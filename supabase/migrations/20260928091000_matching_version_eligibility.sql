-- Hanaply processing versions: what makes an already-scored posting eligible
-- again.
--
-- `public.matching_job_candidates` decided eligibility with
--
--   existing.id is null
--   or existing.profile_version <> profile.version
--   or existing.job_updated_at < jobs.updated_at
--
-- and the third clause made the documented invariant — "already-scored jobs are
-- only revisited when the profile or the posting changed" — untrue. `updated_at`
-- is bumped by the generic `jobs_set_updated_at` trigger on *any* update, and
-- `public.refresh_job_freshness` stamps `freshness_checked_at` on every job it
-- passes. So the worker's own maintenance cycle re-opened every posting on the
-- next due pass, and thousands of jobs on a schedule re-ran matching, AI
-- enrichment, writes, and notification evaluation for content that had not
-- changed.
--
-- The clause also never considered `existing.model_version`, so a deliberate
-- matching-engine version change re-queued nothing at all: the engine could be
-- rewritten and the stored results would keep claiming to be current.
--
-- This migration replaces the revision marker with the canonical content hash
-- introduced by 20260928090000_job_content_hash.sql, and makes the engine version
-- an explicit argument so a version bump is a decision the caller makes and the
-- database honours.
--
-- The invariant this file makes true, in final form:
--
--   A posting with a stored result is a candidate again if and only if
--     * it has no stored result for this profile, or
--     * its canonical content hash differs from the hash the result was computed
--       from, or
--     * the profile has changed since the result was computed, or
--     * the matching engine's version differs from the one the result was
--       computed with.
--
-- `jobs.updated_at` appears nowhere in that decision.

-- ---------------------------------------------------------------------------
-- The revision a stored result was computed from
-- ---------------------------------------------------------------------------

alter table public.job_matches
  add column job_content_hash text null
    check (job_content_hash is null or job_content_hash ~ '^[a-f0-9]{64}$');

comment on column public.job_matches.job_content_hash is
  'The canonical content hash this result was computed from. Compared against public.jobs.content_hash to decide whether the posting has changed since; it is the revision marker `job_updated_at` was mistakenly used as.';

-- `job_updated_at` is deliberately kept: it is a true record of when the posting
-- row was last written, other read paths and migrations reference it, and
-- removing a column is not what this change is about. It is simply no longer
-- consulted when deciding what to recompute.

-- ---------------------------------------------------------------------------
-- Index for the eligibility query
-- ---------------------------------------------------------------------------
--
-- The worker runs this on the candidate path: `public.jobs` filtered to
-- `status = 'active'`, left-joined to one profile's stored results, and filtered
-- on the revision comparison. `job_matches_unique` is
-- `(user_id, job_id, career_profile_id)`, which cannot answer that join:
-- `career_profile_id` is its third column, so a lookup by `job_id` alone cannot
-- use it as a search key. `job_matches_job_idx (job_id)` can answer the join but
-- carries none of the columns the eligibility filter reads, so every candidate
-- reached through it costs a heap fetch.
--
-- This index is ordered by `(career_profile_id, job_id)` — the join's two
-- columns, in the order the join needs them — and carries the three version
-- columns as payload in `include`, so the filter can be answered from the index
-- instead of from the heap. The `where job_content_hash is not null` predicate
-- keeps it to rows that can participate in the comparison at all; a row with no
-- recorded revision is eligible by the "no stored result" branch and is found
-- through the join key regardless.
--
-- What was actually measured, so the claim is not wider than the evidence: at
-- 4,000 active postings the planner still chooses a sequential scan of
-- `job_matches` and a hash join, with and without this index, and the two plans
-- are within noise of each other (8.2ms vs 8.1ms; ~1,500 shared buffers either
-- way). At that size the whole join fits in memory and an index is not the
-- cheaper path, which is why this is a supporting index rather than a fix. It
-- exists for the shape the production table has and the local one does not:
-- many matches per profile, where the filter's selectivity is high and the
-- index-only path avoids a heap fetch per scored posting. `explain` on a
-- deployment-sized table is the way to confirm it is being chosen there.

create index job_matches_revision_idx
  on public.job_matches (career_profile_id, job_id)
  include (job_content_hash, profile_version, model_version)
  where job_content_hash is not null;

-- ---------------------------------------------------------------------------
-- The candidate read
-- ---------------------------------------------------------------------------
--
-- Forward-only: the previous signature and both of its bodies are left exactly
-- as they were written, and the three-argument function is dropped below so that
-- every call site must state which engine version it is asking for. A version
-- that the database remembers instead of the caller is a version that goes stale
-- silently the first time an engine is deployed without a migration.

create or replace function public.matching_job_candidates(
  actor_user_id uuid,
  target_career_profile_id uuid,
  batch_size integer default 60,
  requested_model_version text default null
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
  perform app_private.require_active_actor(actor_user_id);
  profile := app_private.require_career_profile_owner(actor_user_id, target_career_profile_id);

  if batch_size < 1 or batch_size > 200 then
    raise exception 'batch_size must be between 1 and 200' using errcode = '22023';
  end if;

  if requested_model_version is not null
     and pg_catalog.char_length(requested_model_version) not between 1 and 60 then
    raise exception 'requested_model_version must be between 1 and 60 characters'
      using errcode = '22023';
  end if;

  return pg_catalog.jsonb_build_object(
    'items', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', entry.id,
          'title', entry.title,
          'companyName', entry.company_name,
          'description', entry.description,
          'employmentType', entry.employment_type,
          'seniority', entry.seniority,
          'remoteState', entry.remote_state,
          'locationRaw', entry.location_raw,
          'city', entry.city,
          'region', entry.region,
          'countryCode', entry.country_code,
          'isPhilippines', entry.is_philippines,
          'salaryMinMinor', entry.salary_min_minor,
          'salaryMaxMinor', entry.salary_max_minor,
          'salaryCurrency', entry.salary_currency,
          'salaryPeriod', entry.salary_period,
          'skills', pg_catalog.to_jsonb(entry.skills),
          'requirements', pg_catalog.to_jsonb(entry.requirements),
          'preferredQualifications', pg_catalog.to_jsonb(entry.preferred_qualifications),
          'experienceYearsMin', entry.experience_years_min,
          'experienceYearsMax', entry.experience_years_max,
          'postedAt', entry.posted_at,
          'lastSeenAt', entry.last_seen_at,
          'status', entry.status,
          -- Why this posting is in the set. The worker logs it, so a burst of
          -- reprocessing can be attributed to a cause rather than guessed at.
          -- `retry` is deliberately absent: the database holds no record of a
          -- scoring attempt that failed, so a failed attempt is indistinguishable
          -- from a first attempt here and only the worker can tell them apart.
          'eligibleReason', entry.eligible_reason
        )
        order by coalesce(entry.posted_at, entry.first_seen_at) desc, entry.id
      )
      from (
        select
          jobs.id,
          jobs.title,
          company.display_name as company_name,
          jobs.description,
          jobs.employment_type,
          jobs.seniority,
          jobs.remote_state,
          jobs.location_raw,
          jobs.city,
          jobs.region,
          jobs.country_code,
          jobs.is_philippines,
          jobs.salary_min_minor,
          jobs.salary_max_minor,
          jobs.salary_currency,
          jobs.salary_period,
          jobs.skills,
          jobs.requirements,
          jobs.preferred_qualifications,
          jobs.experience_years_min,
          jobs.experience_years_max,
          jobs.posted_at,
          jobs.last_seen_at,
          jobs.first_seen_at,
          jobs.status,
          -- Most specific cause first. A new posting is `new_job` even though its
          -- hash and version also "differ": there was nothing to differ from.
          case
            when existing.id is null then 'new_job'
            when existing.job_content_hash is distinct from jobs.content_hash
              then 'content_changed'
            when existing.profile_version <> profile.version then 'profile_changed'
            else 'matching_version_changed'
          end as eligible_reason
        from public.jobs as jobs
        join public.companies as company on company.id = jobs.company_id
        left join public.job_matches as existing
          on existing.job_id = jobs.id
         and existing.career_profile_id = profile.id
        where jobs.status = 'active'
          and not exists (
            select 1 from public.job_feedback as feedback
            where feedback.user_id = actor_user_id
              and feedback.job_id = jobs.id
              and feedback.active
              and feedback.feedback not in ('interested', 'saved')
          )
          and (
            existing.id is null
            or existing.job_content_hash is distinct from jobs.content_hash
            or existing.profile_version <> profile.version
            or existing.model_version is distinct from requested_model_version
          )
        order by coalesce(jobs.posted_at, jobs.first_seen_at) desc
        limit batch_size
      ) as entry
    ), '[]'::jsonb),
    'careerProfileId', profile.id,
    'profileVersion', profile.version,
    'modelVersion', requested_model_version
  );
end;
$$;

comment on function public.matching_job_candidates(uuid, uuid, integer, text) is
  'Bounded candidate set for scoring. Dismissed opportunities are excluded and an already-scored job is revisited only when its canonical content hash, the profile version, or the caller-supplied matching engine version differs from what the stored result recorded. Each item carries the eligibleReason the worker logs.';

drop function public.matching_job_candidates(uuid, uuid, integer);

revoke all on function public.matching_job_candidates(uuid, uuid, integer, text)
  from public, anon, authenticated;
grant execute on function public.matching_job_candidates(uuid, uuid, integer, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- Diagnostics
-- ---------------------------------------------------------------------------
--
-- The same eligibility predicate, exposed as a query an operator can run by hand
-- when a reprocessing burst needs to be explained. It is a query shape rather
-- than a function because it is for a human at a psql prompt, not a caller:
--
--   select jobs.id, jobs.title, matches.id is null as never_scored,
--          matches.job_content_hash is distinct from jobs.content_hash as content_changed,
--          matches.profile_version <> profiles.version as profile_changed,
--          matches.model_version is distinct from 'matching-v1' as version_changed
--   from public.jobs as jobs
--   left join public.job_matches as matches
--     on matches.job_id = jobs.id and matches.career_profile_id = :profile_id
--   join public.career_profiles as profiles on profiles.id = :profile_id
--   where jobs.status = 'active';
