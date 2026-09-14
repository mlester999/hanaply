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

/**
 * The confirmed fact ids for a profile. The production helper is private to the
 * service role, so the suite reproduces it from the table rather than calling it,
 * which also means these tests assert the same fact the application sees.
 */
create or replace function pg_temp.confirmed_ids(profile uuid)
returns uuid[]
language sql
stable
as $$
  select coalesce(pg_catalog.array_agg(fact.id order by fact.created_at, fact.id), '{}'::uuid[])
  from public.career_facts as fact
  where fact.career_profile_id = profile and fact.status = 'confirmed';
$$;

select plan(36);

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
    'b1000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'ai-owner@hanaply.test',
    crypt('AiOwner1', gen_salt('bf')), now(), '{}',
    '{"display_name":"AI Owner"}', now(), now(), false, false
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'b1000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'ai-other@hanaply.test',
    crypt('AiOther1', gen_salt('bf')), now(), '{}',
    '{"display_name":"AI Other"}', now(), now(), false, false
  );

insert into public.subscriptions (user_id, plan_id, status, starts_at, ends_at, source)
select seed.user_id, plans.id, 'active', now() - interval '1 day', now() + interval '30 days',
       'admin_grant'
from (
  values
    ('b1000000-0000-4000-8000-000000000001'::uuid),
    ('b1000000-0000-4000-8000-000000000002'::uuid)
) as seed (user_id)
cross join public.plans
where plans.code = 'plus_monthly';

insert into public.job_sources (code, display_name, source_kind, base_url, attribution, min_scan_interval_minutes)
values ('ai_fixture', 'AI Fixture', 'manual', 'https://example.test/ai', 'Synthetic test source.', 60)
on conflict (code) do nothing;

create temporary table ai_ids (key text primary key, value uuid not null);
grant all on table ai_ids to service_role;

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into ai_ids (key, value)
select 'source', id from public.job_sources where code = 'ai_fixture';

insert into ai_ids (key, value)
select 'profile', public.create_career_profile(
  'b1000000-0000-4000-8000-000000000001',
  '{
    "name":"AI search",
    "headline":"Automation specialist",
    "summary":"Builds reliable automation between business systems for small operations teams that need dependable reporting without a platform team.",
    "currentRoleTitle":"Automation Specialist",
    "careerLevel":"mid",
    "yearsExperience":4,
    "targetRoleTitles":["Workflow Automation Engineer"],
    "preferredEmploymentTypes":["full_time"],
    "preferredWorkArrangement":"remote",
    "preferredLocations":["Remote"]
  }'::jsonb,
  gen_random_uuid()
);

insert into ai_ids (key, value)
select 'job', (public.upsert_ingested_job(
  (select value from ai_ids where key = 'source'),
  pg_catalog.jsonb_build_object(
    'sourceJobId', 'ai-job-1',
    'sourceUrl', 'https://example.test/jobs/ai-1',
    'title', 'Workflow Automation Engineer',
    'companyName', 'Northstar Systems',
    'description', repeat('Automate business workflows for operations teams. ', 10),
    'employmentType', 'full_time',
    'remoteState', 'remote',
    'locationRaw', 'Remote - Philippines',
    'countryCode', 'PH',
    'postedAt', (now() - interval '1 day'),
    'contentFingerprint', repeat('e', 64),
    'payloadChecksum', repeat('f', 64),
    'rawPayload', '{"id":"ai-job-1"}'::jsonb
  ),
  gen_random_uuid()
) ->> 'jobId')::uuid;

-- Two confirmed facts and one candidate, so the admissibility checks are real.
select public.record_career_facts(
  'b1000000-0000-4000-8000-000000000001',
  (select value from ai_ids where key = 'profile'),
  pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'category', 'skill',
      'label', 'n8n',
      'statement', 'Five years of production n8n workflow ownership.'
    ),
    pg_catalog.jsonb_build_object(
      'category', 'achievement',
      'label', 'Onboarding automation',
      'statement', 'Rebuilt onboarding automation for a 40-person operations team.'
    )
  ),
  'user_entered',
  null,
  gen_random_uuid()
);

-- A candidate fact must reference the document it was extracted from, so the
-- fixture creates one. This is the shape a real upload produces.
insert into ai_ids (key, value)
select 'document', gen_random_uuid();

insert into public.career_documents (
  id, user_id, career_profile_id, document_kind, original_filename, mime_type,
  size_bytes, checksum_sha256, bucket_id, object_path, status
) values (
  (select value from ai_ids where key = 'document'),
  'b1000000-0000-4000-8000-000000000001',
  (select value from ai_ids where key = 'profile'),
  'resume',
  'ai-owner-resume.pdf',
  'application/pdf',
  2048,
  repeat('9', 64),
  'career-documents',
  'b1000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002.pdf',
  'uploaded'
);

insert into ai_ids (key, value)
select 'candidate-fact', gen_random_uuid();

-- Inserted directly rather than through record_career_facts so the row is
-- unambiguously a candidate: it is exactly what an extraction produces
-- before the subscriber reviews it.
insert into public.career_facts (
  id, career_profile_id, category, statement, source, status, evidence, document_id
) values (
  (select value from ai_ids where key = 'candidate-fact'),
  (select value from ai_ids where key = 'profile'),
  'skill',
  'Operated Kubernetes clusters in production.',
  'resume_extraction',
  'candidate',
  '{}'::jsonb,
  (select value from ai_ids where key = 'document')
);
select is(
  (select count(*)::integer from public.career_facts
   where career_profile_id = (select value from ai_ids where key = 'profile')
     and status = 'confirmed'),
  2,
  'the fixture has two confirmed facts'
);
select is(
  (select count(*)::integer from public.career_facts
   where career_profile_id = (select value from ai_ids where key = 'profile')
     and status = 'candidate'),
  1,
  'and one candidate fact that extracted evidence supplies'
);

select is(
  pg_catalog.array_length(
    pg_temp.confirmed_ids((select value from ai_ids where key = 'profile')), 1
  ),
  2,
  'admissible evidence is exactly the confirmed set'
);

-- ---------------------------------------------------------------------------
-- Invocation records
-- ---------------------------------------------------------------------------

select ok(
  (public.record_ai_invocation(
    'b1000000-0000-4000-8000-000000000001',
    (select value from ai_ids where key = 'profile'),
    'opportunity_analysis', 'openai-compatible', 'gpt-test', 'opportunity-analysis-v1',
    gen_random_uuid(), 'succeeded', null, 1200, 400, 900, 1, false
  )) is not null,
  'a successful invocation is recorded'
);
select is(
  (select count(*)::integer from public.ai_invocations where outcome = 'grounding_rejected'),
  0,
  'no grounding rejection exists yet'
);
select ok(
  (public.record_ai_invocation(
    'b1000000-0000-4000-8000-000000000001',
    (select value from ai_ids where key = 'profile'),
    'artifact_generation', 'openai-compatible', 'gpt-test', 'pack-artifact-v1',
    gen_random_uuid(), 'grounding_rejected',
    'the response asserted an employer that is not in the evidence', null, null, 1500, 1, false
  )) is not null,
  'a rejected grounding attempt is recorded rather than discarded'
);
select is(
  (select count(*)::integer from public.ai_invocations),
  2,
  'both the success and the rejection are retained'
);
select ok(
  pg_temp.operation_fails($statement$insert into public.ai_invocations
    (operation, provider, model, prompt_version, request_id, outcome)
    values ('summarise_everything', 'p', 'm', 'v1', gen_random_uuid(), 'succeeded')$statement$),
  'an unknown operation is rejected by the schema'
);
select ok(
  pg_temp.operation_fails($statement$insert into public.ai_invocations
    (operation, provider, model, prompt_version, request_id, outcome)
    values ('coach_message', 'p', 'm', 'v1', gen_random_uuid(), 'probably_fine')$statement$),
  'an unknown outcome is rejected by the schema'
);
select ok(
  pg_temp.operation_fails($statement$select public.record_ai_invocation(
    null, null, 'coach_message', 'p', 'm', 'v1', gen_random_uuid(), 'succeeded')$statement$),
  'a client role cannot record an invocation'
);

-- ---------------------------------------------------------------------------
-- Opportunity analysis grounding
-- ---------------------------------------------------------------------------

select is(
  (pg_temp.confirmed_ids((select value from ai_ids where key = 'profile')))[1],
  (select id from public.career_facts
   where career_profile_id = (select value from ai_ids where key = 'profile')
     and status = 'confirmed'
   order by created_at, id limit 1),
  'the evidence helper returns confirmed fact ids'
);

select ok(
  (public.record_opportunity_analysis(
    'b1000000-0000-4000-8000-000000000001',
    (select value from ai_ids where key = 'profile'),
    (select value from ai_ids where key = 'job'),
    'openai-compatible', 'gpt-test', 'opportunity-analysis-v1', 'matching-v1',
    repeat('a', 64),
    pg_catalog.jsonb_build_object('verdict', 'A strong fit for your automation background.'),
    pg_temp.confirmed_ids((select value from ai_ids where key = 'profile'))
  )) is not null,
  'an analysis citing only confirmed facts is stored'
);
select is(
  (select count(*)::integer from public.opportunity_analyses),
  1,
  'the analysis was persisted'
);

-- The central guarantee: reasoning may not cite a claim the subscriber has not
-- confirmed, even though extracted evidence proposed it.
select ok(
  pg_temp.operation_fails($statement$select public.record_opportunity_analysis(
    'b1000000-0000-4000-8000-000000000001',
    (select value from ai_ids where key = 'profile'),
    (select value from ai_ids where key = 'job'),
    'openai-compatible', 'gpt-test', 'opportunity-analysis-v1', 'matching-v1',
    repeat('b', 64),
    '{"verdict":"You have operated Kubernetes clusters."}'::jsonb,
    array[(select value from ai_ids where key = 'candidate-fact')]
  )$statement$),
  'an analysis citing an unconfirmed fact is refused, even though extraction proposed it'
);

select is(
  (public.record_opportunity_analysis(
    'b1000000-0000-4000-8000-000000000001',
    (select value from ai_ids where key = 'profile'),
    (select value from ai_ids where key = 'job'),
    'openai-compatible', 'gpt-test', 'opportunity-analysis-v1', 'matching-v1',
    repeat('a', 64),
    pg_catalog.jsonb_build_object('verdict', 'Rewritten after a regeneration.'),
    '{}'::uuid[]
  )),
  (select id from public.opportunity_analyses limit 1),
  're-running with the same evidence fingerprint updates in place rather than duplicating'
);
select is(
  (select count(*)::integer from public.opportunity_analyses),
  1,
  'the cache holds one row per evidence fingerprint'
);
select is(
  (select analysis ->> 'verdict' from public.opportunity_analyses limit 1),
  'Rewritten after a regeneration.',
  'the cached analysis was replaced'
);

select ok(
  (public.record_opportunity_analysis(
    'b1000000-0000-4000-8000-000000000001',
    (select value from ai_ids where key = 'profile'),
    (select value from ai_ids where key = 'job'),
    'openai-compatible', 'gpt-test', 'opportunity-analysis-v1', 'matching-v1',
    repeat('c', 64),
    '{"verdict":"A second fingerprint."}'::jsonb,
    '{}'::uuid[]
  )) is not null,
  'a changed evidence fingerprint produces a new analysis'
);
select is(
  (select count(*)::integer from public.opportunity_analyses),
  2,
  'so a changed fact ledger invalidates the cached reasoning instead of serving it'
);
select ok(
  pg_temp.operation_fails($statement$select public.record_opportunity_analysis(
    'b1000000-0000-4000-8000-000000000002',
    (select value from ai_ids where key = 'profile'),
    (select value from ai_ids where key = 'job'),
    'p', 'm', 'v1', 'matching-v1', repeat('d', 64),
    '{"verdict":"Not mine to write."}'::jsonb, '{}'::uuid[])$statement$),
  'an analysis cannot be written for a profile the caller does not own'
);

-- ---------------------------------------------------------------------------
-- Coach threads
-- ---------------------------------------------------------------------------

select ok(
  (public.open_coach_conversation(
    'b1000000-0000-4000-8000-000000000001',
    (select value from ai_ids where key = 'profile'),
    'How should I position my automation work?',
    'career_strategy', 'openai-compatible', 'gpt-test'
  )).id is not null,
  'a coach conversation can be opened'
);
insert into ai_ids (key, value)
select 'conversation', id from public.coach_conversations limit 1;

select ok(
  (public.append_coach_message(
    'b1000000-0000-4000-8000-000000000001',
    (select value from ai_ids where key = 'conversation'),
    'user', 'What should I lead with?', '[]'::jsonb, '[]'::jsonb, '{}'::uuid[], null, null, null, null
  )).id is not null,
  'a subscriber message is stored'
);
select ok(
  (public.append_coach_message(
    'b1000000-0000-4000-8000-000000000001',
    (select value from ai_ids where key = 'conversation'),
    'assistant',
    'Lead with the onboarding automation you rebuilt.',
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'statement', 'You rebuilt onboarding automation for a 40-person operations team.',
      'factIds', pg_catalog.to_jsonb(pg_temp.confirmed_ids((select value from ai_ids where key = 'profile')))
    )),
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'statement', 'Consider targeting platform teams next.',
      'reasoning', 'Your automation work is adjacent to platform engineering.'
    )),
    pg_temp.confirmed_ids((select value from ai_ids where key = 'profile')),
    'openai-compatible', 'gpt-test', 800, 300
  )).id is not null,
  'a grounded assistant message is stored with facts and suggestions separated'
);
select is(
  (select message_count from public.coach_conversations limit 1),
  2,
  'the conversation counts its messages'
);
select is(
  pg_catalog.jsonb_array_length(
    (select facts from public.coach_messages where role = 'assistant')
  ),
  1,
  'the assistant message reports one fact'
);
select is(
  pg_catalog.jsonb_array_length(
    (select suggestions from public.coach_messages where role = 'assistant')
  ),
  1,
  'and one suggestion, held separately'
);

-- The constraint that makes an uncited factual claim unstorable. This is the
-- database half of "never state inferred information as a fact about the user".
select ok(
  pg_temp.operation_fails($statement$insert into public.coach_messages
    (conversation_id, user_id, role, body, facts, cited_fact_ids)
    values ((select value from ai_ids where key = 'conversation'),
            'b1000000-0000-4000-8000-000000000001', 'assistant',
            'You have led a platform team for six years.',
            '[{"statement":"You have led a platform team for six years."}]'::jsonb,
            '{}'::uuid[])$statement$),
  'an assistant message asserting a fact with no cited evidence cannot be stored'
);
select ok(
  pg_temp.operation_fails($statement$select public.append_coach_message(
    'b1000000-0000-4000-8000-000000000001',
    (select value from ai_ids where key = 'conversation'),
    'assistant', 'You have operated Kubernetes clusters in production.',
    '[]'::jsonb, '[]'::jsonb,
    array[(select value from ai_ids where key = 'candidate-fact')],
    'p', 'm', 10, 10)$statement$),
  'a coach message citing an unconfirmed fact is refused'
);

select is(
  (public.coach_conversation_detail(
    'b1000000-0000-4000-8000-000000000001',
    (select value from ai_ids where key = 'conversation')
  ) -> 'messages' -> 1 ->> 'role'),
  'assistant',
  'the conversation detail returns the thread in order'
);

-- ---------------------------------------------------------------------------
-- Ownership and row-level security
-- ---------------------------------------------------------------------------

select ok(
  pg_temp.operation_fails($statement$select public.coach_conversation_detail(
    'b1000000-0000-4000-8000-000000000002',
    (select value from ai_ids where key = 'conversation'))$statement$),
  'another subscriber cannot read this coach thread'
);
select ok(
  pg_temp.operation_fails($statement$select public.append_coach_message(
    'b1000000-0000-4000-8000-000000000002',
    (select value from ai_ids where key = 'conversation'),
    'user', 'Let me in.', '[]'::jsonb, '[]'::jsonb, '{}'::uuid[], null, null, null, null)$statement$),
  'another subscriber cannot post into this coach thread'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"b1000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);

select ok(
  pg_temp.operation_fails($statement$select count(*) from public.ai_invocations$statement$),
  'the invocation log is denied to clients entirely'
);
select ok(
  pg_temp.operation_fails($statement$select count(*) from public.opportunity_analyses$statement$),
  'cached AI reasoning is denied to clients entirely'
);
select is(
  (select count(*)::integer from public.coach_conversations),
  0,
  'another subscriber sees no coach threads'
);
select is(
  (select count(*)::integer from public.coach_messages),
  0,
  'and none of their messages'
);
select ok(
  pg_temp.operation_fails($statement$update public.coach_conversations set title = 'Mine now'$statement$),
  'a client cannot rewrite a coach thread'
);

select * from finish();
rollback;
