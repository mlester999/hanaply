-- Hanaply Career Radar: the ranked opportunity feed and the intelligence-first
-- job detail read model.
--
-- Both functions are server-side and paginated. The browser never receives the
-- job table: filtering, ordering, and counting all happen in PostgreSQL against
-- normalized columns and the indexes created with the ingestion schema.
--
-- Ranking reads the cached public.job_matches rows. A job with no match result
-- yet is still returned, but it sorts after every scored job so the interface
-- can say "not analysed yet" instead of implying a score it does not have.

create or replace function app_private.job_match_summary(match public.job_matches)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when match.id is null then null
    else pg_catalog.jsonb_build_object(
      'jobId', match.job_id,
      'score', match.score,
      'verdict', match.verdict,
      'confidence', match.confidence,
      'modelVersion', match.model_version,
      'recommendedAction', match.recommended_action,
      'strengths', match.strengths,
      'gaps', match.gaps,
      'blockers', match.blockers,
      'computedAt', match.computed_at
    )
  end;
$$;

/**
 * The ranked feed.
 *
 * Supported filter keys (all optional):
 *   careerProfileId, search, minScore, verdicts[], remoteStates[],
 *   employmentTypes[], seniorities[], countryCode, philippinesOnly,
 *   internationalOnly, postedWithinDays, salaryMinMinor, companyId, savedOnly,
 *   dismissedOnly, includeDismissed, sort, page, pageSize.
 *
 * Sorting is 'best_match' (default), 'newest', 'salary', or 'company'.
 */
create or replace function public.job_radar(
  actor_user_id uuid,
  filters jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  payload jsonb := coalesce(filters, '{}'::jsonb);
  target_profile uuid;
  search_term text;
  minimum_score integer;
  page_number integer;
  page_size integer;
  sort_key text;
  posted_within integer;
  salary_floor integer;
  target_company uuid;
  saved_only boolean;
  dismissed_only boolean;
  include_dismissed boolean;
  philippines_only boolean;
  international_only boolean;
  country_filter text;
  verdict_filter text[];
  remote_filter text[];
  employment_filter text[];
  seniority_filter text[];
  result jsonb;
begin
  perform app_private.require_active_actor(actor_user_id);

  target_profile := nullif(app_private.career_text(payload, 'careerProfileId', 40, false), '')::uuid;
  if target_profile is null then
    select candidate.id into target_profile
    from public.career_profiles as candidate
    where candidate.user_id = actor_user_id and candidate.status <> 'archived'
    order by candidate.is_primary desc, candidate.created_at
    limit 1;
  else
    perform app_private.require_career_profile_owner(actor_user_id, target_profile);
  end if;

  search_term := app_private.career_text(payload, 'search', 120, false);
  minimum_score := app_private.career_integer(payload, 'minScore', 0, 100);
  page_number := coalesce(app_private.career_integer(payload, 'page', 1, 10000), 1);
  page_size := coalesce(app_private.career_integer(payload, 'pageSize', 1, 50), 20);
  posted_within := app_private.career_integer(payload, 'postedWithinDays', 1, 3650);
  salary_floor := app_private.career_integer(payload, 'salaryMinMinor', 1, 2000000000);
  target_company := nullif(app_private.career_text(payload, 'companyId', 40, false), '')::uuid;
  country_filter := app_private.career_text(payload, 'countryCode', 2, false);
  saved_only := coalesce(app_private.career_boolean(payload, 'savedOnly', false), false);
  dismissed_only := coalesce(app_private.career_boolean(payload, 'dismissedOnly', false), false);
  include_dismissed := coalesce(app_private.career_boolean(payload, 'includeDismissed', false), false);
  philippines_only := coalesce(app_private.career_boolean(payload, 'philippinesOnly', false), false);
  international_only := coalesce(
    app_private.career_boolean(payload, 'internationalOnly', false), false
  );

  sort_key := coalesce(app_private.career_enum(
    payload, 'sort', array['best_match', 'newest', 'salary', 'company'], false
  ), 'best_match');

  verdict_filter := case
    when pg_catalog.jsonb_typeof(payload -> 'verdicts') = 'array' then
      array(select pg_catalog.jsonb_array_elements_text(payload -> 'verdicts'))
    else null
  end;
  remote_filter := case
    when pg_catalog.jsonb_typeof(payload -> 'remoteStates') = 'array' then
      array(select pg_catalog.jsonb_array_elements_text(payload -> 'remoteStates'))
    else null
  end;
  employment_filter := case
    when pg_catalog.jsonb_typeof(payload -> 'employmentTypes') = 'array' then
      array(select pg_catalog.jsonb_array_elements_text(payload -> 'employmentTypes'))
    else null
  end;
  seniority_filter := case
    when pg_catalog.jsonb_typeof(payload -> 'seniorities') = 'array' then
      array(select pg_catalog.jsonb_array_elements_text(payload -> 'seniorities'))
    else null
  end;

  with candidate as (
    select
      jobs.id,
      jobs.title,
      jobs.employment_type,
      jobs.seniority,
      jobs.remote_state,
      jobs.location_raw,
      jobs.city,
      jobs.region,
      jobs.country_code,
      jobs.is_philippines,
      jobs.is_international,
      jobs.salary_min_minor,
      jobs.salary_max_minor,
      jobs.salary_currency,
      jobs.salary_period,
      jobs.salary_is_estimate,
      jobs.skills,
      jobs.posted_at,
      jobs.first_seen_at,
      jobs.last_seen_at,
      jobs.last_verified_at,
      jobs.source_count,
      jobs.status,
      jobs.description_excerpt,
      jobs.company_id,
      company.display_name as company_name,
      matches.id as match_id,
      matches.score,
      matches.verdict,
      matches.confidence,
      matches.model_version,
      matches.recommended_action,
      matches.strengths,
      matches.gaps,
      matches.blockers,
      matches.computed_at,
      saved.id as saved_id,
      saved.saved_at,
      feedback.feedback as active_feedback,
      matches.score is null as unscored
    from public.jobs as jobs
    join public.companies as company on company.id = jobs.company_id
    left join public.job_matches as matches
      on matches.job_id = jobs.id
     and matches.user_id = actor_user_id
     and (target_profile is null or matches.career_profile_id = target_profile)
    left join public.saved_jobs as saved
      on saved.job_id = jobs.id
     and saved.user_id = actor_user_id
    left join public.job_feedback as feedback
      on feedback.job_id = jobs.id
     and feedback.user_id = actor_user_id
     and feedback.active
    where jobs.status = 'active'
      and (target_company is null or jobs.company_id = target_company)
      and (country_filter is null or jobs.country_code = country_filter)
      and (not philippines_only or jobs.is_philippines)
      and (not international_only or jobs.is_international or not jobs.is_philippines)
      and (
        posted_within is null
        or coalesce(jobs.posted_at, jobs.first_seen_at)
           >= now() - pg_catalog.make_interval(days => posted_within)
      )
      and (
        salary_floor is null
        or coalesce(jobs.salary_max_minor, jobs.salary_min_minor) >= salary_floor
      )
      and (minimum_score is null or matches.score >= minimum_score)
      and (verdict_filter is null or matches.verdict::text = any (verdict_filter))
      and (remote_filter is null or jobs.remote_state::text = any (remote_filter))
      and (employment_filter is null or jobs.employment_type::text = any (employment_filter))
      and (seniority_filter is null or jobs.seniority::text = any (seniority_filter))
      and (not saved_only or saved.id is not null)
      and (
        case
          -- "show me what I dismissed" must require a negative signal, not
          -- merely stop filtering it out.
          when dismissed_only then
            feedback.feedback is not null
            and feedback.feedback not in ('interested', 'saved')
          when include_dismissed then true
          else feedback.feedback is null or feedback.feedback in ('interested', 'saved')
        end
      )
      and (
        search_term is null
        or jobs.title ilike '%' || search_term || '%'
        or company.display_name ilike '%' || search_term || '%'
        or exists (
          select 1 from pg_catalog.unnest(jobs.skills) as skill
          where skill ilike '%' || search_term || '%'
        )
      )
  ),
  ranked as (
    select
      candidate.*,
      row_number() over (
        order by
          case when sort_key = 'best_match' then candidate.unscored end asc,
          case when sort_key = 'best_match' then candidate.score end desc nulls last,
          case when sort_key = 'newest'
            then coalesce(candidate.posted_at, candidate.first_seen_at) end desc,
          case when sort_key = 'salary'
            then coalesce(candidate.salary_max_minor, candidate.salary_min_minor) end desc nulls last,
          case when sort_key = 'company' then candidate.company_name end asc,
          coalesce(candidate.score, 0) desc,
          coalesce(candidate.posted_at, candidate.first_seen_at) desc,
          candidate.id
      ) as position
    from candidate
  ),
  page as (
    select * from ranked
    where position > (page_number - 1) * page_size
      and position <= page_number * page_size
  ),
  totals as (
    select pg_catalog.count(*)::bigint as total_rows from candidate
  )
  select pg_catalog.jsonb_build_object(
    'items', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', page.id,
          'title', page.title,
          'companyId', page.company_id,
          'companyName', page.company_name,
          'employmentType', page.employment_type,
          'seniority', page.seniority,
          'remoteState', page.remote_state,
          'locationRaw', page.location_raw,
          'city', page.city,
          'region', page.region,
          'countryCode', page.country_code,
          'isPhilippines', page.is_philippines,
          'isInternational', page.is_international,
          'salaryMinMinor', page.salary_min_minor,
          'salaryMaxMinor', page.salary_max_minor,
          'salaryCurrency', page.salary_currency,
          'salaryPeriod', page.salary_period,
          'salaryIsEstimate', page.salary_is_estimate,
          'skills', pg_catalog.to_jsonb(page.skills),
          'postedAt', page.posted_at,
          'firstSeenAt', page.first_seen_at,
          'lastSeenAt', page.last_seen_at,
          'lastVerifiedAt', page.last_verified_at,
          'sourceCount', page.source_count,
          'status', page.status,
          'excerpt', page.description_excerpt,
          'savedAt', page.saved_at,
          'feedback', page.active_feedback,
          'match', case
            when page.match_id is null then null
            else pg_catalog.jsonb_build_object(
              'jobId', page.id,
              'score', page.score,
              'verdict', page.verdict,
              'confidence', page.confidence,
              'modelVersion', page.model_version,
              'recommendedAction', page.recommended_action,
              'strengths', page.strengths,
              'gaps', page.gaps,
              'blockers', page.blockers,
              'computedAt', page.computed_at
            )
          end
        )
        order by page.position
      )
      from page
    ), '[]'::jsonb),
    'pagination', pg_catalog.jsonb_build_object(
      'page', page_number,
      'pageSize', page_size,
      'total', (select total_rows from totals),
      'totalPages', case
        when (select total_rows from totals) = 0 then 0
        else pg_catalog.ceil((select total_rows from totals)::numeric / page_size)::integer
      end
    ),
    'careerProfileId', target_profile,
    'evaluatedAt', now()
  ) into result
  from totals;

  return result;
end;
$$;

/**
 * Intelligence-first job detail: the posting, its provenance, the caller's
 * relationship to it, and the full explainable match result.
 */
create or replace function public.job_detail(
  actor_user_id uuid,
  target_job_id uuid,
  target_career_profile_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_job public.jobs;
  matched public.job_matches;
  profile_id uuid;
begin
  perform app_private.require_active_actor(actor_user_id);

  select * into target_job from public.jobs where id = target_job_id;
  if target_job.id is null then
    raise exception 'job does not exist' using errcode = 'P0002';
  end if;

  if target_career_profile_id is not null then
    perform app_private.require_career_profile_owner(actor_user_id, target_career_profile_id);
    profile_id := target_career_profile_id;
  else
    select candidate.id into profile_id
    from public.career_profiles as candidate
    where candidate.user_id = actor_user_id and candidate.status <> 'archived'
    order by candidate.is_primary desc, candidate.created_at
    limit 1;
  end if;

  if profile_id is not null then
    select * into matched
    from public.job_matches
    where user_id = actor_user_id
      and job_id = target_job.id
      and career_profile_id = profile_id;
  end if;

  return app_private.job_card_snapshot(target_job) || pg_catalog.jsonb_build_object(
    'description', target_job.description,
    'requirements', pg_catalog.to_jsonb(target_job.requirements),
    'preferredQualifications', pg_catalog.to_jsonb(target_job.preferred_qualifications),
    'experienceYearsMin', target_job.experience_years_min,
    'experienceYearsMax', target_job.experience_years_max,
    'applyUrl', target_job.apply_url,
    'canonicalUrl', target_job.canonical_url,
    'careerProfileId', profile_id,
    'savedAt', (
      select saved.saved_at from public.saved_jobs as saved
      where saved.user_id = actor_user_id and saved.job_id = target_job.id
    ),
    'feedback', (
      select feedback.feedback from public.job_feedback as feedback
      where feedback.user_id = actor_user_id
        and feedback.job_id = target_job.id
        and feedback.active
    ),
    'match', app_private.job_match_summary(matched),
    'sources', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'sourceCode', source.code,
          'displayName', source.display_name,
          'attribution', source.attribution,
          'sourceUrl', record.source_url,
          'isPrimary', record.is_primary,
          'firstSeenAt', record.first_seen_at,
          'lastSeenAt', record.last_seen_at,
          'status', record.status
        )
        order by record.is_primary desc, source.code
      )
      from public.job_source_records as record
      join public.job_sources as source on source.id = record.source_id
      where record.job_id = target_job.id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function app_private.job_match_summary(public.job_matches)
  from public, anon, authenticated;
revoke all on function public.job_radar(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.job_detail(uuid, uuid, uuid) from public, anon, authenticated;

grant execute on function public.job_radar(uuid, jsonb) to service_role;
grant execute on function public.job_detail(uuid, uuid, uuid) to service_role;
