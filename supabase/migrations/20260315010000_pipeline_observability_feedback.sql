alter table public.ai_model_invocations
    add column if not exists specialty text,
    add column if not exists artifact_type text,
    add column if not exists result_status text,
    add column if not exists pipeline_status text,
    add column if not exists thought_summary text,
    add column if not exists thought_signature text,
    add column if not exists response_preview text;

alter table public.ai_pipeline_attempts
    add column if not exists model_used text,
    add column if not exists provider_used text,
    add column if not exists specialty text,
    add column if not exists artifact_type text,
    add column if not exists result_status text,
    add column if not exists pipeline_status text;

alter table public.doctor_satisfaction_events
    add column if not exists audit_id uuid references public.ai_audit_logs(id) on delete set null,
    add column if not exists session_id text,
    add column if not exists specialty text,
    add column if not exists artifact_type text,
    add column if not exists feedback_stage text default 'generated',
    add column if not exists feedback_text text;

create index if not exists idx_ai_model_invocations_session_phase
    on public.ai_model_invocations(session_id, phase, created_at desc);

create index if not exists idx_ai_model_invocations_specialty_artifact
    on public.ai_model_invocations(specialty, artifact_type, created_at desc);

create index if not exists idx_ai_pipeline_attempts_session_stage
    on public.ai_pipeline_attempts(session_id, stage, created_at desc);

create index if not exists idx_doctor_satisfaction_events_audit
    on public.doctor_satisfaction_events(audit_id, created_at desc);

create index if not exists idx_doctor_satisfaction_events_session_stage
    on public.doctor_satisfaction_events(session_id, feedback_stage, created_at desc);
