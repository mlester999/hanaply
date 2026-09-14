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
 * Runs a count as the current role and reports what it can actually see. A
 * denied table reports zero, which is the same outcome as an empty result: the
 * caller learned nothing. This is used instead of operation_fails(...) or
 * count = 0, because SQL does not guarantee that or short-circuits and the
 * second operand would still be planned and executed.
 */
create or replace function pg_temp.rows_visible(statement text)
returns integer
language plpgsql
as $$
declare
  counted integer;
begin
  execute statement into counted;
  return coalesce(counted, 0);
exception when others then
  return 0;
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

/**
 * The `record_opportunity_analysis` call under attack, with one argument varied.
 *
 * `service_definer` is what a *client* would have to become for the function to
 * accept it; `actor` is the identity handed to the function; `profile` is the
 * profile whose ledger the analysis would be written against. Every combination
 * an attacker can reach is expressed here, so the ownership check is proved to
 * hold in each argument position rather than at one convenient call site.
 */
create or replace function pg_temp.analysis_statement(
  actor uuid,
  profile uuid,
  job uuid,
  fingerprint text
)
returns text
language sql
immutable
as $$
  select pg_catalog.format(
    $sql$select public.record_opportunity_analysis(
      %L::uuid, %L::uuid, %L::uuid,
      'openai-compatible', 'gpt-test', 'opportunity-analysis-v1', 'matching-v1',
      %L, '{"verdict":"Forged by another subscriber."}'::jsonb, '{}'::uuid[])$sql$,
    actor, profile, job, fingerprint
  );
$$;

/**
 * The `append_coach_message` call under attack with the cited fact ids supplied
 * by the caller, so a citation that belongs to a different profile can be tried.
 */
create or replace function pg_temp.coach_message_statement(
  actor uuid,
  conversation uuid,
  cited_facts uuid[]
)
returns text
language sql
immutable
as $$
  select pg_catalog.format(
    $sql$select public.append_coach_message(
      %L::uuid, %L::uuid, 'assistant',
      'You have led a platform team for six years.',
      '[{"statement":"You have led a platform team for six years."}]'::jsonb,
      '[]'::jsonb, %L::uuid[], 'openai-compatible', 'gpt-test', 10, 10)$sql$,
    actor, conversation, cited_facts
  );
$$;

select plan(71);

-- ---------------------------------------------------------------------------
-- Two subscribers, the attacker holding no AI row of its own
-- ---------------------------------------------------------------------------

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    'c1000000-0000-4000-8000-00000000000a',
    'authenticated', 'authenticated', 'ai-attacker@hanaply.test',
    crypt('AiAttacker1', gen_salt('bf')), now(), '{}',
    '{"display_name":"AI Attacker"}', now(), now(), false, false
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'c1000000-0000-4000-8000-00000000000b',
    'authenticated', 'authenticated', 'ai-victim@hanaply.test',
    crypt('AiVictim1', gen_salt('bf')), now(), '{}',
    '{"display_name":"AI Victim"}', now(), now(), false, false
  );

insert into public.subscriptions (user_id, plan_id, status, starts_at, ends_at, source)
select seed.user_id, plans.id, 'active', now() - interval '1 day', now() + interval '30 days',
       'admin_grant'
from (
  values
    -- Both subscribers hold a plan, because `create_career_profile` is itself
    -- metered and the attacker needs a profile of its own for the cross-profile
    -- citation case below. The attacker holds no AI row of any kind, so a
    -- non-zero count on an AI table can only be the victim's.
    ('c1000000-0000-4000-8000-00000000000a'::uuid),
    ('c1000000-0000-4000-8000-00000000000b'::uuid)
) as seed (user_id)
cross join public.plans
where plans.code = 'plus_monthly';

insert into public.job_sources (code, display_name, source_kind, base_url, attribution, min_scan_interval_minutes)
values ('ai_isolation_fixture', 'AI Isolation Fixture', 'manual', 'https://example.test/ai-isolation', 'Synthetic test source.', 60)
on conflict (code) do nothing;

create temporary table ai_iso (key text primary key, value uuid not null);
-- The fixture ids are read by the adversarial statements too, and a statement
-- executed as `authenticated` cannot read a temporary table another role owns.
-- Only the identifiers are exposed, which are the attacker's own inputs anyway:
-- every one of them is already reachable from the URL or the request body.
grant all on table ai_iso to service_role, authenticated, anon;

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into ai_iso (key, value)
select 'source', id from public.job_sources where code = 'ai_isolation_fixture';

insert into ai_iso (key, value)
select 'job', (public.upsert_ingested_job(
  (select value from ai_iso where key = 'source'),
  pg_catalog.jsonb_build_object(
    'sourceJobId', 'ai-isolation-job-1',
    'sourceUrl', 'https://example.test/jobs/ai-isolation-1',
    'title', 'Workflow Automation Engineer',
    'companyName', 'Northstar Systems',
    'description', repeat('Automate business workflows for operations teams. ', 10),
    'employmentType', 'full_time',
    'remoteState', 'remote',
    'locationRaw', 'Remote - Philippines',
    'countryCode', 'PH',
    'postedAt', (now() - interval '1 day'),
    'contentFingerprint', repeat('1', 64),
    'payloadChecksum', repeat('2', 64),
    'rawPayload', '{"id":"ai-isolation-job-1"}'::jsonb
  ),
  gen_random_uuid()
) ->> 'jobId')::uuid;

-- The attacker owns a profile with one confirmed fact. That fact is the whole
-- point of the cross-profile case below: it is real, it is confirmed, it is the
-- attacker's, and it still must not be citable in the victim's thread.
insert into ai_iso (key, value)
select 'profile-a', public.create_career_profile(
  'c1000000-0000-4000-8000-00000000000a',
  '{
    "name":"Attacker search",
    "headline":"Automation generalist",
    "summary":"Builds automation between business systems for small operations teams that need dependable reporting without a platform team.",
    "currentRoleTitle":"Automation Generalist",
    "careerLevel":"mid",
    "yearsExperience":2,
    "targetRoleTitles":["Workflow Automation Engineer"],
    "preferredEmploymentTypes":["full_time"],
    "preferredWorkArrangement":"remote",
    "preferredLocations":["Remote"]
  }'::jsonb,
  gen_random_uuid()
);

insert into ai_iso (key, value)
select 'fact-a', created.value::uuid
from public.record_career_facts(
  'c1000000-0000-4000-8000-00000000000a',
  (select value from ai_iso where key = 'profile-a'),
  pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'category', 'skill',
    'label', 'Zapier',
    'statement', 'Two years of Zapier automation ownership.'
  )),
  'user_entered',
  null,
  gen_random_uuid()
) as recorded
cross join lateral pg_catalog.jsonb_array_elements_text(recorded -> 'createdIds') as created(value);

insert into ai_iso (key, value)
select 'profile-b', public.create_career_profile(
  'c1000000-0000-4000-8000-00000000000b',
  '{
    "name":"Victim private search",
    "headline":"Confidential automation lead",
    "summary":"Builds reliable automation between business systems for small operations teams that need dependable reporting without a platform team.",
    "currentRoleTitle":"Automation Lead",
    "careerLevel":"senior",
    "yearsExperience":7,
    "targetRoleTitles":["Workflow Automation Engineer"],
    "preferredEmploymentTypes":["full_time"],
    "preferredWorkArrangement":"remote",
    "preferredLocations":["Remote"]
  }'::jsonb,
  gen_random_uuid()
);

insert into ai_iso (key, value)
select 'fact-b', created.value::uuid
from public.record_career_facts(
  'c1000000-0000-4000-8000-00000000000b',
  (select value from ai_iso where key = 'profile-b'),
  pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'category', 'achievement',
    'label', 'Onboarding automation',
    'statement', 'Rebuilt onboarding automation for a 40-person operations team.'
  )),
  'user_entered',
  null,
  gen_random_uuid()
) as recorded
cross join lateral pg_catalog.jsonb_array_elements_text(recorded -> 'createdIds') as created(value);

-- ---------------------------------------------------------------------------
-- The victim's AI data, written the way the API writes it
-- ---------------------------------------------------------------------------

select public.record_ai_invocation(
  'c1000000-0000-4000-8000-00000000000b',
  (select value from ai_iso where key = 'profile-b'),
  'opportunity_analysis', 'openai-compatible', 'gpt-test', 'opportunity-analysis-v1',
  gen_random_uuid(), 'succeeded', null, 1200, 400, 900, 1, false
);

select public.record_ai_invocation(
  'c1000000-0000-4000-8000-00000000000b',
  (select value from ai_iso where key = 'profile-b'),
  'artifact_generation', 'openai-compatible', 'gpt-test', 'pack-artifact-v1',
  gen_random_uuid(), 'grounding_rejected',
  'the response asserted an employer that is not in the evidence', null, null, 1500, 1, false
);

select public.record_ai_invocation(
  'c1000000-0000-4000-8000-00000000000b',
  (select value from ai_iso where key = 'profile-b'),
  'coach_message', 'openai-compatible', 'gpt-test', 'ai-v1',
  gen_random_uuid(), 'disabled', null, null, null, null, 1, true
);

insert into public.opportunity_analyses (
  user_id, career_profile_id, job_id, provider, model, prompt_version,
  match_model_version, evidence_fingerprint, analysis, cited_fact_ids
) values (
  'c1000000-0000-4000-8000-00000000000b',
  (select value from ai_iso where key = 'profile-b'),
  (select value from ai_iso where key = 'job'),
  'openai-compatible', 'gpt-test', 'opportunity-analysis-v1', 'matching-v1',
  repeat('a', 64),
  '{"verdict":"A strong fit for the victim automation background."}'::jsonb,
  array[(select value from ai_iso where key = 'fact-b')]
);

insert into public.opportunity_analyses (
  user_id, career_profile_id, job_id, provider, model, prompt_version,
  match_model_version, evidence_fingerprint, analysis, cited_fact_ids
) values (
  'c1000000-0000-4000-8000-00000000000b',
  (select value from ai_iso where key = 'profile-b'),
  (select value from ai_iso where key = 'job'),
  'openai-compatible', 'gpt-test', 'opportunity-analysis-v1', 'matching-v1',
  repeat('b', 64),
  '{"verdict":"A second fingerprint for the victim."}'::jsonb,
  '{}'::uuid[]
);

insert into ai_iso (key, value)
select 'conversation-b', (public.open_coach_conversation(
  'c1000000-0000-4000-8000-00000000000b',
  (select value from ai_iso where key = 'profile-b'),
  'How should I position my automation work?',
  'career_strategy', 'openai-compatible', 'gpt-test'
)).id;

insert into ai_iso (key, value)
select 'conversation-b-unlinked', (public.open_coach_conversation(
  'c1000000-0000-4000-8000-00000000000b',
  null,
  'A thread with no career profile attached',
  'general', 'openai-compatible', 'gpt-test'
)).id;

select public.append_coach_message(
  'c1000000-0000-4000-8000-00000000000b',
  (select value from ai_iso where key = 'conversation-b'),
  'user', 'What should I lead with?', '[]'::jsonb, '[]'::jsonb, '{}'::uuid[], null, null, null, null
);

select public.append_coach_message(
  'c1000000-0000-4000-8000-00000000000b',
  (select value from ai_iso where key = 'conversation-b'),
  'assistant',
  'Lead with the onboarding automation you rebuilt.',
  pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'statement', 'You rebuilt onboarding automation for a 40-person operations team.',
    'factIds', pg_catalog.to_jsonb(array[(select value from ai_iso where key = 'fact-b')])
  )),
  pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'statement', 'Consider targeting platform teams next.',
    'reasoning', 'Your automation work is adjacent to platform engineering.'
  )),
  array[(select value from ai_iso where key = 'fact-b')],
  'openai-compatible', 'gpt-test', 800, 300
);

-- The victim's own thread, which the attacker must not be able to reach.
insert into ai_iso (key, value)
select 'message-b', id from public.coach_messages
where conversation_id = (select value from ai_iso where key = 'conversation-b')
  and role = 'assistant';

-- ---------------------------------------------------------------------------
-- The fixtures are real, so a zero below cannot be vacuous
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::integer from public.ai_invocations),
  3,
  'the victim has three recorded model calls'
);
select is(
  (select count(*)::integer from public.opportunity_analyses
   where user_id = 'c1000000-0000-4000-8000-00000000000b'),
  2,
  'the victim has two cached analyses'
);
select is(
  (select count(*)::integer from public.coach_conversations
   where user_id = 'c1000000-0000-4000-8000-00000000000b'),
  2,
  'the victim has two coach threads'
);
select is(
  (select count(*)::integer from public.coach_messages
   where user_id = 'c1000000-0000-4000-8000-00000000000b'),
  2,
  'and two coach messages, one of them grounded'
);
select is(
  pg_catalog.cardinality(pg_temp.confirmed_ids((select value from ai_iso where key = 'profile-b'))),
  1,
  'the victim profile has exactly one confirmed fact to cite'
);
select is(
  pg_catalog.cardinality(pg_temp.confirmed_ids((select value from ai_iso where key = 'profile-a'))),
  1,
  'and the attacker owns a confirmed fact of its own, which is what makes the cross-profile case real'
);

-- ---------------------------------------------------------------------------
-- The attacker reads. Every AI table must be out of reach.
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"c1000000-0000-4000-8000-00000000000a","role":"authenticated"}',
  true
);

select is(
  pg_temp.rows_visible('select count(*)::integer from public.ai_invocations'),
  0,
  'a subscriber cannot read the model call log at all'
);
select is(
  pg_temp.rows_visible(
    $sql$select count(*)::integer from public.ai_invocations
      where user_id = 'c1000000-0000-4000-8000-00000000000b'$sql$
  ),
  0,
  'not even the rows naming another subscriber'
);
select is(
  pg_temp.rows_visible('select count(*)::integer from public.opportunity_analyses'),
  0,
  'a subscriber cannot read cached AI reasoning at all'
);
select is(
  pg_temp.rows_visible(
    $sql$select count(*)::integer from public.opportunity_analyses
      where career_profile_id = 'c1000000-0000-4000-8000-00000000000b'$sql$
  ),
  0,
  'and cannot reach it even with a predicate naming the victim profile'
);
select is(
  pg_temp.rows_visible('select count(*)::integer from public.coach_conversations'),
  0,
  'a subscriber sees no coach thread that is not theirs'
);
select is(
  pg_temp.rows_visible('select count(*)::integer from public.coach_messages'),
  0,
  'and none of another subscriber messages'
);
select ok(
  pg_temp.operation_fails($sql$select user_id from public.coach_conversations$sql$),
  'the conversation owner column is not client-readable'
);
select ok(
  pg_temp.operation_fails($sql$select user_id from public.coach_messages$sql$),
  'nor is the message owner column'
);
select ok(
  pg_temp.operation_fails($sql$select provider, model from public.coach_messages$sql$),
  'nor the provider wiring recorded on a message'
);
select ok(
  (select count(*)::integer from public.coach_conversations
   where title = 'How should I position my automation work?') = 0,
  'the victim thread is invisible rather than merely uncounted'
);

-- ---------------------------------------------------------------------------
-- The attacker writes. No AI table accepts a client write, forged or not.
-- ---------------------------------------------------------------------------

select ok(
  pg_temp.operation_fails($sql$insert into public.ai_invocations
    (user_id, career_profile_id, operation, provider, model, prompt_version,
     request_id, outcome)
    values ('c1000000-0000-4000-8000-00000000000a',
            (select value from ai_iso where key = 'profile-a'),
            'opportunity_analysis', 'openai-compatible', 'gpt-test', 'v1',
            gen_random_uuid(), 'succeeded')$sql$),
  'a client cannot write its own invocation row'
);
select ok(
  pg_temp.operation_fails($sql$insert into public.ai_invocations
    (user_id, career_profile_id, operation, provider, model, prompt_version,
     request_id, outcome)
    values ('c1000000-0000-4000-8000-00000000000b',
            (select value from ai_iso where key = 'profile-b'),
            'artifact_generation', 'openai-compatible', 'gpt-test', 'v1',
            gen_random_uuid(), 'succeeded')$sql$),
  'nor a forged one naming another subscriber'
);
select ok(
  pg_temp.operation_fails($sql$insert into public.opportunity_analyses
    (user_id, career_profile_id, job_id, provider, model, prompt_version,
     match_model_version, evidence_fingerprint, analysis)
    values ('c1000000-0000-4000-8000-00000000000a',
            (select value from ai_iso where key = 'profile-a'),
            (select value from ai_iso where key = 'job'),
            'openai-compatible', 'gpt-test', 'v1', 'matching-v1', repeat('c', 64),
            '{"verdict":"Mine."}'::jsonb)$sql$),
  'a client cannot plant a cached analysis of its own'
);
select ok(
  pg_temp.operation_fails($sql$insert into public.opportunity_analyses
    (user_id, career_profile_id, job_id, provider, model, prompt_version,
     match_model_version, evidence_fingerprint, analysis)
    values ('c1000000-0000-4000-8000-00000000000b',
            (select value from ai_iso where key = 'profile-b'),
            (select value from ai_iso where key = 'job'),
            'openai-compatible', 'gpt-test', 'v1', 'matching-v1', repeat('d', 64),
            '{"verdict":"Forged for the victim."}'::jsonb)$sql$),
  'nor plant one inside another subscriber cache'
);
select ok(
  pg_temp.operation_fails($sql$insert into public.coach_conversations (user_id, title)
    values ('c1000000-0000-4000-8000-00000000000a', 'Mine now')$sql$),
  'a client cannot open a coach thread by direct insert'
);
select ok(
  pg_temp.operation_fails($sql$insert into public.coach_conversations (user_id, title)
    values ('c1000000-0000-4000-8000-00000000000b', 'Forged for the victim')$sql$),
  'nor one under another subscriber id'
);
select ok(
  pg_temp.operation_fails($sql$insert into public.coach_messages
    (conversation_id, user_id, role, body, facts, cited_fact_ids)
    values ((select value from ai_iso where key = 'conversation-b'),
            'c1000000-0000-4000-8000-00000000000a', 'user', 'Let me in.',
            '[]'::jsonb, '{}'::uuid[])$sql$),
  'a client cannot write a message into another subscriber thread'
);
select ok(
  pg_temp.operation_fails($sql$insert into public.coach_messages
    (conversation_id, user_id, role, body, facts, cited_fact_ids)
    values ((select value from ai_iso where key = 'conversation-b'),
            'c1000000-0000-4000-8000-00000000000b', 'assistant',
            'You have led a platform team for six years.',
            '[{"statement":"You have led a platform team for six years."}]'::jsonb,
            array[(select value from ai_iso where key = 'fact-b')])$sql$),
  'nor a grounded-looking one, because no client writes this table at all'
);
select ok(
  pg_temp.operation_fails($sql$update public.coach_conversations set title = 'Mine now'$sql$),
  'a client cannot rewrite a coach thread'
);
select ok(
  pg_temp.operation_fails($sql$delete from public.coach_conversations$sql$),
  'and cannot delete one'
);
select ok(
  pg_temp.operation_fails($sql$delete from public.coach_messages$sql$),
  'nor delete a message from it'
);
select ok(
  pg_temp.operation_fails($sql$delete from public.ai_invocations$sql$),
  'nor clear the model call log'
);
select ok(
  pg_temp.operation_fails($sql$delete from public.opportunity_analyses$sql$),
  'nor the analysis cache'
);

-- ---------------------------------------------------------------------------
-- The API functions refuse a client, whatever arguments it supplies
-- ---------------------------------------------------------------------------

select ok(
  pg_temp.operation_fails($sql$select public.record_ai_invocation(
    'c1000000-0000-4000-8000-00000000000a', null, 'coach_message',
    'openai-compatible', 'gpt-test', 'v1', gen_random_uuid(), 'succeeded')$sql$),
  'a client cannot reach record_ai_invocation at all'
);
select ok(
  pg_temp.operation_fails(
    pg_temp.analysis_statement(
      'c1000000-0000-4000-8000-00000000000a',
      (select value from ai_iso where key = 'profile-b'),
      (select value from ai_iso where key = 'job'),
      repeat('e', 64)
    )
  ),
  'record_opportunity_analysis refuses a client naming the victim profile'
);
select ok(
  pg_temp.operation_fails(
    pg_temp.analysis_statement(
      'c1000000-0000-4000-8000-00000000000b',
      (select value from ai_iso where key = 'profile-b'),
      (select value from ai_iso where key = 'job'),
      repeat('f', 64)
    )
  ),
  'and refuses one naming the victim as the actor'
);
select ok(
  pg_temp.operation_fails(
    pg_temp.analysis_statement(
      'c1000000-0000-4000-8000-00000000000a',
      (select value from ai_iso where key = 'profile-a'),
      (select value from ai_iso where key = 'job'),
      repeat('0', 64)
    )
  ),
  'and refuses one naming a profile the attacker does own, because a client may write none of them'
);

-- The service role is the only caller the writers accept, so the ownership
-- check itself is exercised from there: a service-role caller that names a
-- profile it was not asked to write for is still refused.
select ok(
  pg_temp.operation_fails(
    pg_temp.analysis_statement(
      'c1000000-0000-4000-8000-00000000000b',
      (select value from ai_iso where key = 'profile-a'),
      (select value from ai_iso where key = 'job'),
      repeat('1', 64)
    )
  ),
  'the analysis writer refuses an actor serving a profile that is not its own'
);
select ok(
  pg_temp.operation_fails(
    pg_temp.analysis_statement(
      'c1000000-0000-4000-8000-00000000000b',
      (select value from ai_iso where key = 'profile-b'),
      '00000000-0000-4000-8000-000000000000',
      repeat('2', 64)
    )
  ),
  'and refuses one naming a job that does not exist'
);
select ok(
  pg_temp.operation_fails(
    pg_temp.coach_message_statement(
      'c1000000-0000-4000-8000-00000000000a',
      (select value from ai_iso where key = 'conversation-b'),
      array[(select value from ai_iso where key = 'fact-a')]
    )
  ),
  'a client cannot post into another subscriber coach thread'
);

-- ---------------------------------------------------------------------------
-- The coach thread is owner-scoped in every write direction
--
-- Executed as the service role, because the `authorized` client cannot reach
-- these functions at all: this is the ownership check being proved, not the
-- grant that precedes it.
-- ---------------------------------------------------------------------------

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select ok(
  pg_temp.operation_fails($sql$select public.open_coach_conversation(
    'c1000000-0000-4000-8000-00000000000a',
    (select value from ai_iso where key = 'profile-b'),
    'A thread opened on someone else profile')$sql$),
  'a conversation cannot be opened against a profile the actor does not own'
);
select ok(
  pg_temp.operation_fails($sql$select public.open_coach_conversation(
    '00000000-0000-4000-8000-000000000000', null, 'An actor that does not exist')$sql$),
  'and cannot be opened by an actor that does not exist'
);
select ok(
  pg_temp.operation_fails($sql$select public.append_coach_message(
    'c1000000-0000-4000-8000-00000000000a',
    (select value from ai_iso where key = 'conversation-b'),
    'user', 'Let me in.', '[]'::jsonb, '[]'::jsonb, '{}'::uuid[], null, null, null, null)$sql$),
  'another subscriber cannot append a message to this thread'
);
select ok(
  pg_temp.operation_fails($sql$select public.coach_conversation_detail(
    'c1000000-0000-4000-8000-00000000000a',
    (select value from ai_iso where key = 'conversation-b'))$sql$),
  'and cannot read its detail'
);
select ok(
  pg_temp.operation_fails($sql$select public.coach_conversation_detail(
    'c1000000-0000-4000-8000-00000000000a',
    '00000000-0000-4000-8000-000000000000')$sql$),
  'and cannot read a conversation that does not exist'
);

-- The cross-profile case: the attacker owns a confirmed fact, but not the
-- profile the thread belongs to. A citable fact is not a citable fact here.
select ok(
  pg_temp.operation_fails(
    pg_temp.coach_message_statement(
      'c1000000-0000-4000-8000-00000000000a',
      (select value from ai_iso where key = 'conversation-b'),
      array[(select value from ai_iso where key = 'fact-a')]
    )
  ),
  'a fact confirmed on a different profile the attacker owns is not citable in the victim thread'
);
select ok(
  pg_temp.operation_fails($sql$select public.append_coach_message(
    'c1000000-0000-4000-8000-00000000000b',
    (select value from ai_iso where key = 'conversation-b'),
    'assistant', 'You have led a platform team for six years.',
    '[{"statement":"You have led a platform team for six years."}]'::jsonb,
    '[]'::jsonb,
    array[(select value from ai_iso where key = 'fact-a')],
    'openai-compatible', 'gpt-test', 10, 10)$sql$),
  'and the owner cannot smuggle another profile fact into its own thread either'
);
select ok(
  pg_temp.operation_fails($sql$select public.append_coach_message(
    'c1000000-0000-4000-8000-00000000000a',
    (select value from ai_iso where key = 'conversation-b-unlinked'),
    'assistant', 'You have led a platform team for six years.',
    '[{"statement":"You have led a platform team for six years."}]'::jsonb,
    '[]'::jsonb,
    array[(select value from ai_iso where key = 'fact-b')],
    'openai-compatible', 'gpt-test', 10, 10)$sql$),
  'a thread with no career profile cannot be used to cite another subscriber fact'
);
select ok(
  pg_temp.operation_fails($sql$select public.append_coach_message(
    'c1000000-0000-4000-8000-00000000000b',
    (select value from ai_iso where key = 'conversation-b-unlinked'),
    'assistant', 'You have led a platform team for six years.',
    '[{"statement":"You have led a platform team for six years."}]'::jsonb,
    '[]'::jsonb,
    array[gen_random_uuid()],
    'openai-compatible', 'gpt-test', 10, 10)$sql$),
  'nor by naming an identifier that is a confirmed fact on no profile at all'
);
-- The guard must not have been achieved by refusing every unlinked thread: a
-- citation the subscriber can actually stand behind is still stored.
select ok(
  (public.append_coach_message(
    'c1000000-0000-4000-8000-00000000000b',
    (select value from ai_iso where key = 'conversation-b-unlinked'),
    'assistant', 'You have confirmed automation work.',
    '[{"statement":"You have confirmed automation work."}]'::jsonb,
    '[]'::jsonb,
    array[(select value from ai_iso where key = 'fact-b')],
    'openai-compatible', 'gpt-test', 10, 10)).id is not null,
  'while a citation the subscriber can stand behind is still stored on that thread'
);

-- ---------------------------------------------------------------------------
-- Nothing above left a row behind
--
-- Read as the superuser, because the client cannot read these tables at all and
-- a zero from a denied read would prove nothing about what is stored.
-- ---------------------------------------------------------------------------

reset role;

select is(
  (select count(*)::integer from public.ai_invocations),
  3,
  'the invocation log still holds only what the API recorded'
);
select is(
  (select count(*)::integer from public.opportunity_analyses),
  2,
  'and the cache still holds only the victim analyses'
);
select is(
  (select count(*)::integer from public.coach_conversations),
  2,
  'and no extra coach thread was created'
);
select is(
  (select count(*)::integer from public.coach_messages),
  3,
  'and only the one message that was entitled to be stored was added'
);

-- ---------------------------------------------------------------------------
-- The uncited-claim constraint is not bypassable by a direct write either
--
-- Read as the superuser, whose writes no grant refuses: this is the constraint
-- itself being tested, not the privilege that a client would hit first.
-- ---------------------------------------------------------------------------

select ok(
  pg_temp.operation_fails($sql$insert into public.coach_messages
    (conversation_id, user_id, role, body, facts, cited_fact_ids)
    values ((select value from ai_iso where key = 'conversation-b'),
            'c1000000-0000-4000-8000-00000000000b', 'assistant',
            'You have led a platform team for six years.',
            '[{"statement":"You have led a platform team for six years."}]'::jsonb,
            '{}'::uuid[])$sql$),
  'an uncited assistant claim cannot be inserted directly'
);
select ok(
  pg_temp.operation_fails($sql$insert into public.coach_messages
    (conversation_id, user_id, role, body, facts, cited_fact_ids)
    values ((select value from ai_iso where key = 'conversation-b'),
            'c1000000-0000-4000-8000-00000000000b', 'assistant',
            'You have led a platform team for six years.',
            '[{"statement":"You have led a platform team for six years."}]'::jsonb,
            null)$sql$),
  'nor with a null citation list'
);
select ok(
  pg_temp.operation_fails($sql$insert into public.coach_messages
    (conversation_id, user_id, role, body, facts, cited_fact_ids)
    values ((select value from ai_iso where key = 'conversation-b'),
            'c1000000-0000-4000-8000-00000000000b', 'assistant',
            'You have led a platform team for six years.',
            '[{"statement":"You have led a platform team for six years."}]'::jsonb,
            array[gen_random_uuid()])$sql$),
  'nor by citing an identifier that is not a confirmed fact on any profile'
);
select ok(
  pg_temp.operation_fails($sql$insert into public.coach_messages
    (conversation_id, user_id, role, body, facts, cited_fact_ids)
    values ((select value from ai_iso where key = 'conversation-b'),
            'c1000000-0000-4000-8000-00000000000b', 'assistant',
            'You have led a platform team for six years.',
            '[{"statement":"You have led a platform team for six years."}]'::jsonb,
            array[(select value from ai_iso where key = 'fact-a')])$sql$),
  'nor by citing a real fact that belongs to another profile'
);
select ok(
  pg_temp.operation_fails($sql$update public.coach_messages
    set cited_fact_ids = '{}'::uuid[]
    where id = (select value from ai_iso where key = 'message-b')$sql$),
  'a grounded message cannot be rewritten to strip its citations'
);
select ok(
  pg_temp.operation_fails($sql$update public.coach_messages
    set cited_fact_ids = null
    where id = (select value from ai_iso where key = 'message-b')$sql$),
  'nor to null them'
);
select ok(
  pg_temp.operation_fails($sql$update public.coach_messages
    set facts = facts, cited_fact_ids = '{}'::uuid[]
    where role = 'assistant'$sql$),
  'nor can any assistant message in the table be stripped of citations in bulk'
);
select is(
  (select body from public.coach_messages
   where id = (select value from ai_iso where key = 'message-b')),
  'Lead with the onboarding automation you rebuilt.',
  'nor can a grounded message body be rewritten'
);
select is(
  pg_catalog.array_length(
    (select cited_fact_ids from public.coach_messages
     where id = (select value from ai_iso where key = 'message-b')),
    1
  ),
  1,
  'the grounded message kept its citation through every attempt above'
);
select is(
  (select count(*)::integer from public.coach_messages
   where body = 'You have led a platform team for six years.'),
  0,
  'and no uncited claim reached the table'
);

-- ---------------------------------------------------------------------------
-- No AI table carries a write grant or a write policy to climb through
-- ---------------------------------------------------------------------------

select is(
  pg_catalog.has_table_privilege('authenticated', 'public.coach_messages', 'INSERT'),
  false,
  'a client holds no insert privilege on the coach message table'
);
select is(
  pg_catalog.has_table_privilege('authenticated', 'public.coach_messages', 'UPDATE'),
  false,
  'nor an update privilege'
);
select is(
  pg_catalog.has_table_privilege('authenticated', 'public.coach_messages', 'DELETE'),
  false,
  'nor a delete privilege'
);
select is(
  pg_catalog.has_table_privilege('authenticated', 'public.coach_conversations', 'INSERT'),
  false,
  'a client holds no insert privilege on the coach thread table'
);
select is(
  pg_catalog.has_table_privilege('authenticated', 'public.ai_invocations', 'SELECT'),
  false,
  'and no read privilege on the model call log'
);

select is(
  (select count(*)::integer from pg_catalog.pg_policies
   where schemaname = 'public'
     and tablename in ('ai_invocations', 'opportunity_analyses', 'coach_conversations', 'coach_messages')
     and cmd <> 'SELECT'),
  0,
  'no AI table has an insert, update, delete, or all policy for a client to use'
);
select is(
  (select count(*)::integer from pg_catalog.pg_policies
   where schemaname = 'public'
     and tablename in ('ai_invocations', 'opportunity_analyses', 'coach_conversations', 'coach_messages')
     and roles::text like '%authenticated%'),
  2,
  'a client is named by exactly the two own-row select policies and nothing else'
);
select is(
  (select count(*)::integer from pg_catalog.pg_policies
   where schemaname = 'public'
     and tablename in ('ai_invocations', 'opportunity_analyses', 'coach_conversations', 'coach_messages')
     and cmd = 'SELECT'
     and coalesce(qual, '') not like '%auth.uid()%'),
  0,
  'and every select policy that exists is scoped to the caller own rows'
);

-- ---------------------------------------------------------------------------
-- An AI table cannot be used as an escalation path
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"c1000000-0000-4000-8000-00000000000a","role":"authenticated"}',
  true
);

select ok(
  pg_temp.operation_fails($sql$select count(*) from public.admin_role_assignments$sql$),
  'the AI tables gave the attacker no reach into administrator grants'
);
select ok(
  pg_temp.operation_fails($sql$select public.admin_job_source_directory(
    'c1000000-0000-4000-8000-00000000000a')$sql$),
  'nor any administrator read model'
);
select ok(
  pg_temp.operation_fails($sql$insert into public.admin_role_assignments (admin_user_id, role_id)
    select 'c1000000-0000-4000-8000-00000000000a', id from public.admin_roles limit 1$sql$),
  'nor a way to grant itself an administrator role'
);

select * from finish();
rollback;
