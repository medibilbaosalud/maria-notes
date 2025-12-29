-- Create table for AI Audit Logs (The "Pro" Black Box)
create table if not exists ai_audit_logs (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  patient_name text,
  pipeline_version text,
  
  -- The Core Audit Data (JSONB for flexibility)
  models_used jsonb,         -- Which model did what
  extraction_data jsonb,     -- What Phase 1 extracted
  generation_versions jsonb, -- All drafts (Phase 2 & corrections)
  validation_logs jsonb,     -- What Phase 3 complained about
  
  -- Metrics
  corrections_applied integer,
  successful boolean,
  duration_ms integer
);

-- Enable RLS (Row Level Security) but keep it open for authenticated users for now
alter table ai_audit_logs enable row level security;

create policy "Enable insert for authenticated users only"
on ai_audit_logs for insert
to authenticated
with check (true);

create policy "Enable select for authenticated users only"
on ai_audit_logs for select
to authenticated
using (true);
