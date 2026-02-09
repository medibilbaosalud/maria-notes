-- Model traceability: per-attempt provider/model logs
create extension if not exists pgcrypto;

create table if not exists ai_model_invocations (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid references ai_audit_logs(id) on delete cascade,
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

create index if not exists ai_model_invocations_audit_task_attempt_idx on ai_model_invocations(audit_id, task, attempt_index);
create index if not exists ai_model_invocations_provider_model_created_idx on ai_model_invocations(provider, model, created_at desc);
create index if not exists ai_model_invocations_success_created_idx on ai_model_invocations(success, created_at desc);

alter table ai_model_invocations enable row level security;

drop trigger if exists ai_model_invocations_owner_default on ai_model_invocations;
create trigger ai_model_invocations_owner_default
before insert on ai_model_invocations
for each row execute function apply_owner_default();

drop policy if exists "ai_model_invocations_select_owner" on ai_model_invocations;
drop policy if exists "ai_model_invocations_insert_owner" on ai_model_invocations;
drop policy if exists "ai_model_invocations_update_owner" on ai_model_invocations;
drop policy if exists "ai_model_invocations_delete_owner" on ai_model_invocations;

create policy "ai_model_invocations_select_owner" on ai_model_invocations
for select to authenticated
using (owner_user_id = auth.uid());

create policy "ai_model_invocations_insert_owner" on ai_model_invocations
for insert to authenticated
with check (owner_user_id = auth.uid());

create policy "ai_model_invocations_update_owner" on ai_model_invocations
for update to authenticated
using (owner_user_id = auth.uid())
with check (owner_user_id = auth.uid());

create policy "ai_model_invocations_delete_owner" on ai_model_invocations
for delete to authenticated
using (owner_user_id = auth.uid());
