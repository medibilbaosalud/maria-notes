-- Internal runtime guardrails for no-login deployments.
-- Ensures app-facing runtime tables accept writes even when auth.uid() is null.

do $$
declare
  tbl text;
  runtime_tables text[] := array[
    'medical_records',
    'ai_learning_events',
    'ai_improvement_lessons',
    'ai_rule_candidates',
    'ai_rule_evaluations',
    'ai_rule_evidence_rollups',
    'ai_learning_decisions',
    'ai_rule_pack_versions_v2',
    'ai_model_invocations',
    'doctor_satisfaction_events',
    'consultation_quality_summary',
    'clinical_generation_diagnostics',
    'clinical_generation_diagnostic_edits'
  ];
begin
  foreach tbl in array runtime_tables loop
    if exists (
      select 1
      from information_schema.tables
      where table_schema = 'public'
        and table_name = tbl
    ) then
      if exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = tbl
          and column_name = 'owner_user_id'
          and is_nullable = 'NO'
      ) then
        execute format('alter table public.%I alter column owner_user_id drop not null', tbl);
      end if;

      execute format('alter table public.%I disable row level security', tbl);
      execute format('grant select, insert, update, delete on public.%I to anon', tbl);
      execute format('grant select, insert, update, delete on public.%I to authenticated', tbl);
      execute format('grant select, insert, update, delete on public.%I to service_role', tbl);
    end if;
  end loop;
end $$;
