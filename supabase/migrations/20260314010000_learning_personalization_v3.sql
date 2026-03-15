alter table public.ai_learning_events
  add column if not exists specialty text,
  add column if not exists artifact_type text,
  add column if not exists target_section text,
  add column if not exists scope_level text not null default 'section';

alter table public.ai_rule_candidates
  add column if not exists specialty text,
  add column if not exists artifact_type text,
  add column if not exists target_section text,
  add column if not exists scope_level text not null default 'section',
  add column if not exists doctor_reason_code text;

alter table public.ai_rule_evaluations
  add column if not exists specialty text,
  add column if not exists artifact_type text,
  add column if not exists target_section text,
  add column if not exists scope_level text not null default 'document',
  add column if not exists doctor_reason_code text;

alter table public.ai_rule_pack_versions_v2
  add column if not exists specialty text,
  add column if not exists artifact_type text,
  add column if not exists target_section text;

alter table public.ai_learning_decisions
  add column if not exists specialty text,
  add column if not exists artifact_type text,
  add column if not exists target_section text,
  add column if not exists doctor_reason_code text;

create table if not exists public.ai_rule_evidence_rollups (
  id uuid primary key default gen_random_uuid(),
  signature_hash text not null unique,
  owner_user_id uuid not null,
  specialty text not null default 'otorrino',
  artifact_type text not null default 'medical_history',
  target_section text,
  recurrence_count integer not null default 0,
  contradiction_rate numeric(6,4) not null default 0,
  manual_weight_total numeric(8,4) not null default 0,
  autosave_weight_total numeric(8,4) not null default 0,
  last_event_at timestamptz,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists ai_learning_events_scope_idx
  on public.ai_learning_events(owner_user_id, specialty, artifact_type, target_section, created_at desc);

create index if not exists ai_rule_candidates_scope_idx
  on public.ai_rule_candidates(owner_user_id, specialty, artifact_type, target_section, lifecycle_state, confidence_score desc);

create index if not exists ai_rule_pack_versions_scope_idx
  on public.ai_rule_pack_versions_v2(owner_user_id, specialty, artifact_type, target_section, active);

alter table public.ai_rule_evidence_rollups enable row level security;

drop trigger if exists ai_rule_evidence_rollups_owner_default on public.ai_rule_evidence_rollups;
create trigger ai_rule_evidence_rollups_owner_default
before insert on public.ai_rule_evidence_rollups
for each row execute function public.apply_owner_default();

drop policy if exists ai_rule_evidence_rollups_select_owner on public.ai_rule_evidence_rollups;
drop policy if exists ai_rule_evidence_rollups_insert_owner on public.ai_rule_evidence_rollups;
drop policy if exists ai_rule_evidence_rollups_update_owner on public.ai_rule_evidence_rollups;
drop policy if exists ai_rule_evidence_rollups_delete_owner on public.ai_rule_evidence_rollups;

create policy ai_rule_evidence_rollups_select_owner
on public.ai_rule_evidence_rollups for select to authenticated
using (owner_user_id = auth.uid());

create policy ai_rule_evidence_rollups_insert_owner
on public.ai_rule_evidence_rollups for insert to authenticated
with check (owner_user_id = auth.uid());

create policy ai_rule_evidence_rollups_update_owner
on public.ai_rule_evidence_rollups for update to authenticated
using (owner_user_id = auth.uid())
with check (owner_user_id = auth.uid());

create policy ai_rule_evidence_rollups_delete_owner
on public.ai_rule_evidence_rollups for delete to authenticated
using (owner_user_id = auth.uid());
