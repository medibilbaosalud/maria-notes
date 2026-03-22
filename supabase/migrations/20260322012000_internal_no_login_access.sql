-- Internal no-login mode for Maria Notes.
-- Keeps using the anon key, but opens the app-facing continuity tables to anon/public.

alter table if exists public.medical_records
  alter column owner_user_id drop not null;

alter table if exists public.consultation_histories
  alter column owner_user_id drop not null;

alter table if exists public.patient_briefings
  alter column owner_user_id drop not null;

alter table if exists public.patient_briefings
  add column if not exists scope_owner_key text generated always as (coalesce(owner_user_id::text, '__internal__')) stored;

drop index if exists public.patient_briefings_owner_patient_specialty_scope_uq;

create unique index if not exists patient_briefings_scope_owner_patient_specialty_scope_uq
  on public.patient_briefings (
    scope_owner_key,
    normalized_patient_name,
    specialty,
    clinician_scope
  );

alter table if exists public.medical_records enable row level security;
drop policy if exists "medical_records_select_owner" on public.medical_records;
drop policy if exists "medical_records_insert_owner" on public.medical_records;
drop policy if exists "medical_records_update_owner" on public.medical_records;
drop policy if exists "medical_records_delete_owner" on public.medical_records;
create policy "medical_records_select_internal" on public.medical_records
  for select to public
  using (true);
create policy "medical_records_insert_internal" on public.medical_records
  for insert to public
  with check (true);
create policy "medical_records_update_internal" on public.medical_records
  for update to public
  using (true)
  with check (true);
create policy "medical_records_delete_internal" on public.medical_records
  for delete to public
  using (true);

alter table if exists public.consultation_histories enable row level security;
drop policy if exists "consultation_histories_select_owner" on public.consultation_histories;
drop policy if exists "consultation_histories_insert_owner" on public.consultation_histories;
drop policy if exists "consultation_histories_update_owner" on public.consultation_histories;
drop policy if exists "consultation_histories_delete_owner" on public.consultation_histories;
create policy "consultation_histories_select_internal" on public.consultation_histories
  for select to public
  using (true);
create policy "consultation_histories_insert_internal" on public.consultation_histories
  for insert to public
  with check (true);
create policy "consultation_histories_update_internal" on public.consultation_histories
  for update to public
  using (true)
  with check (true);
create policy "consultation_histories_delete_internal" on public.consultation_histories
  for delete to public
  using (true);

alter table if exists public.legacy_clinical_records enable row level security;
drop policy if exists "legacy_clinical_records_select_owner" on public.legacy_clinical_records;
drop policy if exists "legacy_clinical_records_insert_owner" on public.legacy_clinical_records;
drop policy if exists "legacy_clinical_records_update_owner" on public.legacy_clinical_records;
drop policy if exists "legacy_clinical_records_delete_owner" on public.legacy_clinical_records;
create policy "legacy_clinical_records_select_internal" on public.legacy_clinical_records
  for select to public
  using (true);
create policy "legacy_clinical_records_insert_internal" on public.legacy_clinical_records
  for insert to public
  with check (true);
create policy "legacy_clinical_records_update_internal" on public.legacy_clinical_records
  for update to public
  using (true)
  with check (true);
create policy "legacy_clinical_records_delete_internal" on public.legacy_clinical_records
  for delete to public
  using (true);

alter table if exists public.patient_briefings enable row level security;
drop policy if exists "patient_briefings_select_owner" on public.patient_briefings;
drop policy if exists "patient_briefings_insert_owner" on public.patient_briefings;
drop policy if exists "patient_briefings_update_owner" on public.patient_briefings;
drop policy if exists "patient_briefings_delete_owner" on public.patient_briefings;
create policy "patient_briefings_select_internal" on public.patient_briefings
  for select to public
  using (true);
create policy "patient_briefings_insert_internal" on public.patient_briefings
  for insert to public
  with check (true);
create policy "patient_briefings_update_internal" on public.patient_briefings
  for update to public
  using (true)
  with check (true);
create policy "patient_briefings_delete_internal" on public.patient_briefings
  for delete to public
  using (true);
