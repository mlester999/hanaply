-- Hanaply Career Intelligence Profile: structured, truth-gated career data.
--
-- This migration introduces the canonical career data model that later job
-- matching, ranking, document generation, and coaching depend on. Three rules
-- shape the design:
--
--   1. Career data is structured, not a resume blob. Employment, projects,
--      education, certifications, links, skills, and sub-careers are separate
--      keyed records that can be queried, matched, and versioned.
--   2. Every claim is a row in public.career_facts with an explicit source and
--      status. Only `confirmed` facts may be used as evidence when generating
--      application material, so the AI layer cannot promote its own guesses
--      into the user's record.
--   3. Clients never write these tables directly. Row-level security exposes
--      read-only, owner-scoped access, and every mutation goes through a
--      SECURITY DEFINER function that re-checks the actor, ownership, plan
--      entitlements, and optimistic version.

-- ---------------------------------------------------------------------------
-- Enumerated types
-- ---------------------------------------------------------------------------

create type public.career_profile_status as enum ('draft', 'active', 'archived');
create type public.career_level as enum (
  'student',
  'entry',
  'junior',
  'mid',
  'senior',
  'lead',
  'manager',
  'director',
  'executive'
);
create type public.employment_type as enum (
  'full_time',
  'part_time',
  'contract',
  'freelance',
  'internship',
  'temporary',
  'volunteer'
);
create type public.work_arrangement as enum ('remote', 'hybrid', 'onsite', 'flexible');
create type public.availability_status as enum (
  'immediately',
  'two_weeks',
  'one_month',
  'three_months',
  'not_looking'
);
create type public.salary_period as enum ('hourly', 'daily', 'monthly', 'annual');
create type public.proficiency_level as enum ('beginner', 'intermediate', 'advanced', 'expert');
create type public.career_skill_kind as enum (
  'skill',
  'tool',
  'technology',
  'language',
  'soft_skill',
  'domain'
);
create type public.career_link_kind as enum (
  'github',
  'gitlab',
  'linkedin',
  'portfolio',
  'personal_website',
  'behance',
  'dribbble',
  'stackoverflow',
  'other'
);
create type public.career_fact_category as enum (
  'experience',
  'responsibility',
  'achievement',
  'metric',
  'skill',
  'education',
  'certification',
  'preference',
  'goal'
);
create type public.career_fact_source as enum (
  'user_entered',
  'resume_extraction',
  'ai_inference',
  'imported'
);
create type public.career_fact_status as enum ('candidate', 'confirmed', 'rejected', 'superseded');

-- ---------------------------------------------------------------------------
-- Core profile
-- ---------------------------------------------------------------------------

create table public.career_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  is_primary boolean not null default false,
  status public.career_profile_status not null default 'draft',
  headline text null check (headline is null or char_length(headline) between 1 and 160),
  summary text null check (summary is null or char_length(summary) between 1 and 4000),
  current_role_title text null
    check (current_role_title is null or char_length(current_role_title) between 1 and 160),
  career_level public.career_level null,
  years_experience numeric(4, 1) null
    check (years_experience is null or (years_experience >= 0 and years_experience <= 80)),
  industries text[] not null default '{}',
  target_role_titles text[] not null default '{}',
  excluded_role_titles text[] not null default '{}',
  preferred_employment_types public.employment_type[] not null default '{}',
  preferred_work_arrangement public.work_arrangement null,
  preferred_locations text[] not null default '{}',
  open_to_international boolean not null default false,
  open_to_relocation boolean not null default false,
  work_authorizations text[] not null default '{}',
  availability public.availability_status null,
  salary_expectation_min_minor integer null
    check (salary_expectation_min_minor is null or salary_expectation_min_minor > 0),
  salary_expectation_max_minor integer null
    check (salary_expectation_max_minor is null or salary_expectation_max_minor > 0),
  salary_currency text not null default 'PHP' check (salary_currency ~ '^[A-Z]{3}$'),
  salary_period public.salary_period null,
  career_goals text null check (career_goals is null or char_length(career_goals) between 1 and 2000),
  completeness_percent smallint not null default 0
    check (completeness_percent between 0 and 100),
  last_reviewed_at timestamptz null,
  version integer not null default 0 check (version >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint career_profiles_name_unique unique (user_id, name),
  constraint career_profiles_salary_range_check check (
    salary_expectation_min_minor is null
    or salary_expectation_max_minor is null
    or salary_expectation_max_minor >= salary_expectation_min_minor
  ),
  constraint career_profiles_salary_period_check check (
    salary_period is null or salary_expectation_min_minor is not null
  )
);

comment on table public.career_profiles is
  'One row per career search profile. A user may keep several when their plan allows it, and exactly one may be primary.';
comment on column public.career_profiles.completeness_percent is
  'Derived by app_private.career_profile_completeness_value(); never set directly by clients.';

create unique index career_profiles_one_primary_per_user_idx
  on public.career_profiles (user_id)
  where is_primary;
create index career_profiles_user_status_idx
  on public.career_profiles (user_id, status, created_at desc);

create table public.career_sub_careers (
  id uuid primary key default gen_random_uuid(),
  career_profile_id uuid not null references public.career_profiles (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  focus text null check (focus is null or char_length(focus) between 1 and 1000),
  keywords text[] not null default '{}',
  priority smallint not null default 0 check (priority between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint career_sub_careers_name_unique unique (career_profile_id, name)
);

create index career_sub_careers_profile_idx
  on public.career_sub_careers (career_profile_id, priority desc, name);

create table public.career_employment_history (
  id uuid primary key default gen_random_uuid(),
  career_profile_id uuid not null references public.career_profiles (id) on delete cascade,
  company_name text not null check (char_length(company_name) between 1 and 160),
  company_url text null check (company_url is null or char_length(company_url) between 4 and 500),
  role_title text not null check (char_length(role_title) between 1 and 160),
  employment_type public.employment_type not null default 'full_time',
  work_arrangement public.work_arrangement null,
  location text null check (location is null or char_length(location) between 1 and 160),
  country_code text null check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  industry text null check (industry is null or char_length(industry) between 1 and 120),
  start_date date not null,
  end_date date null,
  is_current boolean not null default false,
  summary text null check (summary is null or char_length(summary) between 1 and 2000),
  highlights text[] not null default '{}',
  skills text[] not null default '{}',
  display_order smallint not null default 0 check (display_order between 0 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint career_employment_dates_check check (end_date is null or end_date >= start_date),
  constraint career_employment_current_check check (not is_current or end_date is null)
);

create index career_employment_profile_idx
  on public.career_employment_history (career_profile_id, start_date desc);

create table public.career_projects (
  id uuid primary key default gen_random_uuid(),
  career_profile_id uuid not null references public.career_profiles (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 160),
  role_title text null check (role_title is null or char_length(role_title) between 1 and 160),
  description text null check (description is null or char_length(description) between 1 and 2000),
  project_url text null check (project_url is null or char_length(project_url) between 4 and 500),
  repository_url text null
    check (repository_url is null or char_length(repository_url) between 4 and 500),
  start_date date null,
  end_date date null,
  is_featured boolean not null default false,
  highlights text[] not null default '{}',
  skills text[] not null default '{}',
  display_order smallint not null default 0 check (display_order between 0 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint career_projects_dates_check check (
    end_date is null or start_date is null or end_date >= start_date
  )
);

create index career_projects_profile_idx
  on public.career_projects (career_profile_id, is_featured desc, display_order);

create table public.career_education (
  id uuid primary key default gen_random_uuid(),
  career_profile_id uuid not null references public.career_profiles (id) on delete cascade,
  institution text not null check (char_length(institution) between 1 and 160),
  degree text null check (degree is null or char_length(degree) between 1 and 160),
  field_of_study text null check (field_of_study is null or char_length(field_of_study) between 1 and 160),
  start_year smallint null check (start_year is null or start_year between 1930 and 2100),
  end_year smallint null check (end_year is null or end_year between 1930 and 2100),
  is_current boolean not null default false,
  grade text null check (grade is null or char_length(grade) between 1 and 60),
  description text null check (description is null or char_length(description) between 1 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint career_education_years_check check (
    start_year is null or end_year is null or end_year >= start_year
  )
);

create index career_education_profile_idx
  on public.career_education (career_profile_id, end_year desc nulls first);

create table public.career_certifications (
  id uuid primary key default gen_random_uuid(),
  career_profile_id uuid not null references public.career_profiles (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 160),
  issuer text null check (issuer is null or char_length(issuer) between 1 and 160),
  credential_id text null check (credential_id is null or char_length(credential_id) between 1 and 120),
  credential_url text null
    check (credential_url is null or char_length(credential_url) between 4 and 500),
  issued_on date null,
  expires_on date null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint career_certifications_dates_check check (
    expires_on is null or issued_on is null or expires_on >= issued_on
  )
);

create index career_certifications_profile_idx
  on public.career_certifications (career_profile_id, issued_on desc nulls last);

create table public.career_profile_links (
  id uuid primary key default gen_random_uuid(),
  career_profile_id uuid not null references public.career_profiles (id) on delete cascade,
  link_kind public.career_link_kind not null,
  label text null check (label is null or char_length(label) between 1 and 80),
  url text not null check (char_length(url) between 4 and 500),
  display_order smallint not null default 0 check (display_order between 0 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint career_profile_links_url_unique unique (career_profile_id, url)
);

create index career_profile_links_profile_idx
  on public.career_profile_links (career_profile_id, display_order);

create table public.career_skills (
  id uuid primary key default gen_random_uuid(),
  career_profile_id uuid not null references public.career_profiles (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  skill_kind public.career_skill_kind not null default 'skill',
  proficiency public.proficiency_level null,
  years_experience numeric(4, 1) null
    check (years_experience is null or (years_experience >= 0 and years_experience <= 80)),
  last_used_year smallint null check (last_used_year is null or last_used_year between 1930 and 2100),
  is_primary boolean not null default false,
  display_order smallint not null default 0 check (display_order between 0 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index career_skills_unique_idx
  on public.career_skills (career_profile_id, pg_catalog.lower(name), skill_kind);
create index career_skills_profile_idx
  on public.career_skills (career_profile_id, is_primary desc, display_order);

-- ---------------------------------------------------------------------------
-- Career documents (private storage metadata only)
-- ---------------------------------------------------------------------------

create type public.career_document_kind as enum ('resume', 'cover_letter', 'portfolio', 'other');
create type public.career_document_status as enum (
  'uploaded',
  'processing',
  'parsed',
  'needs_review',
  'failed',
  'rejected',
  'archived'
);

create table public.career_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  career_profile_id uuid null references public.career_profiles (id) on delete set null,
  document_kind public.career_document_kind not null default 'resume',
  status public.career_document_status not null default 'uploaded',
  original_filename text not null check (char_length(original_filename) between 1 and 160),
  mime_type text not null check (
    mime_type in (
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/rtf',
      'text/rtf',
      'text/plain',
      'text/markdown'
    )
  ),
  size_bytes integer not null check (size_bytes between 1 and 10485760),
  checksum_sha256 text not null check (checksum_sha256 ~ '^[a-f0-9]{64}$'),
  bucket_id text not null default 'career-documents' check (bucket_id = 'career-documents'),
  object_path text not null unique check (
    char_length(object_path) between 10 and 300
    and object_path !~ '\.\.'
    and object_path !~ '[\x00-\x1f]'
  ),
  page_count integer null check (page_count is null or page_count between 1 and 500),
  word_count integer null check (word_count is null or word_count between 0 and 200000),
  parse_error_code text null check (parse_error_code is null or char_length(parse_error_code) <= 80),
  parsed_at timestamptz null,
  is_active boolean not null default true,
  version integer not null default 0 check (version >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint career_documents_parsed_check check (
    (status in ('parsed', 'needs_review') and parsed_at is not null)
    or status not in ('parsed', 'needs_review')
  )
);

comment on table public.career_documents is
  'Metadata for privately stored career documents. Object bytes are written and signed only by the server-side service client; no anon or authenticated storage policy exists for the bucket.';

create unique index career_documents_checksum_idx
  on public.career_documents (user_id, checksum_sha256);
create index career_documents_user_idx
  on public.career_documents (user_id, created_at desc);
create index career_documents_profile_idx
  on public.career_documents (career_profile_id)
  where career_profile_id is not null;

-- ---------------------------------------------------------------------------
-- Truth ledger
-- ---------------------------------------------------------------------------

create table public.career_facts (
  id uuid primary key default gen_random_uuid(),
  career_profile_id uuid not null references public.career_profiles (id) on delete cascade,
  category public.career_fact_category not null default 'experience',
  statement text not null check (char_length(statement) between 3 and 500),
  source public.career_fact_source not null,
  status public.career_fact_status not null default 'candidate',
  confidence numeric(3, 2) null check (confidence is null or (confidence >= 0 and confidence <= 1)),
  -- Structured pointer back to the record the claim came from, e.g.
  -- {"kind":"employment","id":"<uuid>"} or {"kind":"document","id":"<uuid>","page":2}.
  evidence jsonb not null default '{}' check (pg_catalog.jsonb_typeof(evidence) = 'object'),
  -- Numbers are modelled explicitly so a generator can never invent a metric.
  metric_value numeric null,
  metric_unit text null check (metric_unit is null or char_length(metric_unit) between 1 and 40),
  metric_context text null check (metric_context is null or char_length(metric_context) between 1 and 240),
  document_id uuid null references public.career_documents (id) on delete set null,
  confirmed_at timestamptz null,
  confirmed_by uuid null references auth.users (id) on delete set null,
  superseded_by uuid null references public.career_facts (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint career_facts_confirmation_check check (
    (status = 'confirmed' and confirmed_at is not null)
    or (status <> 'confirmed' and confirmed_at is null)
  ),
  constraint career_facts_metric_check check (
    (metric_value is null and metric_unit is null)
    or (metric_value is not null and metric_unit is not null)
  )
);

comment on table public.career_facts is
  'Append-oriented ledger of individual career claims. Only rows with status = confirmed are admissible evidence for generated application material.';
comment on column public.career_facts.metric_value is
  'Structured numeric evidence. Generated text may only quote numbers that exist here on a confirmed fact.';

create index career_facts_profile_idx
  on public.career_facts (career_profile_id, status, category, created_at desc);
create index career_facts_document_idx
  on public.career_facts (document_id)
  where document_id is not null;
create unique index career_facts_confirmed_statement_idx
  on public.career_facts (career_profile_id, pg_catalog.lower(statement))
  where status = 'confirmed';

-- ---------------------------------------------------------------------------
-- JSON input helpers
-- ---------------------------------------------------------------------------

create or replace function app_private.career_text(
  source jsonb,
  field_key text,
  max_length integer,
  required boolean
)
returns text
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  raw text;
begin
  if source is null or not (source ? field_key) or source -> field_key = 'null'::jsonb then
    if required then
      raise exception 'field % is required', field_key using errcode = '22023';
    end if;
    return null;
  end if;
  if pg_catalog.jsonb_typeof(source -> field_key) <> 'string' then
    raise exception 'field % must be a string', field_key using errcode = '22023';
  end if;
  raw := pg_catalog.btrim(source ->> field_key);
  if raw = '' then
    if required then
      raise exception 'field % is required', field_key using errcode = '22023';
    end if;
    return null;
  end if;
  if pg_catalog.char_length(raw) > max_length then
    raise exception 'field % exceeds % characters', field_key, max_length using errcode = '22023';
  end if;
  if raw ~ '[\x00-\x08\x0b\x0c\x0e-\x1f]' then
    raise exception 'field % contains control characters', field_key using errcode = '22023';
  end if;
  return raw;
end;
$$;

create or replace function app_private.career_boolean(source jsonb, field_key text, fallback boolean)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
begin
  if source is null or not (source ? field_key) or source -> field_key = 'null'::jsonb then
    return fallback;
  end if;
  if pg_catalog.jsonb_typeof(source -> field_key) <> 'boolean' then
    raise exception 'field % must be a boolean', field_key using errcode = '22023';
  end if;
  return (source ->> field_key)::boolean;
end;
$$;

create or replace function app_private.career_numeric(
  source jsonb,
  field_key text,
  minimum numeric,
  maximum numeric
)
returns numeric
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  raw numeric;
begin
  if source is null or not (source ? field_key) or source -> field_key = 'null'::jsonb then
    return null;
  end if;
  if pg_catalog.jsonb_typeof(source -> field_key) <> 'number' then
    raise exception 'field % must be a number', field_key using errcode = '22023';
  end if;
  raw := (source ->> field_key)::numeric;
  if raw < minimum or raw > maximum then
    raise exception 'field % must be between % and %', field_key, minimum, maximum
      using errcode = '22023';
  end if;
  return raw;
end;
$$;

create or replace function app_private.career_integer(
  source jsonb,
  field_key text,
  minimum integer,
  maximum integer
)
returns integer
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  raw numeric;
begin
  if source is null or not (source ? field_key) or source -> field_key = 'null'::jsonb then
    return null;
  end if;
  if pg_catalog.jsonb_typeof(source -> field_key) <> 'number' then
    raise exception 'field % must be a number', field_key using errcode = '22023';
  end if;
  raw := (source ->> field_key)::numeric;
  if raw <> pg_catalog.trunc(raw) then
    raise exception 'field % must be an integer', field_key using errcode = '22023';
  end if;
  if raw < minimum or raw > maximum then
    raise exception 'field % must be between % and %', field_key, minimum, maximum
      using errcode = '22023';
  end if;
  return raw::integer;
end;
$$;

create or replace function app_private.career_date(source jsonb, field_key text)
returns date
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  raw text;
  parsed date;
begin
  if source is null or not (source ? field_key) or source -> field_key = 'null'::jsonb then
    return null;
  end if;
  if pg_catalog.jsonb_typeof(source -> field_key) <> 'string' then
    raise exception 'field % must be an ISO date string', field_key using errcode = '22023';
  end if;
  raw := source ->> field_key;
  if raw !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'field % must use the YYYY-MM-DD format', field_key using errcode = '22023';
  end if;
  parsed := raw::date;
  if parsed > (pg_catalog.now() at time zone 'UTC')::date + 1 then
    raise exception 'field % cannot be in the future', field_key using errcode = '22023';
  end if;
  return parsed;
end;
$$;

create or replace function app_private.career_enum(
  source jsonb,
  field_key text,
  allowed_values text[],
  required boolean
)
returns text
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  raw text;
begin
  raw := app_private.career_text(source, field_key, 40, required);
  if raw is null then
    return null;
  end if;
  if not (raw = any (allowed_values)) then
    raise exception 'field % must be one of: %', field_key, pg_catalog.array_to_string(allowed_values, ', ')
      using errcode = '22023';
  end if;
  return raw;
end;
$$;

create or replace function app_private.career_text_array(
  source jsonb,
  field_key text,
  max_items integer,
  max_length integer
)
returns text[]
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  raw jsonb;
  element jsonb;
  cleaned text;
  result text[] := '{}';
begin
  if source is null or not (source ? field_key) or source -> field_key = 'null'::jsonb then
    return '{}';
  end if;
  raw := source -> field_key;
  if pg_catalog.jsonb_typeof(raw) <> 'array' then
    raise exception 'field % must be an array of strings', field_key using errcode = '22023';
  end if;
  if pg_catalog.jsonb_array_length(raw) > max_items then
    raise exception 'field % accepts at most % entries', field_key, max_items using errcode = '22023';
  end if;
  for element in select pg_catalog.jsonb_array_elements(raw)
  loop
    if pg_catalog.jsonb_typeof(element) <> 'string' then
      raise exception 'field % must contain only strings', field_key using errcode = '22023';
    end if;
    cleaned := pg_catalog.btrim(element #>> '{}');
    if cleaned = '' then
      continue;
    end if;
    if pg_catalog.char_length(cleaned) > max_length then
      raise exception 'field % entries must be at most % characters', field_key, max_length
        using errcode = '22023';
    end if;
    result := pg_catalog.array_append(result, cleaned);
  end loop;
  return (select coalesce(pg_catalog.array_agg(distinct value order by value), '{}')
          from pg_catalog.unnest(result) as value);
end;
$$;

create or replace function app_private.career_require_object(value jsonb, label text)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = ''
as $$
begin
  if value is null or pg_catalog.jsonb_typeof(value) <> 'object' then
    raise exception '% must be a JSON object', label using errcode = '22023';
  end if;
  return value;
end;
$$;

revoke all on function app_private.career_text(jsonb, text, integer, boolean)
  from public, anon, authenticated;
revoke all on function app_private.career_boolean(jsonb, text, boolean)
  from public, anon, authenticated;
revoke all on function app_private.career_numeric(jsonb, text, numeric, numeric)
  from public, anon, authenticated;
revoke all on function app_private.career_integer(jsonb, text, integer, integer)
  from public, anon, authenticated;
revoke all on function app_private.career_date(jsonb, text)
  from public, anon, authenticated;
revoke all on function app_private.career_enum(jsonb, text, text[], boolean)
  from public, anon, authenticated;
revoke all on function app_private.career_text_array(jsonb, text, integer, integer)
  from public, anon, authenticated;
revoke all on function app_private.career_require_object(jsonb, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Entitlement resolution inside the database
-- ---------------------------------------------------------------------------

create or replace function app_private.career_entitlements(actor_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  evaluated jsonb;
begin
  select pg_catalog.jsonb_object_agg(entitlement_key, value)
  into evaluated
  from public.plan_entitlements
  where plan_id = (
    select subscription.plan_id
    from public.subscriptions as subscription
    where subscription.user_id = actor_user_id
      and subscription.status = 'active'
      and subscription.starts_at <= now()
      and (subscription.ends_at is null or subscription.ends_at > now())
    limit 1
  );

  if evaluated is null then
    return '{}'::jsonb;
  end if;
  return evaluated;
end;
$$;

create or replace function app_private.career_entitlement_integer(
  actor_user_id uuid,
  entitlement_key text
)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  raw jsonb;
begin
  raw := app_private.career_entitlements(actor_user_id) -> entitlement_key;
  if raw is null or pg_catalog.jsonb_typeof(raw) <> 'number' then
    return 0;
  end if;
  return (raw #>> '{}')::integer;
end;
$$;

create or replace function app_private.require_career_profile_owner(
  actor_user_id uuid,
  target_profile_id uuid
)
returns public.career_profiles
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  profile public.career_profiles;
begin
  perform app_private.require_active_actor(actor_user_id);
  select * into profile
  from public.career_profiles
  where id = target_profile_id and user_id = actor_user_id;
  if profile.id is null then
    raise exception 'career profile does not exist' using errcode = 'P0002';
  end if;
  return profile;
end;
$$;

revoke all on function app_private.career_entitlements(uuid) from public, anon, authenticated;
revoke all on function app_private.career_entitlement_integer(uuid, text)
  from public, anon, authenticated;
revoke all on function app_private.require_career_profile_owner(uuid, uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Completeness scoring
-- ---------------------------------------------------------------------------

create or replace function app_private.career_profile_completeness_value(target_profile_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  profile public.career_profiles;
  missing jsonb := '[]'::jsonb;
  earned integer := 0;
  employment_count integer := 0;
  skill_count integer := 0;
  education_count integer := 0;
  link_count integer := 0;
  confirmed_fact_count integer := 0;
  target_role_count integer := 0;
begin
  select * into profile from public.career_profiles where id = target_profile_id;
  if profile.id is null then
    raise exception 'career profile does not exist' using errcode = 'P0002';
  end if;

  select pg_catalog.count(*) into employment_count
  from public.career_employment_history where career_profile_id = target_profile_id;
  select pg_catalog.count(*) into skill_count
  from public.career_skills where career_profile_id = target_profile_id;
  select pg_catalog.count(*) into education_count
  from public.career_education where career_profile_id = target_profile_id;
  select pg_catalog.count(*) into link_count
  from public.career_profile_links where career_profile_id = target_profile_id;
  select pg_catalog.count(*) into confirmed_fact_count
  from public.career_facts
  where career_profile_id = target_profile_id and status = 'confirmed';
  target_role_count := coalesce(pg_catalog.array_length(profile.target_role_titles, 1), 0);

  -- Each fully satisfied item is worth 10 points; ten items reach 100%.
  if profile.headline is not null then earned := earned + 10;
  else missing := missing || '"headline"'::jsonb; end if;

  if profile.summary is not null and pg_catalog.char_length(profile.summary) >= 80 then
    earned := earned + 10;
  else
    missing := missing || '"summary"'::jsonb;
  end if;

  if profile.current_role_title is not null and profile.career_level is not null then
    earned := earned + 10;
  else
    missing := missing || '"currentRole"'::jsonb;
  end if;

  if profile.years_experience is not null then earned := earned + 10;
  else missing := missing || '"yearsExperience"'::jsonb; end if;

  if target_role_count > 0 then earned := earned + 10;
  else missing := missing || '"targetRoles"'::jsonb; end if;

  if employment_count > 0 then earned := earned + 10;
  else missing := missing || '"employmentHistory"'::jsonb; end if;

  if skill_count >= 5 then earned := earned + 10;
  elsif skill_count > 0 then
    earned := earned + 5;
    missing := missing || '"skills"'::jsonb;
  else
    missing := missing || '"skills"'::jsonb;
  end if;

  if education_count > 0 then earned := earned + 10;
  else missing := missing || '"education"'::jsonb; end if;

  if profile.preferred_work_arrangement is not null
    and (pg_catalog.array_length(profile.preferred_locations, 1) is not null
      or profile.preferred_work_arrangement = 'remote')
  then
    earned := earned + 10;
  else
    missing := missing || '"locationPreferences"'::jsonb;
  end if;

  if link_count > 0 or confirmed_fact_count >= 3 then earned := earned + 10;
  else missing := missing || '"evidence"'::jsonb; end if;

  return pg_catalog.jsonb_build_object(
    'percent', least(earned, 100),
    'missing', missing,
    'counts', pg_catalog.jsonb_build_object(
      'employment', employment_count,
      'skills', skill_count,
      'education', education_count,
      'links', link_count,
      'confirmedFacts', confirmed_fact_count
    )
  );
end;
$$;

create or replace function app_private.refresh_career_profile_completeness()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_profile_id uuid;
  computed integer;
begin
  target_profile_id := coalesce(new.career_profile_id, old.career_profile_id, new.id, old.id);
  if target_profile_id is null then
    return coalesce(new, old);
  end if;
  computed := (app_private.career_profile_completeness_value(target_profile_id) ->> 'percent')::integer;
  update public.career_profiles
  set completeness_percent = computed
  where id = target_profile_id
    and completeness_percent <> computed;
  return coalesce(new, old);
end;
$$;

revoke all on function app_private.career_profile_completeness_value(uuid)
  from public, anon, authenticated;
revoke all on function app_private.refresh_career_profile_completeness()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Read models
-- ---------------------------------------------------------------------------

create or replace function app_private.career_profile_summary(profile public.career_profiles)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return pg_catalog.jsonb_build_object(
    'id', profile.id,
    'name', profile.name,
    'isPrimary', profile.is_primary,
    'status', profile.status,
    'headline', profile.headline,
    'currentRoleTitle', profile.current_role_title,
    'careerLevel', profile.career_level,
    'yearsExperience', profile.years_experience,
    'targetRoleTitles', profile.target_role_titles,
    'preferredWorkArrangement', profile.preferred_work_arrangement,
    'completenessPercent', profile.completeness_percent,
    'version', profile.version,
    'createdAt', profile.created_at,
    'updatedAt', profile.updated_at
  );
end;
$$;

create or replace function app_private.career_profile_detail_value(target_profile_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  profile public.career_profiles;
begin
  select * into profile from public.career_profiles where id = target_profile_id;
  if profile.id is null then
    raise exception 'career profile does not exist' using errcode = 'P0002';
  end if;

  return app_private.career_profile_summary(profile) || pg_catalog.jsonb_build_object(
    'summary', profile.summary,
    'industries', pg_catalog.to_jsonb(profile.industries),
    'excludedRoleTitles', pg_catalog.to_jsonb(profile.excluded_role_titles),
    'preferredEmploymentTypes', pg_catalog.to_jsonb(profile.preferred_employment_types),
    'preferredLocations', pg_catalog.to_jsonb(profile.preferred_locations),
    'openToInternational', profile.open_to_international,
    'openToRelocation', profile.open_to_relocation,
    'workAuthorizations', pg_catalog.to_jsonb(profile.work_authorizations),
    'availability', profile.availability,
    'salaryExpectation', case
      when profile.salary_expectation_min_minor is null then null
      else pg_catalog.jsonb_build_object(
        'minMinor', profile.salary_expectation_min_minor,
        'maxMinor', profile.salary_expectation_max_minor,
        'currency', profile.salary_currency,
        'period', profile.salary_period
      )
    end,
    'careerGoals', profile.career_goals,
    'lastReviewedAt', profile.last_reviewed_at,
    'completeness', app_private.career_profile_completeness_value(target_profile_id),
    'subCareers', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', sub.id,
          'name', sub.name,
          'focus', sub.focus,
          'keywords', pg_catalog.to_jsonb(sub.keywords),
          'priority', sub.priority
        ) order by sub.priority desc, sub.name
      )
      from public.career_sub_careers as sub
      where sub.career_profile_id = target_profile_id
    ), '[]'::jsonb),
    'employment', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', employment.id,
          'companyName', employment.company_name,
          'companyUrl', employment.company_url,
          'roleTitle', employment.role_title,
          'employmentType', employment.employment_type,
          'workArrangement', employment.work_arrangement,
          'location', employment.location,
          'countryCode', employment.country_code,
          'industry', employment.industry,
          'startDate', employment.start_date,
          'endDate', employment.end_date,
          'isCurrent', employment.is_current,
          'summary', employment.summary,
          'highlights', pg_catalog.to_jsonb(employment.highlights),
          'skills', pg_catalog.to_jsonb(employment.skills),
          'displayOrder', employment.display_order
        ) order by employment.is_current desc, employment.start_date desc
      )
      from public.career_employment_history as employment
      where employment.career_profile_id = target_profile_id
    ), '[]'::jsonb),
    'projects', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', project.id,
          'name', project.name,
          'roleTitle', project.role_title,
          'description', project.description,
          'projectUrl', project.project_url,
          'repositoryUrl', project.repository_url,
          'startDate', project.start_date,
          'endDate', project.end_date,
          'isFeatured', project.is_featured,
          'highlights', pg_catalog.to_jsonb(project.highlights),
          'skills', pg_catalog.to_jsonb(project.skills),
          'displayOrder', project.display_order
        ) order by project.is_featured desc, project.display_order, project.name
      )
      from public.career_projects as project
      where project.career_profile_id = target_profile_id
    ), '[]'::jsonb),
    'education', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', education.id,
          'institution', education.institution,
          'degree', education.degree,
          'fieldOfStudy', education.field_of_study,
          'startYear', education.start_year,
          'endYear', education.end_year,
          'isCurrent', education.is_current,
          'grade', education.grade,
          'description', education.description
        ) order by education.end_year desc nulls first, education.institution
      )
      from public.career_education as education
      where education.career_profile_id = target_profile_id
    ), '[]'::jsonb),
    'certifications', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', certification.id,
          'name', certification.name,
          'issuer', certification.issuer,
          'credentialId', certification.credential_id,
          'credentialUrl', certification.credential_url,
          'issuedOn', certification.issued_on,
          'expiresOn', certification.expires_on
        ) order by certification.issued_on desc nulls last, certification.name
      )
      from public.career_certifications as certification
      where certification.career_profile_id = target_profile_id
    ), '[]'::jsonb),
    'links', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', link.id,
          'linkKind', link.link_kind,
          'label', link.label,
          'url', link.url,
          'displayOrder', link.display_order
        ) order by link.display_order, link.link_kind
      )
      from public.career_profile_links as link
      where link.career_profile_id = target_profile_id
    ), '[]'::jsonb),
    'skills', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', skill.id,
          'name', skill.name,
          'skillKind', skill.skill_kind,
          'proficiency', skill.proficiency,
          'yearsExperience', skill.years_experience,
          'lastUsedYear', skill.last_used_year,
          'isPrimary', skill.is_primary,
          'displayOrder', skill.display_order
        ) order by skill.is_primary desc, skill.display_order, skill.name
      )
      from public.career_skills as skill
      where skill.career_profile_id = target_profile_id
    ), '[]'::jsonb),
    'factCounts', (
      select pg_catalog.jsonb_build_object(
        'candidate', pg_catalog.count(*) filter (where fact.status = 'candidate'),
        'confirmed', pg_catalog.count(*) filter (where fact.status = 'confirmed'),
        'rejected', pg_catalog.count(*) filter (where fact.status = 'rejected')
      )
      from public.career_facts as fact
      where fact.career_profile_id = target_profile_id
    )
  );
end;
$$;

create or replace function app_private.career_fact_snapshot(fact public.career_facts)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'id', fact.id,
    'careerProfileId', fact.career_profile_id,
    'category', fact.category,
    'statement', fact.statement,
    'source', fact.source,
    'status', fact.status,
    'confidence', fact.confidence,
    'evidence', fact.evidence,
    'metricValue', fact.metric_value,
    'metricUnit', fact.metric_unit,
    'metricContext', fact.metric_context,
    'documentId', fact.document_id,
    'confirmedAt', fact.confirmed_at,
    'createdAt', fact.created_at
  );
$$;

revoke all on function app_private.career_profile_summary(public.career_profiles)
  from public, anon, authenticated;
revoke all on function app_private.career_profile_detail_value(uuid)
  from public, anon, authenticated;
revoke all on function app_private.career_fact_snapshot(public.career_facts)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Profile lifecycle functions
-- ---------------------------------------------------------------------------

create or replace function public.career_profile_directory(actor_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app_private.require_active_actor(actor_user_id);

  return pg_catalog.jsonb_build_object(
    'items', coalesce((
      select pg_catalog.jsonb_agg(
        app_private.career_profile_summary(profile)
        order by profile.is_primary desc, profile.created_at
      )
      from public.career_profiles as profile
      where profile.user_id = actor_user_id
        and profile.status <> 'archived'
    ), '[]'::jsonb),
    'limits', pg_catalog.jsonb_build_object(
      'careerProfileLimit', app_private.career_entitlement_integer(
        actor_user_id, 'careerProfileLimit'
      ),
      'subCareerLimitPerProfile', app_private.career_entitlement_integer(
        actor_user_id, 'subCareerLimitPerProfile'
      )
    )
  );
end;
$$;

create or replace function public.career_profile_detail(
  actor_user_id uuid,
  target_profile_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  profile public.career_profiles;
begin
  profile := app_private.require_career_profile_owner(actor_user_id, target_profile_id);
  return app_private.career_profile_detail_value(profile.id);
end;
$$;

create or replace function public.create_career_profile(
  actor_user_id uuid,
  profile_input jsonb,
  action_request_id uuid default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  payload jsonb;
  active_count integer;
  profile_limit integer;
  created_id uuid;
  profile_name text;
begin
  perform app_private.require_active_actor(actor_user_id);
  payload := app_private.career_require_object(profile_input, 'profile');
  profile_name := app_private.career_text(payload, 'name', 120, true);

  profile_limit := app_private.career_entitlement_integer(actor_user_id, 'careerProfileLimit');
  select pg_catalog.count(*) into active_count
  from public.career_profiles
  where user_id = actor_user_id and status <> 'archived';

  if active_count >= profile_limit then
    raise exception 'the current plan allows % career profiles', profile_limit
      using errcode = '42501';
  end if;

  insert into public.career_profiles (
    user_id, name, is_primary, current_role_title, career_level, years_experience,
    headline, summary, industries, target_role_titles, excluded_role_titles,
    preferred_employment_types, preferred_work_arrangement, preferred_locations,
    open_to_international, open_to_relocation, work_authorizations, availability,
    career_goals
  ) values (
    actor_user_id,
    profile_name,
    active_count = 0,
    app_private.career_text(payload, 'currentRoleTitle', 160, false),
    app_private.career_enum(
      payload, 'careerLevel',
      array['student','entry','junior','mid','senior','lead','manager','director','executive'],
      false
    )::public.career_level,
    app_private.career_numeric(payload, 'yearsExperience', 0, 80),
    app_private.career_text(payload, 'headline', 160, false),
    app_private.career_text(payload, 'summary', 4000, false),
    app_private.career_text_array(payload, 'industries', 20, 80),
    app_private.career_text_array(payload, 'targetRoleTitles', 15, 120),
    app_private.career_text_array(payload, 'excludedRoleTitles', 15, 120),
    coalesce((
      select pg_catalog.array_agg(value::public.employment_type order by value)
      from pg_catalog.unnest(app_private.career_text_array(payload, 'preferredEmploymentTypes', 7, 20)) as value
    ), '{}'),
    app_private.career_enum(
      payload, 'preferredWorkArrangement',
      array['remote','hybrid','onsite','flexible'],
      false
    )::public.work_arrangement,
    app_private.career_text_array(payload, 'preferredLocations', 20, 120),
    app_private.career_boolean(payload, 'openToInternational', false),
    app_private.career_boolean(payload, 'openToRelocation', false),
    app_private.career_text_array(payload, 'workAuthorizations', 15, 120),
    app_private.career_enum(
      payload, 'availability',
      array['immediately','two_weeks','one_month','three_months','not_looking'],
      false
    )::public.availability_status,
    app_private.career_text(payload, 'careerGoals', 2000, false)
  )
  returning id into created_id;

  update public.career_profiles
  set salary_expectation_min_minor = app_private.career_integer(payload, 'salaryMinMinor', 1, 2000000000),
      salary_expectation_max_minor = app_private.career_integer(payload, 'salaryMaxMinor', 1, 2000000000),
      salary_currency = pg_catalog.upper(
        coalesce(app_private.career_text(payload, 'salaryCurrency', 3, false), 'PHP')
      ),
      salary_period = app_private.career_enum(
        payload, 'salaryPeriod', array['hourly','daily','monthly','annual'], false
      )::public.salary_period
  where id = created_id;

  update public.career_profiles
  set completeness_percent =
    (app_private.career_profile_completeness_value(created_id) ->> 'percent')::integer
  where id = created_id;

  insert into public.audit_events (
    actor_user_id, actor_type, action, target_type, target_id, request_id, after_state
  ) values (
    actor_user_id, 'user', 'career_profile.created', 'career_profile', created_id, action_request_id,
    pg_catalog.jsonb_build_object('name', profile_name)
  );

  return created_id;
end;
$$;

create or replace function public.update_career_profile(
  actor_user_id uuid,
  target_profile_id uuid,
  expected_version integer,
  profile_input jsonb,
  action_request_id uuid default null
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  profile public.career_profiles;
  payload jsonb;
  next_version integer;
begin
  profile := app_private.require_career_profile_owner(actor_user_id, target_profile_id);
  if profile.version <> expected_version then
    raise exception 'the career profile changed in another session' using errcode = '40001';
  end if;
  payload := app_private.career_require_object(profile_input, 'profile');

  update public.career_profiles
  set name = coalesce(app_private.career_text(payload, 'name', 120, false), profile.name),
      headline = case when payload ? 'headline'
        then app_private.career_text(payload, 'headline', 160, false) else profile.headline end,
      summary = case when payload ? 'summary'
        then app_private.career_text(payload, 'summary', 4000, false) else profile.summary end,
      current_role_title = case when payload ? 'currentRoleTitle'
        then app_private.career_text(payload, 'currentRoleTitle', 160, false)
        else profile.current_role_title end,
      career_level = case when payload ? 'careerLevel'
        then app_private.career_enum(
          payload, 'careerLevel',
          array['student','entry','junior','mid','senior','lead','manager','director','executive'],
          false
        )::public.career_level
        else profile.career_level end,
      years_experience = case when payload ? 'yearsExperience'
        then app_private.career_numeric(payload, 'yearsExperience', 0, 80)
        else profile.years_experience end,
      industries = case when payload ? 'industries'
        then app_private.career_text_array(payload, 'industries', 20, 80) else profile.industries end,
      target_role_titles = case when payload ? 'targetRoleTitles'
        then app_private.career_text_array(payload, 'targetRoleTitles', 15, 120)
        else profile.target_role_titles end,
      excluded_role_titles = case when payload ? 'excludedRoleTitles'
        then app_private.career_text_array(payload, 'excludedRoleTitles', 15, 120)
        else profile.excluded_role_titles end,
      preferred_employment_types = case when payload ? 'preferredEmploymentTypes'
        then coalesce((
          select pg_catalog.array_agg(value::public.employment_type order by value)
          from pg_catalog.unnest(
            app_private.career_text_array(payload, 'preferredEmploymentTypes', 7, 20)
          ) as value
        ), '{}')
        else profile.preferred_employment_types end,
      preferred_work_arrangement = case when payload ? 'preferredWorkArrangement'
        then app_private.career_enum(
          payload, 'preferredWorkArrangement',
          array['remote','hybrid','onsite','flexible'], false
        )::public.work_arrangement
        else profile.preferred_work_arrangement end,
      preferred_locations = case when payload ? 'preferredLocations'
        then app_private.career_text_array(payload, 'preferredLocations', 20, 120)
        else profile.preferred_locations end,
      open_to_international = app_private.career_boolean(
        payload, 'openToInternational', profile.open_to_international
      ),
      open_to_relocation = app_private.career_boolean(
        payload, 'openToRelocation', profile.open_to_relocation
      ),
      work_authorizations = case when payload ? 'workAuthorizations'
        then app_private.career_text_array(payload, 'workAuthorizations', 15, 120)
        else profile.work_authorizations end,
      availability = case when payload ? 'availability'
        then app_private.career_enum(
          payload, 'availability',
          array['immediately','two_weeks','one_month','three_months','not_looking'], false
        )::public.availability_status
        else profile.availability end,
      salary_expectation_min_minor = case when payload ? 'salaryMinMinor'
        then app_private.career_integer(payload, 'salaryMinMinor', 1, 2000000000)
        else profile.salary_expectation_min_minor end,
      salary_expectation_max_minor = case when payload ? 'salaryMaxMinor'
        then app_private.career_integer(payload, 'salaryMaxMinor', 1, 2000000000)
        else profile.salary_expectation_max_minor end,
      salary_currency = pg_catalog.upper(coalesce(
        app_private.career_text(payload, 'salaryCurrency', 3, false), profile.salary_currency
      )),
      salary_period = case when payload ? 'salaryPeriod'
        then app_private.career_enum(
          payload, 'salaryPeriod', array['hourly','daily','monthly','annual'], false
        )::public.salary_period
        else profile.salary_period end,
      career_goals = case when payload ? 'careerGoals'
        then app_private.career_text(payload, 'careerGoals', 2000, false) else profile.career_goals end,
      last_reviewed_at = now(),
      version = profile.version + 1
  where id = profile.id
  returning version into next_version;

  update public.career_profiles
  set completeness_percent =
    (app_private.career_profile_completeness_value(profile.id) ->> 'percent')::integer
  where id = profile.id;

  insert into public.audit_events (
    actor_user_id, actor_type, action, target_type, target_id, request_id, metadata
  ) values (
    actor_user_id, 'user', 'career_profile.updated', 'career_profile', profile.id, action_request_id,
    pg_catalog.jsonb_build_object(
      'changedFields', (
        select coalesce(pg_catalog.jsonb_agg(field_key order by field_key), '[]'::jsonb)
        from pg_catalog.jsonb_object_keys(payload) as field_key
      )
    )
  );

  return next_version;
end;
$$;

create or replace function public.set_primary_career_profile(
  actor_user_id uuid,
  target_profile_id uuid,
  action_request_id uuid default null
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  profile public.career_profiles;
begin
  profile := app_private.require_career_profile_owner(actor_user_id, target_profile_id);
  if profile.status = 'archived' then
    raise exception 'an archived career profile cannot be primary' using errcode = '22023';
  end if;
  if profile.is_primary then
    return false;
  end if;

  update public.career_profiles
  set is_primary = false
  where user_id = actor_user_id and is_primary and id <> profile.id;

  update public.career_profiles
  set is_primary = true, version = version + 1
  where id = profile.id;

  insert into public.audit_events (
    actor_user_id, actor_type, action, target_type, target_id, request_id
  ) values (
    actor_user_id, 'user', 'career_profile.primary_changed', 'career_profile', profile.id,
    action_request_id
  );

  return true;
end;
$$;

create or replace function public.set_career_profile_status(
  actor_user_id uuid,
  target_profile_id uuid,
  requested_status public.career_profile_status,
  action_request_id uuid default null
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  profile public.career_profiles;
  next_version integer;
begin
  profile := app_private.require_career_profile_owner(actor_user_id, target_profile_id);
  if profile.status = requested_status then
    return profile.version;
  end if;

  update public.career_profiles
  set status = requested_status,
      is_primary = case when requested_status = 'archived' then false else is_primary end,
      version = profile.version + 1
  where id = profile.id
  returning version into next_version;

  -- Archiving the primary profile promotes the oldest remaining active profile.
  if requested_status = 'archived' and profile.is_primary then
    update public.career_profiles
    set is_primary = true, version = version + 1
    where id = (
      select id from public.career_profiles
      where user_id = actor_user_id and status <> 'archived'
      order by created_at
      limit 1
    );
  end if;

  insert into public.audit_events (
    actor_user_id, actor_type, action, target_type, target_id, request_id, metadata
  ) values (
    actor_user_id, 'user', 'career_profile.status_changed', 'career_profile', profile.id,
    action_request_id, pg_catalog.jsonb_build_object('status', requested_status)
  );

  return next_version;
end;
$$;

create or replace function public.delete_career_profile(
  actor_user_id uuid,
  target_profile_id uuid,
  action_request_id uuid default null
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  profile public.career_profiles;
begin
  profile := app_private.require_career_profile_owner(actor_user_id, target_profile_id);
  delete from public.career_profiles where id = profile.id;

  if profile.is_primary then
    update public.career_profiles
    set is_primary = true, version = version + 1
    where id = (
      select id from public.career_profiles
      where user_id = actor_user_id and status <> 'archived'
      order by created_at
      limit 1
    );
  end if;

  insert into public.audit_events (
    actor_user_id, actor_type, action, target_type, target_id, request_id, metadata
  ) values (
    actor_user_id, 'user', 'career_profile.deleted', 'career_profile', profile.id, action_request_id,
    pg_catalog.jsonb_build_object('name', profile.name)
  );

  return true;
end;
$$;

revoke all on function public.career_profile_directory(uuid) from public, anon, authenticated;
revoke all on function public.career_profile_detail(uuid, uuid) from public, anon, authenticated;
revoke all on function public.create_career_profile(uuid, jsonb, uuid)
  from public, anon, authenticated;
revoke all on function public.update_career_profile(uuid, uuid, integer, jsonb, uuid)
  from public, anon, authenticated;
revoke all on function public.set_primary_career_profile(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.set_career_profile_status(uuid, uuid, public.career_profile_status, uuid)
  from public, anon, authenticated;
revoke all on function public.delete_career_profile(uuid, uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.career_profile_directory(uuid) to service_role;
grant execute on function public.career_profile_detail(uuid, uuid) to service_role;
grant execute on function public.create_career_profile(uuid, jsonb, uuid) to service_role;
grant execute on function public.update_career_profile(uuid, uuid, integer, jsonb, uuid) to service_role;
grant execute on function public.set_primary_career_profile(uuid, uuid, uuid) to service_role;
grant execute on function public.set_career_profile_status(uuid, uuid, public.career_profile_status, uuid)
  to service_role;
grant execute on function public.delete_career_profile(uuid, uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Child record upsert/delete
-- ---------------------------------------------------------------------------

create or replace function public.upsert_career_record(
  actor_user_id uuid,
  target_profile_id uuid,
  record_kind text,
  record_id uuid,
  record_input jsonb,
  action_request_id uuid default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  profile public.career_profiles;
  payload jsonb;
  stored_id uuid := record_id;
  sub_career_limit integer;
  sub_career_count integer;
begin
  profile := app_private.require_career_profile_owner(actor_user_id, target_profile_id);
  payload := app_private.career_require_object(record_input, 'record');

  if record_kind = 'sub_career' then
    sub_career_limit := app_private.career_entitlement_integer(
      actor_user_id, 'subCareerLimitPerProfile'
    );
    if stored_id is null then
      select pg_catalog.count(*) into sub_career_count
      from public.career_sub_careers where career_profile_id = profile.id;
      if sub_career_count >= sub_career_limit then
        raise exception 'the current plan allows % sub-careers per profile', sub_career_limit
          using errcode = '42501';
      end if;
    end if;

    insert into public.career_sub_careers (
      id, career_profile_id, name, focus, keywords, priority
    ) values (
      coalesce(stored_id, gen_random_uuid()), profile.id,
      app_private.career_text(payload, 'name', 120, true),
      app_private.career_text(payload, 'focus', 1000, false),
      app_private.career_text_array(payload, 'keywords', 25, 60),
      coalesce(app_private.career_integer(payload, 'priority', 0, 100), 0)
    )
    on conflict (id) do update set
      name = excluded.name,
      focus = excluded.focus,
      keywords = excluded.keywords,
      priority = excluded.priority
    where public.career_sub_careers.career_profile_id = profile.id
    returning id into stored_id;

  elsif record_kind = 'employment' then
    insert into public.career_employment_history (
      id, career_profile_id, company_name, company_url, role_title, employment_type,
      work_arrangement, location, country_code, industry, start_date, end_date, is_current,
      summary, highlights, skills, display_order
    ) values (
      coalesce(stored_id, gen_random_uuid()), profile.id,
      app_private.career_text(payload, 'companyName', 160, true),
      app_private.career_text(payload, 'companyUrl', 500, false),
      app_private.career_text(payload, 'roleTitle', 160, true),
      coalesce(app_private.career_enum(
        payload, 'employmentType',
        array['full_time','part_time','contract','freelance','internship','temporary','volunteer'],
        false
      ), 'full_time')::public.employment_type,
      app_private.career_enum(
        payload, 'workArrangement', array['remote','hybrid','onsite','flexible'], false
      )::public.work_arrangement,
      app_private.career_text(payload, 'location', 160, false),
      app_private.career_text(payload, 'countryCode', 2, false),
      app_private.career_text(payload, 'industry', 120, false),
      app_private.career_date(payload, 'startDate'),
      app_private.career_date(payload, 'endDate'),
      app_private.career_boolean(payload, 'isCurrent', false),
      app_private.career_text(payload, 'summary', 2000, false),
      app_private.career_text_array(payload, 'highlights', 12, 400),
      app_private.career_text_array(payload, 'skills', 30, 60),
      coalesce(app_private.career_integer(payload, 'displayOrder', 0, 1000), 0)
    )
    on conflict (id) do update set
      company_name = excluded.company_name,
      company_url = excluded.company_url,
      role_title = excluded.role_title,
      employment_type = excluded.employment_type,
      work_arrangement = excluded.work_arrangement,
      location = excluded.location,
      country_code = excluded.country_code,
      industry = excluded.industry,
      start_date = excluded.start_date,
      end_date = excluded.end_date,
      is_current = excluded.is_current,
      summary = excluded.summary,
      highlights = excluded.highlights,
      skills = excluded.skills,
      display_order = excluded.display_order
    where public.career_employment_history.career_profile_id = profile.id
    returning id into stored_id;

  elsif record_kind = 'project' then
    insert into public.career_projects (
      id, career_profile_id, name, role_title, description, project_url, repository_url,
      start_date, end_date, is_featured, highlights, skills, display_order
    ) values (
      coalesce(stored_id, gen_random_uuid()), profile.id,
      app_private.career_text(payload, 'name', 160, true),
      app_private.career_text(payload, 'roleTitle', 160, false),
      app_private.career_text(payload, 'description', 2000, false),
      app_private.career_text(payload, 'projectUrl', 500, false),
      app_private.career_text(payload, 'repositoryUrl', 500, false),
      app_private.career_date(payload, 'startDate'),
      app_private.career_date(payload, 'endDate'),
      app_private.career_boolean(payload, 'isFeatured', false),
      app_private.career_text_array(payload, 'highlights', 12, 400),
      app_private.career_text_array(payload, 'skills', 30, 60),
      coalesce(app_private.career_integer(payload, 'displayOrder', 0, 1000), 0)
    )
    on conflict (id) do update set
      name = excluded.name,
      role_title = excluded.role_title,
      description = excluded.description,
      project_url = excluded.project_url,
      repository_url = excluded.repository_url,
      start_date = excluded.start_date,
      end_date = excluded.end_date,
      is_featured = excluded.is_featured,
      highlights = excluded.highlights,
      skills = excluded.skills,
      display_order = excluded.display_order
    where public.career_projects.career_profile_id = profile.id
    returning id into stored_id;

  elsif record_kind = 'education' then
    insert into public.career_education (
      id, career_profile_id, institution, degree, field_of_study, start_year, end_year,
      is_current, grade, description
    ) values (
      coalesce(stored_id, gen_random_uuid()), profile.id,
      app_private.career_text(payload, 'institution', 160, true),
      app_private.career_text(payload, 'degree', 160, false),
      app_private.career_text(payload, 'fieldOfStudy', 160, false),
      app_private.career_integer(payload, 'startYear', 1930, 2100),
      app_private.career_integer(payload, 'endYear', 1930, 2100),
      app_private.career_boolean(payload, 'isCurrent', false),
      app_private.career_text(payload, 'grade', 60, false),
      app_private.career_text(payload, 'description', 1000, false)
    )
    on conflict (id) do update set
      institution = excluded.institution,
      degree = excluded.degree,
      field_of_study = excluded.field_of_study,
      start_year = excluded.start_year,
      end_year = excluded.end_year,
      is_current = excluded.is_current,
      grade = excluded.grade,
      description = excluded.description
    where public.career_education.career_profile_id = profile.id
    returning id into stored_id;

  elsif record_kind = 'certification' then
    insert into public.career_certifications (
      id, career_profile_id, name, issuer, credential_id, credential_url, issued_on, expires_on
    ) values (
      coalesce(stored_id, gen_random_uuid()), profile.id,
      app_private.career_text(payload, 'name', 160, true),
      app_private.career_text(payload, 'issuer', 160, false),
      app_private.career_text(payload, 'credentialId', 120, false),
      app_private.career_text(payload, 'credentialUrl', 500, false),
      app_private.career_date(payload, 'issuedOn'),
      app_private.career_date(payload, 'expiresOn')
    )
    on conflict (id) do update set
      name = excluded.name,
      issuer = excluded.issuer,
      credential_id = excluded.credential_id,
      credential_url = excluded.credential_url,
      issued_on = excluded.issued_on,
      expires_on = excluded.expires_on
    where public.career_certifications.career_profile_id = profile.id
    returning id into stored_id;

  elsif record_kind = 'link' then
    insert into public.career_profile_links (
      id, career_profile_id, link_kind, label, url, display_order
    ) values (
      coalesce(stored_id, gen_random_uuid()), profile.id,
      app_private.career_enum(
        payload, 'linkKind',
        array['github','gitlab','linkedin','portfolio','personal_website','behance','dribbble','stackoverflow','other'],
        true
      )::public.career_link_kind,
      app_private.career_text(payload, 'label', 80, false),
      app_private.career_text(payload, 'url', 500, true),
      coalesce(app_private.career_integer(payload, 'displayOrder', 0, 1000), 0)
    )
    on conflict (id) do update set
      link_kind = excluded.link_kind,
      label = excluded.label,
      url = excluded.url,
      display_order = excluded.display_order
    where public.career_profile_links.career_profile_id = profile.id
    returning id into stored_id;

  elsif record_kind = 'skill' then
    insert into public.career_skills (
      id, career_profile_id, name, skill_kind, proficiency, years_experience,
      last_used_year, is_primary, display_order
    ) values (
      coalesce(stored_id, gen_random_uuid()), profile.id,
      app_private.career_text(payload, 'name', 100, true),
      coalesce(app_private.career_enum(
        payload, 'skillKind',
        array['skill','tool','technology','language','soft_skill','domain'], false
      ), 'skill')::public.career_skill_kind,
      app_private.career_enum(
        payload, 'proficiency', array['beginner','intermediate','advanced','expert'], false
      )::public.proficiency_level,
      app_private.career_numeric(payload, 'yearsExperience', 0, 80),
      app_private.career_integer(payload, 'lastUsedYear', 1930, 2100),
      app_private.career_boolean(payload, 'isPrimary', false),
      coalesce(app_private.career_integer(payload, 'displayOrder', 0, 1000), 0)
    )
    on conflict (id) do update set
      name = excluded.name,
      skill_kind = excluded.skill_kind,
      proficiency = excluded.proficiency,
      years_experience = excluded.years_experience,
      last_used_year = excluded.last_used_year,
      is_primary = excluded.is_primary,
      display_order = excluded.display_order
    where public.career_skills.career_profile_id = profile.id
    returning id into stored_id;

  else
    raise exception 'unsupported career record kind: %', record_kind using errcode = '22023';
  end if;

  if stored_id is null then
    raise exception 'career record does not exist on this profile' using errcode = 'P0002';
  end if;

  update public.career_profiles
  set completeness_percent =
        (app_private.career_profile_completeness_value(profile.id) ->> 'percent')::integer,
      version = version + 1
  where id = profile.id;

  insert into public.audit_events (
    actor_user_id, actor_type, action, target_type, target_id, request_id, metadata
  ) values (
    actor_user_id, 'user',
    case when record_id is null then 'career_record.created' else 'career_record.updated' end,
    'career_profile', profile.id, action_request_id,
    pg_catalog.jsonb_build_object('recordKind', record_kind, 'recordId', stored_id)
  );

  return stored_id;
end;
$$;

create or replace function public.delete_career_record(
  actor_user_id uuid,
  target_profile_id uuid,
  record_kind text,
  record_id uuid,
  action_request_id uuid default null
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  profile public.career_profiles;
  removed integer := 0;
begin
  profile := app_private.require_career_profile_owner(actor_user_id, target_profile_id);

  case record_kind
    when 'sub_career' then
      delete from public.career_sub_careers
      where id = record_id and career_profile_id = profile.id;
      get diagnostics removed = row_count;
    when 'employment' then
      delete from public.career_employment_history
      where id = record_id and career_profile_id = profile.id;
      get diagnostics removed = row_count;
    when 'project' then
      delete from public.career_projects
      where id = record_id and career_profile_id = profile.id;
      get diagnostics removed = row_count;
    when 'education' then
      delete from public.career_education
      where id = record_id and career_profile_id = profile.id;
      get diagnostics removed = row_count;
    when 'certification' then
      delete from public.career_certifications
      where id = record_id and career_profile_id = profile.id;
      get diagnostics removed = row_count;
    when 'link' then
      delete from public.career_profile_links
      where id = record_id and career_profile_id = profile.id;
      get diagnostics removed = row_count;
    when 'skill' then
      delete from public.career_skills
      where id = record_id and career_profile_id = profile.id;
      get diagnostics removed = row_count;
    else
      raise exception 'unsupported career record kind: %', record_kind using errcode = '22023';
  end case;

  if removed > 0 then
    update public.career_profiles
    set completeness_percent =
          (app_private.career_profile_completeness_value(profile.id) ->> 'percent')::integer,
        version = version + 1
    where id = profile.id;

    insert into public.audit_events (
      actor_user_id, actor_type, action, target_type, target_id, request_id, metadata
    ) values (
      actor_user_id, 'user', 'career_record.deleted', 'career_profile', profile.id, action_request_id,
      pg_catalog.jsonb_build_object('recordKind', record_kind, 'recordId', record_id)
    );
  end if;

  return removed > 0;
end;
$$;

revoke all on function public.upsert_career_record(uuid, uuid, text, uuid, jsonb, uuid)
  from public, anon, authenticated;
revoke all on function public.delete_career_record(uuid, uuid, text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.upsert_career_record(uuid, uuid, text, uuid, jsonb, uuid)
  to service_role;
grant execute on function public.delete_career_record(uuid, uuid, text, uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Truth ledger functions
-- ---------------------------------------------------------------------------

create or replace function public.record_career_facts(
  actor_user_id uuid,
  target_profile_id uuid,
  facts jsonb,
  requested_source public.career_fact_source,
  source_document_id uuid default null,
  action_request_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  profile public.career_profiles;
  element jsonb;
  created_ids jsonb := '[]'::jsonb;
  inserted_id uuid;
  fact_statement text;
  fact_category text;
  metric_value numeric;
  metric_unit text;
  fact_status public.career_fact_status;
  evidence jsonb;
begin
  profile := app_private.require_career_profile_owner(actor_user_id, target_profile_id);
  if pg_catalog.jsonb_typeof(facts) <> 'array' then
    raise exception 'facts must be an array' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_array_length(facts) > 200 then
    raise exception 'at most 200 facts may be recorded at once' using errcode = '22023';
  end if;
  if requested_source in ('resume_extraction', 'ai_inference') and source_document_id is null then
    raise exception 'an extracted fact must reference its source document' using errcode = '22023';
  end if;
  if source_document_id is not null and not exists (
    select 1 from public.career_documents
    where id = source_document_id and user_id = actor_user_id
  ) then
    raise exception 'career document does not exist' using errcode = 'P0002';
  end if;

  -- Extraction never produces confirmed facts; only the user can confirm them.
  fact_status := case when requested_source = 'user_entered' then 'confirmed' else 'candidate' end;

  for element in select pg_catalog.jsonb_array_elements(facts)
  loop
    if pg_catalog.jsonb_typeof(element) <> 'object' then
      raise exception 'each fact must be an object' using errcode = '22023';
    end if;
    fact_statement := app_private.career_text(element, 'statement', 500, true);
    fact_category := coalesce(app_private.career_enum(
      element, 'category',
      array['experience','responsibility','achievement','metric','skill','education','certification','preference','goal'],
      false
    ), 'experience');
    metric_value := app_private.career_numeric(element, 'metricValue', -1000000000, 1000000000);
    metric_unit := app_private.career_text(element, 'metricUnit', 40, false);
    if metric_value is not null and metric_unit is null then
      raise exception 'a metric fact requires a unit' using errcode = '22023';
    end if;
    if (element ? 'evidence') and pg_catalog.jsonb_typeof(element -> 'evidence') = 'object' then
      evidence := element -> 'evidence';
    else
      evidence := '{}'::jsonb;
    end if;

    insert into public.career_facts (
      career_profile_id, category, statement, source, status, confidence, evidence,
      metric_value, metric_unit, metric_context, document_id, confirmed_at, confirmed_by
    ) values (
      profile.id,
      fact_category::public.career_fact_category,
      fact_statement,
      requested_source,
      fact_status,
      app_private.career_numeric(element, 'confidence', 0, 1),
      evidence,
      metric_value,
      metric_unit,
      app_private.career_text(element, 'metricContext', 240, false),
      source_document_id,
      case when fact_status = 'confirmed' then now() else null end,
      case when fact_status = 'confirmed' then actor_user_id else null end
    )
    on conflict (career_profile_id, pg_catalog.lower(statement)) where status = 'confirmed'
    do nothing
    returning id into inserted_id;

    if inserted_id is not null then
      created_ids := created_ids || pg_catalog.to_jsonb(inserted_id);
      inserted_id := null;
    end if;
  end loop;

  insert into public.audit_events (
    actor_user_id, actor_type, action, target_type, target_id, request_id, metadata
  ) values (
    actor_user_id,
    (case when requested_source = 'user_entered' then 'user' else 'system' end)::public.audit_actor_type,
    'career_fact.recorded', 'career_profile', profile.id, action_request_id,
    pg_catalog.jsonb_build_object(
      'source', requested_source,
      'requestedCount', pg_catalog.jsonb_array_length(facts),
      'createdCount', pg_catalog.jsonb_array_length(created_ids)
    )
  );

  return pg_catalog.jsonb_build_object('createdIds', created_ids);
end;
$$;

create or replace function public.career_fact_directory(
  actor_user_id uuid,
  target_profile_id uuid,
  status_filter public.career_fact_status default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  profile public.career_profiles;
begin
  profile := app_private.require_career_profile_owner(actor_user_id, target_profile_id);
  return pg_catalog.jsonb_build_object(
    'items', coalesce((
      select pg_catalog.jsonb_agg(
        app_private.career_fact_snapshot(fact)
        order by fact.status, fact.category, fact.created_at desc
      )
      from public.career_facts as fact
      where fact.career_profile_id = profile.id
        and (status_filter is null or fact.status = status_filter)
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.decide_career_fact(
  actor_user_id uuid,
  target_fact_id uuid,
  decision text,
  override_statement text default null,
  override_metric_unit text default null,
  override_metric_value numeric default null,
  action_request_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  fact public.career_facts;
  profile public.career_profiles;
  next_status public.career_fact_status;
  final_statement text;
  final_unit text;
  final_value numeric;
  replacement_id uuid;
begin
  perform app_private.require_active_actor(actor_user_id);

  select * into fact from public.career_facts where id = target_fact_id;
  if fact.id is null then
    raise exception 'career fact does not exist' using errcode = 'P0002';
  end if;
  profile := app_private.require_career_profile_owner(actor_user_id, fact.career_profile_id);

  if decision not in ('confirm', 'reject', 'correct') then
    raise exception 'decision must be confirm, reject, or correct' using errcode = '22023';
  end if;
  if fact.status = 'superseded' then
    raise exception 'a superseded fact cannot be changed' using errcode = '22023';
  end if;

  if decision = 'reject' then
    next_status := 'rejected';
    update public.career_facts
    set status = next_status, confirmed_at = null, confirmed_by = null
    where id = fact.id;
  elsif decision = 'confirm' then
    final_statement := coalesce(pg_catalog.btrim(override_statement), fact.statement);
    final_unit := coalesce(pg_catalog.btrim(override_metric_unit), fact.metric_unit);
    final_value := coalesce(override_metric_value, fact.metric_value);
    if pg_catalog.char_length(final_statement) < 3 or pg_catalog.char_length(final_statement) > 500 then
      raise exception 'a fact statement must be between 3 and 500 characters' using errcode = '22023';
    end if;
    if (final_value is null) <> (final_unit is null) then
      raise exception 'a metric requires both a value and a unit' using errcode = '22023';
    end if;
    update public.career_facts
    set statement = final_statement,
        metric_unit = final_unit,
        metric_value = final_value,
        status = 'confirmed',
        confirmed_at = now(),
        confirmed_by = actor_user_id
    where id = fact.id;
  else
    -- Correcting replaces the claim: the original is superseded and a new
    -- user-entered, already-confirmed fact records the corrected wording.
    final_statement := pg_catalog.btrim(override_statement);
    if final_statement is null or pg_catalog.char_length(final_statement) < 3
      or pg_catalog.char_length(final_statement) > 500
    then
      raise exception 'a corrected statement must be between 3 and 500 characters'
        using errcode = '22023';
    end if;
    final_unit := coalesce(pg_catalog.btrim(override_metric_unit), fact.metric_unit);
    final_value := coalesce(override_metric_value, fact.metric_value);
    if (final_value is null) <> (final_unit is null) then
      raise exception 'a metric requires both a value and a unit' using errcode = '22023';
    end if;

    insert into public.career_facts (
      career_profile_id, category, statement, source, status, evidence,
      metric_value, metric_unit, metric_context, document_id, confirmed_at, confirmed_by
    ) values (
      profile.id, fact.category, final_statement, 'user_entered', 'confirmed', fact.evidence,
      final_value, final_unit, fact.metric_context, fact.document_id, now(), actor_user_id
    )
    returning id into replacement_id;

    update public.career_facts
    set status = 'superseded', confirmed_at = null, confirmed_by = null, superseded_by = replacement_id
    where id = fact.id;
  end if;

  insert into public.audit_events (
    actor_user_id, actor_type, action, target_type, target_id, request_id, metadata
  ) values (
    actor_user_id, 'user', 'career_fact.' || decision || 'ed', 'career_profile', profile.id,
    action_request_id,
    pg_catalog.jsonb_build_object('factId', fact.id, 'replacementId', replacement_id)
  );

  return pg_catalog.jsonb_build_object(
    'originalId', fact.id,
    'replacementId', replacement_id,
    'facts', public.career_fact_directory(actor_user_id, profile.id, null)
  );
end;
$$;

-- Truth-gate read model. Generation code must read evidence exclusively here.
create or replace function public.confirmed_career_evidence(
  actor_user_id uuid,
  target_profile_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  profile public.career_profiles;
begin
  profile := app_private.require_career_profile_owner(actor_user_id, target_profile_id);
  return pg_catalog.jsonb_build_object(
    'careerProfileId', profile.id,
    'facts', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', fact.id,
          'category', fact.category,
          'statement', fact.statement,
          'source', fact.source,
          'metricValue', fact.metric_value,
          'metricUnit', fact.metric_unit,
          'metricContext', fact.metric_context,
          'evidence', fact.evidence,
          'confirmedAt', fact.confirmed_at
        ) order by fact.category, fact.created_at
      )
      from public.career_facts as fact
      where fact.career_profile_id = profile.id and fact.status = 'confirmed'
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.record_career_facts(uuid, uuid, jsonb, public.career_fact_source, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.career_fact_directory(uuid, uuid, public.career_fact_status)
  from public, anon, authenticated;
revoke all on function public.decide_career_fact(uuid, uuid, text, text, text, numeric, uuid)
  from public, anon, authenticated;
revoke all on function public.confirmed_career_evidence(uuid, uuid) from public, anon, authenticated;

grant execute on function public.record_career_facts(uuid, uuid, jsonb, public.career_fact_source, uuid, uuid)
  to service_role;
grant execute on function public.career_fact_directory(uuid, uuid, public.career_fact_status)
  to service_role;
grant execute on function public.decide_career_fact(uuid, uuid, text, text, text, numeric, uuid)
  to service_role;
grant execute on function public.confirmed_career_evidence(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Onboarding state
-- ---------------------------------------------------------------------------

create or replace function public.set_onboarding_status(
  actor_user_id uuid,
  requested_status public.onboarding_status,
  action_request_id uuid default null
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  previous public.onboarding_status;
begin
  perform app_private.require_active_actor(actor_user_id);

  select onboarding_status into previous
  from public.profiles where id = actor_user_id;

  if previous is null then
    raise exception 'profile does not exist' using errcode = 'P0002';
  end if;
  if previous = requested_status then
    return false;
  end if;
  if previous = 'complete' and requested_status <> 'complete' then
    raise exception 'completed onboarding cannot be reopened' using errcode = '22023';
  end if;

  update public.profiles
  set onboarding_status = requested_status
  where id = actor_user_id;

  insert into public.audit_events (
    actor_user_id, actor_type, action, target_type, target_id, request_id,
    before_state, after_state
  ) values (
    actor_user_id, 'user', 'profile.onboarding_status_changed', 'profile', actor_user_id,
    action_request_id,
    pg_catalog.jsonb_build_object('onboardingStatus', previous),
    pg_catalog.jsonb_build_object('onboardingStatus', requested_status)
  );

  return true;
end;
$$;

revoke all on function public.set_onboarding_status(uuid, public.onboarding_status, uuid)
  from public, anon, authenticated;
grant execute on function public.set_onboarding_status(uuid, public.onboarding_status, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create trigger career_profiles_set_updated_at
before update on public.career_profiles
for each row execute function app_private.set_updated_at();

create trigger career_sub_careers_set_updated_at
before update on public.career_sub_careers
for each row execute function app_private.set_updated_at();

create trigger career_employment_history_set_updated_at
before update on public.career_employment_history
for each row execute function app_private.set_updated_at();

create trigger career_projects_set_updated_at
before update on public.career_projects
for each row execute function app_private.set_updated_at();

create trigger career_education_set_updated_at
before update on public.career_education
for each row execute function app_private.set_updated_at();

create trigger career_certifications_set_updated_at
before update on public.career_certifications
for each row execute function app_private.set_updated_at();

create trigger career_profile_links_set_updated_at
before update on public.career_profile_links
for each row execute function app_private.set_updated_at();

create trigger career_skills_set_updated_at
before update on public.career_skills
for each row execute function app_private.set_updated_at();

create trigger career_facts_set_updated_at
before update on public.career_facts
for each row execute function app_private.set_updated_at();

create trigger career_documents_set_updated_at
before update on public.career_documents
for each row execute function app_private.set_updated_at();

-- Cached completeness is refreshed on every child change so list views never
-- show a stale percentage, even if a future writer bypasses the upsert helper.
create trigger career_sub_careers_refresh_completeness
after insert or update or delete on public.career_sub_careers
for each row execute function app_private.refresh_career_profile_completeness();

create trigger career_employment_refresh_completeness
after insert or update or delete on public.career_employment_history
for each row execute function app_private.refresh_career_profile_completeness();

create trigger career_projects_refresh_completeness
after insert or update or delete on public.career_projects
for each row execute function app_private.refresh_career_profile_completeness();

create trigger career_education_refresh_completeness
after insert or update or delete on public.career_education
for each row execute function app_private.refresh_career_profile_completeness();

create trigger career_certifications_refresh_completeness
after insert or update or delete on public.career_certifications
for each row execute function app_private.refresh_career_profile_completeness();

create trigger career_profile_links_refresh_completeness
after insert or update or delete on public.career_profile_links
for each row execute function app_private.refresh_career_profile_completeness();

create trigger career_skills_refresh_completeness
after insert or update or delete on public.career_skills
for each row execute function app_private.refresh_career_profile_completeness();

create trigger career_facts_refresh_completeness
after insert or update or delete on public.career_facts
for each row execute function app_private.refresh_career_profile_completeness();

-- ---------------------------------------------------------------------------
-- Row-level security and grants
--
-- Career tables are read-only from the client. Every mutation is funnelled
-- through the SECURITY DEFINER functions above, which re-check the actor,
-- ownership, plan limits, and version. There is deliberately no INSERT,
-- UPDATE, or DELETE policy anywhere in this section.
-- ---------------------------------------------------------------------------

alter table public.career_profiles enable row level security;
alter table public.career_profiles force row level security;
alter table public.career_sub_careers enable row level security;
alter table public.career_sub_careers force row level security;
alter table public.career_employment_history enable row level security;
alter table public.career_employment_history force row level security;
alter table public.career_projects enable row level security;
alter table public.career_projects force row level security;
alter table public.career_education enable row level security;
alter table public.career_education force row level security;
alter table public.career_certifications enable row level security;
alter table public.career_certifications force row level security;
alter table public.career_profile_links enable row level security;
alter table public.career_profile_links force row level security;
alter table public.career_skills enable row level security;
alter table public.career_skills force row level security;
alter table public.career_facts enable row level security;
alter table public.career_facts force row level security;
alter table public.career_documents enable row level security;
alter table public.career_documents force row level security;

revoke all on table public.career_profiles from public, anon, authenticated;
revoke all on table public.career_sub_careers from public, anon, authenticated;
revoke all on table public.career_employment_history from public, anon, authenticated;
revoke all on table public.career_projects from public, anon, authenticated;
revoke all on table public.career_education from public, anon, authenticated;
revoke all on table public.career_certifications from public, anon, authenticated;
revoke all on table public.career_profile_links from public, anon, authenticated;
revoke all on table public.career_skills from public, anon, authenticated;
revoke all on table public.career_facts from public, anon, authenticated;
revoke all on table public.career_documents from public, anon, authenticated;

grant all privileges on table public.career_profiles to service_role;
grant all privileges on table public.career_sub_careers to service_role;
grant all privileges on table public.career_employment_history to service_role;
grant all privileges on table public.career_projects to service_role;
grant all privileges on table public.career_education to service_role;
grant all privileges on table public.career_certifications to service_role;
grant all privileges on table public.career_profile_links to service_role;
grant all privileges on table public.career_skills to service_role;
grant all privileges on table public.career_facts to service_role;
grant all privileges on table public.career_documents to service_role;

grant select (
  id,
  user_id,
  name,
  is_primary,
  status,
  headline,
  summary,
  current_role_title,
  career_level,
  years_experience,
  industries,
  target_role_titles,
  excluded_role_titles,
  preferred_employment_types,
  preferred_work_arrangement,
  preferred_locations,
  open_to_international,
  open_to_relocation,
  work_authorizations,
  availability,
  salary_expectation_min_minor,
  salary_expectation_max_minor,
  salary_currency,
  salary_period,
  career_goals,
  completeness_percent,
  last_reviewed_at,
  version,
  created_at,
  updated_at
) on table public.career_profiles to authenticated;

grant select on table public.career_sub_careers to authenticated;
grant select on table public.career_employment_history to authenticated;
grant select on table public.career_projects to authenticated;
grant select on table public.career_education to authenticated;
grant select on table public.career_certifications to authenticated;
grant select on table public.career_profile_links to authenticated;
grant select on table public.career_skills to authenticated;
grant select (
  id,
  career_profile_id,
  document_kind,
  status,
  original_filename,
  mime_type,
  size_bytes,
  checksum_sha256,
  page_count,
  word_count,
  parsed_at,
  is_active,
  version,
  created_at,
  updated_at
) on table public.career_documents to authenticated;
grant select (
  id,
  career_profile_id,
  category,
  statement,
  source,
  status,
  metric_value,
  metric_unit,
  metric_context,
  confirmed_at,
  created_at,
  updated_at
) on table public.career_facts to authenticated;

create policy career_profiles_select_own_active_account
on public.career_profiles
for select
to authenticated
using (
  user_id = (select auth.uid())
  and (select app_private.is_account_active())
);

create policy career_sub_careers_select_own_active_account
on public.career_sub_careers
for select
to authenticated
using (
  (select app_private.is_account_active())
  and exists (
    select 1 from public.career_profiles as profile
    where profile.id = career_sub_careers.career_profile_id
      and profile.user_id = (select auth.uid())
  )
);

create policy career_employment_select_own_active_account
on public.career_employment_history
for select
to authenticated
using (
  (select app_private.is_account_active())
  and exists (
    select 1 from public.career_profiles as profile
    where profile.id = career_employment_history.career_profile_id
      and profile.user_id = (select auth.uid())
  )
);

create policy career_projects_select_own_active_account
on public.career_projects
for select
to authenticated
using (
  (select app_private.is_account_active())
  and exists (
    select 1 from public.career_profiles as profile
    where profile.id = career_projects.career_profile_id
      and profile.user_id = (select auth.uid())
  )
);

create policy career_education_select_own_active_account
on public.career_education
for select
to authenticated
using (
  (select app_private.is_account_active())
  and exists (
    select 1 from public.career_profiles as profile
    where profile.id = career_education.career_profile_id
      and profile.user_id = (select auth.uid())
  )
);

create policy career_certifications_select_own_active_account
on public.career_certifications
for select
to authenticated
using (
  (select app_private.is_account_active())
  and exists (
    select 1 from public.career_profiles as profile
    where profile.id = career_certifications.career_profile_id
      and profile.user_id = (select auth.uid())
  )
);

create policy career_profile_links_select_own_active_account
on public.career_profile_links
for select
to authenticated
using (
  (select app_private.is_account_active())
  and exists (
    select 1 from public.career_profiles as profile
    where profile.id = career_profile_links.career_profile_id
      and profile.user_id = (select auth.uid())
  )
);

create policy career_skills_select_own_active_account
on public.career_skills
for select
to authenticated
using (
  (select app_private.is_account_active())
  and exists (
    select 1 from public.career_profiles as profile
    where profile.id = career_skills.career_profile_id
      and profile.user_id = (select auth.uid())
  )
);

create policy career_facts_select_own_active_account
on public.career_facts
for select
to authenticated
using (
  (select app_private.is_account_active())
  and exists (
    select 1 from public.career_profiles as profile
    where profile.id = career_facts.career_profile_id
      and profile.user_id = (select auth.uid())
  )
);

create policy career_documents_select_own_active_account
on public.career_documents
for select
to authenticated
using (
  user_id = (select auth.uid())
  and (select app_private.is_account_active())
);

comment on policy career_profiles_select_own_active_account on public.career_profiles is
  'Career data is owner-readable only. Every mutation is funnelled through SECURITY DEFINER functions that re-check entitlement limits and version.';
comment on policy career_facts_select_own_active_account on public.career_facts is
  'The truth ledger is owner-readable. Extraction confidence, raw payloads, and object paths are never exposed as client-writable state.';
comment on policy career_documents_select_own_active_account on public.career_documents is
  'Document metadata only. Object paths are the storage address, never returned to clients; bytes are served through short-lived signed URLs.';
