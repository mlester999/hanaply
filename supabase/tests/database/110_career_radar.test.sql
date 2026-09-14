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

select plan(49);

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
    'd0000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'radar-a@hanaply.test',
    crypt('RadarA1', gen_salt('bf')), now(), '{}',
    '{"display_name":"Radar A"}', now(), now(), false, false
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'd0000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'radar-b@hanaply.test',
    crypt('RadarB1', gen_salt('bf')), now(), '{}',
    '{"display_name":"Radar B"}', now(), now(), false, false
  );

insert into public.subscriptions (user_id, plan_id, status, starts_at, ends_at, source)
select seed.user_id, plans.id, 'active', now() - interval '1 day', now() + interval '30 days',
       'admin_grant'
from (
  values ('d0000000-0000-4000-8000-000000000001'::uuid)
) as seed (user_id)
join public.plans on plans.code = 'plus_monthly';

insert into public.job_sources (code, display_name, source_kind, base_url, attribution, min_scan_interval_minutes)
values ('radar_fixture', 'Radar Fixture', 'manual', 'https://example.test/feed', 'Synthetic test source.', 60)
on conflict (code) do nothing;

create temporary table radar_ids (key text primary key, value uuid not null);
grant all on table radar_ids to service_role;
create temporary table radar_text (key text primary key, value text not null);
grant all on table radar_text to service_role;

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into radar_ids (key, value)
select 'profile-a', public.create_career_profile(
  'd0000000-0000-4000-8000-000000000001',
  '{
    "name":"Primary search",
    "headline":"Workflow automation specialist",
    "summary":"Builds reliable automation between business systems for small operations teams that need dependable operations without a platform team.",
    "currentRoleTitle":"Automation Specialist",
    "careerLevel":"mid",
    "yearsExperience":3.5,
    "industries":["SaaS"],
    "targetRoleTitles":["Workflow Automation Engineer"],
    "preferredEmploymentTypes":["full_time"],
    "preferredWorkArrangement":"remote",
    "preferredLocations":["Remote"],
    "salaryMinMinor":8000000,
    "salaryPeriod":"monthly"
  }'::jsonb,
  gen_random_uuid()
);
select public.upsert_career_record(
  'd0000000-0000-4000-8000-000000000001',
  (select value from radar_ids where key = 'profile-a'),
  'skill', null, '{"name":"n8n","skillKind":"tool"}'::jsonb, gen_random_uuid()
);
select public.upsert_career_record(
  'd0000000-0000-4000-8000-000000000001',
  (select value from radar_ids where key = 'profile-a'),
  'skill', null, '{"name":"TypeScript","skillKind":"technology"}'::jsonb, gen_random_uuid()
);

insert into radar_text (key, value)
select 'source', id::text from public.job_sources where code = 'radar_fixture';

insert into radar_ids (key, value)
select 'job-good', (public.upsert_ingested_job(
  (select value::uuid from radar_text where key = 'source'),
  pg_catalog.jsonb_build_object(
    'sourceJobId', 'good-1',
    'sourceUrl', 'https://example.test/jobs/good-1',
    'applyUrl', 'https://example.test/apply/good-1',
    'title', 'Workflow Automation Engineer',
    'companyName', 'Northstar Systems',
    'description', repeat('Automate business workflows with n8n and TypeScript. ', 12),
    'employmentType', 'full_time',
    'seniority', 'mid',
    'remoteState', 'remote',
    'locationRaw', 'Remote — Philippines',
    'countryCode', 'PH',
    'salaryMinMinor', 9000000,
    'salaryMaxMinor', 12000000,
    'salaryCurrency', 'PHP',
    'salaryPeriod', 'monthly',
    'skills', pg_catalog.jsonb_build_array('n8n', 'TypeScript'),
    'requirements', pg_catalog.jsonb_build_array('3+ years building automation with n8n and TypeScript'),
    'experienceYearsMin', 3,
    'postedAt', (now() - interval '1 day'),
    'contentFingerprint', repeat('a', 64),
    'payloadChecksum', repeat('b', 64),
    'rawPayload', '{"id":"good-1"}'::jsonb
  ),
  gen_random_uuid()
) ->> 'jobId')::uuid;

insert into radar_ids (key, value)
select 'job-poor', (public.upsert_ingested_job(
  (select value::uuid from radar_text where key = 'source'),
  pg_catalog.jsonb_build_object(
    'sourceJobId', 'poor-1',
    'sourceUrl', 'https://example.test/jobs/poor-1',
    'title', 'Night Shift Support Representative',
    'companyName', 'Meridian Support',
    'description', repeat('Handle inbound calls on a night shift schedule. ', 12),
    'employmentType', 'part_time',
    'seniority', 'entry',
    'remoteState', 'onsite',
    'locationRaw', 'Makati, Metro Manila',
    'countryCode', 'PH',
    'postedAt', (now() - interval '40 days'),
    'contentFingerprint', repeat('c', 64),
    'payloadChecksum', repeat('d', 64),
    'rawPayload', '{"id":"poor-1"}'::jsonb
  ),
  gen_random_uuid()
) ->> 'jobId')::uuid;

insert into radar_ids (key, value)
select 'job-foreign', (public.upsert_ingested_job(
  (select value::uuid from radar_text where key = 'source'),
  pg_catalog.jsonb_build_object(
    'sourceJobId', 'foreign-1',
    'sourceUrl', 'https://example.test/jobs/foreign-1',
    'title', 'Platform Engineer',
    'companyName', 'Atlas Workflow',
    'description', repeat('Operate a distributed platform for a global customer base. ', 12),
    'employmentType', 'full_time',
    'seniority', 'senior',
    'remoteState', 'onsite',
    'locationRaw', 'Singapore',
    'countryCode', 'SG',
    'isInternational', true,
    'postedAt', (now() - interval '2 days'),
    'contentFingerprint', repeat('e', 64),
    'payloadChecksum', repeat('f', 64),
    'rawPayload', '{"id":"foreign-1"}'::jsonb
  ),
  gen_random_uuid()
) ->> 'jobId')::uuid;

-- ---------------------------------------------------------------------------
-- Truth gate on match evidence
-- ---------------------------------------------------------------------------

insert into radar_ids (key, value)
select 'fact-confirmed', (public.record_career_facts(
  'd0000000-0000-4000-8000-000000000001',
  (select value from radar_ids where key = 'profile-a'),
  '[{"statement":"Rebuilt onboarding automation for a 40-person team","category":"achievement"}]'::jsonb,
  'user_entered',
  null,
  gen_random_uuid()
) -> 'createdIds' ->> 0)::uuid;

insert into radar_ids (key, value)
select 'fact-candidate', (public.record_career_facts(
  'd0000000-0000-4000-8000-000000000001',
  (select value from radar_ids where key = 'profile-a'),
  '[{"statement":"Possibly reduced reporting effort by a large amount","category":"achievement"}]'::jsonb,
  'user_entered',
  null,
  gen_random_uuid()
) -> 'createdIds' ->> 0)::uuid;

update public.career_facts
set status = 'candidate', confirmed_at = null, confirmed_by = null
where id = (select value from radar_ids where key = 'fact-candidate');

select is(
  public.record_job_matches(
    'd0000000-0000-4000-8000-000000000001',
    pg_catalog.jsonb_build_object(
      'careerProfileId', (select value from radar_ids where key = 'profile-a'),
      'items', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'jobId', (select value from radar_ids where key = 'job-good'),
        'score', 88,
        'verdict', 'strong_match',
        'confidence', 'high',
        'modelVersion', 'matching-v1',
        'dimensions', '[]'::jsonb,
        'strengths', pg_catalog.jsonb_build_array('Strong n8n and TypeScript coverage'),
        'gaps', '[]'::jsonb,
        'blockers', '[]'::jsonb,
        'rejectionRisks', '[]'::jsonb,
        'requirementMapping', '[]'::jsonb,
        'recommendedAction', 'Apply now and lead with your automation work.',
        'evidenceFactIds', pg_catalog.jsonb_build_array((select value from radar_ids where key = 'fact-confirmed')),
        'dataQuality', '{"profileCompleteness":"solid","jobDetail":"detailed","unknowns":[]}'::jsonb
      ))
    ),
    gen_random_uuid()
  ),
  1,
  'an authorized match result is recorded'
);

select ok(
  pg_temp.operation_fails($statement$insert into public.job_matches (
    user_id, job_id, career_profile_id, score, verdict, confidence, model_version,
    recommended_action, evidence_fact_ids, profile_version, job_updated_at
  ) values (
    'd0000000-0000-4000-8000-000000000001',
    (select value from radar_ids where key = 'job-foreign'),
    (select value from radar_ids where key = 'profile-a'),
    95, 'strong_match', 'high', 'matching-v1', 'Apply now.',
    array[(select value from radar_ids where key = 'fact-candidate')],
    0, now()
  )$statement$),
  'the evidence trigger rejects a direct write that cites an unconfirmed claim'
);

select is(
  (public.record_job_matches(
    'd0000000-0000-4000-8000-000000000001',
    pg_catalog.jsonb_build_object(
      'careerProfileId', (select value from radar_ids where key = 'profile-a'),
      'items', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'jobId', (select value from radar_ids where key = 'job-poor'),
        'score', 31,
        'verdict', 'weak_match',
        'confidence', 'medium',
        'modelVersion', 'matching-v1',
        'recommendedAction', 'This is a long shot. Save it for later or dismiss it.',
        'evidenceFactIds', pg_catalog.jsonb_build_array(
          (select value from radar_ids where key = 'fact-confirmed'),
          (select value from radar_ids where key = 'fact-candidate')
        )
      ))
    ),
    gen_random_uuid()
  )),
  1,
  'a match result that cites an unconfirmed claim is stored with the claim stripped'
);
select is(
  (select pg_catalog.jsonb_array_length(pg_catalog.to_jsonb(evidence_fact_ids))
   from public.job_matches
   where job_id = (select value from radar_ids where key = 'job-poor')),
  1,
  'only the confirmed identifier survives the evidence filter'
);

-- ---------------------------------------------------------------------------
-- Saved jobs and feedback
-- ---------------------------------------------------------------------------

select is(
  public.save_job(
    'd0000000-0000-4000-8000-000000000001',
    (select value from radar_ids where key = 'job-good'),
    (select value from radar_ids where key = 'profile-a'),
    'Ask about the reporting stack.',
    gen_random_uuid()
  ),
  true,
  'an active subscriber saves an opportunity'
);
select is(
  public.save_job(
    'd0000000-0000-4000-8000-000000000001',
    (select value from radar_ids where key = 'job-good'),
    null, null, gen_random_uuid()
  ),
  false,
  'saving the same opportunity twice is idempotent'
);
select is(
  (select count(*)::integer from public.saved_jobs where user_id = 'd0000000-0000-4000-8000-000000000001'),
  1,
  'saving twice does not create a second row'
);
select is(
  (select note from public.saved_jobs where user_id = 'd0000000-0000-4000-8000-000000000001'),
  'Ask about the reporting stack.',
  'the saved note survives the idempotent retry'
);

select ok(
  (public.record_job_feedback(
    'd0000000-0000-4000-8000-000000000001',
    (select value from radar_ids where key = 'job-poor'),
    'wrong_seniority',
    'This is well below my level.',
    null,
    gen_random_uuid()
  ) is not null),
  'an active subscriber records ranking feedback'
);
select ok(
  pg_temp.operation_fails($statement$insert into public.job_feedback (user_id, job_id, feedback)
    values (
      'd0000000-0000-4000-8000-000000000001',
      (select value from radar_ids where key = 'job-poor'),
      'irrelevant'
    )$statement$),
  'a direct write cannot create a second active feedback row'
);
select is(
  (select count(*)::integer from public.job_feedback
   where user_id = 'd0000000-0000-4000-8000-000000000001'
     and job_id = (select value from radar_ids where key = 'job-poor')
     and active),
  1,
  'the active feedback row is unique'
);
select public.record_job_feedback(
  'd0000000-0000-4000-8000-000000000001',
  (select value from radar_ids where key = 'job-poor'),
  'not_interested',
  'Changed my mind.',
  null,
  gen_random_uuid()
);
select is(
  (select count(*)::integer from public.job_feedback
   where user_id = 'd0000000-0000-4000-8000-000000000001'
     and job_id = (select value from radar_ids where key = 'job-poor')
     and active),
  1,
  'new feedback supersedes the previous active row'
);
select is(
  (select count(*)::integer from public.job_feedback
   where user_id = 'd0000000-0000-4000-8000-000000000001'
     and job_id = (select value from radar_ids where key = 'job-poor')),
  2,
  'superseded feedback is retained for audit rather than deleted'
);

-- ---------------------------------------------------------------------------
-- Ranked feed
-- ---------------------------------------------------------------------------

select is(
  (public.job_radar(
    'd0000000-0000-4000-8000-000000000001',
    pg_catalog.jsonb_build_object('careerProfileId', (select value from radar_ids where key = 'profile-a'))
  ) -> 'items' -> 0 -> 'id'),
  pg_catalog.to_jsonb((select value from radar_ids where key = 'job-good')),
  'the best-scoring opportunity ranks first'
);
select is(
  (public.job_radar(
    'd0000000-0000-4000-8000-000000000001',
    pg_catalog.jsonb_build_object('careerProfileId', (select value from radar_ids where key = 'profile-a'))
  ) -> 'items' -> 0 -> 'match' -> 'score'),
  '88'::jsonb,
  'the ranked item carries its match score'
);
select is(
  (public.job_radar(
    'd0000000-0000-4000-8000-000000000001',
    pg_catalog.jsonb_build_object('careerProfileId', (select value from radar_ids where key = 'profile-a'))
  ) -> 'pagination' -> 'total'),
  '2'::jsonb,
  'dismissed opportunities are excluded from the default feed'
);
select is(
  (public.job_radar(
    'd0000000-0000-4000-8000-000000000001',
    pg_catalog.jsonb_build_object(
      'careerProfileId', (select value from radar_ids where key = 'profile-a'),
      'includeDismissed', true
    )
  ) -> 'pagination' -> 'total'),
  '3'::jsonb,
  'the feed can include dismissed opportunities when asked'
);
select is(
  (public.job_radar(
    'd0000000-0000-4000-8000-000000000001',
    pg_catalog.jsonb_build_object(
      'careerProfileId', (select value from radar_ids where key = 'profile-a'),
      'dismissedOnly', true
    )
  ) -> 'pagination' -> 'total'),
  '1'::jsonb,
  'the feed can list only dismissed opportunities'
);
select is(
  (public.job_radar(
    'd0000000-0000-4000-8000-000000000001',
    pg_catalog.jsonb_build_object(
      'careerProfileId', (select value from radar_ids where key = 'profile-a'),
      'savedOnly', true
    )
  ) -> 'items' -> 0 -> 'savedAt' is not null),
  true,
  'the saved filter returns the saved opportunity with its timestamp'
);
select is(
  (public.job_radar(
    'd0000000-0000-4000-8000-000000000001',
    pg_catalog.jsonb_build_object(
      'careerProfileId', (select value from radar_ids where key = 'profile-a'),
      'remoteStates', pg_catalog.jsonb_build_array('remote')
    )
  ) -> 'pagination' -> 'total'),
  '1'::jsonb,
  'the remote filter is applied in the database'
);
select is(
  (public.job_radar(
    'd0000000-0000-4000-8000-000000000001',
    pg_catalog.jsonb_build_object(
      'careerProfileId', (select value from radar_ids where key = 'profile-a'),
      'minScore', 50
    )
  ) -> 'pagination' -> 'total'),
  '1'::jsonb,
  'a minimum match score filters out weak opportunities'
);
select is(
  (public.job_radar(
    'd0000000-0000-4000-8000-000000000001',
    pg_catalog.jsonb_build_object(
      'careerProfileId', (select value from radar_ids where key = 'profile-a'),
      'search', 'northstar'
    )
  ) -> 'pagination' -> 'total'),
  '1'::jsonb,
  'search matches the employer name'
);
select is(
  (public.job_radar(
    'd0000000-0000-4000-8000-000000000001',
    pg_catalog.jsonb_build_object(
      'careerProfileId', (select value from radar_ids where key = 'profile-a'),
      'internationalOnly', true
    )
  ) -> 'pagination' -> 'total'),
  '1'::jsonb,
  'the international filter returns only roles outside the Philippines'
);
select is(
  (public.job_radar(
    'd0000000-0000-4000-8000-000000000001',
    pg_catalog.jsonb_build_object(
      'careerProfileId', (select value from radar_ids where key = 'profile-a'),
      'postedWithinDays', 7,
      'includeDismissed', true
    )
  ) -> 'pagination' -> 'total'),
  '2'::jsonb,
  'the freshness filter removes older postings'
);
select is(
  (public.job_radar(
    'd0000000-0000-4000-8000-000000000001',
    pg_catalog.jsonb_build_object(
      'careerProfileId', (select value from radar_ids where key = 'profile-a'),
      'pageSize', 1
    )
  ) -> 'pagination' -> 'totalPages'),
  '2'::jsonb,
  'pagination reports the correct page count'
);
select is(
  (public.job_radar(
    'd0000000-0000-4000-8000-000000000001',
    pg_catalog.jsonb_build_object(
      'careerProfileId', (select value from radar_ids where key = 'profile-a'),
      'sort', 'newest'
    )
  ) -> 'items' -> 0 -> 'id'),
  pg_catalog.to_jsonb((select value from radar_ids where key = 'job-good')),
  'the newest sort puts the most recently posted opportunity first'
);
select is(
  (public.job_radar(
    'd0000000-0000-4000-8000-000000000001',
    pg_catalog.jsonb_build_object(
      'careerProfileId', (select value from radar_ids where key = 'profile-a'),
      'sort', 'salary',
      'includeDismissed', true
    )
  ) -> 'items' -> 0 -> 'salaryMaxMinor'),
  '12000000'::jsonb,
  'the salary sort puts the highest advertised range first'
);
select is(
  (public.job_radar(
    'd0000000-0000-4000-8000-000000000001',
    pg_catalog.jsonb_build_object(
      'careerProfileId', (select value from radar_ids where key = 'profile-a'),
      'employmentTypes', pg_catalog.jsonb_build_array('part_time'),
      'includeDismissed', true
    )
  ) -> 'pagination' -> 'total'),
  '1'::jsonb,
  'the employment-type filter is applied server-side'
);
select is(
  (public.job_radar(
    'd0000000-0000-4000-8000-000000000001',
    pg_catalog.jsonb_build_object('careerProfileId', (select value from radar_ids where key = 'profile-a'))
  ) -> 'items' -> 0 -> 'excerpt' is not null),
  true,
  'feed items carry an excerpt instead of the full description'
);
select ok(
  (public.job_radar(
    'd0000000-0000-4000-8000-000000000001',
    pg_catalog.jsonb_build_object('careerProfileId', (select value from radar_ids where key = 'profile-a'))
  ) -> 'items' -> 0) ? 'description' = false,
  'the full description is not sent with every feed item'
);

-- ---------------------------------------------------------------------------
-- Job detail
-- ---------------------------------------------------------------------------

select is(
  (public.job_detail(
    'd0000000-0000-4000-8000-000000000001',
    (select value from radar_ids where key = 'job-good')
  ) ->> 'title'),
  'Workflow Automation Engineer',
  'job detail returns the canonical title'
);
select is(
  (public.job_detail(
    'd0000000-0000-4000-8000-000000000001',
    (select value from radar_ids where key = 'job-good')
  ) -> 'match' -> 'score'),
  '88'::jsonb,
  'job detail returns the explainable match result'
);
select is(
  (public.job_detail(
    'd0000000-0000-4000-8000-000000000001',
    (select value from radar_ids where key = 'job-good')
  ) -> 'match' -> 'strengths' -> 0),
  '"Strong n8n and TypeScript coverage"'::jsonb,
  'job detail explains why the role fits'
);
select is(
  (select pg_catalog.jsonb_array_length(
    public.job_detail(
      'd0000000-0000-4000-8000-000000000001',
      (select value from radar_ids where key = 'job-good')
    ) -> 'sources'
  )),
  1,
  'job detail lists the provenance of the posting'
);
select is(
  (public.job_detail(
    'd0000000-0000-4000-8000-000000000001',
    (select value from radar_ids where key = 'job-good')
  ) ->> 'applyUrl'),
  'https://example.test/apply/good-1',
  'job detail returns the original application link'
);
select is(
  (public.job_detail(
    'd0000000-0000-4000-8000-000000000001',
    (select value from radar_ids where key = 'job-good')
  ) ->> 'savedAt' is not null),
  true,
  'job detail reports the caller saved state'
);
select is(
  (public.job_detail(
    'd0000000-0000-4000-8000-000000000001',
    (select value from radar_ids where key = 'job-poor')
  ) ->> 'feedback'),
  'not_interested',
  'job detail reports the active feedback'
);
select is(
  (public.job_detail(
    'd0000000-0000-4000-8000-000000000001',
    (select value from radar_ids where key = 'job-poor')
  ) -> 'match' -> 'verdict'),
  '"weak_match"'::jsonb,
  'job detail returns the stored verdict'
);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"d0000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

select is(
  (select count(*)::integer from public.saved_jobs),
  1,
  'a subscriber reads only their own saved opportunities'
);
select is(
  (select count(*)::integer from public.job_feedback),
  2,
  'a subscriber reads their own feedback history'
);
select is(
  (select count(*)::integer from public.job_matches),
  2,
  'a subscriber reads only their own match results'
);
select ok(
  pg_temp.operation_fails($statement$insert into public.saved_jobs (user_id, job_id)
    values (auth.uid(), (select id from public.jobs limit 1))$statement$),
  'a subscriber cannot save an opportunity directly'
);
select ok(
  pg_temp.operation_fails($statement$update public.job_matches set score = 100$statement$),
  'a subscriber cannot rewrite a match result'
);
select ok(
  pg_temp.operation_fails($statement$select public.record_job_matches(
    auth.uid(), '{}'::jsonb, gen_random_uuid())$statement$),
  'a subscriber cannot call the match writer'
);
select ok(
  pg_temp.operation_fails($statement$select public.job_radar(auth.uid(), '{}'::jsonb)$statement$),
  'a subscriber cannot call the radar feed server function directly'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"d0000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);
select is(
  (select count(*)::integer from public.saved_jobs),
  0,
  'another subscriber sees no saved opportunities'
);
select is(
  (select count(*)::integer from public.job_matches),
  0,
  'another subscriber sees no match results'
);

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select ok(
  pg_temp.operation_fails($statement$select public.job_radar(
    'd0000000-0000-4000-8000-000000000002',
    pg_catalog.jsonb_build_object('careerProfileId', (select value from radar_ids where key = 'profile-a'))
  )$statement$),
  'another account cannot read a feed built from a profile it does not own'
);
select ok(
  pg_temp.operation_fails($statement$select public.job_detail(
    'd0000000-0000-4000-8000-000000000001',
    'ffffffff-ffff-4fff-8fff-ffffffffffff'
  )$statement$),
  'job detail rejects an unknown opportunity'
);

select * from finish();
rollback;
