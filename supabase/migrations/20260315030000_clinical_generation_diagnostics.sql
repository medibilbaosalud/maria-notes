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

create table if not exists public.clinical_generation_diagnostics (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null,
  record_id uuid references public.medical_records(record_uuid) on delete set null,
  audit_id uuid references public.ai_audit_logs(id) on delete set null,
  session_id text,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  specialty text not null check (specialty in ('otorrino', 'psicologia')),
  artifact_type text not null default 'medical_history',
  patient_name_snapshot text,
  transcription_text text not null default '',
  ai_draft_text text not null default '',
  doctor_final_text text,
  doctor_score integer check (doctor_score between 1 and 10),
  doctor_feedback_text text,
  review_status text not null default 'pending' check (review_status in ('pending', 'reviewed', 'audited', 'locked')),
  model_used text,
  provider_used text,
  prompt_version text,
  rule_pack_version integer,
  rule_ids_used jsonb not null default '[]'::jsonb,
  pipeline_status text,
  result_status text,
  quality_score numeric,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  unique (dedupe_key)
);

create table if not exists public.clinical_generation_diagnostic_edits (
  id uuid primary key default gen_random_uuid(),
  diagnostic_id uuid not null references public.clinical_generation_diagnostics(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  section_name text,
  edit_type text not null check (edit_type in ('added', 'removed', 'rewritten', 'terminology', 'style', 'formatting', 'clinical_precision', 'omission')),
  importance text not null default 'medium' check (importance in ('low', 'medium', 'high')),
  edit_source text not null default 'manual_save' check (edit_source in ('generated', 'manual_save', 'autosave', 'finalized')),
  before_text text,
  after_text text,
  edit_distance_chars integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists clinical_generation_diagnostics_owner_created_idx
  on public.clinical_generation_diagnostics (owner_user_id, created_at desc);

create index if not exists clinical_generation_diagnostics_record_idx
  on public.clinical_generation_diagnostics (record_id, created_at desc);

create index if not exists clinical_generation_diagnostics_audit_idx
  on public.clinical_generation_diagnostics (audit_id);

create index if not exists clinical_generation_diagnostics_specialty_artifact_idx
  on public.clinical_generation_diagnostics (specialty, artifact_type, created_at desc);

create index if not exists clinical_generation_diagnostic_edits_diagnostic_idx
  on public.clinical_generation_diagnostic_edits (diagnostic_id, created_at desc);

create index if not exists clinical_generation_diagnostic_edits_owner_idx
  on public.clinical_generation_diagnostic_edits (owner_user_id, created_at desc);

alter table if exists public.clinical_generation_diagnostics enable row level security;
alter table if exists public.clinical_generation_diagnostic_edits enable row level security;

drop trigger if exists clinical_generation_diagnostics_owner_default on public.clinical_generation_diagnostics;
create trigger clinical_generation_diagnostics_owner_default
before insert on public.clinical_generation_diagnostics
for each row execute function public.apply_owner_default();

drop trigger if exists clinical_generation_diagnostic_edits_owner_default on public.clinical_generation_diagnostic_edits;
create trigger clinical_generation_diagnostic_edits_owner_default
before insert on public.clinical_generation_diagnostic_edits
for each row execute function public.apply_owner_default();

drop policy if exists "clinical_generation_diagnostics_select_owner" on public.clinical_generation_diagnostics;
drop policy if exists "clinical_generation_diagnostics_insert_owner" on public.clinical_generation_diagnostics;
drop policy if exists "clinical_generation_diagnostics_update_owner" on public.clinical_generation_diagnostics;
drop policy if exists "clinical_generation_diagnostics_delete_owner" on public.clinical_generation_diagnostics;

create policy "clinical_generation_diagnostics_select_owner" on public.clinical_generation_diagnostics
  for select to authenticated
  using (auth.uid() = owner_user_id);

create policy "clinical_generation_diagnostics_insert_owner" on public.clinical_generation_diagnostics
  for insert to authenticated
  with check (auth.uid() = owner_user_id);

create policy "clinical_generation_diagnostics_update_owner" on public.clinical_generation_diagnostics
  for update to authenticated
  using (auth.uid() = owner_user_id)
  with check (auth.uid() = owner_user_id);

create policy "clinical_generation_diagnostics_delete_owner" on public.clinical_generation_diagnostics
  for delete to authenticated
  using (auth.uid() = owner_user_id);

drop policy if exists "clinical_generation_diagnostic_edits_select_owner" on public.clinical_generation_diagnostic_edits;
drop policy if exists "clinical_generation_diagnostic_edits_insert_owner" on public.clinical_generation_diagnostic_edits;
drop policy if exists "clinical_generation_diagnostic_edits_update_owner" on public.clinical_generation_diagnostic_edits;
drop policy if exists "clinical_generation_diagnostic_edits_delete_owner" on public.clinical_generation_diagnostic_edits;

create policy "clinical_generation_diagnostic_edits_select_owner" on public.clinical_generation_diagnostic_edits
  for select to authenticated
  using (auth.uid() = owner_user_id);

create policy "clinical_generation_diagnostic_edits_insert_owner" on public.clinical_generation_diagnostic_edits
  for insert to authenticated
  with check (auth.uid() = owner_user_id);

create policy "clinical_generation_diagnostic_edits_update_owner" on public.clinical_generation_diagnostic_edits
  for update to authenticated
  using (auth.uid() = owner_user_id)
  with check (auth.uid() = owner_user_id);

create policy "clinical_generation_diagnostic_edits_delete_owner" on public.clinical_generation_diagnostic_edits
  for delete to authenticated
  using (auth.uid() = owner_user_id);
