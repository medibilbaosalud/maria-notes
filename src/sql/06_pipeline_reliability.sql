-- Pipeline reliability schema (v4 canary)
-- Adds execution tracing and server-side outbox mirror tables.

create extension if not exists pgcrypto;

create table if not exists ai_pipeline_runs (
  id uuid default gen_random_uuid() primary key,
  session_id text not null,
  session_version integer not null default 1,
  retry_count integer not null default 0,
  result_status text,
  next_attempt_at timestamptz,
  record_id uuid,
  patient_name text,
  status text not null default 'recording',
  outcome text,
  started_at timestamptz not null default timezone('utc'::text, now()),
  finished_at timestamptz,
  duration_ms bigint,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

alter table ai_pipeline_runs add column if not exists session_version integer not null default 1;
alter table ai_pipeline_runs add column if not exists retry_count integer not null default 0;
alter table ai_pipeline_runs add column if not exists result_status text;
alter table ai_pipeline_runs add column if not exists next_attempt_at timestamptz;

create table if not exists ai_pipeline_attempts (
  id uuid default gen_random_uuid() primary key,
  run_id uuid references ai_pipeline_runs(id) on delete cascade,
  session_id text not null,
  stage text not null,
  attempt_index integer not null default 0,
  status text not null default 'started',
  started_at timestamptz not null default timezone('utc'::text, now()),
  finished_at timestamptz,
  duration_ms bigint,
  error_code text,
  error_message text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc'::text, now())
);

create table if not exists ai_audit_outbox (
  id uuid default gen_random_uuid() primary key,
  session_id text,
  record_id uuid,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default timezone('utc'::text, now()),
  last_error text,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists ai_pipeline_runs_session_idx on ai_pipeline_runs(session_id);
create index if not exists ai_pipeline_runs_record_idx on ai_pipeline_runs(record_id);
create index if not exists ai_pipeline_runs_status_created_idx on ai_pipeline_runs(status, created_at desc);
create index if not exists ai_pipeline_runs_next_attempt_idx on ai_pipeline_runs(next_attempt_at) where next_attempt_at is not null;

create index if not exists ai_pipeline_attempts_run_stage_idx on ai_pipeline_attempts(run_id, stage, attempt_index);
create index if not exists ai_pipeline_attempts_session_stage_idx on ai_pipeline_attempts(session_id, stage, created_at desc);

create index if not exists ai_audit_outbox_status_next_idx on ai_audit_outbox(status, next_attempt_at);
create index if not exists ai_audit_outbox_session_created_idx on ai_audit_outbox(session_id, created_at desc);

alter table ai_pipeline_runs enable row level security;
alter table ai_pipeline_attempts enable row level security;
alter table ai_audit_outbox enable row level security;

drop policy if exists "Enable insert for all users" on ai_pipeline_runs;
drop policy if exists "Enable select for all users" on ai_pipeline_runs;
create policy "Enable insert for all users" on ai_pipeline_runs for insert to public with check (true);
create policy "Enable select for all users" on ai_pipeline_runs for select to public using (true);

drop policy if exists "Enable insert for all users" on ai_pipeline_attempts;
drop policy if exists "Enable select for all users" on ai_pipeline_attempts;
create policy "Enable insert for all users" on ai_pipeline_attempts for insert to public with check (true);
create policy "Enable select for all users" on ai_pipeline_attempts for select to public using (true);

drop policy if exists "Enable insert for all users" on ai_audit_outbox;
drop policy if exists "Enable select for all users" on ai_audit_outbox;
create policy "Enable insert for all users" on ai_audit_outbox for insert to public with check (true);
create policy "Enable select for all users" on ai_audit_outbox for select to public using (true);
