-- Internal-only deployment: disable RLS for runtime tables and grant direct API access.

do $$
declare
  tbl text;
  app_tables text[] := array[
    'medical_records',
    'consultation_transcript_chunks',
    'consultation_histories',
    'legacy_clinical_records',
    'patient_briefings',
    'error_logs',
    'app_error_events',
    'ai_audit_logs',
    'ai_chunks',
    'ai_field_lineage',
    'ai_semantic_checks',
    'ai_field_confirmations',
    'ai_quality_events',
    'ai_quality_metrics_daily',
    'ai_pipeline_runs',
    'ai_pipeline_attempts',
    'ai_audit_outbox',
    'ai_learning_events',
    'ai_improvement_lessons',
    'ai_rule_candidates',
    'ai_rule_evaluations',
    'ai_rule_evidence_rollups',
    'ai_rule_pack_versions_v2',
    'ai_rule_versions',
    'ai_learning_decisions',
    'ai_long_term_memory',
    'ai_model_invocations',
    'doctor_satisfaction_events',
    'consultation_quality_summary',
    'clinical_generation_diagnostics',
    'clinical_generation_diagnostic_edits',
    'clinical_specialty_profiles',
    'psychology_consultation_contexts',
    'legacy_clinical_import_staging'
  ];
begin
  foreach tbl in array app_tables loop
    if exists (
      select 1
      from information_schema.tables
      where table_schema = 'public'
        and table_name = tbl
    ) then
      execute format('alter table public.%I disable row level security', tbl);
      execute format('grant select, insert, update, delete on public.%I to anon', tbl);
      execute format('grant select, insert, update, delete on public.%I to authenticated', tbl);
      execute format('grant select, insert, update, delete on public.%I to service_role', tbl);
    end if;
  end loop;

  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'legacy_clinical_import_staging'
  ) then
    grant usage, select on sequence public.legacy_clinical_import_staging_id_seq to anon;
    grant usage, select on sequence public.legacy_clinical_import_staging_id_seq to authenticated;
    grant usage, select on sequence public.legacy_clinical_import_staging_id_seq to service_role;
  end if;
end $$;
