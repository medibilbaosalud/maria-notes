create extension if not exists pgcrypto;

create table if not exists public.doctor_satisfaction_events (
  id uuid primary key default gen_random_uuid(),
  record_id uuid references public.medical_records(record_uuid) on delete set null,
  score smallint not null check (score between 1 and 10),
  context jsonb not null default '{}'::jsonb,
  owner_user_id uuid,
  created_at timestamptz not null default timezone('utc'::text, now())
);

create table if not exists public.consultation_quality_summary (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null references public.medical_records(record_uuid) on delete cascade,
  quality_score smallint not null check (quality_score between 0 and 100),
  critical_gaps_count integer not null default 0,
  corrected_count integer not null default 0,
  owner_user_id uuid,
  created_at timestamptz not null default timezone('utc'::text, now()),
  unique(record_id)
);

create index if not exists doctor_satisfaction_events_created_idx on public.doctor_satisfaction_events(created_at desc);
create index if not exists doctor_satisfaction_events_record_idx on public.doctor_satisfaction_events(record_id);
create index if not exists consultation_quality_summary_created_idx on public.consultation_quality_summary(created_at desc);
create index if not exists consultation_quality_summary_record_idx on public.consultation_quality_summary(record_id);

alter table public.doctor_satisfaction_events enable row level security;
alter table public.consultation_quality_summary enable row level security;

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

drop trigger if exists doctor_satisfaction_events_owner_default on public.doctor_satisfaction_events;
create trigger doctor_satisfaction_events_owner_default
before insert on public.doctor_satisfaction_events
for each row execute function public.apply_owner_default();

drop trigger if exists consultation_quality_summary_owner_default on public.consultation_quality_summary;
create trigger consultation_quality_summary_owner_default
before insert on public.consultation_quality_summary
for each row execute function public.apply_owner_default();

drop policy if exists "doctor_satisfaction_events_select_owner" on public.doctor_satisfaction_events;
drop policy if exists "doctor_satisfaction_events_insert_owner" on public.doctor_satisfaction_events;
drop policy if exists "doctor_satisfaction_events_update_owner" on public.doctor_satisfaction_events;
drop policy if exists "doctor_satisfaction_events_delete_owner" on public.doctor_satisfaction_events;

create policy "doctor_satisfaction_events_select_owner" on public.doctor_satisfaction_events
for select to authenticated
using (owner_user_id = auth.uid());

create policy "doctor_satisfaction_events_insert_owner" on public.doctor_satisfaction_events
for insert to authenticated
with check (owner_user_id = auth.uid());

create policy "doctor_satisfaction_events_update_owner" on public.doctor_satisfaction_events
for update to authenticated
using (owner_user_id = auth.uid())
with check (owner_user_id = auth.uid());

create policy "doctor_satisfaction_events_delete_owner" on public.doctor_satisfaction_events
for delete to authenticated
using (owner_user_id = auth.uid());

drop policy if exists "consultation_quality_summary_select_owner" on public.consultation_quality_summary;
drop policy if exists "consultation_quality_summary_insert_owner" on public.consultation_quality_summary;
drop policy if exists "consultation_quality_summary_update_owner" on public.consultation_quality_summary;
drop policy if exists "consultation_quality_summary_delete_owner" on public.consultation_quality_summary;

create policy "consultation_quality_summary_select_owner" on public.consultation_quality_summary
for select to authenticated
using (owner_user_id = auth.uid());

create policy "consultation_quality_summary_insert_owner" on public.consultation_quality_summary
for insert to authenticated
with check (owner_user_id = auth.uid());

create policy "consultation_quality_summary_update_owner" on public.consultation_quality_summary
for update to authenticated
using (owner_user_id = auth.uid())
with check (owner_user_id = auth.uid());

create policy "consultation_quality_summary_delete_owner" on public.consultation_quality_summary
for delete to authenticated
using (owner_user_id = auth.uid());
