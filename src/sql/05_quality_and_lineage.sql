-- Quality + lineage tables for multi-phase pipeline

create table if not exists ai_chunks (
  id uuid default gen_random_uuid() primary key,
  record_id uuid,
  chunk_id text,
  text text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table if not exists ai_field_lineage (
  id uuid default gen_random_uuid() primary key,
  record_id uuid,
  field_path text,
  value text,
  chunk_id text,
  evidence text,
  polarity text,
  temporality text,
  confidence numeric,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table if not exists ai_semantic_checks (
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
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table if not exists ai_field_confirmations (
  id uuid default gen_random_uuid() primary key,
  record_id uuid,
  field_path text,
  suggested_value text,
  doctor_value text,
  confirmed boolean,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table if not exists ai_quality_events (
  id uuid default gen_random_uuid() primary key,
  record_id uuid,
  event_type text,
  payload jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table if not exists ai_quality_metrics_daily (
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
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table if not exists ai_rule_versions (
  id uuid default gen_random_uuid() primary key,
  version integer not null,
  global_rules text,
  global_rules_json jsonb,
  source_lesson_ids jsonb,
  model text,
  is_active boolean default false,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create unique index if not exists ai_rule_versions_version_idx on ai_rule_versions (version);

alter table if exists ai_long_term_memory
  add column if not exists global_rules_json jsonb;

alter table ai_chunks enable row level security;
alter table ai_field_lineage enable row level security;
alter table ai_semantic_checks enable row level security;
alter table ai_field_confirmations enable row level security;
alter table ai_quality_events enable row level security;
alter table ai_quality_metrics_daily enable row level security;
alter table ai_rule_versions enable row level security;

create policy "Enable insert for authenticated users" on ai_chunks for insert to authenticated with check (true);
create policy "Enable select for authenticated users" on ai_chunks for select to authenticated using (true);

create policy "Enable insert for authenticated users" on ai_field_lineage for insert to authenticated with check (true);
create policy "Enable select for authenticated users" on ai_field_lineage for select to authenticated using (true);

create policy "Enable insert for authenticated users" on ai_semantic_checks for insert to authenticated with check (true);
create policy "Enable select for authenticated users" on ai_semantic_checks for select to authenticated using (true);

create policy "Enable insert for authenticated users" on ai_field_confirmations for insert to authenticated with check (true);
create policy "Enable select for authenticated users" on ai_field_confirmations for select to authenticated using (true);

create policy "Enable insert for authenticated users" on ai_quality_events for insert to authenticated with check (true);
create policy "Enable select for authenticated users" on ai_quality_events for select to authenticated using (true);

create policy "Enable insert for authenticated users" on ai_quality_metrics_daily for insert to authenticated with check (true);
create policy "Enable select for authenticated users" on ai_quality_metrics_daily for select to authenticated using (true);

create policy "Enable insert for authenticated users" on ai_rule_versions for insert to authenticated with check (true);
create policy "Enable select for authenticated users" on ai_rule_versions for select to authenticated using (true);
