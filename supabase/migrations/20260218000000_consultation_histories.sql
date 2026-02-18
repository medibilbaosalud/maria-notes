-- Persist final generated histories with exact model traceability.
create extension if not exists pgcrypto;

create table if not exists public.consultation_histories (
  id uuid primary key default gen_random_uuid(),
  audit_id text not null,
  session_id text,
  name text,
  patient_name text,
  medical_history text not null,
  primary_model text,
  models_used jsonb not null default '{}'::jsonb,
  model_invocations jsonb not null default '[]'::jsonb,
  successful boolean not null default true,
  pipeline_version text,
  owner_user_id uuid,
  created_at timestamptz not null default timezone('utc'::text, now())
);

alter table if exists public.consultation_histories add column if not exists name text;
alter table if exists public.consultation_histories add column if not exists patient_name text;

create unique index if not exists consultation_histories_audit_id_uq on public.consultation_histories(audit_id);
create index if not exists consultation_histories_created_at_idx on public.consultation_histories(created_at desc);
create index if not exists consultation_histories_name_created_idx on public.consultation_histories(name, created_at desc);
create index if not exists consultation_histories_patient_created_idx on public.consultation_histories(patient_name, created_at desc);

alter table public.consultation_histories enable row level security;

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

drop trigger if exists consultation_histories_owner_default on public.consultation_histories;
create trigger consultation_histories_owner_default
before insert on public.consultation_histories
for each row execute function public.apply_owner_default();

do $$
begin
  if exists(select 1 from information_schema.tables where table_schema = 'public' and table_name = 'consultation_histories')
     and not exists(select 1 from public.consultation_histories where owner_user_id is null)
  then
    alter table public.consultation_histories alter column owner_user_id set not null;
  end if;
end $$;

drop policy if exists "consultation_histories_select_owner" on public.consultation_histories;
drop policy if exists "consultation_histories_insert_owner" on public.consultation_histories;
drop policy if exists "consultation_histories_update_owner" on public.consultation_histories;
drop policy if exists "consultation_histories_delete_owner" on public.consultation_histories;

create policy "consultation_histories_select_owner" on public.consultation_histories
for select to authenticated
using (owner_user_id = auth.uid());

create policy "consultation_histories_insert_owner" on public.consultation_histories
for insert to authenticated
with check (owner_user_id = auth.uid());

create policy "consultation_histories_update_owner" on public.consultation_histories
for update to authenticated
using (owner_user_id = auth.uid())
with check (owner_user_id = auth.uid());

create policy "consultation_histories_delete_owner" on public.consultation_histories
for delete to authenticated
using (owner_user_id = auth.uid());
