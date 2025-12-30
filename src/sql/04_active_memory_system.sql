-- 1. Create table for Long-Term Memory (Consolidated Global Rules)
create table if not exists ai_long_term_memory (
  id uuid primary key default gen_random_uuid(),
  global_rules text not null default '',
  last_consolidated_at timestamptz default now(),
  doctor_id uuid -- Optional, if multi-tenant
);

-- 2. Update existing Lessons table for "Smart Feedback" workflow
alter table ai_improvement_lessons 
add column if not exists recurrence_count int default 1,
add column if not exists status text default 'learning', -- 'learning', 'active', 'rejected'
add column if not exists is_format boolean default false,
add column if not exists last_seen_at timestamptz default now(),
add column if not exists consolidated boolean default false,
add column if not exists doctor_comment text;

-- 3. Row Level Security (RLS) policies (Basic)
alter table ai_long_term_memory enable row level security;

create policy "Enable all access for authenticated users" 
on ai_long_term_memory for all using (true);
