alter table if exists public.consultation_histories
  add column if not exists transcription_text text not null default '';

comment on column public.consultation_histories.transcription_text is
  'Raw transcription snapshot associated with the generated clinical history.';

create index if not exists consultation_histories_session_created_idx
  on public.consultation_histories (session_id, created_at desc);
