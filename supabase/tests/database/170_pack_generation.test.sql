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

select plan(19);

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
    'ac000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'generation-plus@hanaply.test',
    crypt('Generation1', gen_salt('bf')), now(), '{}',
    '{"display_name":"Generation Plus"}', now(), now(), false, false
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'ac000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'generation-other@hanaply.test',
    crypt('Generation2', gen_salt('bf')), now(), '{}',
    '{"display_name":"Generation Other"}', now(), now(), false, false
  );

insert into public.subscriptions (user_id, plan_id, status, starts_at, ends_at, source)
select 'ac000000-0000-4000-8000-000000000001', plans.id, 'active',
       now() - interval '1 day', now() + interval '30 days', 'admin_grant'
from public.plans where code = 'plus_monthly';

insert into public.job_sources (code, display_name, source_kind, base_url, attribution, min_scan_interval_minutes)
values ('generation_fixture', 'Generation Fixture', 'manual', 'https://example.test/generation', 'Synthetic test source.', 60)
on conflict (code) do nothing;

create temporary table generation_ids (key text primary key, value uuid not null);
grant all on table generation_ids to service_role;

create temporary table generation_payloads (key text primary key, value jsonb not null);
grant all on table generation_payloads to service_role;

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into generation_ids (key, value)
select 'source', id from public.job_sources where code = 'generation_fixture';

insert into generation_ids (key, value)
select 'profile', public.create_career_profile(
  'ac000000-0000-4000-8000-000000000001',
  '{
    "name":"Primary search",
    "headline":"Workflow automation specialist",
    "summary":"Builds reliable automation between business systems for small operations teams that need dependable operations without a platform team.",
    "currentRoleTitle":"Automation Specialist",
    "careerLevel":"mid",
    "yearsExperience":3.5,
    "targetRoleTitles":["Workflow Automation Engineer"],
    "preferredEmploymentTypes":["full_time"],
    "preferredWorkArrangement":"remote",
    "preferredLocations":["Remote"]
  }'::jsonb,
  gen_random_uuid()
);

insert into generation_ids (key, value)
select 'fact', (public.record_career_facts(
  'ac000000-0000-4000-8000-000000000001',
  (select value from generation_ids where key = 'profile'),
  '[{"statement":"Rebuilt onboarding automation for a 40-person operations team","category":"achievement"}]'::jsonb,
  'user_entered', null, gen_random_uuid()
) -> 'createdIds' ->> 0)::uuid;

insert into generation_ids (key, value)
select 'job', (public.upsert_ingested_job(
  (select value from generation_ids where key = 'source'),
  pg_catalog.jsonb_build_object(
    'sourceJobId', 'generation-job-1',
    'sourceUrl', 'https://example.test/jobs/generation-1',
    'title', 'Workflow Automation Engineer',
    'companyName', 'Northstar Systems',
    'description', repeat('Automate business workflows for operations teams. ', 10),
    'employmentType', 'full_time',
    'remoteState', 'remote',
    'locationRaw', 'Remote, Philippines',
    'countryCode', 'PH',
    'postedAt', (now() - interval '1 day'),
    'contentFingerprint', repeat('d', 64),
    'payloadChecksum', repeat('e', 64),
    'rawPayload', '{"id":"generation-job-1"}'::jsonb
  ),
  gen_random_uuid()
) ->> 'jobId')::uuid;

insert into generation_ids (key, value)
select 'archived-job', (public.upsert_ingested_job(
  (select value from generation_ids where key = 'source'),
  pg_catalog.jsonb_build_object(
    'sourceJobId', 'generation-job-2',
    'sourceUrl', 'https://example.test/jobs/generation-2',
    'title', 'Solutions Engineer',
    'companyName', 'Pinebridge Labs',
    'description', repeat('Design solutions for operations teams across the region. ', 10),
    'employmentType', 'full_time',
    'remoteState', 'remote',
    'locationRaw', 'Remote, Philippines',
    'countryCode', 'PH',
    'postedAt', (now() - interval '2 days'),
    'contentFingerprint', repeat('f', 64),
    'payloadChecksum', repeat('a', 64),
    'rawPayload', '{"id":"generation-job-2"}'::jsonb
  ),
  gen_random_uuid()
) ->> 'jobId')::uuid;

-- A match result has to exist before the pack is created, because the pack
-- freezes whatever the match snapshot held at that moment.
select public.record_job_matches(
  'ac000000-0000-4000-8000-000000000001',
  pg_catalog.jsonb_build_object(
    'careerProfileId', (select value from generation_ids where key = 'profile'),
    'items', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'jobId', (select value from generation_ids where key = 'job'),
        'score', 74,
        'verdict', 'good_match',
        'confidence', 'medium',
        'modelVersion', 'matching-v1',
        'recommendedAction', 'Apply, and address the gap in your summary honestly.',
        'requirementMapping', pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'requirement', 'Kubernetes cluster administration',
            'status', 'unmet',
            'matchedSkills', '[]'::jsonb,
            'evidence', null
          )
        ),
        'evidenceFactIds', '[]'::jsonb
      )
    )
  ),
  gen_random_uuid()
);

insert into generation_ids (key, value)
select 'pack', (public.create_application_pack(
  'ac000000-0000-4000-8000-000000000001',
  (select value from generation_ids where key = 'job'),
  (select value from generation_ids where key = 'profile'),
  'pack-generate-0001',
  gen_random_uuid()
) -> 'pack' ->> 'id')::uuid;

insert into generation_ids (key, value)
select 'archived-pack', (public.create_application_pack(
  'ac000000-0000-4000-8000-000000000001',
  (select value from generation_ids where key = 'archived-job'),
  (select value from generation_ids where key = 'profile'),
  'pack-generate-0002',
  gen_random_uuid()
) -> 'pack' ->> 'id')::uuid;

-- ---------------------------------------------------------------------------
-- The generation context
-- ---------------------------------------------------------------------------

insert into generation_payloads (key, value)
select 'prepared', public.generate_application_pack_artifacts(
  'ac000000-0000-4000-8000-000000000001',
  (select value from generation_ids where key = 'pack'),
  array['resume', 'cover_letter']::public.application_artifact_kind[],
  'standard',
  gen_random_uuid()
);

select is(
  (select value -> 'match' ->> 'score' from generation_payloads where key = 'prepared'),
  '74',
  'the RPC returns the match snapshot the pack froze at creation time'
);
select is(
  (select pg_catalog.jsonb_array_length(value -> 'evidence') from generation_payloads where key = 'prepared'),
  1,
  'the RPC returns exactly the confirmed evidence the generator may cite'
);
select is(
  (select value ->> 'finalized' from generation_payloads where key = 'prepared'),
  'false',
  'a prepare call does not report the pack as finalized'
);
select is(
  (select status::text from public.application_packs
   where id = (select value from generation_ids where key = 'pack')),
  'generating',
  'preparing generation moves the pack to generating'
);
select is(
  (select value -> 'profile' ->> 'headline' from generation_payloads where key = 'prepared'),
  'Workflow automation specialist',
  'the RPC returns the career profile the generator writes from'
);
select is(
  (select value -> 'job' ->> 'title' from generation_payloads where key = 'prepared'),
  'Workflow Automation Engineer',
  'the RPC returns the posting the generator writes against'
);

-- ---------------------------------------------------------------------------
-- Ownership and the ready gate
-- ---------------------------------------------------------------------------

select ok(
  pg_temp.operation_fails($statement$select public.generate_application_pack_artifacts(
    'ac000000-0000-4000-8000-000000000002',
    (select value from generation_ids where key = 'pack'),
    array['resume']::public.application_artifact_kind[],
    'standard',
    gen_random_uuid()
  )$statement$),
  'the generation RPC refuses a pack the caller does not own'
);
select ok(
  pg_temp.operation_fails($statement$select public.complete_application_pack(
    'ac000000-0000-4000-8000-000000000001',
    (select value from generation_ids where key = 'pack'),
    'ready',
    null
  )$statement$),
  'a pack cannot be marked ready while it has zero artifacts'
);
select is(
  (select status::text from public.application_packs
   where id = (select value from generation_ids where key = 'pack')),
  'generating',
  'the refused pack is left exactly where it was'
);

-- ---------------------------------------------------------------------------
-- The evidence set is the frozen one
-- ---------------------------------------------------------------------------

insert into generation_ids (key, value)
select 'later-fact', (public.record_career_facts(
  'ac000000-0000-4000-8000-000000000001',
  (select value from generation_ids where key = 'profile'),
  '[{"statement":"Confirmed after the pack was created","category":"achievement"}]'::jsonb,
  'user_entered', null, gen_random_uuid()
) -> 'createdIds' ->> 0)::uuid;

select is(
  public.generate_application_pack_artifacts(
    'ac000000-0000-4000-8000-000000000001',
    (select value from generation_ids where key = 'pack'),
    array['resume']::public.application_artifact_kind[],
    'standard',
    gen_random_uuid()
  ) -> 'evidence' -> 0 ->> 'id',
  (select value::text from generation_ids where key = 'fact'),
  'a fact confirmed after the pack was created is not offered as evidence'
);

-- ---------------------------------------------------------------------------
-- Refusals
-- ---------------------------------------------------------------------------

update public.application_packs
set status = 'archived'
where id = (select value from generation_ids where key = 'archived-pack');

select ok(
  pg_temp.operation_fails($statement$select public.generate_application_pack_artifacts(
    'ac000000-0000-4000-8000-000000000001',
    (select value from generation_ids where key = 'archived-pack'),
    array['resume']::public.application_artifact_kind[],
    'standard',
    gen_random_uuid()
  )$statement$),
  'an archived pack cannot be generated'
);
select ok(
  pg_temp.operation_fails($statement$select public.generate_application_pack_artifacts(
    'ac000000-0000-4000-8000-000000000001',
    (select value from generation_ids where key = 'pack'),
    array['resume']::public.application_artifact_kind[],
    'fancy',
    gen_random_uuid()
  )$statement$),
  'an unsupported artifact style is refused'
);
select ok(
  pg_temp.operation_fails($statement$select public.generate_application_pack_artifacts(
    'ac000000-0000-4000-8000-000000000001',
    (select value from generation_ids where key = 'pack'),
    array[]::public.application_artifact_kind[],
    'standard',
    gen_random_uuid()
  )$statement$),
  'an empty kind list is refused'
);

-- ---------------------------------------------------------------------------
-- Finalisation
-- ---------------------------------------------------------------------------

select ok(
  public.record_application_artifact(
    'ac000000-0000-4000-8000-000000000001',
    (select value from generation_ids where key = 'pack'),
    pg_catalog.jsonb_build_object(
      'kind', 'resume',
      'style', 'standard',
      'title', 'Resume for Workflow Automation Engineer',
      'content', '{"sections":[{"heading":"Professional summary","paragraphs":["Workflow automation specialist"],"body":"Workflow automation specialist","sources":[]}]}'::jsonb,
      'plainText', E'Professional summary\n\nWorkflow automation specialist',
      'evidenceFactIds', pg_catalog.jsonb_build_array((select value from generation_ids where key = 'fact'))
    ),
    gen_random_uuid()
  ) is not null,
  'a generated artifact is recorded through the truth gate'
);

insert into generation_payloads (key, value)
select 'finalized', public.generate_application_pack_artifacts(
  'ac000000-0000-4000-8000-000000000001',
  (select value from generation_ids where key = 'pack'),
  array['resume', 'cover_letter']::public.application_artifact_kind[],
  'standard',
  gen_random_uuid()
);

select is(
  (select value ->> 'finalized' from generation_payloads where key = 'finalized'),
  'true',
  'the call made after the artifacts exist reports the pack as finalized'
);
select is(
  (select status::text from public.application_packs
   where id = (select value from generation_ids where key = 'pack')),
  'ready',
  'the pack is marked ready through the existing helper'
);
select is(
  (select pg_catalog.jsonb_array_length(value -> 'artifacts') from generation_payloads where key = 'finalized'),
  1,
  'the RPC returns the artifacts stored on the pack'
);
select is(
  (select count(*)::integer from public.audit_events
   where action = 'application_pack.generation_finalized'),
  1,
  'finalisation is audited'
);
select ok(
  not pg_catalog.has_function_privilege(
    'authenticated',
    'public.generate_application_pack_artifacts(uuid, uuid, public.application_artifact_kind[], text, uuid)',
    'execute'
  ),
  'a client cannot call the generation function directly'
);

select * from finish();
rollback;
