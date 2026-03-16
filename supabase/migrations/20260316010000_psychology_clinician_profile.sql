alter table public.medical_records
    add column if not exists clinician_profile text;

alter table public.ai_audit_logs
    add column if not exists clinician_profile text;

alter table public.ai_pipeline_runs
    add column if not exists clinician_profile text;

alter table public.ai_pipeline_attempts
    add column if not exists clinician_profile text;

alter table public.ai_model_invocations
    add column if not exists clinician_profile text;

alter table public.doctor_satisfaction_events
    add column if not exists clinician_profile text;

alter table public.consultation_quality_summary
    add column if not exists clinician_profile text;

alter table public.consultation_histories
    add column if not exists clinician_profile text;

alter table public.clinical_specialty_profiles
    add column if not exists clinician_profile text;

alter table public.psychology_consultation_contexts
    add column if not exists clinician_profile text;

alter table public.ai_learning_events
    add column if not exists clinician_profile text;

alter table public.ai_rule_candidates
    add column if not exists clinician_profile text;

alter table public.ai_rule_evaluations
    add column if not exists clinician_profile text;

alter table public.ai_learning_decisions
    add column if not exists clinician_profile text;

alter table public.ai_rule_pack_versions_v2
    add column if not exists clinician_profile text;

alter table public.ai_rule_evidence_rollups
    add column if not exists clinician_profile text;

alter table public.clinical_generation_diagnostics
    add column if not exists clinician_profile text;

alter table public.clinical_generation_diagnostic_edits
    add column if not exists clinician_profile text;

update public.medical_records
set clinician_profile = 'ainhoa'
where specialty = 'psicologia'
  and clinician_profile is null;

update public.ai_audit_logs
set clinician_profile = 'ainhoa'
where clinician_profile is null
  and (
    lower(coalesce(models_used ->> 'clinician_profile', '')) in ('ainhoa', 'june')
    or lower(coalesce(generation_versions::text, '')) like '%psychology-ainhoa%'
  );

update public.ai_pipeline_runs
set clinician_profile = 'ainhoa'
where clinician_profile is null
  and lower(coalesce(metadata ->> 'consultation_type', '')) = 'psicologia';

update public.ai_pipeline_attempts
set clinician_profile = 'ainhoa'
where clinician_profile is null
  and specialty = 'psicologia';

update public.ai_model_invocations
set clinician_profile = 'ainhoa'
where clinician_profile is null
  and specialty = 'psicologia';

update public.doctor_satisfaction_events
set clinician_profile = 'ainhoa'
where clinician_profile is null
  and specialty = 'psicologia';

update public.consultation_quality_summary cqs
set clinician_profile = mr.clinician_profile
from public.medical_records mr
where cqs.record_id = mr.record_uuid
  and cqs.clinician_profile is null;

update public.consultation_histories
set clinician_profile = 'ainhoa'
where clinician_profile is null
  and lower(coalesce(models_used ->> 'clinician_profile', '')) not in ('ainhoa', 'june')
  and lower(coalesce(models_used::text, '')) like '%psicologia%';

update public.clinical_specialty_profiles
set clinician_profile = 'ainhoa'
where specialty = 'psicologia'
  and clinician_profile is null;

update public.psychology_consultation_contexts pcc
set clinician_profile = mr.clinician_profile
from public.medical_records mr
where pcc.record_id = mr.record_uuid
  and pcc.clinician_profile is null;

update public.ai_learning_events
set clinician_profile = 'ainhoa'
where clinician_profile is null
  and specialty = 'psicologia';

update public.ai_rule_candidates
set clinician_profile = 'ainhoa'
where clinician_profile is null
  and specialty = 'psicologia';

update public.ai_rule_evaluations
set clinician_profile = 'ainhoa'
where clinician_profile is null
  and specialty = 'psicologia';

update public.ai_learning_decisions
set clinician_profile = 'ainhoa'
where clinician_profile is null
  and specialty = 'psicologia';

update public.ai_rule_pack_versions_v2
set clinician_profile = 'ainhoa'
where clinician_profile is null
  and specialty = 'psicologia';

update public.ai_rule_evidence_rollups
set clinician_profile = 'ainhoa'
where clinician_profile is null
  and specialty = 'psicologia';

update public.clinical_generation_diagnostics
set clinician_profile = 'ainhoa'
where clinician_profile is null
  and specialty = 'psicologia';

update public.clinical_generation_diagnostic_edits edits
set clinician_profile = diag.clinician_profile
from public.clinical_generation_diagnostics diag
where edits.diagnostic_id = diag.id
  and edits.clinician_profile is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'medical_records_clinician_profile_chk'
  ) then
    alter table public.medical_records
      add constraint medical_records_clinician_profile_chk
      check (clinician_profile is null or clinician_profile in ('ainhoa', 'june'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'ai_audit_logs_clinician_profile_chk'
  ) then
    alter table public.ai_audit_logs
      add constraint ai_audit_logs_clinician_profile_chk
      check (clinician_profile is null or clinician_profile in ('ainhoa', 'june'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'ai_pipeline_runs_clinician_profile_chk'
  ) then
    alter table public.ai_pipeline_runs
      add constraint ai_pipeline_runs_clinician_profile_chk
      check (clinician_profile is null or clinician_profile in ('ainhoa', 'june'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'ai_pipeline_attempts_clinician_profile_chk'
  ) then
    alter table public.ai_pipeline_attempts
      add constraint ai_pipeline_attempts_clinician_profile_chk
      check (clinician_profile is null or clinician_profile in ('ainhoa', 'june'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'ai_model_invocations_clinician_profile_chk'
  ) then
    alter table public.ai_model_invocations
      add constraint ai_model_invocations_clinician_profile_chk
      check (clinician_profile is null or clinician_profile in ('ainhoa', 'june'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'doctor_satisfaction_events_clinician_profile_chk'
  ) then
    alter table public.doctor_satisfaction_events
      add constraint doctor_satisfaction_events_clinician_profile_chk
      check (clinician_profile is null or clinician_profile in ('ainhoa', 'june'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'consultation_quality_summary_clinician_profile_chk'
  ) then
    alter table public.consultation_quality_summary
      add constraint consultation_quality_summary_clinician_profile_chk
      check (clinician_profile is null or clinician_profile in ('ainhoa', 'june'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'consultation_histories_clinician_profile_chk'
  ) then
    alter table public.consultation_histories
      add constraint consultation_histories_clinician_profile_chk
      check (clinician_profile is null or clinician_profile in ('ainhoa', 'june'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'clinical_specialty_profiles_clinician_profile_chk'
  ) then
    alter table public.clinical_specialty_profiles
      add constraint clinical_specialty_profiles_clinician_profile_chk
      check (
        clinician_profile is null
        or clinician_profile in ('ainhoa', 'june')
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'psychology_consultation_contexts_clinician_profile_chk'
  ) then
    alter table public.psychology_consultation_contexts
      add constraint psychology_consultation_contexts_clinician_profile_chk
      check (clinician_profile is null or clinician_profile in ('ainhoa', 'june'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'ai_learning_events_clinician_profile_chk'
  ) then
    alter table public.ai_learning_events
      add constraint ai_learning_events_clinician_profile_chk
      check (clinician_profile is null or clinician_profile in ('ainhoa', 'june'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'ai_rule_candidates_clinician_profile_chk'
  ) then
    alter table public.ai_rule_candidates
      add constraint ai_rule_candidates_clinician_profile_chk
      check (clinician_profile is null or clinician_profile in ('ainhoa', 'june'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'ai_rule_evaluations_clinician_profile_chk'
  ) then
    alter table public.ai_rule_evaluations
      add constraint ai_rule_evaluations_clinician_profile_chk
      check (clinician_profile is null or clinician_profile in ('ainhoa', 'june'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'ai_learning_decisions_clinician_profile_chk'
  ) then
    alter table public.ai_learning_decisions
      add constraint ai_learning_decisions_clinician_profile_chk
      check (clinician_profile is null or clinician_profile in ('ainhoa', 'june'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'ai_rule_pack_versions_v2_clinician_profile_chk'
  ) then
    alter table public.ai_rule_pack_versions_v2
      add constraint ai_rule_pack_versions_v2_clinician_profile_chk
      check (clinician_profile is null or clinician_profile in ('ainhoa', 'june'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'ai_rule_evidence_rollups_clinician_profile_chk'
  ) then
    alter table public.ai_rule_evidence_rollups
      add constraint ai_rule_evidence_rollups_clinician_profile_chk
      check (clinician_profile is null or clinician_profile in ('ainhoa', 'june'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'clinical_generation_diagnostics_clinician_profile_chk'
  ) then
    alter table public.clinical_generation_diagnostics
      add constraint clinical_generation_diagnostics_clinician_profile_chk
      check (clinician_profile is null or clinician_profile in ('ainhoa', 'june'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'clinical_generation_diagnostic_edits_clinician_profile_chk'
  ) then
    alter table public.clinical_generation_diagnostic_edits
      add constraint clinical_generation_diagnostic_edits_clinician_profile_chk
      check (clinician_profile is null or clinician_profile in ('ainhoa', 'june'));
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'clinical_specialty_profiles_owner_user_id_specialty_key'
  ) then
    alter table public.clinical_specialty_profiles
      drop constraint clinical_specialty_profiles_owner_user_id_specialty_key;
  end if;
end $$;

create unique index if not exists clinical_specialty_profiles_owner_specialty_null_profile_uq
  on public.clinical_specialty_profiles (owner_user_id, specialty)
  where clinician_profile is null;

create unique index if not exists clinical_specialty_profiles_owner_specialty_profile_uq
  on public.clinical_specialty_profiles (owner_user_id, specialty, clinician_profile)
  where clinician_profile is not null;

create index if not exists medical_records_specialty_clinician_idx
  on public.medical_records (specialty, clinician_profile, updated_at desc);

create index if not exists ai_model_invocations_specialty_clinician_idx
  on public.ai_model_invocations (specialty, clinician_profile, artifact_type, created_at desc);

create index if not exists ai_pipeline_attempts_specialty_clinician_idx
  on public.ai_pipeline_attempts (specialty, clinician_profile, stage, created_at desc);

create index if not exists doctor_satisfaction_events_clinician_idx
  on public.doctor_satisfaction_events (specialty, clinician_profile, feedback_stage, created_at desc);

create index if not exists consultation_histories_clinician_idx
  on public.consultation_histories (clinician_profile, created_at desc);

create index if not exists ai_learning_events_scope_clinician_idx
  on public.ai_learning_events (owner_user_id, specialty, clinician_profile, artifact_type, target_section, created_at desc);

create index if not exists ai_rule_candidates_scope_clinician_idx
  on public.ai_rule_candidates (owner_user_id, specialty, clinician_profile, artifact_type, target_section, lifecycle_state, confidence_score desc);

create index if not exists ai_rule_pack_versions_scope_clinician_idx
  on public.ai_rule_pack_versions_v2 (owner_user_id, specialty, clinician_profile, artifact_type, target_section, active);

create index if not exists clinical_generation_diagnostics_clinician_idx
  on public.clinical_generation_diagnostics (owner_user_id, specialty, clinician_profile, created_at desc);
