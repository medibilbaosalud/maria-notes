-- Security hardening for clinical data
-- Goal: remove public-open access and enforce authenticated ownership policies.

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- 1) Owner columns
-- ------------------------------------------------------------
alter table if exists public.medical_records add column if not exists owner_user_id uuid;
alter table if exists public.ai_audit_logs add column if not exists owner_user_id uuid;
alter table if exists public.ai_pipeline_runs add column if not exists owner_user_id uuid;
alter table if exists public.ai_pipeline_attempts add column if not exists owner_user_id uuid;
alter table if exists public.ai_audit_outbox add column if not exists owner_user_id uuid;
alter table if exists public.ai_chunks add column if not exists owner_user_id uuid;
alter table if exists public.ai_field_lineage add column if not exists owner_user_id uuid;
alter table if exists public.ai_semantic_checks add column if not exists owner_user_id uuid;
alter table if exists public.ai_field_confirmations add column if not exists owner_user_id uuid;
alter table if exists public.ai_quality_events add column if not exists owner_user_id uuid;
alter table if exists public.ai_quality_metrics_daily add column if not exists owner_user_id uuid;
alter table if exists public.ai_rule_versions add column if not exists owner_user_id uuid;
alter table if exists public.ai_improvement_lessons add column if not exists owner_user_id uuid;
alter table if exists public.ai_long_term_memory add column if not exists owner_user_id uuid;
alter table if exists public.error_logs add column if not exists owner_user_id uuid;

-- ------------------------------------------------------------
-- 2) Remove legacy public-open policies
-- ------------------------------------------------------------
drop policy if exists "Enable insert for all users" on public.medical_records;
drop policy if exists "Enable select for all users" on public.medical_records;
drop policy if exists "Enable insert for authenticated users only" on public.ai_audit_logs;
drop policy if exists "Enable select for authenticated users only" on public.ai_audit_logs;
drop policy if exists "Enable insert for all users" on public.ai_audit_logs;
drop policy if exists "Enable select for all users" on public.ai_audit_logs;
drop policy if exists "Enable insert for all users" on public.ai_pipeline_runs;
drop policy if exists "Enable select for all users" on public.ai_pipeline_runs;
drop policy if exists "Enable insert for all users" on public.ai_pipeline_attempts;
drop policy if exists "Enable select for all users" on public.ai_pipeline_attempts;
drop policy if exists "Enable insert for all users" on public.ai_audit_outbox;
drop policy if exists "Enable select for all users" on public.ai_audit_outbox;
drop policy if exists "Enable insert for all users" on public.ai_chunks;
drop policy if exists "Enable select for all users" on public.ai_chunks;
drop policy if exists "Enable insert for all users" on public.ai_field_lineage;
drop policy if exists "Enable select for all users" on public.ai_field_lineage;
drop policy if exists "Enable insert for all users" on public.ai_semantic_checks;
drop policy if exists "Enable select for all users" on public.ai_semantic_checks;
drop policy if exists "Enable insert for all users" on public.ai_field_confirmations;
drop policy if exists "Enable select for all users" on public.ai_field_confirmations;
drop policy if exists "Enable insert for all users" on public.ai_quality_events;
drop policy if exists "Enable select for all users" on public.ai_quality_events;
drop policy if exists "Enable insert for all users" on public.ai_quality_metrics_daily;
drop policy if exists "Enable select for all users" on public.ai_quality_metrics_daily;
drop policy if exists "Enable insert for all users" on public.ai_rule_versions;
drop policy if exists "Enable select for all users" on public.ai_rule_versions;
drop policy if exists "Enable insert for all users" on public.ai_improvement_lessons;
drop policy if exists "Enable select for all users" on public.ai_improvement_lessons;
drop policy if exists "Enable all access for all users" on public.ai_long_term_memory;
drop policy if exists "Enable insert for all users" on public.error_logs;
drop policy if exists "Enable select for all users" on public.error_logs;

-- ------------------------------------------------------------
-- 3) Strict auth policies
-- ------------------------------------------------------------
alter table if exists public.medical_records enable row level security;
drop policy if exists "medical_records_select_owner" on public.medical_records;
drop policy if exists "medical_records_insert_owner" on public.medical_records;
drop policy if exists "medical_records_update_owner" on public.medical_records;
drop policy if exists "medical_records_delete_owner" on public.medical_records;
create policy "medical_records_select_owner" on public.medical_records
for select to authenticated
using (owner_user_id = auth.uid());
create policy "medical_records_insert_owner" on public.medical_records
for insert to authenticated
with check (owner_user_id = auth.uid());
create policy "medical_records_update_owner" on public.medical_records
for update to authenticated
using (owner_user_id = auth.uid())
with check (owner_user_id = auth.uid());
create policy "medical_records_delete_owner" on public.medical_records
for delete to authenticated
using (owner_user_id = auth.uid());

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

drop trigger if exists medical_records_owner_default on public.medical_records;
create trigger medical_records_owner_default
before insert on public.medical_records
for each row execute function public.apply_owner_default();

do $$
begin
  if exists(select 1 from information_schema.tables where table_schema = 'public' and table_name = 'medical_records')
     and not exists(select 1 from public.medical_records where owner_user_id is null)
  then
    alter table public.medical_records alter column owner_user_id set not null;
  end if;
end $$;

-- Generic strict policies for telemetry/auxiliary tables.
do $$
declare
  tbl text;
  has_null boolean;
  tables text[] := array[
    'ai_audit_logs',
    'ai_pipeline_runs',
    'ai_pipeline_attempts',
    'ai_audit_outbox',
    'ai_chunks',
    'ai_field_lineage',
    'ai_semantic_checks',
    'ai_field_confirmations',
    'ai_quality_events',
    'ai_quality_metrics_daily',
    'ai_rule_versions',
    'ai_improvement_lessons',
    'ai_long_term_memory',
    'error_logs'
  ];
begin
  foreach tbl in array tables loop
    if to_regclass(format('public.%s', tbl)) is null then
      continue;
    end if;

    execute format('drop trigger if exists %I on public.%I', tbl || '_owner_default', tbl);
    execute format(
      'create trigger %I before insert on public.%I for each row execute function public.apply_owner_default()',
      tbl || '_owner_default',
      tbl
    );

    -- Enforce NOT NULL owner_user_id when backfilled data is already clean.
    execute format('select exists(select 1 from public.%I where owner_user_id is null)', tbl) into has_null;
    if not has_null then
      execute format('alter table public.%I alter column owner_user_id set not null', tbl);
    end if;

    execute format('alter table if exists public.%I enable row level security', tbl);
    execute format('drop policy if exists %I on public.%I', tbl || '_select_owner', tbl);
    execute format('drop policy if exists %I on public.%I', tbl || '_insert_owner', tbl);
    execute format('drop policy if exists %I on public.%I', tbl || '_update_owner', tbl);
    execute format('drop policy if exists %I on public.%I', tbl || '_delete_owner', tbl);

    execute format(
      'create policy %I on public.%I for select to authenticated using (owner_user_id = auth.uid())',
      tbl || '_select_owner',
      tbl
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (owner_user_id = auth.uid())',
      tbl || '_insert_owner',
      tbl
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid())',
      tbl || '_update_owner',
      tbl
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (owner_user_id = auth.uid())',
      tbl || '_delete_owner',
      tbl
    );
  end loop;
end $$;
