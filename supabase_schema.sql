-- Enable the UUID extension if not already enabled
create extension if not exists "uuid-ossp";

-- Create the medical_records table
create table public.medical_records (
  id uuid not null default uuid_generate_v4(),
  created_at timestamp with time zone not null default now(),
  patient_name text not null,
  consultation_type text not null,
  transcription text null, -- The raw audio transcription
  medical_history text null, -- The AI generated history (Markdown)
  
  -- Constraints
  constraint medical_records_pkey primary key (id)
);

-- Set up Row Level Security (RLS)
-- For a simple desktop app with a single shared API key, we might want to allow public access 
-- OR restrict it if we implement user auth later. 
-- For now, we'll enable RLS but allow public access for simplicity in this dev phase.
alter table public.medical_records enable row level security;

-- Policy to allow anyone to insert records (since we are using a shared client for now)
create policy "Enable insert for all users"
on public.medical_records
for insert
to public
with check (true);

-- Policy to allow anyone to view records
create policy "Enable select for all users"
on public.medical_records
for select
to public
using (true);

-- Optional: Create an index for faster searching by patient name
create index medical_records_patient_name_idx on public.medical_records using btree (patient_name);
