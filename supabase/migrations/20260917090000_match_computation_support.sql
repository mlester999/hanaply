-- Hanaply match computation support: bounded, service-only read models that let
-- the worker build explainable match results without N+1 queries.
--
-- Both functions are deliberately bounded. Match computation is shared and
-- periodic, so it must never scan the whole job table or the whole user base in
-- one pass: the worker asks for a batch, scores it, stores the results, and asks
-- again on the next cycle. Priority processing simply means a subject is
-- returned earlier, never that a provider is called more often.

create or replace function public.matching_subjects(
  batch_size integer default 25,
  stale_after_hours integer default 12
)
returns table (
  user_id uuid,
  career_profile_id uuid,
  plan_code text,
  priority integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app_private.require_service_role();

  if batch_size < 1 or batch_size > 200 then
    raise exception 'batch_size must be between 1 and 200' using errcode = '22023';
  end if;
  if stale_after_hours < 1 or stale_after_hours > 720 then
    raise exception 'stale_after_hours must be between 1 and 720' using errcode = '22023';
  end if;

  return query
  with subscribed as (
    select
      subscription.user_id,
      subscription.plan_id,
      plan.code as plan_code,
      -- Priority processing is an entitlement; it reorders the work queue and
      -- nothing else.
      coalesce(
        (select (entitlement.value #>> '{}') = 'true'
         from public.plan_entitlements as entitlement
         where entitlement.plan_id = subscription.plan_id
           and entitlement.entitlement_key = 'priorityProcessing'),
        false
      ) as priority
    from public.subscriptions as subscription
    join public.plans as plan on plan.id = subscription.plan_id
    where subscription.status = 'active'
      and subscription.starts_at <= now()
      and (subscription.ends_at is null or subscription.ends_at > now())
  )
  select
    profile.user_id,
    profile.id as career_profile_id,
    subscribed.plan_code,
    case when subscribed.priority then 0 else 1 end as priority
  from public.career_profiles as profile
  join public.profiles as account on account.id = profile.user_id
  join subscribed on subscribed.user_id = profile.user_id
  where profile.status <> 'archived'
    and account.account_status = 'active'
    and not exists (
      select 1
      from public.job_matches as existing
      where existing.career_profile_id = profile.id
        and existing.computed_at
            > now() - pg_catalog.make_interval(hours => stale_after_hours)
    )
  order by
    case when subscribed.priority then 0 else 1 end,
    profile.is_primary desc,
    profile.updated_at asc
  limit batch_size;
end;
$$;

comment on function public.matching_subjects(integer, integer) is
  'Batched work queue for match computation. A profile is returned only when it has no match result newer than the staleness window, so repeated cycles do not recompute the same work.';

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

revoke all on function public.matching_subjects(integer, integer)
  from public, anon, authenticated;
revoke all on function public.matching_job_candidates(uuid, uuid, integer)
  from public, anon, authenticated;

grant execute on function public.matching_subjects(integer, integer) to service_role;
grant execute on function public.matching_job_candidates(uuid, uuid, integer) to service_role;
