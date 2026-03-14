-- Multi-specialty support: ORL + Psicologia
-- Keeps medical_records as the canonical source and adds explicit specialty/context tables.

create extension if not exists unaccent;

alter table if exists public.medical_records
  add column if not exists specialty text;

update public.medical_records
set specialty = case
  when lower(unaccent(coalesce(consultation_type, ''))) like '%psic%' then 'psicologia'
  else 'otorrino'
end
where specialty is null;

alter table if exists public.medical_records
  alter column specialty set default 'otorrino';

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'medical_records'
      and column_name = 'specialty'
  ) and not exists (
    select 1 from pg_constraint where conname = 'medical_records_specialty_chk'
  ) then
    alter table public.medical_records
      add constraint medical_records_specialty_chk
      check (specialty in ('otorrino', 'psicologia'));
  end if;
end $$;

create index if not exists medical_records_specialty_idx
  on public.medical_records (specialty, updated_at desc);

create table if not exists public.clinical_specialty_profiles (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  specialty text not null check (specialty in ('otorrino', 'psicologia')),
  display_name text,
  note_preferences jsonb not null default '{}'::jsonb,
  report_preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  unique (owner_user_id, specialty)
);

create table if not exists public.psychology_consultation_contexts (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null references public.medical_records(record_uuid) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  session_format text,
  care_context text,
  focus_areas text[] not null default '{}'::text[],
  risk_level text,
  observed_state text,
  protective_factors text[] not null default '{}'::text[],
  intervention_summary text,
  homework_plan text,
  followup_plan text,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  unique (record_id)
);

create index if not exists clinical_specialty_profiles_owner_specialty_idx
  on public.clinical_specialty_profiles (owner_user_id, specialty);

create index if not exists psychology_consultation_contexts_owner_created_idx
  on public.psychology_consultation_contexts (owner_user_id, created_at desc);

create index if not exists psychology_consultation_contexts_record_idx
  on public.psychology_consultation_contexts (record_id);

alter table if exists public.clinical_specialty_profiles enable row level security;
alter table if exists public.psychology_consultation_contexts enable row level security;

drop policy if exists "clinical_specialty_profiles_select_owner" on public.clinical_specialty_profiles;
drop policy if exists "clinical_specialty_profiles_insert_owner" on public.clinical_specialty_profiles;
drop policy if exists "clinical_specialty_profiles_update_owner" on public.clinical_specialty_profiles;
drop policy if exists "clinical_specialty_profiles_delete_owner" on public.clinical_specialty_profiles;

create policy "clinical_specialty_profiles_select_owner" on public.clinical_specialty_profiles
  for select to authenticated
  using (auth.uid() = owner_user_id);

create policy "clinical_specialty_profiles_insert_owner" on public.clinical_specialty_profiles
  for insert to authenticated
  with check (auth.uid() = owner_user_id);

create policy "clinical_specialty_profiles_update_owner" on public.clinical_specialty_profiles
  for update to authenticated
  using (auth.uid() = owner_user_id)
  with check (auth.uid() = owner_user_id);

create policy "clinical_specialty_profiles_delete_owner" on public.clinical_specialty_profiles
  for delete to authenticated
  using (auth.uid() = owner_user_id);

drop policy if exists "psychology_consultation_contexts_select_owner" on public.psychology_consultation_contexts;
drop policy if exists "psychology_consultation_contexts_insert_owner" on public.psychology_consultation_contexts;
drop policy if exists "psychology_consultation_contexts_update_owner" on public.psychology_consultation_contexts;
drop policy if exists "psychology_consultation_contexts_delete_owner" on public.psychology_consultation_contexts;

create policy "psychology_consultation_contexts_select_owner" on public.psychology_consultation_contexts
  for select to authenticated
  using (auth.uid() = owner_user_id);

create policy "psychology_consultation_contexts_insert_owner" on public.psychology_consultation_contexts
  for insert to authenticated
  with check (auth.uid() = owner_user_id);

create policy "psychology_consultation_contexts_update_owner" on public.psychology_consultation_contexts
  for update to authenticated
  using (auth.uid() = owner_user_id)
  with check (auth.uid() = owner_user_id);

create policy "psychology_consultation_contexts_delete_owner" on public.psychology_consultation_contexts
  for delete to authenticated
  using (auth.uid() = owner_user_id);
