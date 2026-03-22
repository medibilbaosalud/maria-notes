alter table if exists public.patient_briefings
  add column if not exists clinician_scope text generated always as (coalesce(clinician_profile, '__all__')) stored;

drop index if exists public.patient_briefings_owner_patient_specialty_scope_uq;

create unique index if not exists patient_briefings_owner_patient_specialty_scope_uq
  on public.patient_briefings (
    owner_user_id,
    normalized_patient_name,
    specialty,
    clinician_scope
  );
