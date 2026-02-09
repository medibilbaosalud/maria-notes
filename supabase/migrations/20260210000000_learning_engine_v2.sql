-- Learning engine v2: evidence-driven clinical auto-improvement
create extension if not exists pgcrypto;

create or replace function public.apply_owner_default()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.owner_user_id is null and auth.uid() is not null then
    new.owner_user_id := auth.uid();
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'learning_lifecycle_state' and n.nspname = 'public'
  ) then
    create type public.learning_lifecycle_state as enum ('candidate', 'shadow', 'active', 'deprecated', 'blocked');
  end if;
end $$;

create table if not exists public.ai_learning_events (
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
  owner_user_id uuid not null,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  constraint ai_learning_events_change_type_chk check (change_type in ('added', 'removed', 'modified')),
  constraint ai_learning_events_severity_chk check (severity in ('low', 'medium', 'high', 'critical'))
);

create table if not exists public.ai_rule_candidates (
  id uuid primary key default gen_random_uuid(),
  signature_hash text not null unique,
  rule_text text not null,
  rule_json jsonb not null default '{}'::jsonb,
  category text not null default 'style',
  evidence_count integer not null default 1,
  contradiction_count integer not null default 0,
  confidence_score numeric(5,4) not null default 0,
  lifecycle_state public.learning_lifecycle_state not null default 'candidate',
  last_seen_at timestamptz not null default timezone('utc'::text, now()),
  promoted_at timestamptz,
  blocked_reason text,
  metrics_snapshot jsonb not null default '{}'::jsonb,
  owner_user_id uuid not null,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  constraint ai_rule_candidates_confidence_chk check (confidence_score >= 0 and confidence_score <= 1)
);

create table if not exists public.ai_rule_evaluations (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.ai_rule_candidates(id) on delete cascade,
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
  owner_user_id uuid not null,
  created_at timestamptz not null default timezone('utc'::text, now()),
  constraint ai_rule_evaluations_unique_day unique (rule_id, metric_date)
);

create table if not exists public.ai_rule_pack_versions_v2 (
  id uuid primary key default gen_random_uuid(),
  version integer not null,
  pack_json jsonb not null default '{}'::jsonb,
  active boolean not null default false,
  rollout_pct numeric(5,2) not null default 100,
  rollback_of uuid references public.ai_rule_pack_versions_v2(id) on delete set null,
  source_rule_ids jsonb not null default '[]'::jsonb,
  owner_user_id uuid not null,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  constraint ai_rule_pack_versions_v2_rollout_chk check (rollout_pct >= 0 and rollout_pct <= 100),
  constraint ai_rule_pack_versions_v2_version_uq unique (version)
);

create table if not exists public.ai_learning_decisions (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid references public.ai_rule_candidates(id) on delete cascade,
  decision_type text not null,
  reason text,
  metrics_snapshot jsonb not null default '{}'::jsonb,
  context jsonb not null default '{}'::jsonb,
  owner_user_id uuid not null,
  created_at timestamptz not null default timezone('utc'::text, now()),
  constraint ai_learning_decisions_type_chk check (decision_type in ('promote', 'demote', 'block', 'rollback', 'force_shadow', 'resume'))
);

create index if not exists ai_learning_events_record_created_idx on public.ai_learning_events(record_id, created_at desc);
create index if not exists ai_learning_events_signature_idx on public.ai_learning_events(signature_hash, created_at desc);
create index if not exists ai_rule_candidates_state_conf_idx on public.ai_rule_candidates(lifecycle_state, confidence_score desc);
create index if not exists ai_rule_candidates_last_seen_idx on public.ai_rule_candidates(last_seen_at desc);
create index if not exists ai_rule_evaluations_rule_metric_idx on public.ai_rule_evaluations(rule_id, metric_date desc);
create index if not exists ai_learning_decisions_rule_created_idx on public.ai_learning_decisions(rule_id, created_at desc);

alter table public.ai_learning_events enable row level security;
alter table public.ai_rule_candidates enable row level security;
alter table public.ai_rule_evaluations enable row level security;
alter table public.ai_rule_pack_versions_v2 enable row level security;
alter table public.ai_learning_decisions enable row level security;

do $$
declare
  tbl text;
  tables text[] := array[
    'ai_learning_events',
    'ai_rule_candidates',
    'ai_rule_evaluations',
    'ai_rule_pack_versions_v2',
    'ai_learning_decisions'
  ];
begin
  foreach tbl in array tables loop
    execute format('drop trigger if exists %I on public.%I', tbl || '_owner_default', tbl);
    execute format(
      'create trigger %I before insert on public.%I for each row execute function public.apply_owner_default()',
      tbl || '_owner_default', tbl
    );

    execute format('drop policy if exists %I on public.%I', tbl || '_select_owner', tbl);
    execute format('drop policy if exists %I on public.%I', tbl || '_insert_owner', tbl);
    execute format('drop policy if exists %I on public.%I', tbl || '_update_owner', tbl);
    execute format('drop policy if exists %I on public.%I', tbl || '_delete_owner', tbl);

    execute format(
      'create policy %I on public.%I for select to authenticated using (owner_user_id = auth.uid())',
      tbl || '_select_owner', tbl
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (owner_user_id = auth.uid())',
      tbl || '_insert_owner', tbl
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid())',
      tbl || '_update_owner', tbl
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (owner_user_id = auth.uid())',
      tbl || '_delete_owner', tbl
    );
  end loop;
end $$;

