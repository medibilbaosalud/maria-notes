-- Align public.medical_records with the runtime payload sent by the app.
-- Safe to run multiple times.

alter table if exists public.medical_records
  add column if not exists output_tier text;

alter table if exists public.medical_records
  add column if not exists supersedes_record_uuid uuid;

alter table if exists public.medical_records
  add column if not exists source_session_id text;

alter table if exists public.medical_records
  add column if not exists critical_path_ms integer;

alter table if exists public.medical_records
  add column if not exists hardening_ms integer;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'medical_records'
      and column_name = 'output_tier'
  ) and not exists (
    select 1 from pg_constraint where conname = 'medical_records_output_tier_chk'
  ) then
    alter table public.medical_records
      add constraint medical_records_output_tier_chk
      check (output_tier is null or output_tier in ('draft', 'final'));
  end if;
end $$;

create index if not exists medical_records_source_session_id_idx
  on public.medical_records (source_session_id);

create index if not exists medical_records_output_tier_idx
  on public.medical_records (output_tier, updated_at desc);
