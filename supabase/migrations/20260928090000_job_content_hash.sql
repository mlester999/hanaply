-- Hanaply canonical job content revision.
--
-- `public.jobs.updated_at` was being used as a content revision marker, and it is
-- not one. The generic `jobs_set_updated_at` trigger
-- (20260915090000_job_ingestion_foundation.sql, lines 1226-1228) moves
-- `updated_at` on *any* update, and `public.refresh_job_freshness` (same file,
-- lines 1187-1189) stamps `freshness_checked_at` on every job on every pass. So
-- the worker's own maintenance cycle bumped `updated_at` for every job it
-- touched, `matching_job_candidates` compared that against the revision stored on
-- a result, and every already-scored posting became eligible again on the next
-- due pass: matching, AI enrichment, writes, and notification evaluation were all
-- re-run for jobs whose content had not changed at all.
--
-- This migration replaces that proxy with the thing it was standing in for: a
-- canonical fingerprint of the posting's meaningful content, computed in SQL on
-- every write so no application code path can forget it.
--
-- ---------------------------------------------------------------------------
-- What participates, and what deliberately does not
-- ---------------------------------------------------------------------------
--
-- Participating (23 fields, exactly the ones a match score can read):
--
--   title, description, requirements, preferred_qualifications, skills,
--   salary_min_minor, salary_max_minor, salary_currency, salary_period,
--   salary_is_estimate, location_raw, city, region, country_code, remote_state,
--   employment_type, seniority, experience_years_min, experience_years_max,
--   apply_url, status, posted_at, company_id
--
-- Excluded, by class, each for a reason:
--
--   * Identity and bookkeeping — `id`, `created_at`, `updated_at`,
--     `first_seen_at`, `last_seen_at`, `last_verified_at`,
--     `freshness_checked_at`, `source_count`. These move with the observation of
--     a posting, not with the posting. Hashing any of them reintroduces exactly
--     the defect this migration removes.
--   * `content_fingerprint` — the source-supplied deduplication signal. It is a
--     second-hand claim about a provider's payload, not canonical content, and
--     two providers legitimately disagree about it for the same opening.
--   * `dedup_key` — derived from the normalized title, the company name, and the
--     location, all of which participate on their own.
--   * `normalized_title` and `description_excerpt` — derived from `title` and
--     `description`, which participate on their own.
--   * `is_philippines` / `is_international` — derived from `country_code`.
--   * `expires_at` — it moves with the clock, not with the posting.
--   * The **company display name** — excluded even though `company_id` is
--     included. A rename is presentation, not a change to the opportunity: the
--     interface reads the employer's name by joining `public.companies` at render
--     time, so nothing a subscriber sees goes stale when the canonical row is
--     left alone. Hashing the name would re-enqueue every posting that employer
--     carries on a rename — the mass reprocessing this change exists to prevent,
--     triggered by a cosmetic edit. The company's *identity* is still part of the
--     content, through `company_id`, so a posting genuinely moving to a different
--     employer does move the hash.
--
-- ---------------------------------------------------------------------------
-- Normalisation
-- ---------------------------------------------------------------------------
--
--   * null and empty are the same value: `nullif(btrim(x), '')`.
--   * internal whitespace runs collapse to a single space, then trim.
--   * case is folded where it is not semantic: title, description, requirements,
--     preferred qualifications, skills, locations, employment type, seniority,
--     remote state, currency, period, and the apply URL's host and path.
--   * arrays are trimmed per element, emptied elements dropped, deduplicated,
--     and sorted, so the order a provider happens to list things in is not
--     meaningful.
--   * numbers are hashed as numbers, not as their text form, so `9000000`,
--     `9000000.0`, and `9000000.00` cannot disagree.
--   * timestamps are hashed in UTC with a fixed representation
--     (`YYYY-MM-DD"T"HH24:MI:SS`), so the server's TimeZone setting cannot
--     change the value.
--   * the document is built with `jsonb_build_object`. `jsonb` canonicalises key
--     order and whitespace, so determinism comes for free and nothing depends on
--     the physical column order of a row.
--
-- The digest is taken with pgcrypto's `digest`/`encode`. pgcrypto is installed in
-- the `extensions` schema by the Supabase baseline, so the function states that
-- schema explicitly rather than relying on the caller's `search_path`; every
-- other function it calls is qualified into `pg_catalog`.

-- ---------------------------------------------------------------------------
-- Normalisation helpers
-- ---------------------------------------------------------------------------

/**
 * Canonical form of a scalar text field.
 *
 * `fold_case` is true for the fields whose case carries no meaning — a title,
 * a city, a currency code — and false for the fields whose case is part of the
 * value, of which the canonical content currently has none. It is stated per
 * call rather than assumed so adding one later is a deliberate act.
 */
create or replace function app_private.job_hash_text(requested_value text, fold_case boolean)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select nullif(
    pg_catalog.regexp_replace(
      case
        when fold_case then pg_catalog.lower(pg_catalog.btrim(requested_value))
        else pg_catalog.btrim(requested_value)
      end,
      '\s+', ' ', 'g'
    ),
    ''
  );
$$;

/**
 * Canonical form of a text array: trimmed, emptied elements dropped, folded to
 * lower case, deduplicated, and sorted. An array with nothing meaningful in it
 * hashes as `[]` rather than as null, so that repeated normalization converges
 * instead of oscillating between two empty shapes.
 */
create or replace function app_private.job_hash_text_array(requested_values text[])
returns jsonb
language sql
immutable
security invoker
set search_path = ''
as $$
  select pg_catalog.to_jsonb(
    coalesce(
      (
        select pg_catalog.array_agg(distinct normalized order by normalized)
        from pg_catalog.unnest(coalesce(requested_values, '{}'::text[])) as element
        cross join lateral (
          select app_private.job_hash_text(element, true) as normalized
        ) as canonical
        where normalized is not null
      ),
      '{}'::text[]
    )
  );
$$;

/**
 * Canonical form of a timestamp: a fixed UTC rendering, so two servers with
 * different TimeZone settings hash the same instant identically.
 */
create or replace function app_private.job_hash_timestamp(requested_value timestamptz)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when requested_value is null then null
    else pg_catalog.to_char(requested_value at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS')
  end;
$$;

/**
 * Canonical form of an apply URL: scheme removed, host and path folded to lower
 * case, surrounding and internal whitespace collapsed. The scheme is dropped
 * because `https://example.test/x` and `http://example.test/x` are the same
 * destination, and a provider flipping one to the other is not a change to the
 * opportunity.
 */
create or replace function app_private.job_hash_url(requested_value text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select app_private.job_hash_text(
    pg_catalog.regexp_replace(
      coalesce(requested_value, ''),
      '^[A-Za-z][A-Za-z0-9+.-]*://',
      ''
    ),
    true
  );
$$;

-- ---------------------------------------------------------------------------
-- The canonical content fingerprint
-- ---------------------------------------------------------------------------

/**
 * SHA-256 over the canonical JSON document of a posting's meaningful content.
 *
 * The participating values are arguments rather than a whole row on purpose: a
 * row-typed argument would silently pick up any column added to `public.jobs`
 * later, which is the opposite of what a content revision needs, and it would
 * also be impossible to unit test field by field. Passing values means adding a
 * field is a deliberate edit to this signature.
 */
create or replace function app_private.job_content_hash(
  requested_title text,
  requested_description text,
  requested_requirements text[],
  requested_preferred_qualifications text[],
  requested_skills text[],
  requested_salary_min_minor integer,
  requested_salary_max_minor integer,
  requested_salary_currency text,
  requested_salary_period text,
  requested_salary_is_estimate boolean,
  requested_location_raw text,
  requested_city text,
  requested_region text,
  requested_country_code text,
  requested_remote_state text,
  requested_employment_type text,
  requested_seniority text,
  requested_experience_years_min numeric,
  requested_experience_years_max numeric,
  requested_apply_url text,
  requested_status text,
  requested_posted_at timestamptz,
  requested_company_id uuid
)
returns text
language sql
immutable
security invoker
set search_path = 'pg_catalog, extensions'
as $$
  select pg_catalog.encode(
    extensions.digest(
      pg_catalog.jsonb_build_object(
        'title', app_private.job_hash_text(requested_title, true),
        -- The description is the largest participating field and the one a
        -- provider edits most often; it is folded like every other text field.
        'description', app_private.job_hash_text(requested_description, true),
        'requirements', app_private.job_hash_text_array(requested_requirements),
        'preferredQualifications',
          app_private.job_hash_text_array(requested_preferred_qualifications),
        'skills', app_private.job_hash_text_array(requested_skills),
        -- Numbers travel as JSON numbers, so `9000000`, `9000000.0`, and
        -- `9000000.00` cannot disagree. `to_jsonb` yields jsonb, and
        -- `jsonb_build_object` has no jsonb overload — an uncast value here is
        -- silently coerced to its text form, which is the text form this line
        -- exists to avoid. A non-finite value would make `to_jsonb` raise rather
        -- than hash, and a number JSON cannot represent is not content, so it
        -- hashes as absent instead of aborting the write.
        'salaryMinMinor',
          case when pg_catalog.jsonb_typeof(pg_catalog.to_jsonb(requested_salary_min_minor)) = 'number'
            then pg_catalog.to_jsonb(requested_salary_min_minor)::text end,
        'salaryMaxMinor',
          case when pg_catalog.jsonb_typeof(pg_catalog.to_jsonb(requested_salary_max_minor)) = 'number'
            then pg_catalog.to_jsonb(requested_salary_max_minor)::text end,
        'salaryCurrency', app_private.job_hash_text(requested_salary_currency, true),
        'salaryPeriod', app_private.job_hash_text(requested_salary_period, true),
        'salaryIsEstimate', requested_salary_is_estimate,
        'locationRaw', app_private.job_hash_text(requested_location_raw, true),
        'city', app_private.job_hash_text(requested_city, true),
        'region', app_private.job_hash_text(requested_region, true),
        'countryCode', app_private.job_hash_text(requested_country_code, true),
        'remoteState', app_private.job_hash_text(requested_remote_state, true),
        'employmentType', app_private.job_hash_text(requested_employment_type, true),
        'seniority', app_private.job_hash_text(requested_seniority, true),
        'experienceYearsMin',
          case when pg_catalog.jsonb_typeof(pg_catalog.to_jsonb(requested_experience_years_min)) = 'number'
            then pg_catalog.to_jsonb(requested_experience_years_min)::text end,
        'experienceYearsMax',
          case when pg_catalog.jsonb_typeof(pg_catalog.to_jsonb(requested_experience_years_max)) = 'number'
            then pg_catalog.to_jsonb(requested_experience_years_max)::text end,
        'applyUrl', app_private.job_hash_url(requested_apply_url),
        'status', app_private.job_hash_text(requested_status, true),
        'postedAt', app_private.job_hash_timestamp(requested_posted_at),
        'companyId', requested_company_id::text
      )::text::bytea,
      'sha256'
    ),
    'hex'
  );
$$;

comment on function app_private.job_content_hash(
  text, text, text[], text[], text[], integer, integer, text, text, boolean,
  text, text, text, text, text, text, text, numeric, numeric, text, text,
  timestamptz, uuid
) is
  'SHA-256 over the canonical JSON document of a posting''s meaningful content. Excludes identity, observation, derived, and presentation fields; see the migration header for the exclusion rationale.';

-- ---------------------------------------------------------------------------
-- The canonical columns
-- ---------------------------------------------------------------------------

alter table public.jobs
  add column content_hash text null,
  add column content_changed_at timestamptz null;

comment on column public.jobs.content_hash is
  'SHA-256 over the canonical meaningful content of this posting. A content revision marker: it moves only when something a match score can read actually changes, never on observation or bookkeeping.';
comment on column public.jobs.content_changed_at is
  'When content_hash last changed. Null means the content has not been observed changing since the hash was introduced. Never moved by a last_seen or freshness refresh.';

/**
 * Keeps `content_hash` correct on every insert and update.
 *
 * The hash is computed from `NEW`, which is what makes it fire on the ingestion
 * write path: `upsert_ingested_job` writes canonical columns and never mentions
 * `content_hash`, so a trigger that recomputed from a stored row or from `OLD`
 * would leave the column stale on exactly the writes that matter.
 *
 * `content_changed_at` moves only when the hash actually changed. On a first
 * insert `OLD` does not exist, so the comparison is against null and `OLD` is
 * never dereferenced — in PL/pgSQL, `TG_OP = 'INSERT' or new.x is distinct from
 * old.x` short-circuits before the `OLD` reference is evaluated.
 *
 * One escape hatch exists, and only one caller uses it: the backfill below sets
 * `hanaply.job_content_hash_backfill` so that initialising the column on an
 * existing row does not claim the row's content just changed. Without it, the
 * backfill's own update would fire this trigger, see `OLD.content_hash` as null,
 * and stamp `content_changed_at = now()` on every posting in the database.
 */
create or replace function app_private.set_job_content_hash()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.content_hash := app_private.job_content_hash(
    new.title,
    new.description,
    new.requirements,
    new.preferred_qualifications,
    new.skills,
    new.salary_min_minor,
    new.salary_max_minor,
    new.salary_currency,
    new.salary_period::text,
    new.salary_is_estimate,
    new.location_raw,
    new.city,
    new.region,
    new.country_code,
    new.remote_state::text,
    new.employment_type::text,
    new.seniority::text,
    new.experience_years_min,
    new.experience_years_max,
    new.apply_url,
    new.status::text,
    new.posted_at,
    new.company_id
  );

  if pg_catalog.current_setting('hanaply.job_content_hash_backfill', true) = 'on' then
    -- Initialisation, not a change. Whatever the writing statement left in the
    -- column is preserved, which for the backfill is null.
    return new;
  end if;

  if tg_op = 'INSERT' or new.content_hash is distinct from old.content_hash then
    new.content_changed_at := now();
  else
    new.content_changed_at := old.content_changed_at;
  end if;

  return new;
end;
$$;

create trigger jobs_set_content_hash
before insert or update on public.jobs
for each row execute function app_private.set_job_content_hash();

-- ---------------------------------------------------------------------------
-- Backfill
-- ---------------------------------------------------------------------------
--
-- Every existing job receives a correct hash in this migration, computed by the
-- same function the trigger uses so the two cannot disagree.
--
-- `content_changed_at` is deliberately left null rather than set to now(). Null
-- is the honest answer — the moment the content last changed is not knowable from
-- the row — and it is also the safe one: a non-null value here would claim every
-- posting in the database changed at migration time. Nothing re-queues on a null
-- `content_changed_at`, and the trigger preserves null until a hash genuinely
-- moves.
--
-- The update is guarded by `content_hash is null`, so it is a no-op on a database
-- where this migration is somehow applied twice, and it never rewrites a hash the
-- trigger has already produced.

-- `set`/`reset` rather than `set local`, so the escape hatch is armed whether the
-- migration chain runs this file inside a transaction (Harness: `--single-transaction`;
-- Supabase: the same) or statement by statement.

set hanaply.job_content_hash_backfill = 'on';

update public.jobs as jobs
set content_hash = app_private.job_content_hash(
  jobs.title,
  jobs.description,
  jobs.requirements,
  jobs.preferred_qualifications,
  jobs.skills,
  jobs.salary_min_minor,
  jobs.salary_max_minor,
  jobs.salary_currency,
  jobs.salary_period::text,
  jobs.salary_is_estimate,
  jobs.location_raw,
  jobs.city,
  jobs.region,
  jobs.country_code,
  jobs.remote_state::text,
  jobs.employment_type::text,
  jobs.seniority::text,
  jobs.experience_years_min,
  jobs.experience_years_max,
  jobs.apply_url,
  jobs.status::text,
  jobs.posted_at,
  jobs.company_id
)
where jobs.content_hash is null;

reset hanaply.job_content_hash_backfill;

alter table public.jobs
  alter column content_hash set not null,
  add constraint jobs_content_hash_check check (content_hash ~ '^[a-f0-9]{64}$');

-- The not-null is only meaningful if the backfill above actually produced a
-- value for every row, so it is asserted rather than assumed.
do $$
declare
  missing integer;
begin
  select pg_catalog.count(*)::integer into missing
  from public.jobs
  where content_hash is null or content_hash !~ '^[a-f0-9]{64}$';

  if missing > 0 then
    raise exception 'job content hashing left % jobs without a canonical hash', missing
      using errcode = 'P0001';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
--
-- These are internal derivations. They are never called by a client, and the
-- default `execute` grant to `public` that PostgreSQL gives every new function is
-- removed for the same reason it is removed everywhere else in this schema.

revoke all on function app_private.job_hash_text(text, boolean)
  from public, anon, authenticated;
revoke all on function app_private.job_hash_text_array(text[])
  from public, anon, authenticated;
revoke all on function app_private.job_hash_timestamp(timestamptz)
  from public, anon, authenticated;
revoke all on function app_private.job_hash_url(text)
  from public, anon, authenticated;
revoke all on function app_private.job_content_hash(
  text, text, text[], text[], text[], integer, integer, text, text, boolean,
  text, text, text, text, text, text, text, numeric, numeric, text, text,
  timestamptz, uuid
) from public, anon, authenticated;
-- `job_content_hash` is a security-invoker function, so the helpers it calls are
-- resolved with the caller's privileges. `service_role` is the only caller that
-- has to be able to run it — the operator-facing check in the pgTAP suite — and
-- without these grants that check fails on the helper rather than on the digest.
grant execute on function app_private.job_hash_text(text, boolean) to service_role;
grant execute on function app_private.job_hash_text_array(text[]) to service_role;
grant execute on function app_private.job_hash_timestamp(timestamptz) to service_role;
grant execute on function app_private.job_hash_url(text) to service_role;
grant execute on function app_private.job_content_hash(
  text, text, text[], text[], text[], integer, integer, text, text, boolean,
  text, text, text, text, text, text, text, numeric, numeric, text, text,
  timestamptz, uuid
) to service_role;
revoke all on function app_private.set_job_content_hash()
  from public, anon, authenticated;
