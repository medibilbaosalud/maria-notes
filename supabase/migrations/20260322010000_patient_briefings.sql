create extension if not exists pgcrypto;

create table if not exists public.patient_briefings (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  normalized_patient_name text not null,
  patient_name text not null,
  specialty text not null check (specialty in ('psicologia')),
  clinician_profile text,
  clinician_scope text generated always as (coalesce(clinician_profile, '__all__')) stored,
  clinician_name text,
  source_kind text not null default 'current' check (source_kind in ('current', 'legacy', 'mixed')),
  summary_text text not null default '',
  latest_consultation_at timestamptz not null,
  generated_from_count integer not null default 0,
  generated_from_record_ids text[] not null default '{}'::text[],
  model text not null default '',
  status text not null default 'stale' check (status in ('ready', 'failed', 'stale')),
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists patient_briefings_owner_lookup_idx
  on public.patient_briefings (owner_user_id, normalized_patient_name, specialty, updated_at desc);

create index if not exists patient_briefings_latest_idx
  on public.patient_briefings (owner_user_id, latest_consultation_at desc);

create unique index if not exists patient_briefings_owner_patient_specialty_scope_uq
  on public.patient_briefings (
    owner_user_id,
    normalized_patient_name,
    specialty,
    clinician_scope
  );

alter table if exists public.patient_briefings enable row level security;

drop policy if exists "patient_briefings_select_owner" on public.patient_briefings;
drop policy if exists "patient_briefings_insert_owner" on public.patient_briefings;
drop policy if exists "patient_briefings_update_owner" on public.patient_briefings;
drop policy if exists "patient_briefings_delete_owner" on public.patient_briefings;

create policy "patient_briefings_select_owner" on public.patient_briefings
  for select to authenticated
  using (auth.uid() = owner_user_id);

create policy "patient_briefings_insert_owner" on public.patient_briefings
  for insert to authenticated
  with check (auth.uid() = owner_user_id);

create policy "patient_briefings_update_owner" on public.patient_briefings
  for update to authenticated
  using (auth.uid() = owner_user_id)
  with check (auth.uid() = owner_user_id);

create policy "patient_briefings_delete_owner" on public.patient_briefings
  for delete to authenticated
  using (auth.uid() = owner_user_id);
