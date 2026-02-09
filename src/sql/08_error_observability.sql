-- Error observability: central app error events for diagnostics
create extension if not exists pgcrypto;

create table if not exists app_error_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default timezone('utc'::text, now()),
  severity text not null default 'error',
  message text not null,
  stack text,
  source text,
  handled boolean not null default false,
  session_id text,
  route text,
  fingerprint text,
  context jsonb not null default '{}'::jsonb,
  breadcrumbs jsonb not null default '[]'::jsonb,
  user_agent text,
  app_version text,
  release_channel text,
  owner_user_id uuid
);

create index if not exists app_error_events_created_at_idx on app_error_events(created_at desc);
create index if not exists app_error_events_fingerprint_idx on app_error_events(fingerprint);
create index if not exists app_error_events_severity_created_idx on app_error_events(severity, created_at desc);
