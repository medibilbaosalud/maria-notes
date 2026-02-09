-- Core schema upgrades for premium-quality medical notes
-- Safe to run multiple times (IF NOT EXISTS / idempotent blocks).

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- 1) Open up AI audit logs for anon desktop clients (optional)
-- ------------------------------------------------------------
alter table if exists public.ai_audit_logs enable row level security;

drop policy if exists "Enable insert for authenticated users only" on public.ai_audit_logs;
drop policy if exists "Enable select for authenticated users only" on public.ai_audit_logs;

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='ai_audit_logs') then
    create policy "Enable insert for all users" on public.ai_audit_logs
      for insert to public with check (true);
    create policy "Enable select for all users" on public.ai_audit_logs
      for select to public using (true);
  end if;
exception when duplicate_object then
  -- policies already exist
  null;
end $$;

create index if not exists ai_audit_logs_created_at_idx on public.ai_audit_logs (created_at desc);

-- ------------------------------------------------------------
-- 2) Medical records: stable UUID + updated_at + full-text search
-- ------------------------------------------------------------
alter table if exists public.medical_records
  add column if not exists medical_report text;

alter table if exists public.medical_records
  add column if not exists report_created_at timestamptz;

alter table if exists public.medical_records
  add column if not exists ai_model text;

alter table if exists public.medical_records
  add column if not exists record_uuid uuid;

alter table if exists public.medical_records
  add column if not exists idempotency_key text;

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='medical_records') then
    update public.medical_records
    set record_uuid = gen_random_uuid()
    where record_uuid is null;
  end if;
end $$;

alter table if exists public.medical_records
  alter column record_uuid set not null;

create unique index if not exists medical_records_record_uuid_uq on public.medical_records (record_uuid);
create unique index if not exists medical_records_idempotency_key_uq on public.medical_records (idempotency_key) where idempotency_key is not null;

alter table if exists public.medical_records
  add column if not exists original_medical_history text;

alter table if exists public.medical_records
  add column if not exists audit_id uuid;

alter table if exists public.medical_records
  add column if not exists updated_at timestamptz;

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='medical_records') then
    update public.medical_records
    set updated_at = coalesce(updated_at, created_at, now())
    where updated_at is null;
  end if;
end $$;

alter table if exists public.medical_records
  alter column updated_at set default now();

alter table if exists public.medical_records
  alter column updated_at set not null;

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='ai_audit_logs')
     and not exists (select 1 from pg_constraint where conname='medical_records_audit_id_fkey') then
    alter table public.medical_records
      add constraint medical_records_audit_id_fkey
      foreign key (audit_id) references public.ai_audit_logs(id)
      on delete set null;
  end if;
end $$;

alter table if exists public.medical_records
  add column if not exists search_tsv tsvector
  generated always as (
    to_tsvector(
      'spanish',
      coalesce(patient_name,'') || ' ' ||
      coalesce(consultation_type,'') || ' ' ||
      coalesce(medical_history,'') || ' ' ||
      coalesce(transcription,'') || ' ' ||
      coalesce(medical_report,'')
    )
  ) stored;

create index if not exists medical_records_search_tsv_idx on public.medical_records using gin (search_tsv);
create index if not exists medical_records_updated_at_idx on public.medical_records (updated_at desc);

-- ------------------------------------------------------------
-- 3) Error logging table (client-side logError)
-- ------------------------------------------------------------
create table if not exists public.error_logs (
  id uuid default gen_random_uuid() primary key,
  created_at timestamptz default now() not null,
  message text not null,
  stack text,
  context jsonb not null default '{}'::jsonb,
  source text,
  severity text,
  url text
);

alter table public.error_logs enable row level security;
drop policy if exists "Enable insert for all users" on public.error_logs;
drop policy if exists "Enable select for all users" on public.error_logs;
create policy "Enable insert for all users" on public.error_logs for insert to public with check (true);
create policy "Enable select for all users" on public.error_logs for select to public using (true);
create index if not exists error_logs_created_at_idx on public.error_logs (created_at desc);

-- ------------------------------------------------------------
-- 4) Smart feedback (doctor corrections) + memory tables
-- ------------------------------------------------------------
create table if not exists public.ai_improvement_lessons (
  id uuid default gen_random_uuid() primary key,
  created_at timestamptz default now() not null,
  original_transcription text not null,
  ai_generated_history text not null,
  doctor_edited_history text not null,
  changes_detected jsonb not null default '[]'::jsonb,
  lesson_summary text not null,
  improvement_category text not null default 'style',
  status text not null default 'learning',
  is_format boolean not null default false,
  recurrence_count int not null default 1,
  last_seen_at timestamptz default now(),
  consolidated boolean not null default false,
  doctor_comment text,
  doctor_id uuid,
  record_id uuid
);

create index if not exists ai_improvement_lessons_created_at_idx on public.ai_improvement_lessons (created_at desc);
create index if not exists ai_improvement_lessons_status_idx on public.ai_improvement_lessons (status);
create index if not exists ai_improvement_lessons_consolidated_idx on public.ai_improvement_lessons (consolidated);

alter table public.ai_improvement_lessons enable row level security;
drop policy if exists "Enable all access for authenticated users" on public.ai_improvement_lessons;
drop policy if exists "Enable insert for all users" on public.ai_improvement_lessons;
drop policy if exists "Enable select for all users" on public.ai_improvement_lessons;
create policy "Enable insert for all users" on public.ai_improvement_lessons for insert to public with check (true);
create policy "Enable select for all users" on public.ai_improvement_lessons for select to public using (true);

create table if not exists public.ai_long_term_memory (
  id uuid primary key default gen_random_uuid(),
  global_rules text not null default '',
  global_rules_json jsonb,
  last_consolidated_at timestamptz default now(),
  doctor_id uuid
);

alter table public.ai_long_term_memory enable row level security;
drop policy if exists "Enable all access for authenticated users" on public.ai_long_term_memory;
drop policy if exists "Enable all access for all users" on public.ai_long_term_memory;
create policy "Enable all access for all users" on public.ai_long_term_memory for all to public using (true) with check (true);

-- ------------------------------------------------------------
-- 5) Quality + lineage (tables used by the app)
-- ------------------------------------------------------------
create table if not exists public.ai_chunks (
  id uuid default gen_random_uuid() primary key,
  record_id uuid,
  chunk_id text,
  text text,
  created_at timestamptz default timezone('utc'::text, now()) not null
);

create table if not exists public.ai_field_lineage (
  id uuid default gen_random_uuid() primary key,
  record_id uuid,
  field_path text,
  value text,
  chunk_id text,
  evidence text,
  polarity text,
  temporality text,
  confidence numeric,
  created_at timestamptz default timezone('utc'::text, now()) not null
);

create table if not exists public.ai_semantic_checks (
  id uuid default gen_random_uuid() primary key,
  record_id uuid,
  field_path text,
  value_a text,
  value_b text,
  chosen text,
  polarity text,
  temporality text,
  evidence text,
  confidence numeric,
  model text,
  created_at timestamptz default timezone('utc'::text, now()) not null
);

create table if not exists public.ai_field_confirmations (
  id uuid default gen_random_uuid() primary key,
  record_id uuid,
  field_path text,
  suggested_value text,
  doctor_value text,
  confirmed boolean,
  created_at timestamptz default timezone('utc'::text, now()) not null
);

create table if not exists public.ai_quality_events (
  id uuid default gen_random_uuid() primary key,
  record_id uuid,
  event_type text,
  payload jsonb,
  created_at timestamptz default timezone('utc'::text, now()) not null
);

create table if not exists public.ai_quality_metrics_daily (
  metric_date date primary key,
  total_consultations integer default 0,
  corrected_consultations integer default 0,
  total_corrections integer default 0,
  total_uncertainty_flags integer default 0,
  total_missing integer default 0,
  total_hallucinations integer default 0,
  total_inconsistencies integer default 0,
  total_manual_edits integer default 0,
  total_duration_ms bigint default 0,
  total_transcript_tokens integer default 0,
  created_at timestamptz default timezone('utc'::text, now()) not null,
  updated_at timestamptz default timezone('utc'::text, now()) not null
);

create table if not exists public.ai_rule_versions (
  id uuid default gen_random_uuid() primary key,
  version integer not null,
  global_rules text,
  global_rules_json jsonb,
  source_lesson_ids jsonb,
  model text,
  is_active boolean default false,
  created_at timestamptz default timezone('utc'::text, now()) not null
);

create unique index if not exists ai_rule_versions_version_idx on public.ai_rule_versions (version);
create index if not exists ai_chunks_record_created_idx on public.ai_chunks (record_id, created_at desc);
create index if not exists ai_field_lineage_record_field_idx on public.ai_field_lineage (record_id, field_path);
create index if not exists ai_semantic_checks_record_field_idx on public.ai_semantic_checks (record_id, field_path);
create index if not exists ai_field_confirmations_record_field_idx on public.ai_field_confirmations (record_id, field_path);
create index if not exists ai_quality_events_record_type_created_idx on public.ai_quality_events (record_id, event_type, created_at desc);

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='ai_field_lineage')
     and not exists (select 1 from pg_constraint where conname='ai_field_lineage_confidence_chk') then
    alter table public.ai_field_lineage
      add constraint ai_field_lineage_confidence_chk
      check (confidence is null or (confidence >= 0 and confidence <= 1));
  end if;
end $$;

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='ai_semantic_checks')
     and not exists (select 1 from pg_constraint where conname='ai_semantic_checks_confidence_chk') then
    alter table public.ai_semantic_checks
      add constraint ai_semantic_checks_confidence_chk
      check (confidence is null or (confidence >= 0 and confidence <= 1));
  end if;
end $$;

alter table public.ai_chunks enable row level security;
alter table public.ai_field_lineage enable row level security;
alter table public.ai_semantic_checks enable row level security;
alter table public.ai_field_confirmations enable row level security;
alter table public.ai_quality_events enable row level security;
alter table public.ai_quality_metrics_daily enable row level security;
alter table public.ai_rule_versions enable row level security;

drop policy if exists "Enable insert for all users" on public.ai_chunks;
drop policy if exists "Enable select for all users" on public.ai_chunks;
create policy "Enable insert for all users" on public.ai_chunks for insert to public with check (true);
create policy "Enable select for all users" on public.ai_chunks for select to public using (true);

drop policy if exists "Enable insert for all users" on public.ai_field_lineage;
drop policy if exists "Enable select for all users" on public.ai_field_lineage;
create policy "Enable insert for all users" on public.ai_field_lineage for insert to public with check (true);
create policy "Enable select for all users" on public.ai_field_lineage for select to public using (true);

drop policy if exists "Enable insert for all users" on public.ai_semantic_checks;
drop policy if exists "Enable select for all users" on public.ai_semantic_checks;
create policy "Enable insert for all users" on public.ai_semantic_checks for insert to public with check (true);
create policy "Enable select for all users" on public.ai_semantic_checks for select to public using (true);

drop policy if exists "Enable insert for all users" on public.ai_field_confirmations;
drop policy if exists "Enable select for all users" on public.ai_field_confirmations;
create policy "Enable insert for all users" on public.ai_field_confirmations for insert to public with check (true);
create policy "Enable select for all users" on public.ai_field_confirmations for select to public using (true);

drop policy if exists "Enable insert for all users" on public.ai_quality_events;
drop policy if exists "Enable select for all users" on public.ai_quality_events;
create policy "Enable insert for all users" on public.ai_quality_events for insert to public with check (true);
create policy "Enable select for all users" on public.ai_quality_events for select to public using (true);

drop policy if exists "Enable insert for all users" on public.ai_quality_metrics_daily;
drop policy if exists "Enable select for all users" on public.ai_quality_metrics_daily;
create policy "Enable insert for all users" on public.ai_quality_metrics_daily for insert to public with check (true);
create policy "Enable select for all users" on public.ai_quality_metrics_daily for select to public using (true);

drop policy if exists "Enable insert for all users" on public.ai_rule_versions;
drop policy if exists "Enable select for all users" on public.ai_rule_versions;
create policy "Enable insert for all users" on public.ai_rule_versions for insert to public with check (true);
create policy "Enable select for all users" on public.ai_rule_versions for select to public using (true);
