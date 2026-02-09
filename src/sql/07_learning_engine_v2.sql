-- Learning engine v2: evidence-driven clinical auto-improvement
create extension if not exists pgcrypto;

create table if not exists ai_learning_events (
  id uuid primary key default gen_random_uuid(),
  record_id uuid,
  audit_id uuid,
  session_id text,
  section text not null,
  field_path text not null,
  before_value text,
  after_value text,
  change_type text not null,
  severity text not null default 'medium',
  source text not null default 'doctor_edit',
  category text not null default 'style',
  normalized_before text,
  normalized_after text,
  signature_hash text not null,
  metadata jsonb not null default '{}'::jsonb,
  owner_user_id uuid,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  constraint ai_learning_events_change_type_chk check (change_type in ('added', 'removed', 'modified')),
  constraint ai_learning_events_severity_chk check (severity in ('low', 'medium', 'high', 'critical'))
);

create table if not exists ai_rule_candidates (
  id uuid primary key default gen_random_uuid(),
  signature_hash text not null unique,
  rule_text text not null,
  rule_json jsonb not null default '{}'::jsonb,
  category text not null default 'style',
  evidence_count integer not null default 1,
  contradiction_count integer not null default 0,
  confidence_score numeric(5,4) not null default 0,
  lifecycle_state text not null default 'candidate',
  last_seen_at timestamptz not null default timezone('utc'::text, now()),
  promoted_at timestamptz,
  blocked_reason text,
  metrics_snapshot jsonb not null default '{}'::jsonb,
  owner_user_id uuid,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  constraint ai_rule_candidates_confidence_chk check (confidence_score >= 0 and confidence_score <= 1),
  constraint ai_rule_candidates_lifecycle_chk check (lifecycle_state in ('candidate', 'shadow', 'active', 'deprecated', 'blocked'))
);

create table if not exists ai_rule_evaluations (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references ai_rule_candidates(id) on delete cascade,
  metric_date date not null default current_date,
  window_start timestamptz,
  window_end timestamptz,
  uses integer not null default 0,
  accepted integer not null default 0,
  overridden integer not null default 0,
  edit_delta numeric,
  hallucination_delta numeric,
  inconsistency_delta numeric,
  score numeric(6,3),
  metadata jsonb not null default '{}'::jsonb,
  owner_user_id uuid,
  created_at timestamptz not null default timezone('utc'::text, now()),
  constraint ai_rule_evaluations_unique_day unique (rule_id, metric_date)
);

create table if not exists ai_rule_pack_versions_v2 (
  id uuid primary key default gen_random_uuid(),
  version integer not null,
  pack_json jsonb not null default '{}'::jsonb,
  active boolean not null default false,
  rollout_pct numeric(5,2) not null default 100,
  rollback_of uuid references ai_rule_pack_versions_v2(id) on delete set null,
  source_rule_ids jsonb not null default '[]'::jsonb,
  owner_user_id uuid,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  constraint ai_rule_pack_versions_v2_rollout_chk check (rollout_pct >= 0 and rollout_pct <= 100),
  constraint ai_rule_pack_versions_v2_version_uq unique (version)
);

create table if not exists ai_learning_decisions (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid references ai_rule_candidates(id) on delete cascade,
  decision_type text not null,
  reason text,
  metrics_snapshot jsonb not null default '{}'::jsonb,
  context jsonb not null default '{}'::jsonb,
  owner_user_id uuid,
  created_at timestamptz not null default timezone('utc'::text, now()),
  constraint ai_learning_decisions_type_chk check (decision_type in ('promote', 'demote', 'block', 'rollback', 'force_shadow', 'resume'))
);

create index if not exists ai_learning_events_record_created_idx on ai_learning_events(record_id, created_at desc);
create index if not exists ai_learning_events_signature_idx on ai_learning_events(signature_hash, created_at desc);
create index if not exists ai_rule_candidates_state_conf_idx on ai_rule_candidates(lifecycle_state, confidence_score desc);
create index if not exists ai_rule_candidates_last_seen_idx on ai_rule_candidates(last_seen_at desc);
create index if not exists ai_rule_evaluations_rule_metric_idx on ai_rule_evaluations(rule_id, metric_date desc);
create index if not exists ai_learning_decisions_rule_created_idx on ai_learning_decisions(rule_id, created_at desc);

