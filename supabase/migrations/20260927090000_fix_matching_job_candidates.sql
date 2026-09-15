-- Fix: public.matching_job_candidates() could not execute at all.
--
-- The function introduced by 20260917090000_match_computation_support.sql
-- ordered its aggregate by `coalesce(entry.posted_at, entry.first_seen_at)`,
-- but the subquery it aliases as `entry` selected `jobs.posted_at` and
-- `jobs.last_seen_at` and never `jobs.first_seen_at`. PostgreSQL therefore
-- raised `42703: column entry.first_seen_at does not exist` on every call.
--
-- The consequence was not a degraded ranking, it was no ranking: the matching
-- worker reads its candidate set through this function, so match computation
-- could never store a single row. The Career Radar stayed permanently "not
-- analysed", `profilesScored` stayed at zero, and every surface that reads a
-- stored match result — the opportunity explanation, alerts, the digest,
-- insights — had nothing to read.
--
-- Nothing caught it because nothing executed it. No pgTAP file called this
-- function, no API route reaches it, and its only caller in the repository is
-- the worker's match computation cycle, which the end-to-end suite did not run.
-- `supabase/tests/database/200_matching_candidates.test.sql` now executes it,
-- including the branch that made the aggregate unsatisfiable.
--
-- This migration is forward-only: the original file is left exactly as it was
-- written. The replacement below is otherwise identical to it — same signature,
-- same authorization, same filters, same output shape — and the only change to
-- the body is that the inner select also produces `jobs.first_seen_at`, so the
-- ordering expression has a column to read.

create or replace function public.matching_job_candidates(
  actor_user_id uuid,
  target_career_profile_id uuid,
  batch_size integer default 60
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
          'status', entry.status
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
          jobs.status
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
            or existing.profile_version <> profile.version
            or existing.job_updated_at < jobs.updated_at
          )
        order by coalesce(jobs.posted_at, jobs.first_seen_at) desc
        limit batch_size
      ) as entry
    ), '[]'::jsonb),
    'careerProfileId', profile.id,
    'profileVersion', profile.version
  );
end;
$$;

comment on function public.matching_job_candidates(uuid, uuid, integer) is
  'Bounded candidate set for scoring. Dismissed opportunities are excluded and already-scored jobs are only revisited when the profile or the posting changed.';

revoke all on function public.matching_job_candidates(uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.matching_job_candidates(uuid, uuid, integer) to service_role;
