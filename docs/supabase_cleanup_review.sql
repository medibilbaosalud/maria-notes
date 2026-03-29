-- Review rápida de tablas Supabase para Maria Notes
-- Objetivo:
-- 1) Ver qué tablas tienen datos
-- 2) Detectar tablas candidatas a borrado
-- 3) Borrar solo las claramente no conectadas al runtime actual

-- ============================================================
-- 1) INVENTARIO RÁPIDO
-- ============================================================
select table_name
from information_schema.tables
where table_schema = 'public'
order by table_name;

-- Conteos útiles de las tablas principales/conectadas.
select 'medical_records' as table_name, count(*) as total from public.medical_records
union all
select 'consultation_transcript_chunks', count(*) from public.consultation_transcript_chunks
union all
select 'consultation_histories', count(*) from public.consultation_histories
union all
select 'consultation_quality_summary', count(*) from public.consultation_quality_summary
union all
select 'doctor_satisfaction_events', count(*) from public.doctor_satisfaction_events
union all
select 'clinical_generation_diagnostics', count(*) from public.clinical_generation_diagnostics
union all
select 'clinical_generation_diagnostic_edits', count(*) from public.clinical_generation_diagnostic_edits
union all
select 'legacy_clinical_records', count(*) from public.legacy_clinical_records
union all
select 'patient_briefings', count(*) from public.patient_briefings
union all
select 'error_logs', count(*) from public.error_logs
union all
select 'app_error_events', count(*) from public.app_error_events
union all
select 'ai_pipeline_runs', count(*) from public.ai_pipeline_runs
union all
select 'ai_pipeline_attempts', count(*) from public.ai_pipeline_attempts
union all
select 'ai_model_invocations', count(*) from public.ai_model_invocations
union all
select 'ai_learning_events', count(*) from public.ai_learning_events
union all
select 'ai_improvement_lessons', count(*) from public.ai_improvement_lessons
union all
select 'ai_rule_candidates', count(*) from public.ai_rule_candidates
union all
select 'ai_rule_evaluations', count(*) from public.ai_rule_evaluations
union all
select 'ai_rule_evidence_rollups', count(*) from public.ai_rule_evidence_rollups
union all
select 'ai_rule_pack_versions_v2', count(*) from public.ai_rule_pack_versions_v2
union all
select 'ai_learning_decisions', count(*) from public.ai_learning_decisions
union all
select 'ai_long_term_memory', count(*) from public.ai_long_term_memory
union all
select 'ai_quality_events', count(*) from public.ai_quality_events
union all
select 'ai_quality_metrics_daily', count(*) from public.ai_quality_metrics_daily
union all
select 'ai_chunks', count(*) from public.ai_chunks
union all
select 'ai_field_lineage', count(*) from public.ai_field_lineage
union all
select 'ai_semantic_checks', count(*) from public.ai_semantic_checks
union all
select 'ai_field_confirmations', count(*) from public.ai_field_confirmations
union all
select 'ai_audit_logs', count(*) from public.ai_audit_logs;

-- ============================================================
-- 2) TABLAS ESENCIALES: NO BORRAR
-- ============================================================
-- medical_records
-- consultation_transcript_chunks
-- consultation_histories
-- consultation_quality_summary
-- doctor_satisfaction_events
-- clinical_generation_diagnostics
-- clinical_generation_diagnostic_edits
-- legacy_clinical_records
-- patient_briefings
-- error_logs
-- app_error_events
-- ai_pipeline_runs
-- ai_pipeline_attempts
-- ai_model_invocations
-- ai_audit_logs
-- ai_learning_events
-- ai_improvement_lessons
-- ai_rule_candidates
-- ai_rule_evaluations
-- ai_rule_evidence_rollups
-- ai_rule_pack_versions_v2
-- ai_learning_decisions
-- ai_long_term_memory
-- ai_quality_events
-- ai_quality_metrics_daily
-- ai_chunks
-- ai_field_lineage
-- ai_semantic_checks
-- ai_field_confirmations

-- ============================================================
-- 3) CANDIDATAS CLARAS A BORRADO SI ESTÁN VACÍAS
-- ============================================================
-- Ojo: estas NO están conectadas al runtime actual del repo.
-- Ejecuta primero los count(*) y solo borra si te salen a 0 o ya no las necesitas.

-- A) Cola cloud no usada por la app actual.
drop table if exists public.ai_audit_outbox;

-- B) Versión antigua del sistema de reglas.
drop table if exists public.ai_rule_versions;

-- C) Perfil por especialidad: definida en schema, pero no usada desde runtime.
drop table if exists public.clinical_specialty_profiles;

-- D) Contexto psicológico extendido: creada pero no conectada en la app actual.
drop table if exists public.psychology_consultation_contexts;

-- E) Solo si ya no vas a importar más CSV históricos.
drop table if exists public.legacy_clinical_import_staging;

-- F) Solo si esa tabla existe en tu proyecto real y está vacía.
-- La app guarda estos logs en IndexedDB local, no en Supabase.
drop table if exists public.lab_test_logs;
