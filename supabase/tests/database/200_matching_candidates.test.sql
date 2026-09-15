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

-- public.matching_job_candidates is the matching worker's candidate read: the
-- worker asks for a bounded batch, scores it with the deterministic engine, and
-- stores the results. It had no test at all, which is why it shipped with an
-- aggregate that ordered by a column its inner select never produced
-- (`entry.first_seen_at`) and raised 42703 on every call. Match computation
-- therefore never stored a single row, and the Career Radar never left its
-- "not analysed yet" state.
--
-- These assertions execute the function rather than describe it: the ordering
-- expression that could not be resolved, the filters that decide what is due,
-- the batch bound, the authorization, and the two ways a posting becomes due
-- again — a changed profile and changed content.
select plan(17);

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
    'c0000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'candidates-a@hanaply.test',
    crypt('CandidatesA1', gen_salt('bf')), now(), '{}',
    '{"display_name":"Candidates A"}', now(), now(), false, false
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'c0000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'candidates-b@hanaply.test',
    crypt('CandidatesB1', gen_salt('bf')), now(), '{}',
    '{"display_name":"Candidates B"}', now(), now(), false, false
  );

insert into public.subscriptions (user_id, plan_id, status, starts_at, ends_at, source)
select seed.user_id, plans.id, 'active', now() - interval '1 day', now() + interval '30 days',
       'admin_grant'
from (
  values ('c0000000-0000-4000-8000-000000000001'::uuid)
) as seed (user_id)
join public.plans on plans.code = 'plus_monthly';

insert into public.job_sources (
  code, display_name, source_kind, base_url, attribution, min_scan_interval_minutes
)
values (
  'candidates_fixture', 'Candidates Fixture', 'manual', 'https://example.test/feed',
  'Synthetic test source.', 60
)
on conflict (code) do nothing;

create temporary table candidate_ids (key text primary key, value uuid not null);
grant all on table candidate_ids to service_role;
create temporary table candidate_text (key text primary key, value text not null);
grant all on table candidate_text to service_role;

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into candidate_ids (key, value)
select 'profile-a', public.create_career_profile(
  'c0000000-0000-4000-8000-000000000001',
  '{
    "name":"Primary search",
    "headline":"Workflow automation specialist",
    "currentRoleTitle":"Automation Specialist",
    "careerLevel":"mid",
    "yearsExperience":3.5,
    "targetRoleTitles":["Workflow Automation Engineer"],
    "preferredEmploymentTypes":["full_time"],
    "preferredWorkArrangement":"remote",
    "preferredLocations":["Remote"],
    "salaryMinMinor":8000000,
    "salaryPeriod":"monthly"
  }'::jsonb,
  gen_random_uuid()
);

insert into candidate_text (key, value)
select 'source', id::text from public.job_sources where code = 'candidates_fixture';

-- The profile identifier is also kept in a session setting: the assertions that
-- run as `authenticated` must not read the temporary table, which that role has
-- no grant on, because a permission error there would prove nothing about the
-- function being tested.
select set_config(
  'hanaply_test.candidate_profile_id',
  (select value::text from candidate_ids where key = 'profile-a'),
  true
);

-- A posting with no published date: its candidate order comes from
-- `first_seen_at`, the column the aggregate could not resolve.
insert into candidate_ids (key, value)
select 'job-undated', (public.upsert_ingested_job(
  (select value::uuid from candidate_text where key = 'source'),
  pg_catalog.jsonb_build_object(
    'sourceJobId', 'undated-1',
    'sourceUrl', 'https://example.test/jobs/undated-1',
    'title', 'Undated Posting',
    'companyName', 'Northstar Systems',
    'description', repeat('Automate business workflows between systems. ', 8),
    'employmentType', 'full_time',
    'seniority', 'mid',
    'remoteState', 'remote',
    'locationRaw', 'Remote — Philippines',
    'countryCode', 'PH',
    'salaryMinMinor', 9000000,
    'salaryCurrency', 'PHP',
    'salaryPeriod', 'monthly',
    'skills', '["n8n"]'::jsonb,
    'requirements', '["Strong n8n experience"]'::jsonb,
    'contentFingerprint', repeat('1', 64),
    'payloadChecksum', repeat('2', 64),
    'rawPayload', '{"id":"undated-1"}'::jsonb
  ),
  gen_random_uuid()
) ->> 'jobId')::uuid;

insert into candidate_ids (key, value)
select 'job-recent', (public.upsert_ingested_job(
  (select value::uuid from candidate_text where key = 'source'),
  pg_catalog.jsonb_build_object(
    'sourceJobId', 'recent-1',
    'sourceUrl', 'https://example.test/jobs/recent-1',
    'title', 'Recent Posting',
    'companyName', 'Northstar Systems',
    'description', repeat('Automate business workflows between systems. ', 8),
    'employmentType', 'full_time',
    'seniority', 'mid',
    'remoteState', 'remote',
    'locationRaw', 'Remote — Philippines',
    'countryCode', 'PH',
    'postedAt', (now() - interval '1 day'),
    'contentFingerprint', repeat('3', 64),
    'payloadChecksum', repeat('4', 64),
    'rawPayload', '{"id":"recent-1"}'::jsonb
  ),
  gen_random_uuid()
) ->> 'jobId')::uuid;

insert into candidate_ids (key, value)
select 'job-scored', (public.upsert_ingested_job(
  (select value::uuid from candidate_text where key = 'source'),
  pg_catalog.jsonb_build_object(
    'sourceJobId', 'scored-1',
    'sourceUrl', 'https://example.test/jobs/scored-1',
    'title', 'Already Scored Posting',
    'companyName', 'Northstar Systems',
    'description', repeat('Automate business workflows between systems. ', 8),
    'employmentType', 'full_time',
    'seniority', 'mid',
    'remoteState', 'remote',
    'locationRaw', 'Remote — Philippines',
    'countryCode', 'PH',
    'postedAt', (now() - interval '2 days'),
    'contentFingerprint', repeat('5', 64),
    'payloadChecksum', repeat('6', 64),
    'rawPayload', '{"id":"scored-1"}'::jsonb
  ),
  gen_random_uuid()
) ->> 'jobId')::uuid;

insert into candidate_ids (key, value)
select 'job-dismissed', (public.upsert_ingested_job(
  (select value::uuid from candidate_text where key = 'source'),
  pg_catalog.jsonb_build_object(
    'sourceJobId', 'dismissed-1',
    'sourceUrl', 'https://example.test/jobs/dismissed-1',
    'title', 'Dismissed Posting',
    'companyName', 'Northstar Systems',
    'description', repeat('Automate business workflows between systems. ', 8),
    'employmentType', 'full_time',
    'seniority', 'mid',
    'remoteState', 'remote',
    'locationRaw', 'Remote — Philippines',
    'countryCode', 'PH',
    'postedAt', (now() - interval '3 days'),
    'contentFingerprint', repeat('7', 64),
    'payloadChecksum', repeat('8', 64),
    'rawPayload', '{"id":"dismissed-1"}'::jsonb
  ),
  gen_random_uuid()
) ->> 'jobId')::uuid;

-- The one posting that already has a stored result.
select public.record_job_matches(
  'c0000000-0000-4000-8000-000000000001',
  pg_catalog.jsonb_build_object(
    'careerProfileId', (select value from candidate_ids where key = 'profile-a'),
    'items', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'jobId', (select value from candidate_ids where key = 'job-scored'),
      'score', 70,
      'verdict', 'good_match',
      'confidence', 'medium',
      'modelVersion', 'matching-v1',
      'recommendedAction', 'Apply, and address the gap in your summary honestly rather than leaving it unexplained.',
      'evidenceFactIds', '[]'::jsonb,
      'dataQuality', '{}'::jsonb
    ))
  ),
  gen_random_uuid()
);

select public.record_job_feedback(
  'c0000000-0000-4000-8000-000000000001',
  (select value from candidate_ids where key = 'job-dismissed'),
  'not_interested',
  'Not the kind of role I am looking for.',
  null,
  gen_random_uuid()
);

/**
 * The candidate read for the fixture profile, so each assertion reads like the
 * question it is asking rather than repeating a five-line call.
 */
create or replace function pg_temp.candidates(batch integer default 60)
returns jsonb
language sql
as $$
  select public.matching_job_candidates(
    'c0000000-0000-4000-8000-000000000001',
    (select value from pg_temp.candidate_ids where key = 'profile-a'),
    batch
  );
$$;

-- ---------------------------------------------------------------------------
-- The queue the worker reads
-- ---------------------------------------------------------------------------

select is(
  pg_catalog.jsonb_array_length(pg_temp.candidates() -> 'items'),
  2,
  'only postings that are unscored and not dismissed are candidates'
);
select is(
  pg_temp.candidates() -> 'items' -> 0 ->> 'id',
  (select value::text from candidate_ids where key = 'job-undated'),
  'a posting with no published date orders by when it was first seen'
);
select is(
  pg_temp.candidates() -> 'items' -> 1 ->> 'id',
  (select value::text from candidate_ids where key = 'job-recent'),
  'a posting with a published date orders by that date'
);
select is(
  pg_temp.candidates() ->> 'careerProfileId',
  (select value::text from candidate_ids where key = 'profile-a'),
  'the read names the profile it was built for'
);
select is(
  (pg_temp.candidates() ->> 'profileVersion')::integer,
  (select version from public.career_profiles
   where id = (select value from candidate_ids where key = 'profile-a')),
  'the read names the profile version it scored against'
);
select is(
  pg_temp.candidates() -> 'items' -> 0 ->> 'title',
  'Undated Posting',
  'a candidate carries the normalized title'
);
select ok(
  (pg_temp.candidates() -> 'items' -> 0) ? 'skills',
  'a candidate carries the skills the engine scores'
);
select ok(
  not exists (
    select 1 from pg_catalog.jsonb_array_elements(pg_temp.candidates() -> 'items') as entry
    where entry ->> 'id' = (select value::text from candidate_ids where key = 'job-dismissed')
  ),
  'a dismissed posting is not offered again'
);
select is(
  pg_catalog.jsonb_array_length(pg_temp.candidates(1) -> 'items'),
  1,
  'the candidate read honours its batch size'
);

-- ---------------------------------------------------------------------------
-- Authorization and bounds
-- ---------------------------------------------------------------------------

select ok(
  pg_temp.operation_fails(pg_catalog.format(
    'select public.matching_job_candidates(%L::uuid, %L::uuid, 0)',
    'c0000000-0000-4000-8000-000000000001',
    (select value from candidate_ids where key = 'profile-a')
  )),
  'a batch size below one is refused'
);
select ok(
  pg_temp.operation_fails(pg_catalog.format(
    'select public.matching_job_candidates(%L::uuid, %L::uuid, 60)',
    'c0000000-0000-4000-8000-000000000002',
    (select value from candidate_ids where key = 'profile-a')
  )),
  'candidates cannot be read for a profile the actor does not own'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"c0000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
select ok(
  pg_temp.operation_fails(pg_catalog.format(
    'select public.matching_job_candidates(%L::uuid, %L::uuid, 60)',
    'c0000000-0000-4000-8000-000000000001',
    pg_catalog.current_setting('hanaply_test.candidate_profile_id')
  )),
  'a subscriber cannot read the match candidate queue directly'
);

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- ---------------------------------------------------------------------------
-- What makes a posting due again
-- ---------------------------------------------------------------------------

select public.upsert_career_record(
  'c0000000-0000-4000-8000-000000000001',
  (select value from candidate_ids where key = 'profile-a'),
  'skill', null, '{"name":"n8n","skillKind":"tool"}'::jsonb, gen_random_uuid()
);
select is(
  pg_catalog.jsonb_array_length(pg_temp.candidates() -> 'items'),
  3,
  'a posting already scored returns when the profile changed'
);

select public.record_job_matches(
  'c0000000-0000-4000-8000-000000000001',
  pg_catalog.jsonb_build_object(
    'careerProfileId', (select value from candidate_ids where key = 'profile-a'),
    'items', (
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'jobId', entry ->> 'id',
        'score', 70,
        'verdict', 'good_match',
        'confidence', 'medium',
        'modelVersion', 'matching-v1',
        'recommendedAction', 'Apply, and address the gap in your summary honestly rather than leaving it unexplained.',
        'evidenceFactIds', '[]'::jsonb,
        'dataQuality', '{}'::jsonb
      ))
      from pg_catalog.jsonb_array_elements(pg_temp.candidates() -> 'items') as entry
    )
  ),
  gen_random_uuid()
);
select is(
  pg_catalog.jsonb_array_length(pg_temp.candidates() -> 'items'),
  0,
  'nothing is offered once every posting has been scored against the current profile'
);

update public.jobs
set title = title || ' (revised)'
where id = (select value from candidate_ids where key = 'job-scored');

-- The queue sees a content change as "the posting is newer than the result
-- stored for it". Inside one transaction `now()` does not advance, so the update
-- above cannot move `jobs.updated_at` on its own; the stored revision is put an
-- hour into the past instead, which is exactly the state a content change leaves
-- behind a result computed in an earlier transaction.
update public.job_matches
set job_updated_at = job_updated_at - interval '1 hour'
where user_id = 'c0000000-0000-4000-8000-000000000001'
  and career_profile_id = (select value from candidate_ids where key = 'profile-a')
  and job_id = (select value from candidate_ids where key = 'job-scored');

select is(
  pg_catalog.jsonb_array_length(pg_temp.candidates() -> 'items'),
  1,
  'a posting whose content changed returns as a candidate'
);
select is(
  pg_temp.candidates() -> 'items' -> 0 ->> 'id',
  (select value::text from candidate_ids where key = 'job-scored'),
  'and the posting that returns is the one that changed'
);
select is(
  pg_temp.candidates() -> 'items' -> 0 ->> 'title',
  'Already Scored Posting (revised)',
  'and the candidate carries the revised content'
);

select * from finish();
rollback;
