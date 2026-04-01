create or replace function public.legacy_clinician_profile_from_row(
  p_usuario text
)
returns text
language sql
immutable
as $$
  select case
    when lower(coalesce(p_usuario, '')) = 'adelgadopsico@gmail.com' then 'ainhoa'
    when lower(coalesce(p_usuario, '')) = 'juneamoressanchez@gmail.com' then 'june'
    when lower(coalesce(p_usuario, '')) = 'igotxi@medibilbaosalud.com' then 'gotxi'
    else null
  end;
$$;

do $$
begin
  if to_regclass('public.medical_records') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'medical_records' and column_name = 'clinician_profile') then
    if exists (select 1 from pg_constraint where conname = 'medical_records_clinician_profile_chk') then
      alter table public.medical_records drop constraint medical_records_clinician_profile_chk;
    end if;
    alter table public.medical_records
      add constraint medical_records_clinician_profile_chk
      check (clinician_profile is null or clinician_profile in ('ainhoa', 'june', 'gotxi'));
  end if;

  if to_regclass('public.ai_audit_logs') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ai_audit_logs' and column_name = 'clinician_profile') then
    if exists (select 1 from pg_constraint where conname = 'ai_audit_logs_clinician_profile_chk') then
      alter table public.ai_audit_logs drop constraint ai_audit_logs_clinician_profile_chk;
    end if;
    alter table public.ai_audit_logs
      add constraint ai_audit_logs_clinician_profile_chk
      check (clinician_profile is null or clinician_profile in ('ainhoa', 'june', 'gotxi'));
  end if;

  if to_regclass('public.ai_pipeline_runs') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ai_pipeline_runs' and column_name = 'clinician_profile') then
    if exists (select 1 from pg_constraint where conname = 'ai_pipeline_runs_clinician_profile_chk') then
      alter table public.ai_pipeline_runs drop constraint ai_pipeline_runs_clinician_profile_chk;
    end if;
    alter table public.ai_pipeline_runs
      add constraint ai_pipeline_runs_clinician_profile_chk
      check (clinician_profile is null or clinician_profile in ('ainhoa', 'june', 'gotxi'));
  end if;

  if to_regclass('public.ai_pipeline_attempts') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ai_pipeline_attempts' and column_name = 'clinician_profile') then
    if exists (select 1 from pg_constraint where conname = 'ai_pipeline_attempts_clinician_profile_chk') then
      alter table public.ai_pipeline_attempts drop constraint ai_pipeline_attempts_clinician_profile_chk;
    end if;
    alter table public.ai_pipeline_attempts
      add constraint ai_pipeline_attempts_clinician_profile_chk
      check (clinician_profile is null or clinician_profile in ('ainhoa', 'june', 'gotxi'));
  end if;

  if to_regclass('public.ai_model_invocations') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ai_model_invocations' and column_name = 'clinician_profile') then
    if exists (select 1 from pg_constraint where conname = 'ai_model_invocations_clinician_profile_chk') then
      alter table public.ai_model_invocations drop constraint ai_model_invocations_clinician_profile_chk;
    end if;
    alter table public.ai_model_invocations
      add constraint ai_model_invocations_clinician_profile_chk
      check (clinician_profile is null or clinician_profile in ('ainhoa', 'june', 'gotxi'));
  end if;

  if to_regclass('public.doctor_satisfaction_events') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'doctor_satisfaction_events' and column_name = 'clinician_profile') then
    if exists (select 1 from pg_constraint where conname = 'doctor_satisfaction_events_clinician_profile_chk') then
      alter table public.doctor_satisfaction_events drop constraint doctor_satisfaction_events_clinician_profile_chk;
    end if;
    alter table public.doctor_satisfaction_events
      add constraint doctor_satisfaction_events_clinician_profile_chk
      check (clinician_profile is null or clinician_profile in ('ainhoa', 'june', 'gotxi'));
  end if;

  if to_regclass('public.consultation_quality_summary') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'consultation_quality_summary' and column_name = 'clinician_profile') then
    if exists (select 1 from pg_constraint where conname = 'consultation_quality_summary_clinician_profile_chk') then
      alter table public.consultation_quality_summary drop constraint consultation_quality_summary_clinician_profile_chk;
    end if;
    alter table public.consultation_quality_summary
      add constraint consultation_quality_summary_clinician_profile_chk
      check (clinician_profile is null or clinician_profile in ('ainhoa', 'june', 'gotxi'));
  end if;

  if to_regclass('public.consultation_histories') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'consultation_histories' and column_name = 'clinician_profile') then
    if exists (select 1 from pg_constraint where conname = 'consultation_histories_clinician_profile_chk') then
      alter table public.consultation_histories drop constraint consultation_histories_clinician_profile_chk;
    end if;
    alter table public.consultation_histories
      add constraint consultation_histories_clinician_profile_chk
      check (clinician_profile is null or clinician_profile in ('ainhoa', 'june', 'gotxi'));
  end if;

  if to_regclass('public.clinical_specialty_profiles') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'clinical_specialty_profiles' and column_name = 'clinician_profile') then
    if exists (select 1 from pg_constraint where conname = 'clinical_specialty_profiles_clinician_profile_chk') then
      alter table public.clinical_specialty_profiles drop constraint clinical_specialty_profiles_clinician_profile_chk;
    end if;
    alter table public.clinical_specialty_profiles
      add constraint clinical_specialty_profiles_clinician_profile_chk
      check (clinician_profile is null or clinician_profile in ('ainhoa', 'june', 'gotxi'));
  end if;

  if to_regclass('public.psychology_consultation_contexts') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'psychology_consultation_contexts' and column_name = 'clinician_profile') then
    if exists (select 1 from pg_constraint where conname = 'psychology_consultation_contexts_clinician_profile_chk') then
      alter table public.psychology_consultation_contexts drop constraint psychology_consultation_contexts_clinician_profile_chk;
    end if;
    alter table public.psychology_consultation_contexts
      add constraint psychology_consultation_contexts_clinician_profile_chk
      check (clinician_profile is null or clinician_profile in ('ainhoa', 'june', 'gotxi'));
  end if;

  if to_regclass('public.ai_learning_events') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ai_learning_events' and column_name = 'clinician_profile') then
    if exists (select 1 from pg_constraint where conname = 'ai_learning_events_clinician_profile_chk') then
      alter table public.ai_learning_events drop constraint ai_learning_events_clinician_profile_chk;
    end if;
    alter table public.ai_learning_events
      add constraint ai_learning_events_clinician_profile_chk
      check (clinician_profile is null or clinician_profile in ('ainhoa', 'june', 'gotxi'));
  end if;

  if to_regclass('public.ai_rule_candidates') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ai_rule_candidates' and column_name = 'clinician_profile') then
    if exists (select 1 from pg_constraint where conname = 'ai_rule_candidates_clinician_profile_chk') then
      alter table public.ai_rule_candidates drop constraint ai_rule_candidates_clinician_profile_chk;
    end if;
    alter table public.ai_rule_candidates
      add constraint ai_rule_candidates_clinician_profile_chk
      check (clinician_profile is null or clinician_profile in ('ainhoa', 'june', 'gotxi'));
  end if;

  if to_regclass('public.ai_rule_evaluations') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ai_rule_evaluations' and column_name = 'clinician_profile') then
    if exists (select 1 from pg_constraint where conname = 'ai_rule_evaluations_clinician_profile_chk') then
      alter table public.ai_rule_evaluations drop constraint ai_rule_evaluations_clinician_profile_chk;
    end if;
    alter table public.ai_rule_evaluations
      add constraint ai_rule_evaluations_clinician_profile_chk
      check (clinician_profile is null or clinician_profile in ('ainhoa', 'june', 'gotxi'));
  end if;

  if to_regclass('public.ai_learning_decisions') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ai_learning_decisions' and column_name = 'clinician_profile') then
    if exists (select 1 from pg_constraint where conname = 'ai_learning_decisions_clinician_profile_chk') then
      alter table public.ai_learning_decisions drop constraint ai_learning_decisions_clinician_profile_chk;
    end if;
    alter table public.ai_learning_decisions
      add constraint ai_learning_decisions_clinician_profile_chk
      check (clinician_profile is null or clinician_profile in ('ainhoa', 'june', 'gotxi'));
  end if;

  if to_regclass('public.ai_rule_pack_versions_v2') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ai_rule_pack_versions_v2' and column_name = 'clinician_profile') then
    if exists (select 1 from pg_constraint where conname = 'ai_rule_pack_versions_v2_clinician_profile_chk') then
      alter table public.ai_rule_pack_versions_v2 drop constraint ai_rule_pack_versions_v2_clinician_profile_chk;
    end if;
    alter table public.ai_rule_pack_versions_v2
      add constraint ai_rule_pack_versions_v2_clinician_profile_chk
      check (clinician_profile is null or clinician_profile in ('ainhoa', 'june', 'gotxi'));
  end if;

  if to_regclass('public.ai_rule_evidence_rollups') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ai_rule_evidence_rollups' and column_name = 'clinician_profile') then
    if exists (select 1 from pg_constraint where conname = 'ai_rule_evidence_rollups_clinician_profile_chk') then
      alter table public.ai_rule_evidence_rollups drop constraint ai_rule_evidence_rollups_clinician_profile_chk;
    end if;
    alter table public.ai_rule_evidence_rollups
      add constraint ai_rule_evidence_rollups_clinician_profile_chk
      check (clinician_profile is null or clinician_profile in ('ainhoa', 'june', 'gotxi'));
  end if;

  if to_regclass('public.clinical_generation_diagnostics') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'clinical_generation_diagnostics' and column_name = 'clinician_profile') then
    if exists (select 1 from pg_constraint where conname = 'clinical_generation_diagnostics_clinician_profile_chk') then
      alter table public.clinical_generation_diagnostics drop constraint clinical_generation_diagnostics_clinician_profile_chk;
    end if;
    alter table public.clinical_generation_diagnostics
      add constraint clinical_generation_diagnostics_clinician_profile_chk
      check (clinician_profile is null or clinician_profile in ('ainhoa', 'june', 'gotxi'));
  end if;

  if to_regclass('public.clinical_generation_diagnostic_edits') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'clinical_generation_diagnostic_edits' and column_name = 'clinician_profile') then
    if exists (select 1 from pg_constraint where conname = 'clinical_generation_diagnostic_edits_clinician_profile_chk') then
      alter table public.clinical_generation_diagnostic_edits drop constraint clinical_generation_diagnostic_edits_clinician_profile_chk;
    end if;
    alter table public.clinical_generation_diagnostic_edits
      add constraint clinical_generation_diagnostic_edits_clinician_profile_chk
      check (clinician_profile is null or clinician_profile in ('ainhoa', 'june', 'gotxi'));
  end if;
end $$;

do $$
begin
  if to_regclass('public.legacy_clinical_records') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'legacy_clinical_records' and column_name = 'clinician_profile')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'legacy_clinical_records' and column_name = 'specialty') then
    update public.legacy_clinical_records
    set clinician_profile = 'gotxi',
        specialist_name = coalesce(nullif(specialist_name, ''), 'Dra. Gotxi'),
        updated_at = now()
    where specialty = 'otorrino'
      and (
        lower(coalesce(source_email, '')) = 'igotxi@medibilbaosalud.com'
        or lower(coalesce(specialist_name, '')) like '%gotxi%'
        or lower(coalesce(specialist_name, '')) like '%itziar%'
      )
      and coalesce(clinician_profile, '') <> 'gotxi';
  end if;

  if to_regclass('public.medical_records') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'medical_records' and column_name = 'clinician_profile')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'medical_records' and column_name = 'specialty') then
    update public.medical_records
    set clinician_profile = 'gotxi'
    where specialty = 'otorrino'
      and clinician_profile is null;
  end if;

  if to_regclass('public.ai_audit_logs') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ai_audit_logs' and column_name = 'clinician_profile')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ai_audit_logs' and column_name = 'specialty') then
    update public.ai_audit_logs
    set clinician_profile = 'gotxi'
    where clinician_profile is null
      and specialty = 'otorrino';
  end if;

  if to_regclass('public.ai_pipeline_runs') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ai_pipeline_runs' and column_name = 'clinician_profile')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ai_pipeline_runs' and column_name = 'metadata') then
    update public.ai_pipeline_runs
    set clinician_profile = 'gotxi'
    where clinician_profile is null
      and lower(coalesce(metadata ->> 'consultation_type', '')) = 'otorrino';
  end if;

  if to_regclass('public.ai_pipeline_attempts') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ai_pipeline_attempts' and column_name = 'clinician_profile')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ai_pipeline_attempts' and column_name = 'specialty') then
    update public.ai_pipeline_attempts
    set clinician_profile = 'gotxi'
    where clinician_profile is null
      and specialty = 'otorrino';
  end if;

  if to_regclass('public.ai_model_invocations') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ai_model_invocations' and column_name = 'clinician_profile')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ai_model_invocations' and column_name = 'specialty') then
    update public.ai_model_invocations
    set clinician_profile = 'gotxi'
    where clinician_profile is null
      and specialty = 'otorrino';
  end if;

  if to_regclass('public.doctor_satisfaction_events') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'doctor_satisfaction_events' and column_name = 'clinician_profile')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'doctor_satisfaction_events' and column_name = 'specialty') then
    update public.doctor_satisfaction_events
    set clinician_profile = 'gotxi'
    where clinician_profile is null
      and specialty = 'otorrino';
  end if;

  if to_regclass('public.consultation_quality_summary') is not null
     and to_regclass('public.medical_records') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'consultation_quality_summary' and column_name = 'clinician_profile')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'consultation_quality_summary' and column_name = 'record_id')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'medical_records' and column_name = 'record_uuid')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'medical_records' and column_name = 'clinician_profile')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'medical_records' and column_name = 'specialty') then
    update public.consultation_quality_summary cqs
    set clinician_profile = mr.clinician_profile
    from public.medical_records mr
    where cqs.record_id = mr.record_uuid
      and mr.specialty = 'otorrino'
      and cqs.clinician_profile is distinct from mr.clinician_profile;
  end if;

  if to_regclass('public.consultation_histories') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'consultation_histories' and column_name = 'clinician_profile')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'consultation_histories' and column_name = 'models_used') then
    update public.consultation_histories
    set clinician_profile = 'gotxi'
    where clinician_profile is null
      and lower(coalesce(models_used::text, '')) like '%otorrino%';
  end if;

  if to_regclass('public.clinical_specialty_profiles') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'clinical_specialty_profiles' and column_name = 'specialty')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'clinical_specialty_profiles' and column_name = 'clinician_profile') then
    delete from public.clinical_specialty_profiles generic
    where generic.specialty = 'otorrino'
      and generic.clinician_profile is null
      and exists (
        select 1
        from public.clinical_specialty_profiles scoped
        where scoped.owner_user_id is not distinct from generic.owner_user_id
          and scoped.specialty = 'otorrino'
          and scoped.clinician_profile = 'gotxi'
      );

    update public.clinical_specialty_profiles
    set clinician_profile = 'gotxi',
        display_name = 'Estilo de historias ORL - Dra. Gotxi',
        updated_at = now()
    where specialty = 'otorrino'
      and clinician_profile is null;
  end if;

  if to_regclass('public.ai_learning_events') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ai_learning_events' and column_name = 'clinician_profile')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ai_learning_events' and column_name = 'specialty') then
    update public.ai_learning_events
    set clinician_profile = 'gotxi'
    where clinician_profile is null
      and specialty = 'otorrino';
  end if;

  if to_regclass('public.ai_rule_candidates') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ai_rule_candidates' and column_name = 'clinician_profile')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ai_rule_candidates' and column_name = 'specialty') then
    update public.ai_rule_candidates
    set clinician_profile = 'gotxi'
    where clinician_profile is null
      and specialty = 'otorrino';
  end if;

  if to_regclass('public.ai_rule_evaluations') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ai_rule_evaluations' and column_name = 'clinician_profile')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ai_rule_evaluations' and column_name = 'specialty') then
    update public.ai_rule_evaluations
    set clinician_profile = 'gotxi'
    where clinician_profile is null
      and specialty = 'otorrino';
  end if;

  if to_regclass('public.ai_learning_decisions') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ai_learning_decisions' and column_name = 'clinician_profile')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ai_learning_decisions' and column_name = 'specialty') then
    update public.ai_learning_decisions
    set clinician_profile = 'gotxi'
    where clinician_profile is null
      and specialty = 'otorrino';
  end if;

  if to_regclass('public.ai_rule_pack_versions_v2') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ai_rule_pack_versions_v2' and column_name = 'clinician_profile')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ai_rule_pack_versions_v2' and column_name = 'specialty') then
    update public.ai_rule_pack_versions_v2
    set clinician_profile = 'gotxi'
    where clinician_profile is null
      and specialty = 'otorrino';
  end if;

  if to_regclass('public.ai_rule_evidence_rollups') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ai_rule_evidence_rollups' and column_name = 'clinician_profile')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ai_rule_evidence_rollups' and column_name = 'specialty') then
    update public.ai_rule_evidence_rollups
    set clinician_profile = 'gotxi'
    where clinician_profile is null
      and specialty = 'otorrino';
  end if;

  if to_regclass('public.clinical_generation_diagnostics') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'clinical_generation_diagnostics' and column_name = 'clinician_profile')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'clinical_generation_diagnostics' and column_name = 'specialty') then
    update public.clinical_generation_diagnostics
    set clinician_profile = 'gotxi'
    where clinician_profile is null
      and specialty = 'otorrino';
  end if;

  if to_regclass('public.clinical_generation_diagnostic_edits') is not null
     and to_regclass('public.clinical_generation_diagnostics') is not null then
    update public.clinical_generation_diagnostic_edits edits
    set clinician_profile = diag.clinician_profile
    from public.clinical_generation_diagnostics diag
    where edits.diagnostic_id = diag.id
      and diag.specialty = 'otorrino'
      and edits.clinician_profile is distinct from diag.clinician_profile;
  end if;
end $$;
