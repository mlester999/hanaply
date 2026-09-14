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

select plan(54);

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
    'ab000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'packs-plus@hanaply.test',
    crypt('PacksPlus1', gen_salt('bf')), now(), '{}',
    '{"display_name":"Packs Plus"}', now(), now(), false, false
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'ab000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'packs-free@hanaply.test',
    crypt('PacksFree1', gen_salt('bf')), now(), '{}',
    '{"display_name":"Packs Free"}', now(), now(), false, false
  );

insert into public.subscriptions (user_id, plan_id, status, starts_at, ends_at, source)
select 'ab000000-0000-4000-8000-000000000001', plans.id, 'active',
       now() - interval '1 day', now() + interval '30 days', 'admin_grant'
from public.plans where code = 'plus_monthly';

insert into public.job_sources (code, display_name, source_kind, base_url, attribution, min_scan_interval_minutes)
values ('pack_fixture', 'Pack Fixture', 'manual', 'https://example.test/packs', 'Synthetic test source.', 60)
on conflict (code) do nothing;

create temporary table pack_ids (key text primary key, value uuid not null);
grant all on table pack_ids to service_role;

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into pack_ids (key, value)
select 'source', id from public.job_sources where code = 'pack_fixture';

insert into pack_ids (key, value)
select 'profile', public.create_career_profile(
  'ab000000-0000-4000-8000-000000000001',
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

insert into pack_ids (key, value)
select 'fact', (public.record_career_facts(
  'ab000000-0000-4000-8000-000000000001',
  (select value from pack_ids where key = 'profile'),
  '[{"statement":"Rebuilt onboarding automation for a 40-person team","category":"achievement"}]'::jsonb,
  'user_entered', null, gen_random_uuid()
) -> 'createdIds' ->> 0)::uuid;

insert into pack_ids (key, value)
select 'job', (public.upsert_ingested_job(
  (select value from pack_ids where key = 'source'),
  pg_catalog.jsonb_build_object(
    'sourceJobId', 'pack-job-1',
    'sourceUrl', 'https://example.test/jobs/pack-1',
    'title', 'Workflow Automation Engineer',
    'companyName', 'Northstar Systems',
    'description', repeat('Automate business workflows for operations teams. ', 10),
    'employmentType', 'full_time',
    'remoteState', 'remote',
    'locationRaw', 'Remote — Philippines',
    'countryCode', 'PH',
    'postedAt', (now() - interval '1 day'),
    'contentFingerprint', repeat('7', 64),
    'payloadChecksum', repeat('8', 64),
    'rawPayload', '{"id":"pack-job-1"}'::jsonb
  ),
  gen_random_uuid()
) ->> 'jobId')::uuid;

insert into pack_ids (key, value)
select 'second-job', (public.upsert_ingested_job(
  (select value from pack_ids where key = 'source'),
  pg_catalog.jsonb_build_object(
    'sourceJobId', 'pack-job-2',
    'sourceUrl', 'https://example.test/jobs/pack-2',
    'title', 'Solutions Engineer',
    'companyName', 'Pinebridge Labs',
    'description', repeat('Design solutions for operations teams across the region. ', 10),
    'employmentType', 'full_time',
    'remoteState', 'remote',
    'locationRaw', 'Remote � Philippines',
    'countryCode', 'PH',
    'postedAt', (now() - interval '2 days'),
    'contentFingerprint', repeat('9', 64),
    'payloadChecksum', repeat('c', 64),
    'rawPayload', '{"id":"pack-job-2"}'::jsonb
  ),
  gen_random_uuid()
) ->> 'jobId')::uuid;

-- ---------------------------------------------------------------------------
-- Usage metering
-- ---------------------------------------------------------------------------

select is(
  (public.usage_summary('ab000000-0000-4000-8000-000000000001') -> 'items' -> 0 ->> 'feature'),
  'application_pack',
  'the usage summary reports the Application Pack feature first'
);
select is(
  (public.usage_summary('ab000000-0000-4000-8000-000000000001') -> 'items' -> 0 ->> 'limit'),
  '40',
  'the Plus plan allows forty Application Packs a month'
);
select is(
  (public.usage_summary('ab000000-0000-4000-8000-000000000002') -> 'items' -> 0 ->> 'limit'),
  '0',
  'an account without a subscription has no Application Pack allowance'
);
select is(
  (public.usage_summary('ab000000-0000-4000-8000-000000000001') -> 'items' -> 0 ->> 'used'),
  '0',
  'no usage is recorded before the first pack'
);

-- ---------------------------------------------------------------------------
-- Pack creation and quota
-- ---------------------------------------------------------------------------

insert into pack_ids (key, value)
select 'pack', (public.create_application_pack(
  'ab000000-0000-4000-8000-000000000001',
  (select value from pack_ids where key = 'job'),
  (select value from pack_ids where key = 'profile'),
  'pack-create-0001',
  gen_random_uuid()
) -> 'pack' ->> 'id')::uuid;

select ok(
  (select value is not null from pack_ids where key = 'pack'),
  'an active subscriber creates an Application Pack'
);
select is(
  (select status::text from public.application_packs where id = (select value from pack_ids where key = 'pack')),
  'queued',
  'a new pack starts queued'
);
select is(
  (select used from public.usage_counters
   where user_id = 'ab000000-0000-4000-8000-000000000001' and feature = 'application_pack'),
  1,
  'creating a pack consumes exactly one unit of quota'
);
select is(
  (select pg_catalog.array_length(evidence_fact_ids, 1) from public.application_packs
   where id = (select value from pack_ids where key = 'pack')),
  1,
  'the pack freezes the confirmed evidence available at creation time'
);
select is(
  (public.create_application_pack(
    'ab000000-0000-4000-8000-000000000001',
    (select value from pack_ids where key = 'job'),
    (select value from pack_ids where key = 'profile'),
    'pack-create-0001',
    gen_random_uuid()
  ) ->> 'created'),
  'false',
  'asking for the same pack again is idempotent'
);
select is(
  (select used from public.usage_counters
   where user_id = 'ab000000-0000-4000-8000-000000000001' and feature = 'application_pack'),
  1,
  'a repeated request does not consume quota twice'
);
select ok(
  pg_temp.operation_fails($statement$select public.create_application_pack(
    'ab000000-0000-4000-8000-000000000002',
    (select value from pack_ids where key = 'job'),
    (select value from pack_ids where key = 'profile'),
    'pack-free-0001',
    gen_random_uuid()
  )$statement$),
  'an account with no allowance cannot create a pack'
);
select is(
  (select count(*)::integer from public.usage_events
   where user_id = 'ab000000-0000-4000-8000-000000000002'),
  0,
  'a refused operation leaves no consumption record behind'
);
select is(
  (select count(*)::integer from public.audit_events where action = 'application_pack.created'),
  1,
  'pack creation is audited'
);
select ok(
  pg_temp.operation_fails($statement$select public.create_application_pack(
    'ab000000-0000-4000-8000-000000000001',
    (select value from pack_ids where key = 'second-job'),
    (select value from pack_ids where key = 'profile'),
    'short',
    gen_random_uuid()
  )$statement$),
  'an idempotency key that is too short is rejected'
);

-- ---------------------------------------------------------------------------
-- Truth gate on artifacts
-- ---------------------------------------------------------------------------

select is(
  public.record_application_artifact(
    'ab000000-0000-4000-8000-000000000001',
    (select value from pack_ids where key = 'pack'),
    pg_catalog.jsonb_build_object(
      'kind', 'cover_letter',
      'style', 'professional',
      'title', 'Cover letter for Workflow Automation Engineer',
      'content', '{"paragraphs":["I rebuilt onboarding automation for a 40-person team."]}'::jsonb,
      'plainText', 'I rebuilt onboarding automation for a 40-person team.',
      'evidenceFactIds', pg_catalog.jsonb_build_array((select value from pack_ids where key = 'fact'))
    ),
    gen_random_uuid()
  ) is not null,
  true,
  'an artifact citing a confirmed fact is recorded'
);
select is(
  (select truth_gate_status from public.application_artifacts limit 1),
  'passed',
  'the artifact passes the truth gate'
);
select is(
  (select status::text from public.application_packs where id = (select value from pack_ids where key = 'pack')),
  'ready',
  'recording an artifact marks the pack ready'
);
select ok(
  pg_temp.operation_fails($statement$select public.record_application_artifact(
    'ab000000-0000-4000-8000-000000000001',
    (select value from pack_ids where key = 'pack'),
    pg_catalog.jsonb_build_object(
      'kind', 'strategy',
      'title', 'Strategy',
      'content', '{"steps":["Apply"]}'::jsonb,
      'plainText', 'Apply.',
      'evidenceFactIds', pg_catalog.jsonb_build_array(gen_random_uuid())
    ),
    gen_random_uuid()
  )$statement$),
  'an artifact cannot cite a claim that is not a confirmed fact'
);
select ok(
  pg_temp.operation_fails($statement$insert into public.application_artifacts
    (pack_id, kind, title, content, plain_text, evidence_fact_ids)
    values (
      (select value from pack_ids where key = 'pack'),
      'resume',
      'Direct write',
      '{}'::jsonb,
      'Direct write body.',
      array[gen_random_uuid()]
    )$statement$),
  'the evidence trigger rejects a direct write that cites an unsupported claim'
);
select is(
  public.record_application_artifact(
    'ab000000-0000-4000-8000-000000000001',
    (select value from pack_ids where key = 'pack'),
    pg_catalog.jsonb_build_object(
      'kind', 'cover_letter',
      'style', 'professional',
      'title', 'Cover letter, revised',
      'content', '{"paragraphs":["Revised."]}'::jsonb,
      'plainText', 'Revised.',
      'evidenceFactIds', pg_catalog.jsonb_build_array((select value from pack_ids where key = 'fact'))
    ),
    gen_random_uuid()
  ) is not null,
  true,
  'an artifact can be regenerated for the same style'
);
select is(
  (select version from public.application_artifacts limit 1),
  2,
  'regenerating an artifact increments its version instead of duplicating it'
);
select is(
  (select count(id)::integer from public.application_artifacts),
  1,
  'only one artifact exists per pack, kind, and style'
);

-- ---------------------------------------------------------------------------
-- Pack reads
-- ---------------------------------------------------------------------------

select is(
  (public.application_pack_directory('ab000000-0000-4000-8000-000000000001') -> 'items' -> 0 ->> 'jobTitle'),
  'Workflow Automation Engineer',
  'the pack directory reports the opportunity title'
);
select is(
  (public.application_pack_directory('ab000000-0000-4000-8000-000000000001') -> 'items' -> 0 ->> 'artifactCount'),
  '1',
  'the pack directory reports how many artifacts exist'
);
select is(
  (public.application_pack_detail(
    'ab000000-0000-4000-8000-000000000001',
    (select value from pack_ids where key = 'pack')
  ) -> 'job' ->> 'companyName'),
  'Northstar Systems',
  'pack detail includes the opportunity it was built from'
);
select ok(
  pg_temp.operation_fails($statement$select public.application_pack_detail(
    'ab000000-0000-4000-8000-000000000002',
    (select value from pack_ids where key = 'pack')
  )$statement$),
  'another account cannot read a pack it does not own'
);
select is(
  (public.usage_summary('ab000000-0000-4000-8000-000000000001') -> 'items' -> 0 ->> 'remaining'),
  '39',
  'the usage summary reports the remaining allowance'
);

-- ---------------------------------------------------------------------------
-- Application tracker
-- ---------------------------------------------------------------------------

select is(
  (public.upsert_job_application(
    'ab000000-0000-4000-8000-000000000001',
    pg_catalog.jsonb_build_object(
      'jobId', (select value from pack_ids where key = 'job'),
      'careerProfileId', (select value from pack_ids where key = 'profile'),
      'packId', (select value from pack_ids where key = 'pack'),
      'notes', 'Referred by a former colleague.'
    ),
    gen_random_uuid()
  ) ->> 'stage'),
  'saved',
  'tracking an opportunity starts at the saved stage'
);
select is(
  (select applied_at from public.job_applications), null::timestamptz,
  'a saved application has no applied timestamp'
);
select is(
  (public.upsert_job_application(
    'ab000000-0000-4000-8000-000000000001',
    pg_catalog.jsonb_build_object(
      'jobId', (select value from pack_ids where key = 'job'),
      'stage', 'applied',
      'source', 'external'
    ),
    gen_random_uuid()
  ) ->> 'stage'),
  'applied',
  'an application advances to applied'
);
select ok(
  (select applied_at is not null from public.job_applications),
  'moving to applied records the applied timestamp'
);
select is(
  (select count(id)::integer from public.job_applications),
  1,
  'tracking the same opportunity twice updates one row'
);
select is(
  (select count(*)::integer from public.application_events where new_stage = 'applied'),
  1,
  'the stage change is appended to the history'
);

select is(
  public.set_application_stage(
    'ab000000-0000-4000-8000-000000000001',
    (select id from public.job_applications limit 1),
    'interviewing',
    (select version from public.job_applications limit 1),
    'First interview scheduled.',
    gen_random_uuid()
  ) ->> 'stage',
  'interviewing',
  'an application advances through the pipeline'
);
select is(
  (public.set_application_stage(
    'ab000000-0000-4000-8000-000000000001',
    (select id from public.job_applications limit 1),
    'interviewing',
    (select version from public.job_applications limit 1),
    null,
    gen_random_uuid()
  ) ->> 'stage'),
  'interviewing',
  'a repeated stage change is a no-op'
);
select ok(
  pg_temp.operation_fails($statement$select public.set_application_stage(
    'ab000000-0000-4000-8000-000000000001',
    (select id from public.job_applications limit 1),
    'offer',
    0,
    null,
    gen_random_uuid()
  )$statement$),
  'a stale expected version is rejected'
);
select is(
  (public.set_application_stage(
    'ab000000-0000-4000-8000-000000000001',
    (select id from public.job_applications limit 1),
    'offer',
    (select version from public.job_applications limit 1),
    'Offer received.',
    gen_random_uuid()
  ) ->> 'stage'),
  'offer',
  'the pipeline reaches the offer stage'
);
select is(
  (public.application_tracker('ab000000-0000-4000-8000-000000000001') -> 'counts' ->> 'offer'),
  '1',
  'the tracker reports a per-stage count'
);
select is(
  (public.application_tracker('ab000000-0000-4000-8000-000000000001') -> 'items' -> 0 ->> 'companyName'),
  'Northstar Systems',
  'the tracker item carries the employer name'
);
select ok(
  (public.application_timeline(
    'ab000000-0000-4000-8000-000000000001',
    (select id from public.job_applications limit 1)
  ) -> 'events' -> 0) ? 'newStage',
  'the timeline exposes the stage history'
);
select is(
  (select pg_catalog.jsonb_array_length(
    public.application_timeline(
      'ab000000-0000-4000-8000-000000000001',
      (select id from public.job_applications limit 1)
    ) -> 'events'
  )),
  4,
  'every distinct stage transition is retained'
);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"ab000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

select is(
  (select count(id)::integer from public.application_packs),
  1,
  'a subscriber reads only their own packs'
);
select is(
  (select count(id)::integer from public.application_artifacts),
  1,
  'a subscriber reads only artifacts of their own packs'
);
select is(
  (select count(id)::integer from public.job_applications),
  1,
  'a subscriber reads only their own tracked applications'
);
select is(
  (select count(id)::integer from public.usage_counters),
  1,
  'a subscriber reads only their own usage counters'
);
select ok(
  pg_temp.operation_fails($statement$select count(*) from public.usage_events$statement$),
  'the raw metering log is denied to clients entirely'
);
select ok(
  pg_temp.operation_fails($statement$select content from public.application_artifacts$statement$),
  'artifact structured content is not client-readable'
);
select ok(
  pg_temp.operation_fails($statement$update public.usage_counters set used = 0$statement$),
  'a subscriber cannot reset their own quota'
);
select ok(
  pg_temp.operation_fails($statement$insert into public.application_packs (user_id, career_profile_id, job_id, job_updated_at, profile_version)
    values (auth.uid(), (select value from pack_ids where key = 'profile'), (select value from pack_ids where key = 'job'), now(), 0)$statement$),
  'a subscriber cannot create a pack directly'
);
select ok(
  pg_temp.operation_fails($statement$update public.job_applications set stage = 'offer'$statement$),
  'a subscriber cannot change an application stage directly'
);
select ok(
  pg_temp.operation_fails($statement$delete from public.job_applications$statement$),
  'a subscriber cannot delete a tracked application'
);
select ok(
  pg_temp.operation_fails($statement$select public.usage_summary(auth.uid())$statement$),
  'a subscriber cannot call the metering summary server function directly'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"ab000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);
select is(
  (select count(id)::integer from public.application_packs),
  0,
  'another account sees no packs'
);
select is(
  (select count(id)::integer from public.job_applications),
  0,
  'another account sees no tracked applications'
);

select * from finish();
rollback;
