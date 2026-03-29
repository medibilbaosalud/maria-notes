-- Diagnostico rapido de Supabase para Maria Notes
-- Ejecutar en el SQL editor de Supabase.
-- Este script es solo de lectura: no modifica datos.

-- ============================================================
-- 1) TABLAS QUE EL CODIGO USA EN RUNTIME
-- ============================================================
with expected_tables(table_name, area, required) as (
    values
        ('medical_records', 'runtime_principal', true),
        ('consultation_transcript_chunks', 'runtime_principal', true),
        ('consultation_histories', 'runtime_principal', true),
        ('legacy_clinical_records', 'historico', true),
        ('patient_briefings', 'briefings', true),
        ('error_logs', 'errores', true),
        ('app_error_events', 'errores', false),
        ('consultation_quality_summary', 'calidad', false),
        ('doctor_satisfaction_events', 'calidad', false),
        ('clinical_generation_diagnostics', 'diagnostico', false),
        ('clinical_generation_diagnostic_edits', 'diagnostico', false),
        ('ai_audit_logs', 'ai_runtime', false),
        ('ai_pipeline_runs', 'ai_runtime', false),
        ('ai_pipeline_attempts', 'ai_runtime', false),
        ('ai_learning_events', 'ai_runtime', false),
        ('ai_improvement_lessons', 'ai_runtime', false),
        ('ai_learning_decisions', 'ai_runtime', false),
        ('ai_long_term_memory', 'ai_runtime', false),
        ('ai_quality_events', 'ai_runtime', false),
        ('ai_quality_metrics_daily', 'ai_runtime', false),
        ('ai_rule_candidates', 'ai_runtime', false),
        ('ai_rule_evaluations', 'ai_runtime', false),
        ('ai_rule_evidence_rollups', 'ai_runtime', false),
        ('ai_rule_pack_versions_v2', 'ai_runtime', false),
        ('ai_chunks', 'ai_runtime', false),
        ('ai_field_lineage', 'ai_runtime', false),
        ('ai_model_invocations', 'ai_runtime', false),
        ('ai_semantic_checks', 'ai_runtime', false),
        ('ai_field_confirmations', 'ai_runtime', false)
)
select
    e.table_name,
    e.area,
    e.required,
    case when t.table_name is not null then 'ok' else 'missing' end as status
from expected_tables e
left join information_schema.tables t
    on t.table_schema = 'public'
   and t.table_name = e.table_name
order by e.required desc, e.area, e.table_name;

-- ============================================================
-- 2) COLUMNAS CRITICAS
-- ============================================================
with required_columns(table_name, column_name) as (
    values
        ('medical_records', 'record_uuid'),
        ('medical_records', 'patient_name'),
        ('medical_records', 'specialty'),
        ('medical_records', 'clinician_profile'),
        ('medical_records', 'transcription'),
        ('medical_records', 'medical_history'),
        ('medical_records', 'created_at'),
        ('medical_records', 'updated_at'),
        ('medical_records', 'output_tier'),
        ('medical_records', 'supersedes_record_uuid'),
        ('medical_records', 'source_session_id'),
        ('medical_records', 'critical_path_ms'),
        ('medical_records', 'hardening_ms'),
        ('consultation_transcript_chunks', 'session_id'),
        ('consultation_transcript_chunks', 'text'),
        ('consultation_transcript_chunks', 'status'),
        ('consultation_transcript_chunks', 'created_at'),
        ('consultation_histories', 'audit_id'),
        ('consultation_histories', 'session_id'),
        ('consultation_histories', 'patient_name'),
        ('consultation_histories', 'medical_history'),
        ('consultation_histories', 'transcription_text'),
        ('consultation_histories', 'created_at'),
        ('legacy_clinical_records', 'patient_name'),
        ('legacy_clinical_records', 'medical_history'),
        ('patient_briefings', 'patient_name'),
        ('patient_briefings', 'status'),
        ('error_logs', 'message'),
        ('error_logs', 'created_at')
)
select
    rc.table_name,
    rc.column_name,
    case when c.column_name is not null then 'ok' else 'missing' end as status
from required_columns rc
left join information_schema.columns c
    on c.table_schema = 'public'
   and c.table_name = rc.table_name
   and c.column_name = rc.column_name
order by rc.table_name, rc.column_name;

-- ============================================================
-- 3) ESTADO DE RLS
-- Para app interna deberia salir false en runtime_principal.
-- ============================================================
with target_tables(table_name) as (
    values
        ('medical_records'),
        ('consultation_transcript_chunks'),
        ('consultation_histories'),
        ('legacy_clinical_records'),
        ('patient_briefings'),
        ('error_logs'),
        ('app_error_events'),
        ('ai_audit_logs'),
        ('ai_chunks'),
        ('ai_field_lineage'),
        ('ai_model_invocations'),
        ('ai_pipeline_runs'),
        ('ai_pipeline_attempts')
)
select
    c.relname as table_name,
    c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
join target_tables t on t.table_name = c.relname
where n.nspname = 'public'
order by c.relname;

-- ============================================================
-- 4) PRIVILEGIOS EFECTIVOS
-- Para app interna deberia salir true en anon_crud_ok.
-- ============================================================
with target_tables(table_name) as (
    values
        ('medical_records'),
        ('consultation_transcript_chunks'),
        ('consultation_histories'),
        ('legacy_clinical_records'),
        ('patient_briefings'),
        ('error_logs'),
        ('app_error_events'),
        ('ai_audit_logs'),
        ('ai_chunks'),
        ('ai_field_lineage'),
        ('ai_model_invocations'),
        ('ai_pipeline_runs'),
        ('ai_pipeline_attempts')
)
select
    table_name,
    has_table_privilege('anon', format('public.%I', table_name), 'select') as anon_select_ok,
    has_table_privilege('anon', format('public.%I', table_name), 'insert') as anon_insert_ok,
    has_table_privilege('anon', format('public.%I', table_name), 'update') as anon_update_ok,
    has_table_privilege('anon', format('public.%I', table_name), 'delete') as anon_delete_ok
from target_tables
order by table_name;

-- ============================================================
-- 5) CONTEOS DE TABLAS CLAVE
-- ============================================================
with target_tables(table_name) as (
    values
        ('medical_records'),
        ('consultation_transcript_chunks'),
        ('consultation_histories'),
        ('legacy_clinical_records'),
        ('patient_briefings'),
        ('error_logs'),
        ('app_error_events'),
        ('ai_audit_logs'),
        ('ai_chunks'),
        ('ai_field_lineage'),
        ('ai_model_invocations'),
        ('ai_pipeline_runs'),
        ('ai_pipeline_attempts')
),
existing_tables as (
    select t.table_name
    from target_tables t
    join information_schema.tables i
      on i.table_schema = 'public'
     and i.table_name = t.table_name
)
select
    e.table_name,
    (
        xpath(
            '/row/c/text()',
            query_to_xml(format('select count(*) as c from public.%I', e.table_name), false, true, '')
        )
    )[1]::text::bigint as total
from existing_tables e
order by e.table_name;

-- ============================================================
-- 6) ACTIVIDAD RECIENTE DE HOY
-- Si aqui sale 0 en todo, la app no esta subiendo nada nuevo.
-- ============================================================
with bounds as (
    select date_trunc('day', now()) as today_start
)
select 'medical_records_today' as metric, count(*) as total
from public.medical_records, bounds
where created_at >= bounds.today_start
union all
select 'transcript_chunks_today', count(*)
from public.consultation_transcript_chunks, bounds
where created_at >= bounds.today_start
union all
select 'consultation_histories_today', count(*)
from public.consultation_histories, bounds
where created_at >= bounds.today_start
union all
select 'ai_audit_logs_today', count(*)
from public.ai_audit_logs, bounds
where created_at >= bounds.today_start
union all
select 'ai_pipeline_runs_today', count(*)
from public.ai_pipeline_runs, bounds
where created_at >= bounds.today_start;

-- ============================================================
-- 7) ULTIMAS FILAS UTILES PARA DEPURAR
-- ============================================================
select
    record_uuid,
    patient_name,
    specialty,
    consultation_type,
    clinician_profile,
    created_at,
    updated_at
from public.medical_records
order by created_at desc
limit 10;

select
    session_id,
    batch_index,
    status,
    left(text, 120) as text_preview,
    created_at,
    updated_at
from public.consultation_transcript_chunks
order by created_at desc
limit 10;

select
    audit_id,
    session_id,
    patient_name,
    clinician_profile,
    left(medical_history, 120) as medical_history_preview,
    left(coalesce(transcription_text, ''), 120) as transcription_preview,
    created_at
from public.consultation_histories
order by created_at desc
limit 10;

-- ============================================================
-- 8) INTEGRIDAD BASICA ENTRE TABLAS
-- ============================================================
select
    mr.record_uuid,
    mr.patient_name,
    mr.created_at,
    case when ch.audit_id is not null then 'has_history' else 'missing_history' end as history_status
from public.medical_records mr
left join public.consultation_histories ch
    on ch.session_id = mr.record_uuid::text
    or (
        ch.patient_name = mr.patient_name
        and ch.created_at::date = mr.created_at::date
    )
order by mr.created_at desc
limit 20;
