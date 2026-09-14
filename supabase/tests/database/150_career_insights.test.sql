begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

create or replace function pg_temp.operation_fails(statement text)
returns boolean
language plpgsql
as $$
begin
  execute statement;
  return false;
exception when others then
  return true;
end;
$$;

select plan(32);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    'ae000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'insights-new@hanaply.test',
    crypt('InsightsNew1', gen_salt('bf')), now(), '{}',
    '{"display_name":"Insights New"}', now(), now(), false, false
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'ae000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'insights-active@hanaply.test',
    crypt('InsightsActive1', gen_salt('bf')), now(), '{}',
    '{"display_name":"Insights Active"}', now(), now(), false, false
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'ae000000-0000-4000-8000-000000000003',
    'authenticated', 'authenticated', 'insights-none@hanaply.test',
    crypt('InsightsNone1', gen_salt('bf')), now(), '{}',
    '{"display_name":"Insights None"}', now(), now(), false, false
  );

insert into public.subscriptions (user_id, plan_id, status, starts_at, ends_at, source)
select seed.user_id, plans.id, 'active', now() - interval '1 day', now() + interval '30 days',
       'admin_grant'
from (
  values
    ('ae000000-0000-4000-8000-000000000001'::uuid),
    ('ae000000-0000-4000-8000-000000000002'::uuid),
    ('ae000000-0000-4000-8000-000000000003'::uuid)
) as seed (user_id)
cross join public.plans
where plans.code = 'plus_monthly';

insert into public.job_sources (code, display_name, source_kind, base_url, attribution, min_scan_interval_minutes)
values ('insights_fixture', 'Insights Fixture', 'manual', 'https://example.test/insights', 'Synthetic test source.', 60)
on conflict (code) do nothing;

create temporary table insight_ids (key text primary key, value uuid not null);
grant all on table insight_ids to service_role;

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into insight_ids (key, value)
select 'source', id from public.job_sources where code = 'insights_fixture';

insert into insight_ids (key, value)
select 'profile-new', public.create_career_profile(
  'ae000000-0000-4000-8000-000000000001',
  '{
    "name":"New search",
    "headline":"Starting out in data work",
    "summary":"Early-career analyst building reporting and query skills across small operations teams.",
    "currentRoleTitle":"Reporting Assistant",
    "careerLevel":"junior",
    "yearsExperience":1,
    "targetRoleTitles":["Data Analyst"],
    "preferredEmploymentTypes":["full_time"],
    "preferredWorkArrangement":"remote",
    "preferredLocations":["Remote"]
  }'::jsonb,
  gen_random_uuid()
);

insert into insight_ids (key, value)
select 'profile-active', public.create_career_profile(
  'ae000000-0000-4000-8000-000000000002',
  '{
    "name":"Active search",
    "headline":"Automation specialist moving into platform work",
    "summary":"Builds reliable automation between business systems for small operations teams that need dependable reporting without a platform team.",
    "currentRoleTitle":"Automation Specialist",
    "careerLevel":"mid",
    "yearsExperience":4,
    "targetRoleTitles":["Workflow Automation Engineer"],
    "preferredEmploymentTypes":["full_time"],
    "preferredWorkArrangement":"remote",
    "preferredLocations":["Remote"],
    "salaryMinMinor":8000000,
    "salaryMaxMinor":12000000,
    "salaryCurrency":"PHP",
    "salaryPeriod":"monthly"
  }'::jsonb,
  gen_random_uuid()
);

insert into insight_ids (key, value)
select 'job', (public.upsert_ingested_job(
  (select value from insight_ids where key = 'source'),
  pg_catalog.jsonb_build_object(
    'sourceJobId', 'insights-job-1',
    'sourceUrl', 'https://example.test/jobs/insights-1',
    'title', 'Workflow Automation Engineer',
    'companyName', 'Northstar Systems',
    'description', repeat('Automate business workflows for operations teams. ', 10),
    'employmentType', 'full_time',
    'remoteState', 'remote',
    'locationRaw', 'Remote - Philippines',
    'countryCode', 'PH',
    'salaryMinMinor', 5000000,
    'salaryMaxMinor', 6000000,
    'salaryCurrency', 'PHP',
    'salaryPeriod', 'monthly',
    'postedAt', (now() - interval '1 day'),
    'contentFingerprint', repeat('7', 64),
    'payloadChecksum', repeat('8', 64),
    'rawPayload', '{"id":"insights-job-1"}'::jsonb
  ),
  gen_random_uuid()
) ->> 'jobId')::uuid;

-- ---------------------------------------------------------------------------
-- A subscriber with no profile gets one honest suggestion, not empty numbers
-- ---------------------------------------------------------------------------


select is(
  (public.career_insights('ae000000-0000-4000-8000-000000000003') ->> 'hasProfile')::boolean,
  false,
  'a subscriber without a profile is told so rather than shown empty metrics'
);
select is(
  public.career_insights('ae000000-0000-4000-8000-000000000003') -> 'coaching' -> 0 ->> 'key',
  'create_profile',
  'the only suggestion for a subscriber without a profile is to create one'
);
select is(
  public.career_insights('ae000000-0000-4000-8000-000000000003') -> 'matching',
  'null'::jsonb,
  'no match statistics are reported when there is nothing to measure'
);

-- ---------------------------------------------------------------------------
-- Zero denominators are null, never zero
-- ---------------------------------------------------------------------------

select is(
  public.career_insights(
    'ae000000-0000-4000-8000-000000000002',
    (select value from insight_ids where key = 'profile-active')
  ) -> 'pipeline' -> 'interviewRate',
  'null'::jsonb,
  'an interview rate with no applications is unknown, not zero'
);
select is(
  public.career_insights(
    'ae000000-0000-4000-8000-000000000002',
    (select value from insight_ids where key = 'profile-active')
  ) -> 'pipeline' -> 'offerRate',
  'null'::jsonb,
  'an offer rate with no applications is unknown, not zero'
);
select is(
  public.career_insights(
    'ae000000-0000-4000-8000-000000000002',
    (select value from insight_ids where key = 'profile-active')
  ) -> 'matching' -> 'strongMatchRate',
  'null'::jsonb,
  'a strong match rate with nothing analysed is unknown, not zero'
);
select is(
  (public.career_insights(
    'ae000000-0000-4000-8000-000000000002',
    (select value from insight_ids where key = 'profile-active')
  ) -> 'pipeline' ->> 'saved')::integer,
  0,
  'the pipeline reports saved opportunities as a real count'
);
select is(
  (public.career_insights(
    'ae000000-0000-4000-8000-000000000002',
    (select value from insight_ids where key = 'profile-active')
  ) -> 'pipeline' ->> 'applied')::integer,
  0,
  'the pipeline reports submitted applications as a real count'
);

-- ---------------------------------------------------------------------------
-- Profile strength
-- ---------------------------------------------------------------------------

select is(
  public.career_insights(
    'ae000000-0000-4000-8000-000000000001',
    (select value from insight_ids where key = 'profile-new')
  ) -> 'profileStrength' -> 'fields' -> 5 ->> 'field',
  'salaryExpectationMinMinor',
  'profile strength reports the expected fields in impact order'
);
select is(
  public.career_insights(
    'ae000000-0000-4000-8000-000000000001',
    (select value from insight_ids where key = 'profile-new')
  ) -> 'profileStrength' -> 'fields' -> 5 ->> 'present',
  'false',
  'a field the subscriber has not supplied is reported as missing'
);
select is(
  public.career_insights(
    'ae000000-0000-4000-8000-000000000002',
    (select value from insight_ids where key = 'profile-active')
  ) -> 'profileStrength' -> 'fields' -> 0 ->> 'present',
  'true',
  'a field the subscriber has supplied is reported as present'
);
select ok(
  pg_catalog.char_length(
    public.career_insights(
      'ae000000-0000-4000-8000-000000000001',
      (select value from insight_ids where key = 'profile-new')
    ) -> 'profileStrength' -> 'fields' -> 0 ->> 'impact'
  ) > 40,
  'each field explains why its absence lowers match quality'
);

-- ---------------------------------------------------------------------------
-- Matching and pipeline measurement
-- ---------------------------------------------------------------------------

select public.record_job_matches(
  'ae000000-0000-4000-8000-000000000002',
  pg_catalog.jsonb_build_object(
    'careerProfileId', (select value from insight_ids where key = 'profile-active'),
    'items', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'jobId', (select value from insight_ids where key = 'job'),
      'score', 88,
      'verdict', 'strong_match',
      'confidence', 'high',
      'modelVersion', 'matching-v1',
      'recommendedAction', 'Apply now.',
      'requirementMapping', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('requirement', 'Terraform', 'status', 'missing'),
        pg_catalog.jsonb_build_object('requirement', 'TypeScript', 'status', 'met')
      ),
      'dataQuality', '{}'::jsonb
    ))
  ),
  gen_random_uuid()
);

select is(
  (public.career_insights(
    'ae000000-0000-4000-8000-000000000002',
    (select value from insight_ids where key = 'profile-active')
  ) -> 'matching' ->> 'opportunitiesMatched')::integer,
  1,
  'the insight counts the opportunities analysed in the window'
);
select is(
  (public.career_insights(
    'ae000000-0000-4000-8000-000000000002',
    (select value from insight_ids where key = 'profile-active')
  ) -> 'matching' ->> 'strongMatches')::integer,
  1,
  'the insight counts strong matches separately'
);
select is(
  (public.career_insights(
    'ae000000-0000-4000-8000-000000000002',
    (select value from insight_ids where key = 'profile-active')
  ) -> 'matching' -> 'strongMatchRate'),
  '100.0'::jsonb,
  'a strong match rate is computed from real numbers once a denominator exists'
);

-- ---------------------------------------------------------------------------
-- Salary comparison is currency-safe
-- ---------------------------------------------------------------------------

select is(
  (public.career_insights(
    'ae000000-0000-4000-8000-000000000002',
    (select value from insight_ids where key = 'profile-active')
  ) -> 'salary' ->> 'observedSampleSize')::integer,
  1,
  'the salary observation reports how many postings it is based on'
);
select is(
  (public.career_insights(
    'ae000000-0000-4000-8000-000000000002',
    (select value from insight_ids where key = 'profile-active')
  ) -> 'salary' ->> 'belowExpectationCount')::integer,
  1,
  'a posting below the stated expectation is counted'
);
select is(
  public.career_insights(
    'ae000000-0000-4000-8000-000000000001',
    (select value from insight_ids where key = 'profile-new')
  ) -> 'salary' -> 'belowExpectationCount',
  'null'::jsonb,
  'no expectation means no below-expectation count rather than a misleading zero'
);

-- ---------------------------------------------------------------------------
-- Activity is bucketed weekly and spans the window
-- ---------------------------------------------------------------------------

select is(
  pg_catalog.jsonb_array_length(
    public.career_insights(
      'ae000000-0000-4000-8000-000000000002',
      (select value from insight_ids where key = 'profile-active'),
      4
    ) -> 'activity'
  ),
  5,
  'a four-week window reports five weekly buckets including both endpoints'
);
select ok(
  (
    public.career_insights(
      'ae000000-0000-4000-8000-000000000002',
      (select value from insight_ids where key = 'profile-active')
    ) -> 'activity' -> -1 ? 'weekStart'
  ),
  'each activity bucket is labelled with its week'
);

-- ---------------------------------------------------------------------------
-- Coaching is prioritised and every suggestion carries its evidence
-- ---------------------------------------------------------------------------

select ok(
  pg_catalog.jsonb_array_length(
    public.career_insights(
      'ae000000-0000-4000-8000-000000000002',
      (select value from insight_ids where key = 'profile-active')
    ) -> 'coaching'
  ) >= 2,
  'an active subscriber receives more than one suggestion'
);
select ok(
  (
    select pg_catalog.bool_and(suggestion ? 'evidence' and suggestion ? 'action')
    from pg_catalog.jsonb_array_elements(
      public.career_insights(
        'ae000000-0000-4000-8000-000000000002',
        (select value from insight_ids where key = 'profile-active')
      ) -> 'coaching'
    ) as suggestion
  ),
  'every suggestion carries the evidence and the action that justify it'
);
select ok(
  (
    select pg_catalog.bool_and(pg_catalog.jsonb_typeof(suggestion -> 'evidence') = 'object')
    from pg_catalog.jsonb_array_elements(
      public.career_insights(
        'ae000000-0000-4000-8000-000000000002',
        (select value from insight_ids where key = 'profile-active')
      ) -> 'coaching'
    ) as suggestion
  ),
  'the evidence is structured data rather than prose'
);
select is(
  (
    select suggestion ->> 'priority'
    from pg_catalog.jsonb_array_elements(
      public.career_insights(
        'ae000000-0000-4000-8000-000000000002',
        (select value from insight_ids where key = 'profile-active')
      ) -> 'coaching'
    ) as suggestion
    order by (suggestion ->> 'priority')::integer
    limit 1
  ),
  '1',
  'the suggestions are ordered by priority'
);
select is(
  (
    select suggestion ->> 'key'
    from pg_catalog.jsonb_array_elements(
      public.career_insights(
        'ae000000-0000-4000-8000-000000000002',
        (select value from insight_ids where key = 'profile-active')
      ) -> 'coaching'
    ) as suggestion
    where suggestion ->> 'key' = 'address_gaps'
    limit 1
  ),
  null,
  'a single repeated gap does not yet justify a gap suggestion'
);
select ok(
  pg_catalog.jsonb_array_length(
    public.career_insights(
      'ae000000-0000-4000-8000-000000000001',
      (select value from insight_ids where key = 'profile-new')
    ) -> 'coaching'
  ) >= 2,
  'an incomplete profile is told which fields to fill'
);
select ok(
  pg_catalog.jsonb_array_length(
    public.career_insights(
      'ae000000-0000-4000-8000-000000000002',
      (select value from insight_ids where key = 'profile-active')
    ) -> 'coaching'
  ) <= 6,
  'the suggestion list stays short enough to act on'
);

-- ---------------------------------------------------------------------------
-- Authorization
-- ---------------------------------------------------------------------------

select ok(
  pg_temp.operation_fails(
    $statement$select public.career_insights('ae000000-0000-4000-8000-000000000002', (select value from insight_ids where key = 'profile-new'))$statement$
  ),
  'a subscriber cannot read insights for another subscriber profile'
);
select ok(
  pg_temp.operation_fails(
    $statement$select public.career_insights('ae000000-0000-4000-8000-000000000001', null, 100)$statement$
  ),
  'an out-of-range window is rejected'
);
select is(
  (public.career_insights('ae000000-0000-4000-8000-000000000002') ->> 'careerProfileId'),
  (select value from insight_ids where key = 'profile-active')::text,
  'omitting the profile resolves to the primary one'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"ae000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);

select ok(
  pg_temp.operation_fails(
    $statement$select public.career_insights('ae000000-0000-4000-8000-000000000002')$statement$
  ),
  'a client cannot call the insights read model directly'
);
select ok(
  (select count(*)::integer from public.career_profiles
   where user_id <> 'ae000000-0000-4000-8000-000000000002') = 0,
  'a client cannot see another subscriber career profile'
);

select * from finish();
rollback;
