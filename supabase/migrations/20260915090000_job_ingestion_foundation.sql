-- Hanaply job ingestion: sources, canonical jobs, provenance, deduplication,
-- freshness, and provider health.
--
-- Shape of the system:
--
--   source adapter  ->  normalized job payload  ->  public.upsert_ingested_job
--                                                        |
--                          +-----------------------------+-----------------------------+
--                          |                             |                             |
--                    public.jobs              public.job_source_records        public.companies
--                  (one per opportunity)        (one per source posting)        (deduplicated)
--
-- Three properties are deliberate:
--
--   1. External job descriptions are untrusted input. They are stored as data
--      only, never executed, never interpolated into instructions, and every
--      raw payload is retained so a normalization bug can be replayed.
--   2. Deduplication uses several independent signals (source identity, canonical
--      URL, company + normalized title, location, description fingerprint, and
--      posting time) rather than URL equality. Provenance is always retained:
--      merging never deletes a source record.
--   3. Ingestion is shared infrastructure. One scan per source serves every
--      subscriber; plan cadence only decides how often the shared scan runs,
--      never how many provider requests are issued.

-- ---------------------------------------------------------------------------
-- Enumerated types
-- ---------------------------------------------------------------------------

create type public.job_source_kind as enum (
  'remotive',
  'arbeitnow',
  'greenhouse',
  'lever',
  'ashby',
  'hn_algolia',
  'adzuna',
  'jooble',
  'partner_feed',
  'manual'
);

create type public.job_source_status as enum ('active', 'paused', 'disabled');

create type public.job_remote_state as enum ('remote', 'hybrid', 'onsite', 'unspecified');

create type public.job_seniority as enum (
  'internship',
  'entry',
  'junior',
  'mid',
  'senior',
  'lead',
  'principal',
  'manager',
  'director',
  'executive',
  'unspecified'
);

create type public.job_status as enum ('active', 'stale', 'expired', 'closed', 'duplicate', 'rejected');

create type public.job_source_record_status as enum ('active', 'removed', 'stale');

create type public.job_ingestion_run_status as enum ('running', 'succeeded', 'partial', 'failed');

create type public.job_ingestion_trigger as enum ('schedule', 'manual', 'backfill', 'retry');

-- ---------------------------------------------------------------------------
-- Sources
-- ---------------------------------------------------------------------------

create table public.job_sources (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z][a-z0-9_]{2,63}$'),
  display_name text not null check (char_length(display_name) between 2 and 120),
  source_kind public.job_source_kind not null,
  status public.job_source_status not null default 'paused',
  base_url text not null check (char_length(base_url) between 8 and 500),
  -- Attribution and terms are required fields, not optional metadata: a source
  -- cannot be enabled without recording where its data comes from and under
  -- which terms it may be used.
  attribution text not null check (char_length(attribution) between 2 and 300),
  terms_url text null check (terms_url is null or char_length(terms_url) between 8 and 500),
  requires_credentials boolean not null default false,
  -- The environment variable *name* only. Secret values never reach the database.
  credential_env_var text null
    check (credential_env_var is null or credential_env_var ~ '^[A-Z][A-Z0-9_]{2,79}$'),
  min_scan_interval_minutes integer not null default 15
    check (min_scan_interval_minutes between 5 and 1440),
  requests_per_minute integer not null default 30 check (requests_per_minute between 1 and 600),
  batch_size integer not null default 100 check (batch_size between 1 and 1000),
  config jsonb not null default '{}' check (pg_catalog.jsonb_typeof(config) = 'object'),
  last_success_at timestamptz null,
  last_failure_at timestamptz null,
  last_error_code text null check (last_error_code is null or char_length(last_error_code) <= 80),
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  circuit_open_until timestamptz null,
  total_jobs_ingested bigint not null default 0 check (total_jobs_ingested >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint job_sources_credentials_check check (
    not requires_credentials or credential_env_var is not null
  )
);

comment on table public.job_sources is
  'Approved job providers. A source is disabled until an operator records its attribution, terms, and cadence limits.';
comment on column public.job_sources.credential_env_var is
  'Name of the environment variable that holds the provider credential. The value itself must never be stored in the database.';
comment on column public.job_sources.min_scan_interval_minutes is
  'The fastest cadence the provider permits. Plan cadence can never scan a source faster than this.';

create index job_sources_status_idx on public.job_sources (status, source_kind);

create or replace function app_private.job_source_snapshot(source public.job_sources)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'id', source.id,
    'code', source.code,
    'displayName', source.display_name,
    'sourceKind', source.source_kind,
    'status', source.status,
    'baseUrl', source.base_url,
    'attribution', source.attribution,
    'termsUrl', source.terms_url,
    'requiresCredentials', source.requires_credentials,
    'credentialEnvVar', source.credential_env_var,
    'minScanIntervalMinutes', source.min_scan_interval_minutes,
    'requestsPerMinute', source.requests_per_minute,
    'batchSize', source.batch_size,
    'config', source.config,
    'lastSuccessAt', source.last_success_at,
    'lastFailureAt', source.last_failure_at,
    'lastErrorCode', source.last_error_code,
    'consecutiveFailures', source.consecutive_failures,
    'circuitOpenUntil', source.circuit_open_until,
    'totalJobsIngested', source.total_jobs_ingested,
    'createdAt', source.created_at,
    'updatedAt', source.updated_at
  );
$$;

revoke all on function app_private.job_source_snapshot(public.job_sources)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Companies
-- ---------------------------------------------------------------------------

create or replace function app_private.normalize_company_name(requested_name text)
returns text
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  normalized text;
  stripped text;
  previous text;
  guard integer := 0;
begin
  normalized := pg_catalog.regexp_replace(
    pg_catalog.lower(pg_catalog.btrim(coalesce(requested_name, ''))),
    '[^a-z0-9]+',
    ' ',
    'g'
  );
  previous := normalized;

  -- Legal forms stack ("Meridian Support Philippines Inc"), so the suffix is
  -- stripped repeatedly until the name stops changing. PostgreSQL ARE spells the
  -- word boundary \y, and a single regexp_replace cannot loop on its own.
  loop
    stripped := pg_catalog.regexp_replace(
      normalized,
      '\s*[,.]?\s*\y(inc|incorporated|corp|corporation|company|co|llc|ltd|limited|plc|gmbh|bv|nv|pte|pvt|sdn bhd|bhd|philippines|ph)\y\.?\s*$',
      '',
      'g'
    );
    exit when stripped = normalized or guard >= 5;
    normalized := stripped;
    guard := guard + 1;
  end loop;

  normalized := pg_catalog.btrim(normalized);
  -- A name made entirely of legal forms keeps its original wording rather than
  -- collapsing to nothing and failing the ingestion of a real posting.
  if normalized = '' then
    normalized := pg_catalog.btrim(previous);
  end if;
  return nullif(normalized, '');
end;
$$;

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  normalized_name text not null unique
    check (char_length(normalized_name) between 1 and 160),
  display_name text not null check (char_length(display_name) between 1 and 200),
  domain text null check (domain is null or domain ~ '^[a-z0-9.-]{3,200}$'),
  country_code text null check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  is_verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.companies is
  'Deduplicated employers. Rows are created only from ingested postings, and a normalized name is the identity key.';

create index companies_display_name_idx on public.companies (pg_catalog.lower(display_name));

-- ---------------------------------------------------------------------------
-- Canonical jobs
-- ---------------------------------------------------------------------------

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete restrict,
  title text not null check (char_length(title) between 2 and 300),
  normalized_title text not null check (char_length(normalized_title) between 1 and 300),
  description text not null check (char_length(description) between 20 and 40000),
  description_excerpt text not null default ''
    check (char_length(description_excerpt) <= 600),
  employment_type public.employment_type not null default 'full_time',
  seniority public.job_seniority not null default 'unspecified',
  remote_state public.job_remote_state not null default 'unspecified',
  location_raw text null check (location_raw is null or char_length(location_raw) between 1 and 300),
  city text null check (city is null or char_length(city) between 1 and 120),
  region text null check (region is null or char_length(region) between 1 and 120),
  country_code text null check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  is_philippines boolean not null default false,
  is_international boolean not null default false,
  salary_min_minor integer null check (salary_min_minor is null or salary_min_minor > 0),
  salary_max_minor integer null check (salary_max_minor is null or salary_max_minor > 0),
  salary_currency text null check (salary_currency is null or salary_currency ~ '^[A-Z]{3}$'),
  salary_period public.salary_period null,
  salary_is_estimate boolean not null default false,
  requirements text[] not null default '{}',
  preferred_qualifications text[] not null default '{}',
  skills text[] not null default '{}',
  experience_years_min numeric(4, 1) null
    check (experience_years_min is null or (experience_years_min >= 0 and experience_years_min <= 60)),
  experience_years_max numeric(4, 1) null
    check (experience_years_max is null or (experience_years_max >= 0 and experience_years_max <= 60)),
  language text not null default 'en' check (language ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  apply_url text not null check (char_length(apply_url) between 8 and 1000),
  canonical_url text not null check (char_length(canonical_url) between 8 and 1000),
  content_fingerprint text not null check (content_fingerprint ~ '^[a-f0-9]{64}$'),
  dedup_key text not null check (char_length(dedup_key) between 8 and 400),
  source_count integer not null default 1 check (source_count >= 1),
  status public.job_status not null default 'active',
  posted_at timestamptz null,
  expires_at timestamptz null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_verified_at timestamptz null,
  freshness_checked_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint jobs_salary_range_check check (
    salary_min_minor is null
    or salary_max_minor is null
    or salary_max_minor >= salary_min_minor
  ),
  constraint jobs_experience_range_check check (
    experience_years_min is null
    or experience_years_max is null
    or experience_years_max >= experience_years_min
  ),
  constraint jobs_posted_check check (posted_at is null or posted_at <= now() + interval '2 days')
);

comment on table public.jobs is
  'One row per canonical opportunity after normalization and deduplication. Descriptions are untrusted external content and are never treated as instructions.';
comment on column public.jobs.content_fingerprint is
  'SHA-256 over the normalized title, company, location, and description prefix. Used as one deduplication signal, never as the only one.';
comment on column public.jobs.dedup_key is
  'Human-readable composite key (normalized title + company + location bucket) retained for diagnostics and manual merges.';

create index jobs_status_seen_idx on public.jobs (status, last_seen_at desc);
create index jobs_posted_idx on public.jobs (posted_at desc nulls last) where status = 'active';
create index jobs_company_idx on public.jobs (company_id, status);
create index jobs_dedup_key_idx on public.jobs (dedup_key);
create index jobs_fingerprint_idx on public.jobs (content_fingerprint);
create index jobs_philippines_idx on public.jobs (is_philippines, status, posted_at desc nulls last);
create index jobs_remote_idx on public.jobs (remote_state, status, posted_at desc nulls last);
create index jobs_seniority_idx on public.jobs (seniority, employment_type, status);
create index jobs_search_idx on public.jobs
  using gin (to_tsvector('english', title || ' ' || description_excerpt));
create index jobs_skills_idx on public.jobs using gin (skills);

-- ---------------------------------------------------------------------------
-- Source provenance
-- ---------------------------------------------------------------------------

create table public.job_source_records (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  source_id uuid not null references public.job_sources (id) on delete restrict,
  source_job_id text not null check (char_length(source_job_id) between 1 and 200),
  source_url text not null check (char_length(source_url) between 8 and 1000),
  raw_payload jsonb not null check (pg_catalog.jsonb_typeof(raw_payload) = 'object'),
  payload_checksum text not null check (payload_checksum ~ '^[a-f0-9]{64}$'),
  status public.job_source_record_status not null default 'active',
  is_primary boolean not null default false,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_verified_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint job_source_records_identity_unique unique (source_id, source_job_id)
);

comment on table public.job_source_records is
  'Per-source provenance. Merging duplicates never deletes a source record, so attribution and audit survive deduplication.';

create index job_source_records_job_idx on public.job_source_records (job_id, status);
create index job_source_records_source_idx
  on public.job_source_records (source_id, last_seen_at desc);
create unique index job_source_records_one_primary_idx
  on public.job_source_records (job_id)
  where is_primary;

-- ---------------------------------------------------------------------------
-- Ingestion runs, locks, and health
-- ---------------------------------------------------------------------------

create table public.job_ingestion_runs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.job_sources (id) on delete cascade,
  trigger public.job_ingestion_trigger not null default 'schedule',
  status public.job_ingestion_run_status not null default 'running',
  requested_by uuid null references auth.users (id) on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz null,
  duration_ms integer null check (duration_ms is null or duration_ms >= 0),
  fetched_count integer not null default 0 check (fetched_count >= 0),
  created_count integer not null default 0 check (created_count >= 0),
  updated_count integer not null default 0 check (updated_count >= 0),
  merged_count integer not null default 0 check (merged_count >= 0),
  skipped_count integer not null default 0 check (skipped_count >= 0),
  rejected_count integer not null default 0 check (rejected_count >= 0),
  error_code text null check (error_code is null or char_length(error_code) <= 80),
  error_message text null check (error_message is null or char_length(error_message) <= 500),
  request_id uuid null
);

create index job_ingestion_runs_source_idx
  on public.job_ingestion_runs (source_id, started_at desc);
create index job_ingestion_runs_status_idx
  on public.job_ingestion_runs (status, started_at desc);

-- One running scan per source. This is what makes overlapping scans impossible
-- even across processes.
create unique index job_ingestion_runs_one_running_idx
  on public.job_ingestion_runs (source_id)
  where status = 'running';

create table public.job_dedup_candidates (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  duplicate_job_id uuid not null references public.jobs (id) on delete cascade,
  score numeric(4, 3) not null check (score >= 0 and score <= 1),
  signals jsonb not null default '{}' check (pg_catalog.jsonb_typeof(signals) = 'object'),
  resolution text null check (resolution is null or resolution in ('merged', 'kept_separate')),
  resolved_by uuid null references auth.users (id) on delete set null,
  resolved_at timestamptz null,
  created_at timestamptz not null default now(),
  constraint job_dedup_candidates_pair_unique unique (job_id, duplicate_job_id),
  constraint job_dedup_candidates_distinct_check check (job_id <> duplicate_job_id)
);

comment on table public.job_dedup_candidates is
  'Reviewable near-duplicate pairs that scored below the automatic merge threshold. This is the deduplication diagnostic surface.';

create index job_dedup_candidates_open_idx
  on public.job_dedup_candidates (created_at desc)
  where resolution is null;

create table app_private.job_ingestion_locks (
  lock_key text primary key check (lock_key ~ '^[a-z][a-z0-9_.:_-]{2,120}$'),
  holder text not null check (char_length(holder) between 8 and 200),
  acquired_at timestamptz not null default now(),
  expires_at timestamptz not null
);

comment on table app_private.job_ingestion_locks is
  'Cooperative locks that prevent two workers from scanning the same source or shipping the same digest.';

revoke all on table app_private.job_ingestion_locks from public, anon, authenticated;
grant all privileges on table app_private.job_ingestion_locks to service_role;

-- ---------------------------------------------------------------------------
-- Normalization helpers
-- ---------------------------------------------------------------------------

create or replace function app_private.normalize_job_title(requested_title text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select coalesce(
    nullif(
      pg_catalog.btrim(
        pg_catalog.regexp_replace(
          pg_catalog.regexp_replace(
            pg_catalog.lower(pg_catalog.btrim(coalesce(requested_title, ''))),
            '\s*[\(\[\{][^\)\]\}]*[\)\]\}]\s*',
            ' ',
            'g'
          ),
          '[^a-z0-9+#.]+',
          ' ',
          'g'
        )
      ),
      ''
    ),
    ''
  );
$$;

create or replace function app_private.job_dedup_key(
  requested_title text,
  requested_company text,
  requested_location text
)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select app_private.normalize_job_title(requested_title)
    || '@' || app_private.normalize_company_name(requested_company)
    || '@' || pg_catalog.left(
      pg_catalog.regexp_replace(
        pg_catalog.lower(pg_catalog.btrim(coalesce(requested_location, 'unspecified'))),
        '[^a-z0-9]+', '-', 'g'
      ),
      80
    );
$$;

create or replace function app_private.job_description_excerpt(requested_description text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select pg_catalog.left(
    pg_catalog.btrim(
      pg_catalog.regexp_replace(
        pg_catalog.regexp_replace(coalesce(requested_description, ''), '<[^>]*>', ' ', 'g'),
        '\s+', ' ', 'g'
      )
    ),
    600
  );
$$;

revoke all on function app_private.normalize_job_title(text) from public, anon, authenticated;
revoke all on function app_private.normalize_company_name(text) from public, anon, authenticated;
revoke all on function app_private.job_dedup_key(text, text, text)
  from public, anon, authenticated;
revoke all on function app_private.job_description_excerpt(text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Locks
-- ---------------------------------------------------------------------------

create or replace function public.acquire_ingestion_lock(
  requested_lock_key text,
  requested_holder text,
  ttl_seconds integer default 600
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  acquired boolean := false;
begin
  perform app_private.require_service_role();
  if ttl_seconds < 30 or ttl_seconds > 7200 then
    raise exception 'lock ttl must be between 30 and 7200 seconds' using errcode = '22023';
  end if;

  insert into app_private.job_ingestion_locks (lock_key, holder, acquired_at, expires_at)
  values (requested_lock_key, requested_holder, now(), now() + pg_catalog.make_interval(secs => ttl_seconds))
  on conflict (lock_key) do update
    set holder = excluded.holder,
        acquired_at = excluded.acquired_at,
        expires_at = excluded.expires_at
    where app_private.job_ingestion_locks.expires_at <= now()
       or app_private.job_ingestion_locks.holder = excluded.holder
  returning true into acquired;

  return coalesce(acquired, false);
end;
$$;

create or replace function public.release_ingestion_lock(
  requested_lock_key text,
  requested_holder text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  removed integer := 0;
begin
  perform app_private.require_service_role();
  delete from app_private.job_ingestion_locks
  where lock_key = requested_lock_key and holder = requested_holder;
  get diagnostics removed = row_count;
  return removed > 0;
end;
$$;

revoke all on function public.acquire_ingestion_lock(text, text, integer)
  from public, anon, authenticated;
revoke all on function public.release_ingestion_lock(text, text) from public, anon, authenticated;
grant execute on function public.acquire_ingestion_lock(text, text, integer) to service_role;
grant execute on function public.release_ingestion_lock(text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Source catalog
-- ---------------------------------------------------------------------------

-- Approved providers are catalogued here disabled. Enabling a source is an
-- explicit operator action that requires attribution and terms to be recorded.
insert into public.job_sources (
  code, display_name, source_kind, base_url, attribution, terms_url,
  requires_credentials, credential_env_var, min_scan_interval_minutes, requests_per_minute
)
values
  (
    'remotive',
    'Remotive',
    'remotive',
    'https://remotive.com/api/remote-jobs',
    'Job data provided by Remotive (remotive.com).',
    'https://remotive.com/terms',
    false, null, 60, 20
  ),
  (
    'arbeitnow',
    'Arbeitnow',
    'arbeitnow',
    'https://www.arbeitnow.com/api/job-board-api',
    'Job data provided by Arbeitnow (arbeitnow.com).',
    'https://www.arbeitnow.com/terms',
    false, null, 60, 20
  ),
  (
    'hn_algolia',
    'Hacker News Who Is Hiring',
    'hn_algolia',
    'https://hn.algolia.com/api/v1/search_by_date',
    'Hiring posts from the public Hacker News "Who is hiring?" threads via the Algolia HN Search API.',
    'https://news.ycombinator.com/newsguidelines.html',
    false, null, 360, 10
  ),
  (
    'adzuna',
    'Adzuna',
    'adzuna',
    'https://api.adzuna.com/v1/api/jobs',
    'Job data provided by Adzuna (adzuna.com).',
    'https://www.adzuna.com/terms-and-conditions',
    true, 'ADZUNA_APP_ID', 30, 30
  ),
  (
    'jooble',
    'Jooble',
    'jooble',
    'https://jooble.org/api',
    'Job data provided by Jooble (jooble.org).',
    'https://jooble.org/terms',
    true, 'JOOBLE_API_KEY', 30, 30
  )
on conflict (code) do update set
  display_name = excluded.display_name,
  source_kind = excluded.source_kind,
  base_url = excluded.base_url,
  attribution = excluded.attribution,
  terms_url = excluded.terms_url,
  requires_credentials = excluded.requires_credentials,
  credential_env_var = excluded.credential_env_var,
  min_scan_interval_minutes = excluded.min_scan_interval_minutes,
  requests_per_minute = excluded.requests_per_minute;

comment on table public.job_sources is
  'Approved job providers, catalogued disabled. A provider without recorded attribution and terms stays paused, and credential-backed providers require an explicit owner decision before activation.';

-- ---------------------------------------------------------------------------
-- Scheduling
-- ---------------------------------------------------------------------------

create or replace function public.job_ingestion_schedule()
returns table (
  source_id uuid,
  source_code text,
  effective_interval_minutes integer,
  fastest_subscriber_interval_minutes integer,
  due boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app_private.require_service_role();

  return query
  with subscriber_cadence as (
    select pg_catalog.min(
      nullif(plan_entitlements.value #>> '{}', '')::integer
    ) as fastest_interval
    from public.subscriptions as subscription
    join public.plan_entitlements
      on plan_entitlements.plan_id = subscription.plan_id
     and plan_entitlements.entitlement_key = 'scanIntervalMinutes'
    where subscription.status = 'active'
      and subscription.starts_at <= now()
      and (subscription.ends_at is null or subscription.ends_at > now())
      and nullif(plan_entitlements.value #>> '{}', '') ~ '^[0-9]+$'
  )
  select
    source.id,
    source.code,
    greatest(
      source.min_scan_interval_minutes,
      coalesce(cadence.fastest_interval, source.min_scan_interval_minutes)
    ) as effective_interval_minutes,
    coalesce(cadence.fastest_interval, source.min_scan_interval_minutes) as fastest_subscriber_interval_minutes,
    (
      source.last_success_at is null
      or source.last_success_at
        <= now() - pg_catalog.make_interval(
          mins => greatest(
            source.min_scan_interval_minutes,
            coalesce(cadence.fastest_interval, source.min_scan_interval_minutes)
          )
        )
    ) as due
  from public.job_sources as source
  cross join subscriber_cadence as cadence
  where source.status = 'active'
    and (source.circuit_open_until is null or source.circuit_open_until <= now())
  order by source.code;
end;
$$;

revoke all on function public.job_ingestion_schedule() from public, anon, authenticated;
grant execute on function public.job_ingestion_schedule() to service_role;

-- ---------------------------------------------------------------------------
-- Ingestion write path
-- ---------------------------------------------------------------------------

create or replace function app_private.resolve_company(
  requested_name text,
  requested_domain text,
  requested_country_code text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  normalized text;
  resolved_id uuid;
begin
  normalized := app_private.normalize_company_name(requested_name);
  if normalized is null then
    raise exception 'a company name is required' using errcode = '22023';
  end if;

  insert into public.companies (normalized_name, display_name, domain, country_code)
  values (
    normalized,
    pg_catalog.left(pg_catalog.btrim(requested_name), 200),
    pg_catalog.left(requested_domain, 200),
    requested_country_code
  )
  on conflict (normalized_name) do update
    set domain = coalesce(public.companies.domain, excluded.domain),
        country_code = coalesce(public.companies.country_code, excluded.country_code)
  returning id into resolved_id;

  return resolved_id;
end;
$$;

create or replace function public.start_ingestion_run(
  target_source_id uuid,
  requested_trigger public.job_ingestion_trigger default 'schedule',
  requested_by uuid default null,
  action_request_id uuid default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  running_id uuid;
begin
  perform app_private.require_service_role();

  if not exists (select 1 from public.job_sources where id = target_source_id) then
    raise exception 'job source does not exist' using errcode = 'P0002';
  end if;

  -- A partial unique index enforces one running scan per source. Reusing the
  -- existing run keeps concurrent schedulers idempotent instead of erroring.
  insert into public.job_ingestion_runs (source_id, trigger, requested_by, request_id)
  values (target_source_id, requested_trigger, requested_by, action_request_id)
  on conflict (source_id) where status = 'running' do nothing
  returning id into running_id;

  if running_id is null then
    select id into running_id
    from public.job_ingestion_runs
    where source_id = target_source_id and status = 'running'
    limit 1;
  end if;

  return running_id;
end;
$$;

create or replace function public.complete_ingestion_run(
  target_run_id uuid,
  outcome jsonb
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  run public.job_ingestion_runs;
  payload jsonb;
  final_status public.job_ingestion_run_status;
  consecutive integer;
begin
  perform app_private.require_service_role();
  payload := app_private.career_require_object(outcome, 'outcome');

  select * into run from public.job_ingestion_runs where id = target_run_id;
  if run.id is null then
    raise exception 'ingestion run does not exist' using errcode = 'P0002';
  end if;

  final_status := coalesce(
    app_private.career_enum(payload, 'status', array['succeeded', 'partial', 'failed'], false),
    case when run.status = 'running' then 'succeeded' else run.status::text end
  )::public.job_ingestion_run_status;

  update public.job_ingestion_runs
  set status = final_status,
      finished_at = now(),
      duration_ms = greatest(
        0,
        pg_catalog.round(extract(epoch from (now() - run.started_at)) * 1000)::integer
      ),
      fetched_count = coalesce(app_private.career_integer(payload, 'fetchedCount', 0, 1000000), fetched_count),
      created_count = coalesce(app_private.career_integer(payload, 'createdCount', 0, 1000000), created_count),
      updated_count = coalesce(app_private.career_integer(payload, 'updatedCount', 0, 1000000), updated_count),
      merged_count = coalesce(app_private.career_integer(payload, 'mergedCount', 0, 1000000), merged_count),
      skipped_count = coalesce(app_private.career_integer(payload, 'skippedCount', 0, 1000000), skipped_count),
      rejected_count = coalesce(app_private.career_integer(payload, 'rejectedCount', 0, 1000000), rejected_count),
      error_code = app_private.career_text(payload, 'errorCode', 80, false),
      error_message = app_private.career_text(payload, 'errorMessage', 500, false)
  where id = run.id;

  if final_status = 'failed' then
    update public.job_sources
    set last_failure_at = now(),
        last_error_code = app_private.career_text(payload, 'errorCode', 80, false),
        consecutive_failures = consecutive_failures + 1,
        -- Exponential backoff with a cap: a provider outage must not become a
        -- request storm, and the source must recover without operator action.
        circuit_open_until = now() + pg_catalog.make_interval(
          secs => least(
            3600,
            60 * pg_catalog.power(2, least(consecutive_failures + 1, 6))::integer
          )
        ),
        status = case
          when consecutive_failures + 1 >= 8 then 'paused'::public.job_source_status
          else status
        end
    where id = run.source_id
    returning consecutive_failures into consecutive;

    insert into public.audit_events (actor_type, action, target_type, target_id, metadata)
    values (
      'system', 'job_source.ingestion_failed', 'job_source', run.source_id,
      pg_catalog.jsonb_build_object(
        'runId', run.id,
        'errorCode', payload ->> 'errorCode',
        'consecutiveFailures', consecutive
      )
    );
  else
    update public.job_sources
    set last_success_at = now(),
        last_error_code = null,
        consecutive_failures = 0,
        circuit_open_until = null,
        total_jobs_ingested = total_jobs_ingested + coalesce(
          app_private.career_integer(payload, 'createdCount', 0, 1000000), 0
        )
    where id = run.source_id;
  end if;

  return true;
end;
$$;

/**
 * The single write path for ingested postings.
 *
 * Deduplication is deliberately multi-signal. An exact content fingerprint is a
 * confident merge. A shared composite key (normalized title + company +
 * location) is a confident merge only when the posting dates are close; when
 * they are far apart the records stay separate so two genuine openings are not
 * silently collapsed. Provenance is always preserved: merging never deletes a
 * source record.
 */
create or replace function public.upsert_ingested_job(
  target_source_id uuid,
  job_input jsonb,
  action_request_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  payload jsonb;
  source public.job_sources;
  resolved_company_id uuid;
  company_name text;
  job_title text;
  job_description text;
  location_raw text;
  fingerprint text;
  dedup text;
  checksum text;
  incoming_source_job_id text;
  incoming_source_url text;
  incoming_apply_url text;
  provenance public.job_source_records;
  target_job public.jobs;
  created boolean := false;
  merged boolean := false;
  matched_by text := 'created';
  poster timestamptz;
  expiry timestamptz;
  review_candidate_id uuid;
begin
  perform app_private.require_service_role();
  payload := app_private.career_require_object(job_input, 'job');

  select * into source from public.job_sources where id = target_source_id;
  if source.id is null then
    raise exception 'job source does not exist' using errcode = 'P0002';
  end if;
  if source.status = 'disabled' then
    raise exception 'job source is disabled' using errcode = '22023';
  end if;

  incoming_source_job_id := app_private.career_text(payload, 'sourceJobId', 200, true);
  incoming_source_url := app_private.career_text(payload, 'sourceUrl', 1000, true);
  incoming_apply_url := coalesce(app_private.career_text(payload, 'applyUrl', 1000, false), incoming_source_url);
  job_title := app_private.career_text(payload, 'title', 300, true);
  company_name := app_private.career_text(payload, 'companyName', 200, true);
  job_description := app_private.career_text(payload, 'description', 40000, true);
  location_raw := app_private.career_text(payload, 'locationRaw', 300, false);
  fingerprint := app_private.career_text(payload, 'contentFingerprint', 64, true);
  checksum := app_private.career_text(payload, 'payloadChecksum', 64, true);
  dedup := app_private.job_dedup_key(job_title, company_name, location_raw);
  poster := (app_private.career_text(payload, 'postedAt', 40, false))::timestamptz;
  expiry := (app_private.career_text(payload, 'expiresAt', 40, false))::timestamptz;

  -- Fast path: this exact posting has already been ingested from this source.
  select * into provenance
  from public.job_source_records
  where source_id = source.id and source_job_id = incoming_source_job_id;

  if provenance.id is not null then
    update public.jobs
    set last_seen_at = now(),
        last_verified_at = now(),
        status = 'active',
        title = job_title,
        description = job_description,
        description_excerpt = app_private.job_description_excerpt(job_description),
        apply_url = incoming_apply_url,
        canonical_url = incoming_source_url,
        expires_at = coalesce(expiry, expires_at)
    where id = provenance.job_id
    returning * into target_job;

    update public.job_source_records
    set raw_payload = coalesce(payload -> 'rawPayload', '{}'::jsonb),
        payload_checksum = checksum,
        source_url = incoming_source_url,
        status = 'active',
        last_seen_at = now(),
        last_verified_at = now()
    where id = provenance.id;

    return pg_catalog.jsonb_build_object(
      'jobId', target_job.id,
      'sourceRecordId', provenance.id,
      'created', false,
      'merged', false,
      'matchedBy', 'source_identity'
    );
  end if;

  resolved_company_id := app_private.resolve_company(
    company_name,
    app_private.career_text(payload, 'companyDomain', 200, false),
    app_private.career_text(payload, 'companyCountryCode', 2, false)
  );

  -- Signal 1: identical normalized content is the same opportunity.
  select * into target_job
  from public.jobs
  where content_fingerprint = fingerprint
    and company_id = resolved_company_id
    and status in ('active', 'stale')
  order by last_seen_at desc
  limit 1;

  if target_job.id is not null then
    merged := true;
    matched_by := 'content_fingerprint';
  else
    -- Signal 2: same composite key, and the posting dates are close enough that
    -- this is a repost rather than a separate opening.
    select * into target_job
    from public.jobs
    where dedup_key = dedup
      and company_id = resolved_company_id
      and status in ('active', 'stale')
      and (
        poster is null
        or posted_at is null
        or pg_catalog.abs(extract(epoch from (posted_at - poster))) <= 1814400
      )
    order by pg_catalog.abs(
      extract(epoch from (coalesce(posted_at, now()) - coalesce(poster, now())))
    )
    limit 1;

    if target_job.id is not null then
      merged := true;
      matched_by := 'composite_key';
    end if;
  end if;

  if target_job.id is not null then
    update public.jobs
    set last_seen_at = now(),
        last_verified_at = now(),
        status = 'active',
        source_count = source_count + 1,
        -- The earliest posting time is the truest freshness signal.
        posted_at = least(coalesce(posted_at, poster), coalesce(poster, posted_at)),
        salary_min_minor = coalesce(
          salary_min_minor, app_private.career_integer(payload, 'salaryMinMinor', 1, 2000000000)
        ),
        salary_max_minor = coalesce(
          salary_max_minor, app_private.career_integer(payload, 'salaryMaxMinor', 1, 2000000000)
        )
    where id = target_job.id
    returning * into target_job;

    if matched_by = 'composite_key' then
      insert into public.audit_events (actor_type, action, target_type, target_id, metadata)
      values (
        'system',
        'job.deduplicated',
        'job',
        target_job.id,
        pg_catalog.jsonb_build_object('matchedBy', matched_by, 'dedupKey', dedup)
      );
    end if;
  else
    -- Signal 3: the same composite key but a distant posting date. The records
    -- stay separate, and the pair is queued for human review instead of being
    -- silently collapsed.
    select existing.id into review_candidate_id
    from public.jobs as existing
    where existing.dedup_key = dedup
      and existing.company_id = resolved_company_id
      and existing.status in ('active', 'stale')
    order by existing.last_seen_at desc
    limit 1;

    insert into public.jobs (
      company_id, title, normalized_title, description, description_excerpt,
      employment_type, seniority, remote_state, location_raw, city, region, country_code,
      is_philippines, is_international,
      salary_min_minor, salary_max_minor, salary_currency, salary_period, salary_is_estimate,
      requirements, preferred_qualifications, skills,
      experience_years_min, experience_years_max,
      language, apply_url, canonical_url, content_fingerprint, dedup_key,
      source_count, status, posted_at, expires_at, first_seen_at, last_seen_at, last_verified_at
    ) values (
      resolved_company_id,
      job_title,
      app_private.normalize_job_title(job_title),
      job_description,
      app_private.job_description_excerpt(job_description),
      coalesce(app_private.career_enum(
        payload, 'employmentType',
        array['full_time','part_time','contract','freelance','internship','temporary','volunteer'],
        false
      ), 'full_time')::public.employment_type,
      coalesce(app_private.career_enum(
        payload, 'seniority',
        array['internship','entry','junior','mid','senior','lead','principal','manager','director','executive','unspecified'],
        false
      ), 'unspecified')::public.job_seniority,
      coalesce(app_private.career_enum(
        payload, 'remoteState', array['remote','hybrid','onsite','unspecified'], false
      ), 'unspecified')::public.job_remote_state,
      location_raw,
      app_private.career_text(payload, 'city', 120, false),
      app_private.career_text(payload, 'region', 120, false),
      app_private.career_text(payload, 'countryCode', 2, false),
      coalesce(app_private.career_text(payload, 'countryCode', 2, false), '') = 'PH',
      coalesce(app_private.career_boolean(payload, 'isInternational', false), false),
      app_private.career_integer(payload, 'salaryMinMinor', 1, 2000000000),
      app_private.career_integer(payload, 'salaryMaxMinor', 1, 2000000000),
      app_private.career_text(payload, 'salaryCurrency', 3, false),
      app_private.career_enum(
        payload, 'salaryPeriod', array['hourly','daily','monthly','annual'], false
      )::public.salary_period,
      coalesce(app_private.career_boolean(payload, 'salaryIsEstimate', true), true),
      app_private.career_text_array(payload, 'requirements', 30, 500),
      app_private.career_text_array(payload, 'preferredQualifications', 20, 500),
      app_private.career_text_array(payload, 'skills', 40, 60),
      app_private.career_numeric(payload, 'experienceYearsMin', 0, 60),
      app_private.career_numeric(payload, 'experienceYearsMax', 0, 60),
      coalesce(app_private.career_text(payload, 'language', 5, false), 'en'),
      incoming_apply_url,
      incoming_source_url,
      fingerprint,
      dedup,
      1,
      'active',
      poster,
      expiry,
      now(), now(), now()
    )
    returning * into target_job;

    created := true;

    if review_candidate_id is not null and review_candidate_id <> target_job.id then
      insert into public.job_dedup_candidates (job_id, duplicate_job_id, score, signals)
      values (
        review_candidate_id,
        target_job.id,
        0.6,
        pg_catalog.jsonb_build_object(
          'matchedBy', 'composite_key_distant_date',
          'dedupKey', dedup
        )
      )
      on conflict (job_id, duplicate_job_id) do nothing;
    end if;
  end if;

  insert into public.job_source_records (
    job_id, source_id, source_job_id, source_url, raw_payload, payload_checksum, is_primary
  ) values (
    target_job.id, source.id, incoming_source_job_id, incoming_source_url,
    coalesce(payload -> 'rawPayload', '{}'::jsonb),
    checksum,
    not exists (select 1 from public.job_source_records where job_id = target_job.id)
  )
  returning * into provenance;

  insert into public.audit_events (actor_type, action, target_type, target_id, request_id, metadata)
  values (
    'system',
    case when created then 'job.ingested' else 'job.observed' end,
    'job',
    target_job.id,
    action_request_id,
    pg_catalog.jsonb_build_object(
      'sourceCode', source.code,
      'sourceJobId', incoming_source_job_id,
      'matchedBy', matched_by
    )
  );

  return pg_catalog.jsonb_build_object(
    'jobId', target_job.id,
    'sourceRecordId', provenance.id,
    'created', created,
    'merged', merged,
    'matchedBy', matched_by
  );
end;
$$;

/**
 * Freshness maintenance. A job no longer observed by any source becomes stale
 * and then expired, so the radar cannot be dominated by postings that are gone.
 */
create or replace function public.refresh_job_freshness(
  evaluated_at timestamptz default now(),
  stale_after_hours integer default 168,
  expire_after_hours integer default 720
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  stale_count integer := 0;
  expired_count integer := 0;
begin
  perform app_private.require_service_role();
  if stale_after_hours < 1 or expire_after_hours <= stale_after_hours then
    raise exception 'freshness thresholds are invalid' using errcode = '22023';
  end if;

  update public.job_source_records
  set status = 'stale'
  where status = 'active'
    and last_seen_at <= evaluated_at - pg_catalog.make_interval(hours => stale_after_hours);

  update public.jobs
  set status = 'stale', freshness_checked_at = evaluated_at
  where status = 'active'
    and last_seen_at <= evaluated_at - pg_catalog.make_interval(hours => stale_after_hours)
    and (expires_at is null or expires_at > evaluated_at);
  get diagnostics stale_count = row_count;

  update public.jobs
  set status = 'expired', freshness_checked_at = evaluated_at
  where status in ('active', 'stale')
    and (
      (expires_at is not null and expires_at <= evaluated_at)
      or last_seen_at <= evaluated_at - pg_catalog.make_interval(hours => expire_after_hours)
    );
  get diagnostics expired_count = row_count;

  update public.jobs
  set freshness_checked_at = evaluated_at
  where freshness_checked_at is null or freshness_checked_at < evaluated_at - interval '1 hour';

  return pg_catalog.jsonb_build_object(
    'staleCount', stale_count,
    'expiredCount', expired_count,
    'evaluatedAt', evaluated_at
  );
end;
$$;

revoke all on function app_private.resolve_company(text, text, text)
  from public, anon, authenticated;
revoke all on function public.start_ingestion_run(uuid, public.job_ingestion_trigger, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.complete_ingestion_run(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.upsert_ingested_job(uuid, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.refresh_job_freshness(timestamptz, integer, integer)
  from public, anon, authenticated;

grant execute on function public.start_ingestion_run(uuid, public.job_ingestion_trigger, uuid, uuid)
  to service_role;
grant execute on function public.complete_ingestion_run(uuid, jsonb) to service_role;
grant execute on function public.upsert_ingested_job(uuid, jsonb, uuid) to service_role;
grant execute on function public.refresh_job_freshness(timestamptz, integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create trigger job_sources_set_updated_at
before update on public.job_sources
for each row execute function app_private.set_updated_at();

create trigger companies_set_updated_at
before update on public.companies
for each row execute function app_private.set_updated_at();

create trigger jobs_set_updated_at
before update on public.jobs
for each row execute function app_private.set_updated_at();

create trigger job_source_records_set_updated_at
before update on public.job_source_records
for each row execute function app_private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security and grants
--
-- Normalized jobs are public opportunity data: any authenticated active account
-- may read active rows, and anon may read nothing. Everything else in this
-- migration is operator-only and has no client policy at all.
-- ---------------------------------------------------------------------------

alter table public.job_sources enable row level security;
alter table public.job_sources force row level security;
alter table public.companies enable row level security;
alter table public.companies force row level security;
alter table public.jobs enable row level security;
alter table public.jobs force row level security;
alter table public.job_source_records enable row level security;
alter table public.job_source_records force row level security;
alter table public.job_ingestion_runs enable row level security;
alter table public.job_ingestion_runs force row level security;
alter table public.job_dedup_candidates enable row level security;
alter table public.job_dedup_candidates force row level security;

revoke all on table public.job_sources from public, anon, authenticated;
revoke all on table public.companies from public, anon, authenticated;
revoke all on table public.jobs from public, anon, authenticated;
revoke all on table public.job_source_records from public, anon, authenticated;
revoke all on table public.job_ingestion_runs from public, anon, authenticated;
revoke all on table public.job_dedup_candidates from public, anon, authenticated;

grant all privileges on table public.job_sources to service_role;
grant all privileges on table public.companies to service_role;
grant all privileges on table public.jobs to service_role;
grant all privileges on table public.job_source_records to service_role;
grant all privileges on table public.job_ingestion_runs to service_role;
grant all privileges on table public.job_dedup_candidates to service_role;

create policy active_jobs_select_active_account
on public.jobs
for select
to authenticated
using (
  status = 'active'
  and (select app_private.is_account_active())
);

create policy job_sources_select_active_account
on public.job_sources
for select
to authenticated
using (
  status = 'active'
  and (select app_private.is_account_active())
);

create policy companies_select_active_account
on public.companies
for select
to authenticated
using ((select app_private.is_account_active()));

-- Column-level grants keep provider configuration, credential variable names,
-- and operator notes out of the client surface even though RLS already limits
-- which rows are visible.
grant select (
  id,
  code,
  display_name,
  source_kind,
  status,
  base_url,
  attribution,
  terms_url,
  min_scan_interval_minutes
) on table public.job_sources to authenticated;

grant select on table public.jobs to authenticated;

grant select (id, display_name, domain, country_code, is_verified)
  on table public.companies to authenticated;

comment on policy active_jobs_select_active_account on public.jobs is
  'Only normalized, active opportunities are readable and only by an active account. Raw provider payloads and ingestion internals are never exposed.';
