-- Repair internal no-login runtime tables.
-- Some tables still had owner_user_id as NOT NULL, which blocks anon/internal writes.

create extension if not exists pgcrypto;

create table if not exists public.clinical_specialty_profiles (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid references auth.users(id) on delete cascade,
  specialty text not null check (specialty in ('otorrino', 'psicologia')),
  clinician_profile text check (
    clinician_profile is null
    or clinician_profile in ('ainhoa', 'june', 'gotxi')
  ),
  display_name text,
  note_preferences jsonb not null default '{}'::jsonb,
  report_preferences jsonb not null default '{}'::jsonb,
  scope_owner_key text generated always as (coalesce(owner_user_id::text, '__internal__')) stored,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

do $$
declare
  tbl text;
  internal_tables text[] := array[
    'medical_records',
    'patient_briefings',
    'ai_audit_logs',
    'ai_chunks',
    'ai_field_lineage',
    'ai_semantic_checks',
    'ai_field_confirmations',
    'ai_quality_events',
    'ai_quality_metrics_daily',
    'ai_learning_events',
    'ai_improvement_lessons',
    'ai_rule_candidates',
    'ai_rule_evaluations',
    'ai_rule_evidence_rollups',
    'ai_rule_pack_versions_v2',
    'ai_learning_decisions',
    'ai_long_term_memory',
    'clinical_specialty_profiles',
    'psychology_consultation_contexts'
  ];
begin
  foreach tbl in array internal_tables loop
    if exists (
      select 1
      from information_schema.tables
      where table_schema = 'public'
        and table_name = tbl
    ) then
      if exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = tbl
          and column_name = 'owner_user_id'
          and is_nullable = 'NO'
      ) then
        execute format('alter table public.%I alter column owner_user_id drop not null', tbl);
      end if;

      execute format('alter table public.%I disable row level security', tbl);
      execute format('grant select, insert, update, delete on public.%I to anon', tbl);
      execute format('grant select, insert, update, delete on public.%I to authenticated', tbl);
      execute format('grant select, insert, update, delete on public.%I to service_role', tbl);
    end if;
  end loop;
end $$;

do $$
begin
  if to_regclass('public.patient_briefings') is not null then
    if exists (
      select 1
      from pg_constraint
      where conname = 'patient_briefings_specialty_check'
    ) then
      alter table public.patient_briefings
        drop constraint patient_briefings_specialty_check;
    end if;

    if exists (
      select 1
      from pg_constraint
      where conname = 'patient_briefings_specialty_chk'
    ) then
      alter table public.patient_briefings
        drop constraint patient_briefings_specialty_chk;
    end if;

    alter table public.patient_briefings
      add constraint patient_briefings_specialty_chk
      check (specialty in ('otorrino', 'psicologia'));
  end if;

  if to_regclass('public.ai_improvement_lessons') is not null then
    alter table public.ai_improvement_lessons
      add column if not exists updated_at timestamptz not null default timezone('utc'::text, now());
  end if;

  if to_regclass('public.ai_long_term_memory') is not null then
    alter table public.ai_long_term_memory
      add column if not exists global_rules_json jsonb,
      add column if not exists daily_lessons text not null default '',
      add column if not exists last_consolidated_at timestamptz default timezone('utc'::text, now());
  end if;

  if to_regclass('public.psychology_consultation_contexts') is null then
    create table public.psychology_consultation_contexts (
      id uuid primary key default gen_random_uuid(),
      record_id uuid,
      owner_user_id uuid,
      clinician_profile text,
      session_format text,
      care_context text,
      focus_areas text[] not null default '{}'::text[],
      risk_level text,
      observed_state text,
      protective_factors text[] not null default '{}'::text[],
      intervention_summary text,
      homework_plan text,
      followup_plan text,
      created_at timestamptz not null default timezone('utc'::text, now()),
      updated_at timestamptz not null default timezone('utc'::text, now())
    );

    alter table public.psychology_consultation_contexts disable row level security;
    grant select, insert, update, delete on public.psychology_consultation_contexts to anon;
    grant select, insert, update, delete on public.psychology_consultation_contexts to authenticated;
    grant select, insert, update, delete on public.psychology_consultation_contexts to service_role;
  end if;
end $$;

do $$
begin
  if to_regclass('public.clinical_specialty_profiles') is not null then
    alter table public.clinical_specialty_profiles
      add column if not exists scope_owner_key text
      generated always as (coalesce(owner_user_id::text, '__internal__')) stored;

    delete from public.clinical_specialty_profiles stale
    using (
      select ctid
      from (
        select
          ctid,
          row_number() over (
            partition by scope_owner_key, specialty, coalesce(clinician_profile, '__generic__')
            order by updated_at desc, created_at desc
          ) as row_number
        from public.clinical_specialty_profiles
      ) ranked
      where ranked.row_number > 1
    ) duplicates
    where stale.ctid = duplicates.ctid;

    create unique index if not exists clinical_specialty_profiles_scope_specialty_null_profile_uq
      on public.clinical_specialty_profiles (scope_owner_key, specialty)
      where clinician_profile is null;

    create unique index if not exists clinical_specialty_profiles_scope_specialty_profile_uq
      on public.clinical_specialty_profiles (scope_owner_key, specialty, clinician_profile)
      where clinician_profile is not null;
  end if;
end $$;
