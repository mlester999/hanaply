-- Hanaply career insights and deterministic coaching.
--
-- Everything here is computed from data the subscriber already produced: their
-- career profile, their confirmed facts, the opportunities they were matched
-- against, and their own tracker. There is no model in this path, and that is
-- deliberate. A weekly strategy summary that is arithmetic over real numbers is
-- more useful, cheaper, and more trustworthy than generated prose, and nothing
-- in it can be invented.
--
-- Two rules shape the output:
--
--   1. A rate with a zero denominator is null, never zero. Reporting "0%
--      response rate" to someone who has not applied anywhere yet is a false
--      statement, and it is the kind of false statement that changes behaviour.
--   2. Every coaching suggestion carries the number that produced it. If the
--      subscriber cannot see why the product is telling them something, they
--      cannot judge whether it is true.

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

/**
 * Builds one coaching suggestion. The `evidence` field is required so a
 * suggestion cannot be emitted without the count that justifies it.
 */
create or replace function app_private.coach_suggestion(
  suggestion_key text,
  suggestion_title text,
  suggestion_detail text,
  suggestion_action text,
  suggestion_priority integer,
  suggestion_evidence jsonb
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'key', suggestion_key,
    'title', suggestion_title,
    'detail', suggestion_detail,
    'action', suggestion_action,
    'priority', suggestion_priority,
    'evidence', suggestion_evidence
  );
$$;

/**
 * Returns a ratio as a rounded percentage, or null when the denominator is zero.
 * A null here means "not enough information", which is different from "zero".
 */
create or replace function app_private.safe_rate(numerator bigint, denominator bigint)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when denominator is null or denominator = 0 then null
    else pg_catalog.round((numerator::numeric / denominator::numeric) * 100, 1)
  end;
$$;

/** Resolves the profile a request applies to, defaulting to the primary one. */
create or replace function app_private.resolve_insight_profile(
  actor_user_id uuid,
  requested_profile_id uuid
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  resolved uuid;
begin
  if requested_profile_id is not null then
    perform app_private.require_career_profile_owner(actor_user_id, requested_profile_id);
    return requested_profile_id;
  end if;

  select profile.id into resolved
  from public.career_profiles as profile
  where profile.user_id = actor_user_id
    and profile.status <> 'archived'
  order by profile.is_primary desc, profile.created_at
  limit 1;

  return resolved;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profile strength
-- ---------------------------------------------------------------------------

/**
 * Lists the profile fields that measurably change match quality, in the order
 * they matter, and whether the subscriber has supplied each one. A blank field
 * is reported as missing rather than as an empty value.
 */
create or replace function app_private.profile_strength(profile public.career_profiles)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'completenessPercent', profile.completeness_percent,
    'fields', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'field', 'targetRoleTitles',
        'label', 'Target role titles',
        'present', pg_catalog.cardinality(profile.target_role_titles) > 0,
        'impact', 'Role alignment is the heaviest dimension in the score. Without a target role the engine can only fall back on your current title.'
      ),
      pg_catalog.jsonb_build_object(
        'field', 'careerLevel',
        'label', 'Career level',
        'present', profile.career_level is not null,
        'impact', 'Seniority alignment compares this against the posting. Without it, mid-level roles and principal roles score the same.'
      ),
      pg_catalog.jsonb_build_object(
        'field', 'yearsExperience',
        'label', 'Years of experience',
        'present', profile.years_experience is not null,
        'impact', 'Experience alignment is reported as unknown rather than assumed, which lowers confidence on every result.'
      ),
      pg_catalog.jsonb_build_object(
        'field', 'preferredWorkArrangement',
        'label', 'Preferred work arrangement',
        'present', profile.preferred_work_arrangement is not null,
        'impact', 'This is how on-site roles in another country are excluded instead of being recommended.'
      ),
      pg_catalog.jsonb_build_object(
        'field', 'preferredLocations',
        'label', 'Preferred locations',
        'present', pg_catalog.cardinality(profile.preferred_locations) > 0,
        'impact', 'Location alignment cannot be scored without it.'
      ),
      pg_catalog.jsonb_build_object(
        'field', 'salaryExpectationMinMinor',
        'label', 'Salary expectation',
        'present', profile.salary_expectation_min_minor is not null,
        'impact', 'Compensation alignment stays unknown, so a role that pays below your floor is not flagged.'
      ),
      pg_catalog.jsonb_build_object(
        'field', 'excludedRoleTitles',
        'label', 'Roles you do not want',
        'present', pg_catalog.cardinality(profile.excluded_role_titles) > 0,
        'impact', 'Excluded titles become hard blockers. Without them those roles still reach your radar.'
      ),
      pg_catalog.jsonb_build_object(
        'field', 'summary',
        'label', 'Professional summary',
        'present', profile.summary is not null and pg_catalog.char_length(profile.summary) >= 80,
        'impact', 'A summary of at least 80 characters gives the requirement mapping something to match against.'
      )
    )
  );
$$;

-- ---------------------------------------------------------------------------
-- Career insights
-- ---------------------------------------------------------------------------

/**
 * The full insight payload: profile strength, matching activity, pipeline
 * funnel, skill gaps, salary observations, direction analysis, and ranked
 * coaching suggestions.
 */
create or replace function public.career_insights(
  actor_user_id uuid,
  requested_career_profile_id uuid default null,
  window_weeks integer default 8
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  profile_id uuid;
  profile public.career_profiles;
  since timestamptz;
  matched_count bigint;
  strong_count bigint;
  saved_count bigint;
  applied_count bigint;
  interviewing_count bigint;
  offer_count bigint;
  rejected_count bigint;
  confirmed_fact_count bigint;
  suggestions jsonb := '[]'::jsonb;
  strength jsonb;
  insights jsonb;
  missing_required integer;
begin
  perform app_private.require_active_actor(actor_user_id);

  if window_weeks < 1 or window_weeks > 52 then
    raise exception 'window_weeks must be between 1 and 52' using errcode = '22023';
  end if;

  profile_id := app_private.resolve_insight_profile(actor_user_id, requested_career_profile_id);
  if profile_id is null then
    return pg_catalog.jsonb_build_object(
      'hasProfile', false,
      'profileStrength', null,
      'matching', null,
      'pipeline', null,
      'gaps', '[]'::jsonb,
      'salary', null,
      'directions', '[]'::jsonb,
      'activity', '[]'::jsonb,
      'coaching', pg_catalog.jsonb_build_array(
        app_private.coach_suggestion(
          'create_profile',
          'Create your Career Profile',
          'Nothing can be ranked until Hanaply knows what you are looking for. Every match score depends on this.',
          'Open the Career Profile and complete the first step.',
          1,
          pg_catalog.jsonb_build_object('profileCount', 0)
        )
      )
    );
  end if;

  select * into profile from public.career_profiles where id = profile_id;
  since := now() - pg_catalog.make_interval(weeks => window_weeks);

  strength := app_private.profile_strength(profile);

  select pg_catalog.count(*) into confirmed_fact_count
  from public.career_facts as fact
  where fact.career_profile_id = profile_id and fact.status = 'confirmed';

  select
    pg_catalog.count(*),
    pg_catalog.count(*) filter (where matches.verdict = 'strong_match')
  into matched_count, strong_count
  from public.job_matches as matches
  where matches.career_profile_id = profile_id
    and matches.computed_at >= since;

  select pg_catalog.count(*) into saved_count
  from public.saved_jobs where user_id = actor_user_id;

  select
    pg_catalog.count(*) filter (where application.applied_at is not null),
    pg_catalog.count(*) filter (where application.stage in ('interviewing', 'offer')),
    pg_catalog.count(*) filter (where application.stage = 'offer'),
    pg_catalog.count(*) filter (where application.stage = 'rejected')
  into applied_count, interviewing_count, offer_count, rejected_count
  from public.job_applications as application
  where application.user_id = actor_user_id;

  -- ---------------------------------------------------------------------
  -- Assemble the measurements
  -- ---------------------------------------------------------------------

  insights := pg_catalog.jsonb_build_object(
    'hasProfile', true,
    'careerProfileId', profile_id,
    'profileName', profile.name,
    'windowWeeks', window_weeks,
    'confirmedFactCount', confirmed_fact_count,
    'profileStrength', strength,
    'matching', pg_catalog.jsonb_build_object(
      'opportunitiesMatched', matched_count,
      'strongMatches', strong_count,
      'strongMatchRate', app_private.safe_rate(strong_count, matched_count)
    ),
    'pipeline', pg_catalog.jsonb_build_object(
      'saved', saved_count,
      'applied', applied_count,
      'interviewing', interviewing_count,
      'offers', offer_count,
      'rejected', rejected_count,
      -- Null, not zero, when nothing has been submitted yet.
      'interviewRate', app_private.safe_rate(interviewing_count + offer_count, applied_count),
      'offerRate', app_private.safe_rate(offer_count, applied_count),
      'rejectionRate', app_private.safe_rate(rejected_count, applied_count)
    ),
    'gaps', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'skill', gap.skill,
          'opportunityCount', gap.opportunity_count
        )
        order by gap.opportunity_count desc, gap.skill
      )
      from (
        select
          pg_catalog.lower(pg_catalog.btrim(entry ->> 'requirement')) as skill,
          pg_catalog.count(distinct matches.job_id) as opportunity_count
        from public.job_matches as matches
        cross join lateral pg_catalog.jsonb_array_elements(
          coalesce(matches.requirement_mapping, '[]'::jsonb)
        ) as entry
        where matches.career_profile_id = profile_id
          and matches.computed_at >= since
          and pg_catalog.jsonb_typeof(entry) = 'object'
          and entry ->> 'status' = 'missing'
          and pg_catalog.char_length(pg_catalog.btrim(coalesce(entry ->> 'requirement', ''))) between 2 and 80
        group by 1
        having pg_catalog.count(distinct matches.job_id) >= 2
        order by 2 desc, 1
        limit 10
      ) as gap
    ), '[]'::jsonb),
    'salary', (
      select pg_catalog.jsonb_build_object(
        'observedMinMinor', pg_catalog.min(observed.min_minor),
        'observedMaxMinor', pg_catalog.max(observed.max_minor),
        'observedCurrency', pg_catalog.max(observed.currency),
        'observedSampleSize', pg_catalog.count(*),
        'expectationMinMinor', profile.salary_expectation_min_minor,
        'expectationMaxMinor', profile.salary_expectation_max_minor,
        'expectationCurrency', profile.salary_currency,
        -- Only compared when the currencies agree; a PHP expectation against a
        -- USD posting is not a comparable number and is not presented as one.
        'belowExpectationCount', case
          when profile.salary_expectation_min_minor is null then null
          else pg_catalog.count(*) filter (
            where observed.currency = profile.salary_currency
              and observed.max_minor is not null
              and observed.max_minor < profile.salary_expectation_min_minor
          )
        end
      )
      from (
        select
          jobs.salary_min_minor as min_minor,
          jobs.salary_max_minor as max_minor,
          jobs.salary_currency as currency
        from public.job_matches as matches
        join public.jobs as jobs on jobs.id = matches.job_id
        where matches.career_profile_id = profile_id
          and matches.computed_at >= since
          and matches.score >= 55
          and jobs.salary_min_minor is not null
      ) as observed
    ),
    'directions', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'title', direction.title,
          'opportunityCount', direction.opportunity_count,
          'averageScore', direction.average_score
        )
        order by direction.opportunity_count desc, direction.title
      )
      from (
        select
          jobs.normalized_title as title,
          pg_catalog.count(*) as opportunity_count,
          pg_catalog.round(pg_catalog.avg(matches.score), 1) as average_score
        from public.job_matches as matches
        join public.jobs as jobs on jobs.id = matches.job_id
        where matches.career_profile_id = profile_id
          and matches.computed_at >= since
          and matches.score >= 55
        group by 1
        order by 2 desc, 1
        limit 8
      ) as direction
    ), '[]'::jsonb),
    'activity', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'weekStart', pg_catalog.to_char(week.week_start, 'YYYY-MM-DD'),
          'opportunitiesMatched', week.matched,
          'applicationsStarted', week.started
        )
        order by week.week_start
      )
      from (
        select
          bucket.week_start,
          (
            select pg_catalog.count(*) from public.job_matches as matches
            where matches.career_profile_id = profile_id
              and matches.computed_at >= bucket.week_start
              and matches.computed_at < bucket.week_start + interval '7 days'
          ) as matched,
          (
            select pg_catalog.count(*) from public.job_applications as application
            where application.user_id = actor_user_id
              and application.created_at >= bucket.week_start
              and application.created_at < bucket.week_start + interval '7 days'
          ) as started
        from (
          select pg_catalog.generate_series(
            pg_catalog.date_trunc('week', since),
            pg_catalog.date_trunc('week', now()),
            interval '7 days'
          ) as week_start
        ) as bucket
      ) as week
    ), '[]'::jsonb),
    'coaching', '[]'::jsonb
  );

  -- ---------------------------------------------------------------------
  -- Coaching, ranked by what would change the outcome most
  -- ---------------------------------------------------------------------

  if confirmed_fact_count < 5 then
    suggestions := suggestions || app_private.coach_suggestion(
      'confirm_facts',
      'Confirm more of your career facts',
      'Only ' || confirmed_fact_count || ' of your career facts are confirmed. Application material may cite confirmed facts only, so a thin ledger limits what can be written truthfully on your behalf.',
      'Open the facts ledger and confirm or correct what was extracted.',
      1,
      pg_catalog.jsonb_build_object('confirmedFactCount', confirmed_fact_count, 'target', 5)
    );
  end if;

  select pg_catalog.count(*)::integer into missing_required
  from pg_catalog.jsonb_array_elements(strength -> 'fields') as field
  where not (field ->> 'present')::boolean;

  if missing_required > 0 then
    suggestions := suggestions || app_private.coach_suggestion(
      'complete_profile',
      'Fill the ' || missing_required || ' profile ' ||
        case when missing_required = 1 then 'field' else 'fields' end || ' that lower your scores',
      'Each missing field is reported as unknown rather than guessed, which lowers confidence on every result. The profile is ' || profile.completeness_percent || '% complete.',
      'Review the profile strength list and fill the highest-impact item first.',
      2,
      pg_catalog.jsonb_build_object(
        'missingFieldCount', missing_required,
        'completenessPercent', profile.completeness_percent,
        'missingFields', (
          select pg_catalog.jsonb_agg(field ->> 'field' order by field ->> 'field')
          from pg_catalog.jsonb_array_elements(strength -> 'fields') as field
          where not (field ->> 'present')::boolean
        )
      )
    );
  end if;

  if applied_count = 0 and saved_count > 0 then
    suggestions := suggestions || app_private.coach_suggestion(
      'start_applying',
      'You have saved ' || saved_count || ' ' ||
        case when saved_count = 1 then 'opportunity' else 'opportunities' end ||
        ' but not started an application',
      'Saving is not applying, and nothing can be learned about your search until something is submitted. The tracker records the stage so the funnel below becomes meaningful.',
      'Open the tracker and move a saved opportunity to preparing.',
      3,
      pg_catalog.jsonb_build_object('savedCount', saved_count, 'appliedCount', applied_count)
    );
  end if;

  if applied_count >= 5 and interviewing_count + offer_count = 0 then
    suggestions := suggestions || app_private.coach_suggestion(
      'review_targeting',
      'None of your ' || applied_count || ' applications reached an interview',
      'At this volume the pattern usually points at targeting or at the material, not at luck. Consider confirming more evidence so applications can lead with your strongest verified work, and check the gaps list for requirements that keep repeating.',
      'Review the repeated gaps and the roles you are applying to.',
      2,
      pg_catalog.jsonb_build_object('appliedCount', applied_count, 'interviews', interviewing_count)
    );
  end if;

  if matched_count > 0 and strong_count = 0 then
    suggestions := suggestions || app_private.coach_suggestion(
      'widen_search',
      'No strong matches among ' || matched_count || ' analysed ' ||
        case when matched_count = 1 then 'opportunity' else 'opportunities' end,
      'Either the target roles are set too narrowly, or the profile is missing the fields the score needs. Both are fixable, and the gaps list shows which requirements keep blocking you.',
      'Check the gaps list, then consider widening your target role titles.',
      3,
      pg_catalog.jsonb_build_object('matchedCount', matched_count, 'strongCount', strong_count)
    );
  end if;

  if pg_catalog.jsonb_array_length(insights -> 'gaps') >= 3 then
    suggestions := suggestions || app_private.coach_suggestion(
      'address_gaps',
      'The same requirements keep blocking you',
      'The gaps list shows requirements you do not meet across multiple opportunities. A requirement that repeats is worth either learning or deliberately targeting around.',
      'Review the gaps list and decide which one is worth closing first.',
      4,
      pg_catalog.jsonb_build_object(
        'repeatedGapCount', pg_catalog.jsonb_array_length(insights -> 'gaps'),
        'topGap', insights -> 'gaps' -> 0
      )
    );
  end if;

  return pg_catalog.jsonb_set(insights, '{coaching}', suggestions);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

-- The insights read model is mediated by the API, which resolves the actor from
-- the access token and passes it explicitly. The helpers stay private.
revoke all on function app_private.coach_suggestion(text, text, text, text, integer, jsonb)
  from public, anon, authenticated;
revoke all on function app_private.safe_rate(bigint, bigint) from public, anon, authenticated;
revoke all on function app_private.resolve_insight_profile(uuid, uuid)
  from public, anon, authenticated;
revoke all on function app_private.profile_strength(public.career_profiles)
  from public, anon, authenticated;
revoke all on function public.career_insights(uuid, uuid, integer)
  from public, anon, authenticated;

grant execute on function public.career_insights(uuid, uuid, integer) to service_role;

comment on function public.career_insights(uuid, uuid, integer) is
  'Deterministic coaching and analytics for one career profile. Every rate is null rather than zero when its denominator is zero, and every suggestion carries the count that produced it.';
