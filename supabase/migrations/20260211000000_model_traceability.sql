-- Model traceability: per-attempt provider/model logs
create extension if not exists pgcrypto;

create table if not exists public.ai_model_invocations (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid references public.ai_audit_logs(id) on delete cascade,
  session_id text,
  task text not null,
  phase text,
  provider text not null,
  model text not null,
  route_key text not null,
  attempt_index integer not null default 0,
  is_fallback boolean not null default false,
  success boolean not null default false,
  error_type text,
  error_code text,
  latency_ms bigint,
  estimated_tokens integer,
  owner_user_id uuid,
  created_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists ai_model_invocations_audit_task_attempt_idx on public.ai_model_invocations(audit_id, task, attempt_index);
create index if not exists ai_model_invocations_provider_model_created_idx on public.ai_model_invocations(provider, model, created_at desc);
create index if not exists ai_model_invocations_success_created_idx on public.ai_model_invocations(success, created_at desc);

alter table public.ai_model_invocations enable row level security;

-- Ensure owner default trigger exists.
create or replace function public.apply_owner_default()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.owner_user_id is null and auth.uid() is not null then
    new.owner_user_id := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists ai_model_invocations_owner_default on public.ai_model_invocations;
create trigger ai_model_invocations_owner_default
before insert on public.ai_model_invocations
for each row execute function public.apply_owner_default();

do $$
begin
  if exists(select 1 from information_schema.tables where table_schema = 'public' and table_name = 'ai_model_invocations')
     and not exists(select 1 from public.ai_model_invocations where owner_user_id is null)
  then
    alter table public.ai_model_invocations alter column owner_user_id set not null;
  end if;
end $$;

drop policy if exists "ai_model_invocations_select_owner" on public.ai_model_invocations;
drop policy if exists "ai_model_invocations_insert_owner" on public.ai_model_invocations;
drop policy if exists "ai_model_invocations_update_owner" on public.ai_model_invocations;
drop policy if exists "ai_model_invocations_delete_owner" on public.ai_model_invocations;

create policy "ai_model_invocations_select_owner" on public.ai_model_invocations
for select to authenticated
using (owner_user_id = auth.uid());

create policy "ai_model_invocations_insert_owner" on public.ai_model_invocations
for insert to authenticated
with check (owner_user_id = auth.uid());

create policy "ai_model_invocations_update_owner" on public.ai_model_invocations
for update to authenticated
using (owner_user_id = auth.uid())
with check (owner_user_id = auth.uid());

create policy "ai_model_invocations_delete_owner" on public.ai_model_invocations
for delete to authenticated
using (owner_user_id = auth.uid());
