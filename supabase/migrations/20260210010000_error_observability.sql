-- Error observability: central app error events for diagnostics
create extension if not exists pgcrypto;

create table if not exists public.app_error_events (
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

create index if not exists app_error_events_created_at_idx on public.app_error_events(created_at desc);
create index if not exists app_error_events_fingerprint_idx on public.app_error_events(fingerprint);
create index if not exists app_error_events_severity_created_idx on public.app_error_events(severity, created_at desc);

alter table public.app_error_events enable row level security;

drop policy if exists "app_error_events_insert_public" on public.app_error_events;
drop policy if exists "app_error_events_select_owner" on public.app_error_events;

-- Insert abierto para no perder telemetria incluso sin sesion auth.
create policy "app_error_events_insert_public"
on public.app_error_events
for insert
to public
with check (true);

-- Lectura restringida a propietario autenticado si existe owner.
create policy "app_error_events_select_owner"
on public.app_error_events
for select
to authenticated
using (owner_user_id is null or owner_user_id = auth.uid());
