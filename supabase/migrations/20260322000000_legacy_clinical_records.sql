-- Legacy clinical import for historical psychology/ORL notes.
-- Use this when you want specialist identity without tying the data to auth ownership.
--
-- Import flow:
-- 1) Load the CSV into public.legacy_clinical_import_staging
-- 2) Run: select public.import_legacy_clinical_records();
-- 3) For the psychology subset only: select public.import_legacy_psychology_records();
-- 4) For ORL legacy rows: select public.import_legacy_orl_records();

create extension if not exists pgcrypto;

create or replace function public.legacy_normalize_text(value text)
returns text
language sql
immutable
as $$
  select nullif(btrim(coalesce(value, '')), '');
$$;

create or replace function public.legacy_specialty_from_row(
  p_especialidad text,
  p_usuario text
)
returns text
language sql
immutable
as $$
  select case
    when lower(coalesce(p_especialidad, '')) like '%psicolog%'
      or lower(coalesce(p_usuario, '')) in ('adelgadopsico@gmail.com', 'juneamoressanchez@gmail.com')
      then 'psicologia'
    when lower(coalesce(p_especialidad, '')) like '%otorrin%'
      or lower(coalesce(p_usuario, '')) = 'igotxi@medibilbaosalud.com'
      then 'otorrino'
    else 'otorrino'
  end;
$$;

create or replace function public.legacy_specialist_name_from_row(
  p_especialidad text,
  p_usuario text
)
returns text
language sql
immutable
as $$
  select case
    when lower(coalesce(p_usuario, '')) = 'adelgadopsico@gmail.com' then 'Ainhoa'
    when lower(coalesce(p_usuario, '')) = 'juneamoressanchez@gmail.com' then 'June'
    when lower(coalesce(p_usuario, '')) = 'igotxi@medibilbaosalud.com' then 'Dra. Gotxi'
    when lower(coalesce(p_especialidad, '')) like '%psicolog%' then 'Psicologia'
    when lower(coalesce(p_especialidad, '')) like '%otorrin%' then 'Otorrino'
    else nullif(initcap(regexp_replace(split_part(coalesce(p_usuario, ''), '@', 1), '[^[:alnum:] ]+', ' ', 'g')), '')
  end;
$$;

create or replace function public.legacy_clinician_profile_from_row(
  p_usuario text
)
returns text
language sql
immutable
as $$
  select case
    when lower(coalesce(p_usuario, '')) = 'adelgadopsico@gmail.com' then 'ainhoa'
    when lower(coalesce(p_usuario, '')) = 'juneamoressanchez@gmail.com' then 'june'
    else null
  end;
$$;

create or replace function public.legacy_build_history(
  p_antecedentes text,
  p_historia text,
  p_evolucion text
)
returns text
language sql
immutable
as $$
  select btrim(
    concat_ws(
      E'\n\n',
      nullif(btrim(coalesce(p_antecedentes, '')), ''),
      nullif(btrim(coalesce(p_historia, '')), ''),
      nullif(btrim(coalesce(p_evolucion, '')), '')
    )
  );
$$;

create table if not exists public.legacy_clinical_import_staging (
  id bigserial primary key,
  loaded_at timestamptz not null default now(),
  source_csv text,
  import_batch text,
  "FECHA" text,
  "HORA" text,
  "ESPECIALIDAD" text,
  "IDCONTACTO" text,
  "CONTACTO" text,
  "NUM" text,
  "USUARIO" text,
  "HISTORIAL" text,
  "ALERGIA" text,
  "EMBARAZO" text,
  "ENFERMEDAD" text,
  "ANTECEDENTES" text,
  "HISTORIA" text,
  "EVOLUCION" text,
  "PESO" text,
  "ALTURA" text,
  "TENSION" text,
  "PIE" text,
  "MINIMO SESIONES" text,
  "MAXIMO SESIONES" text
);

create index if not exists legacy_clinical_import_staging_source_idx
  on public.legacy_clinical_import_staging (source_csv, import_batch, id);

create table if not exists public.legacy_clinical_records (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique,
  source_csv text not null default 'legacy_csv',
  import_batch text not null default 'legacy_import',
  source_row_id bigint not null,
  source_email text not null,
  specialist_name text not null,
  clinician_profile text,
  specialty text not null check (specialty in ('otorrino', 'psicologia')),
  external_contact_id text,
  patient_name text not null,
  consultation_at timestamp without time zone not null,
  medical_history text not null,
  original_medical_history text not null,
  raw_row jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists legacy_clinical_records_specialist_idx
  on public.legacy_clinical_records (specialty, specialist_name, consultation_at desc);

create index if not exists legacy_clinical_records_patient_idx
  on public.legacy_clinical_records (patient_name, consultation_at desc);

create index if not exists legacy_clinical_records_source_idx
  on public.legacy_clinical_records (source_email, source_csv, import_batch);

alter table if exists public.legacy_clinical_records enable row level security;

drop policy if exists "legacy_clinical_records_select_owner" on public.legacy_clinical_records;
drop policy if exists "legacy_clinical_records_insert_owner" on public.legacy_clinical_records;
drop policy if exists "legacy_clinical_records_update_owner" on public.legacy_clinical_records;
drop policy if exists "legacy_clinical_records_delete_owner" on public.legacy_clinical_records;

create policy "legacy_clinical_records_select_owner"
on public.legacy_clinical_records
for select
to authenticated
using (true);

create policy "legacy_clinical_records_insert_owner"
on public.legacy_clinical_records
for insert
to authenticated
with check (true);

create policy "legacy_clinical_records_update_owner"
on public.legacy_clinical_records
for update
to authenticated
using (true)
with check (true);

create policy "legacy_clinical_records_delete_owner"
on public.legacy_clinical_records
for delete
to authenticated
using (true);

create or replace function public.import_legacy_clinical_records(
  p_source_csv text default null,
  p_import_batch text default null,
  p_specialty_filter text default null,
  p_source_emails text[] default null
)
returns bigint
language plpgsql
as $$
declare
  v_inserted bigint := 0;
begin
  with normalized as (
    select
      s.id as source_row_id,
      coalesce(nullif(btrim(s.source_csv), ''), coalesce(p_source_csv, 'legacy_csv')) as source_csv,
      coalesce(nullif(btrim(s.import_batch), ''), coalesce(p_import_batch, 'legacy_import')) as import_batch,
      legacy_normalize_text(s."FECHA") as fecha,
      legacy_normalize_text(s."HORA") as hora,
      legacy_normalize_text(s."ESPECIALIDAD") as especialidad,
      legacy_normalize_text(s."IDCONTACTO") as external_contact_id,
      legacy_normalize_text(s."CONTACTO") as patient_name,
      legacy_normalize_text(s."USUARIO") as source_email,
      legacy_normalize_text(s."ANTECEDENTES") as antecedentes,
      legacy_normalize_text(s."HISTORIA") as historia,
      legacy_normalize_text(s."EVOLUCION") as evolucion,
      legacy_normalize_text(s."HISTORIAL") as historial,
      legacy_normalize_text(s."ALERGIA") as alergia,
      legacy_normalize_text(s."EMBARAZO") as embarazo,
      legacy_normalize_text(s."ENFERMEDAD") as enfermedad,
      legacy_normalize_text(s."PESO") as peso,
      legacy_normalize_text(s."ALTURA") as altura,
      legacy_normalize_text(s."TENSION") as tension,
      legacy_normalize_text(s."PIE") as pie,
      legacy_normalize_text(s."MINIMO SESIONES") as minimo_sesiones,
      legacy_normalize_text(s."MAXIMO SESIONES") as maximo_sesiones,
      legacy_specialty_from_row(s."ESPECIALIDAD", s."USUARIO") as specialty,
      legacy_specialist_name_from_row(s."ESPECIALIDAD", s."USUARIO") as specialist_name,
      legacy_clinician_profile_from_row(s."USUARIO") as clinician_profile,
      legacy_build_history(s."ANTECEDENTES", s."HISTORIA", s."EVOLUCION") as medical_history,
      jsonb_build_object(
        'FECHA', s."FECHA",
        'HORA', s."HORA",
        'ESPECIALIDAD', s."ESPECIALIDAD",
        'IDCONTACTO', s."IDCONTACTO",
        'CONTACTO', s."CONTACTO",
        'NUM', s."NUM",
        'USUARIO', s."USUARIO",
        'HISTORIAL', s."HISTORIAL",
        'ALERGIA', s."ALERGIA",
        'EMBARAZO', s."EMBARAZO",
        'ENFERMEDAD', s."ENFERMEDAD",
        'ANTECEDENTES', s."ANTECEDENTES",
        'HISTORIA', s."HISTORIA",
        'EVOLUCION', s."EVOLUCION",
        'PESO', s."PESO",
        'ALTURA', s."ALTURA",
        'TENSION', s."TENSION",
        'PIE', s."PIE",
        'MINIMO SESIONES', s."MINIMO SESIONES",
        'MAXIMO SESIONES', s."MAXIMO SESIONES"
      ) as raw_row,
      case
        when legacy_build_history(s."ANTECEDENTES", s."HISTORIA", s."EVOLUCION") = '' then 0
        else length(legacy_build_history(s."ANTECEDENTES", s."HISTORIA", s."EVOLUCION"))
      end as note_length
    from public.legacy_clinical_import_staging s
    where (p_source_csv is null or coalesce(nullif(btrim(s.source_csv), ''), '') = p_source_csv)
      and (p_import_batch is null or coalesce(nullif(btrim(s.import_batch), ''), '') = p_import_batch)
      and (
        p_specialty_filter is null
        or lower(coalesce(s."ESPECIALIDAD", '')) like '%' || lower(p_specialty_filter) || '%'
      )
      and (
        p_source_emails is null
        or exists (
          select 1
          from unnest(p_source_emails) as allowed_email
          where lower(coalesce(s."USUARIO", '')) = lower(allowed_email)
        )
      )
      and (
        lower(coalesce(s."ESPECIALIDAD", '')) like '%psicolog%'
        or lower(coalesce(s."ESPECIALIDAD", '')) like '%otorrin%'
      )
  ),
  ranked as (
    select
      *,
      row_number() over (
        partition by source_email, patient_name, consultation_at, specialist_name
        order by note_length desc, source_row_id asc
      ) as rn
    from (
      select
        *,
        (fecha || ' ' || hora)::timestamp as consultation_at,
        md5(
          lower(coalesce(source_email, '')) || '|' ||
          lower(coalesce(patient_name, '')) || '|' ||
          coalesce((fecha || ' ' || hora)::timestamp::text, '') || '|' ||
          lower(coalesce(specialist_name, '')) || '|' ||
          coalesce(medical_history, '')
        ) as dedupe_key
      from normalized
    ) prepared
    where medical_history <> ''
      and patient_name <> ''
      and source_email <> ''
      and fecha <> ''
      and hora <> ''
  )
  insert into public.legacy_clinical_records (
    dedupe_key,
    source_csv,
    import_batch,
    source_row_id,
    source_email,
    specialist_name,
    clinician_profile,
    specialty,
    external_contact_id,
    patient_name,
    consultation_at,
    medical_history,
    original_medical_history,
    raw_row,
    created_at,
    updated_at
  )
  select
    dedupe_key,
    source_csv,
    import_batch,
    source_row_id,
    source_email,
    specialist_name,
    clinician_profile,
    specialty,
    external_contact_id,
    patient_name,
    consultation_at,
    medical_history,
    medical_history,
    raw_row,
    now(),
    now()
  from ranked
  where rn = 1
  on conflict (dedupe_key) do update set
    source_csv = excluded.source_csv,
    import_batch = excluded.import_batch,
    source_row_id = excluded.source_row_id,
    source_email = excluded.source_email,
    specialist_name = excluded.specialist_name,
    clinician_profile = excluded.clinician_profile,
    specialty = excluded.specialty,
    external_contact_id = excluded.external_contact_id,
    patient_name = excluded.patient_name,
    consultation_at = excluded.consultation_at,
    medical_history = excluded.medical_history,
    original_medical_history = excluded.original_medical_history,
    raw_row = excluded.raw_row,
    updated_at = now();

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

create or replace function public.import_legacy_psychology_records(
  p_source_csv text default null,
  p_import_batch text default null
)
returns bigint
language sql
as $$
  select public.import_legacy_clinical_records(
    p_source_csv,
    p_import_batch,
    'psicolog',
    array['adelgadopsico@gmail.com', 'juneamoressanchez@gmail.com']
  );
$$;

create or replace function public.import_legacy_orl_records(
  p_source_csv text default null,
  p_import_batch text default null
)
returns bigint
language sql
as $$
  select public.import_legacy_clinical_records(
    p_source_csv,
    p_import_batch,
    'otorrin',
    array['igotxi@medibilbaosalud.com']
  );
$$;

comment on table public.legacy_clinical_import_staging is
  'Raw CSV staging table for legacy clinical histories. Import the file here first, then run import_legacy_clinical_records().';

comment on table public.legacy_clinical_records is
  'Curated legacy clinical history table with specialist identity and no auth ownership dependency.';
