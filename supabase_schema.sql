-- Enable the UUID extension if not already enabled
create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;

-- Create the medical_records table
create table public.medical_records (
  id uuid not null default uuid_generate_v4(),
  record_uuid uuid not null default gen_random_uuid(),
  idempotency_key text null,
  owner_user_id uuid not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  patient_name text not null,
  consultation_type text not null,
  transcription text null, -- The raw audio transcription
  medical_history text null, -- The AI generated history (Markdown)
  original_medical_history text null, -- Baseline AI output before edits
  medical_report text null,
  report_created_at timestamptz null,
  ai_model text null,
  audit_id uuid null,
  
  -- Constraints
  constraint medical_records_pkey primary key (id)
);

-- Set up strict Row Level Security (RLS)
alter table public.medical_records enable row level security;

-- Policy to allow anyone to insert records (since we are using a shared client for now)
create policy "medical_records_insert_owner"
on public.medical_records
for insert
to authenticated
with check (owner_user_id = auth.uid());

-- Policy to allow anyone to view records
create policy "medical_records_select_owner"
on public.medical_records
for select
to authenticated
using (owner_user_id = auth.uid());

create policy "medical_records_update_owner"
on public.medical_records
for update
to authenticated
using (owner_user_id = auth.uid())
with check (owner_user_id = auth.uid());

create policy "medical_records_delete_owner"
on public.medical_records
for delete
to authenticated
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

-- Optional: Create an index for faster searching by patient name
create index medical_records_patient_name_idx on public.medical_records using btree (patient_name);
create unique index medical_records_record_uuid_uq on public.medical_records (record_uuid);
create unique index if not exists medical_records_idempotency_key_uq on public.medical_records (idempotency_key) where idempotency_key is not null;
