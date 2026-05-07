-- AIOS Connectors — initial schema.
--
-- device_users: one row per AIOS Desktop install.
--   The device_user_id is a UUID generated client-side on first launch (and
--   persisted in the local SQLite settings DB). It's used as the bearer token
--   for all relay calls and as the Composio entity_id under the hood.
--
-- device_connections: one row per (user, service) pair the user has
--   connected via the Composio OAuth flow. Status starts at 'pending' when
--   the OAuth handoff is initiated and flips to 'connected' when Composio's
--   webhook fires the completion event.

create extension if not exists "pgcrypto";

create table public.device_users (
  id uuid primary key default gen_random_uuid(),
  device_user_id uuid unique not null,
  composio_entity_id text unique not null,
  os text,
  app_version text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table public.device_connections (
  id uuid primary key default gen_random_uuid(),
  device_user_id uuid not null
    references public.device_users(device_user_id)
    on delete cascade,
  service text not null,
  composio_connection_id text unique not null,
  status text not null default 'pending',  -- 'pending' | 'connected' | 'error'
  account_label text,
  connected_at timestamptz,
  last_used_at timestamptz,
  metadata jsonb,
  unique (device_user_id, service)
);

create index device_connections_user_idx on public.device_connections (device_user_id);
create index device_connections_status_idx on public.device_connections (status);

-- RLS: enabled, no policies — only the Edge Functions (using the service role
-- key) can read or write. The desktop app never talks to Postgres directly;
-- it only calls the Edge Function endpoints.
alter table public.device_users enable row level security;
alter table public.device_connections enable row level security;
