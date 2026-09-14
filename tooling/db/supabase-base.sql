-- Hanaply database verification baseline.
--
-- This file reproduces the parts of a Supabase-hosted PostgreSQL instance that the
-- Hanaply migrations and pgTAP suites depend on, so the forward-only migration
-- chain and the row-level-security suites can be executed against a plain local
-- PostgreSQL cluster when Docker/the Supabase CLI are unavailable.
--
-- It is a *test harness* only. It is never applied to a Supabase project: hosted
-- environments already provide these roles, schemas, and helper functions.
--
-- Everything created here mirrors documented Supabase platform behaviour:
--   * roles: anon, authenticated, service_role, supabase_auth_admin, ...
--   * schemas: auth, storage, extensions, graphql, graphql_public
--   * auth.users / auth.sessions and the auth.* claim helpers used by RLS policies
--   * storage.buckets / storage.objects with the storage.* path helpers

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------

do $$
declare
  role_name text;
begin
  foreach role_name in array array[
    'anon',
    'authenticated',
    'service_role',
    'authenticator',
    'supabase_auth_admin',
    'supabase_storage_admin',
    'supabase_admin',
    'dashboard_user',
    'pgbouncer'
  ]
  loop
    if not exists (select 1 from pg_roles where rolname = role_name) then
      execute format('create role %I nologin noinherit', role_name);
    end if;
  end loop;
end;
$$;

alter role anon nologin noinherit;
alter role authenticated nologin noinherit;
alter role service_role nologin noinherit bypassrls;
alter role authenticator login noinherit;
alter role supabase_auth_admin nologin noinherit;
alter role supabase_storage_admin nologin noinherit;
alter role supabase_admin nologin noinherit;
alter role dashboard_user nologin noinherit;
alter role pgbouncer nologin noinherit;

-- ---------------------------------------------------------------------------
-- Schemas
-- ---------------------------------------------------------------------------

create schema if not exists extensions;
create schema if not exists auth;
create schema if not exists storage;
create schema if not exists graphql;
create schema if not exists graphql_public;
create schema if not exists supabase_migrations;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema extensions to anon, authenticated, service_role, supabase_auth_admin;
grant usage on schema auth to anon, authenticated, service_role, supabase_auth_admin, supabase_storage_admin;
grant usage on schema storage to anon, authenticated, service_role, supabase_storage_admin;

alter default privileges in schema public grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to postgres, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Extensions (Supabase installs these into the `extensions` schema)
-- ---------------------------------------------------------------------------

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;
create extension if not exists btree_gin with schema extensions;
create extension if not exists citext with schema extensions;

-- ---------------------------------------------------------------------------
-- auth schema
-- ---------------------------------------------------------------------------

create table if not exists auth.users (
  instance_id uuid null,
  id uuid not null primary key,
  aud varchar(255) null,
  role varchar(255) null,
  email varchar(255) null,
  encrypted_password varchar(255) null,
  email_confirmed_at timestamptz null,
  invited_at timestamptz null,
  confirmation_token varchar(255) null,
  confirmation_sent_at timestamptz null,
  recovery_token varchar(255) null,
  recovery_sent_at timestamptz null,
  email_change_token_new varchar(255) null,
  email_change varchar(255) null,
  email_change_sent_at timestamptz null,
  last_sign_in_at timestamptz null,
  raw_app_meta_data jsonb null,
  raw_user_meta_data jsonb null,
  is_super_admin boolean null,
  created_at timestamptz null,
  updated_at timestamptz null,
  phone text null default null,
  phone_confirmed_at timestamptz null,
  phone_change text null default '',
  phone_change_token varchar(255) null default '',
  phone_change_sent_at timestamptz null,
  confirmed_at timestamptz generated always as (least(email_confirmed_at, phone_confirmed_at)) stored,
  email_change_token_current varchar(255) null default '',
  email_change_confirm_status smallint null default 0,
  banned_until timestamptz null,
  reauthentication_token varchar(255) null default '',
  reauthentication_sent_at timestamptz null,
  is_sso_user boolean not null default false,
  deleted_at timestamptz null,
  is_anonymous boolean not null default false
);

create unique index if not exists users_email_partial_key on auth.users (email);
create index if not exists users_instance_id_idx on auth.users (instance_id);
create index if not exists users_is_anonymous_idx on auth.users (is_anonymous);

create table if not exists auth.identities (
  provider_id text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  identity_data jsonb not null,
  provider text not null,
  last_sign_in_at timestamptz null,
  created_at timestamptz null,
  updated_at timestamptz null,
  email text generated always as (lower(identity_data ->> 'email')) stored,
  id uuid not null default gen_random_uuid() primary key,
  constraint identities_provider_id_provider_unique unique (provider_id, provider)
);

create table if not exists auth.sessions (
  id uuid not null primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz null,
  updated_at timestamptz null,
  factor_id uuid null,
  aal text null,
  not_after timestamptz null,
  refreshed_at timestamp null,
  user_agent text null,
  ip inet null,
  tag text null
);

create index if not exists sessions_user_id_idx on auth.sessions (user_id);
create index if not exists sessions_not_after_idx on auth.sessions (not_after desc);

create table if not exists auth.refresh_tokens (
  instance_id uuid null,
  id bigserial primary key,
  token varchar(255) null,
  user_id varchar(255) null,
  revoked boolean null,
  created_at timestamptz null,
  updated_at timestamptz null,
  parent varchar(255) null,
  session_id uuid null references auth.sessions (id) on delete cascade
);

create table if not exists auth.instances (
  id uuid not null primary key,
  uuid uuid null,
  raw_base_config text null,
  created_at timestamptz null,
  updated_at timestamptz null
);

create table if not exists auth.audit_log_entries (
  instance_id uuid null,
  id uuid not null primary key,
  payload json null,
  created_at timestamptz null,
  ip_address varchar(64) not null default ''
);

-- Claim helpers. Supabase reads the request JWT from the `request.jwt.claims`
-- GUC; tests impersonate a caller with
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}';

create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(nullif(auth.jwt() ->> 'role', ''), nullif(current_setting('role', true), ''))
$$;

create or replace function auth.email()
returns text
language sql
stable
as $$
  select nullif(auth.jwt() ->> 'email', '')
$$;

grant execute on function auth.jwt() to anon, authenticated, service_role, supabase_auth_admin, supabase_storage_admin;
grant execute on function auth.uid() to anon, authenticated, service_role, supabase_auth_admin, supabase_storage_admin;
grant execute on function auth.role() to anon, authenticated, service_role, supabase_auth_admin, supabase_storage_admin;
grant execute on function auth.email() to anon, authenticated, service_role, supabase_auth_admin, supabase_storage_admin;

alter table auth.users enable row level security;
alter table auth.identities enable row level security;
alter table auth.sessions enable row level security;

-- ---------------------------------------------------------------------------
-- storage schema
-- ---------------------------------------------------------------------------

create table if not exists storage.buckets (
  id text not null primary key,
  name text not null,
  owner uuid null,
  created_at timestamptz null default now(),
  updated_at timestamptz null default now(),
  public boolean null default false,
  avif_autodetection boolean null default false,
  file_size_limit bigint null,
  allowed_mime_types text[] null,
  owner_id text null,
  type text not null default 'STANDARD' check (type in ('STANDARD', 'ANALYTICS', 'VECTOR')),
  constraint buckets_name_key unique (name)
);

create table if not exists storage.objects (
  id uuid not null default gen_random_uuid() primary key,
  bucket_id text null references storage.buckets (id),
  name text null,
  owner uuid null,
  created_at timestamptz null default now(),
  updated_at timestamptz null default now(),
  last_accessed_at timestamptz null default now(),
  metadata jsonb null,
  path_tokens text[] generated always as (string_to_array(name, '/')) stored,
  version text null,
  owner_id text null,
  user_metadata jsonb null,
  constraint objects_bucket_id_name_key unique (bucket_id, name)
);

create index if not exists objects_name_idx on storage.objects (name);
create index if not exists objects_bucket_id_idx on storage.objects (bucket_id);
create index if not exists objects_owner_idx on storage.objects (owner);

create or replace function storage.foldername(name text)
returns text[]
language plpgsql
immutable
as $$
declare
  parts text[];
begin
  select string_to_array(name, '/') into parts;
  return parts[1:array_length(parts, 1) - 1];
end;
$$;

create or replace function storage.filename(name text)
returns text
language plpgsql
immutable
as $$
declare
  parts text[];
begin
  select string_to_array(name, '/') into parts;
  return parts[array_length(parts, 1)];
end;
$$;

create or replace function storage.extension(name text)
returns text
language plpgsql
immutable
as $$
declare
  parts text[];
  filename text;
  extension text;
begin
  select string_to_array(name, '/') into parts;
  filename := parts[array_length(parts, 1)];
  extension := substring(filename from '\.([^.]*)$');
  return extension;
end;
$$;

grant execute on function storage.foldername(text) to anon, authenticated, service_role;
grant execute on function storage.filename(text) to anon, authenticated, service_role;
grant execute on function storage.extension(text) to anon, authenticated, service_role;

alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;

grant select on storage.buckets to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
grant select, insert, update, delete on storage.buckets to service_role;

-- ---------------------------------------------------------------------------
-- supabase_migrations bookkeeping (mirrors the CLI's own table)
-- ---------------------------------------------------------------------------

create table if not exists supabase_migrations.schema_migrations (
  version text not null primary key,
  statements text[] null,
  name text null,
  created_by text null,
  idempotency_key text null,
  rollback text[] null
);
