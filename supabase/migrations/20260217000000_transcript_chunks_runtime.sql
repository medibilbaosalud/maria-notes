create table if not exists public.consultation_transcript_chunks (
  id uuid default gen_random_uuid() primary key,
  session_id text not null,
  session_version integer not null default 1,
  batch_index integer not null,
  part_index integer not null default 0,
  text text not null default '',
  status text not null default 'completed',
  error_reason text,
  latency_ms integer,
  model_used text,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  constraint consultation_transcript_chunks_status_chk check (status in ('completed', 'failed')),
  constraint consultation_transcript_chunks_unique unique (session_id, session_version, batch_index, part_index)
);

create index if not exists consultation_transcript_chunks_session_idx
  on public.consultation_transcript_chunks (session_id, session_version, batch_index, part_index);

alter table public.consultation_transcript_chunks enable row level security;

drop policy if exists "Enable insert for all users" on public.consultation_transcript_chunks;
drop policy if exists "Enable select for all users" on public.consultation_transcript_chunks;
create policy "Enable insert for all users"
  on public.consultation_transcript_chunks
  for insert
  to public
  with check (true);
create policy "Enable select for all users"
  on public.consultation_transcript_chunks
  for select
  to public
  using (true);
