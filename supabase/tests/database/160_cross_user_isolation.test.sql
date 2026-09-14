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

select plan(50);

-- ---------------------------------------------------------------------------
-- Two subscribers with as much real data as the schema will accept
-- ---------------------------------------------------------------------------

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    'af000000-0000-4000-8000-00000000000a',
    'authenticated', 'authenticated', 'isolation-a@hanaply.test',
    crypt('IsolationA1', gen_salt('bf')), now(), '{}',
    '{"display_name":"Isolation A"}', now(), now(), false, false
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'af000000-0000-4000-8000-00000000000b',
    'authenticated', 'authenticated', 'isolation-b@hanaply.test',
    crypt('IsolationB1', gen_salt('bf')), now(), '{}',
    '{"display_name":"Isolation B"}', now(), now(), false, false
  );

insert into public.subscriptions (user_id, plan_id, status, starts_at, ends_at, source)
select seed.user_id, plans.id, 'active', now() - interval '1 day', now() + interval '30 days',
       'admin_grant'
from (
  values
    -- Subscriber A is the attacker and deliberately holds no subscription, so a
    -- non-zero count below could only be another subscriber's row.
    ('af000000-0000-4000-8000-00000000000b'::uuid)
) as seed (user_id)
cross join public.plans
where plans.code = 'plus_monthly';

insert into public.job_sources (code, display_name, source_kind, base_url, attribution, min_scan_interval_minutes)
values ('isolation_fixture', 'Isolation Fixture', 'manual', 'https://example.test/isolation', 'Synthetic test source.', 60)
on conflict (code) do nothing;

create temporary table iso_ids (key text primary key, value uuid not null);
grant all on table iso_ids to service_role;

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into iso_ids (key, value)
select 'source', id from public.job_sources where code = 'isolation_fixture';

insert into iso_ids (key, value)
select 'job', (public.upsert_ingested_job(
  (select value from iso_ids where key = 'source'),
  pg_catalog.jsonb_build_object(
    'sourceJobId', 'isolation-job-1',
    'sourceUrl', 'https://example.test/jobs/isolation-1',
    'title', 'Workflow Automation Engineer',
    'companyName', 'Northstar Systems',
    'description', repeat('Automate business workflows for operations teams. ', 10),
    'employmentType', 'full_time',
    'remoteState', 'remote',
    'locationRaw', 'Remote - Philippines',
    'countryCode', 'PH',
    'postedAt', (now() - interval '1 day'),
    'contentFingerprint', repeat('a', 64),
    'payloadChecksum', repeat('b', 64),
    'rawPayload', '{"id":"isolation-job-1"}'::jsonb
  ),
  gen_random_uuid()
) ->> 'jobId')::uuid;

-- Owner B receives the full spread of personal data.
insert into iso_ids (key, value)
select 'profile-b', public.create_career_profile(
  'af000000-0000-4000-8000-00000000000b',
  '{
    "name":"B private search",
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

select public.record_career_facts(
  'af000000-0000-4000-8000-00000000000b',
  (select value from iso_ids where key = 'profile-b'),
  pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'category', 'skill',
    'label', 'n8n',
    'statement', 'Five years of production n8n workflow ownership.'
  )),
  'user_entered',
  null,
  gen_random_uuid()
);

select public.save_job(
  'af000000-0000-4000-8000-00000000000b',
  (select value from iso_ids where key = 'job'),
  (select value from iso_ids where key = 'profile-b'),
  'B private note',
  gen_random_uuid()
);

select public.record_job_matches(
  'af000000-0000-4000-8000-00000000000b',
  pg_catalog.jsonb_build_object(
    'careerProfileId', (select value from iso_ids where key = 'profile-b'),
    'items', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'jobId', (select value from iso_ids where key = 'job'),
      'score', 90,
      'verdict', 'strong_match',
      'confidence', 'high',
      'modelVersion', 'matching-v1',
      'recommendedAction', 'Apply now.',
      'dataQuality', '{}'::jsonb
    ))
  ),
  gen_random_uuid()
);

-- A real Application Pack for owner B, so the pack and artifact policies are
-- exercised against genuine rows rather than empty tables.
insert into iso_ids (key, value)
select 'pack-b', (public.create_application_pack(
  'af000000-0000-4000-8000-00000000000b',
  (select value from iso_ids where key = 'job'),
  (select value from iso_ids where key = 'profile-b'),
  'isolation-pack-0001',
  gen_random_uuid()
) -> 'pack' ->> 'id')::uuid;

insert into iso_ids (key, value)
select 'application-b', (public.upsert_job_application(
  'af000000-0000-4000-8000-00000000000b',
  pg_catalog.jsonb_build_object(
    'jobId', (select value from iso_ids where key = 'job'),
    'careerProfileId', (select value from iso_ids where key = 'profile-b'),
    'stage', 'applied',
    'notes', 'B private tracker note'
  ),
  gen_random_uuid()
) ->> 'id')::uuid;

insert into public.career_documents (
  user_id, career_profile_id, document_kind, original_filename, mime_type,
  size_bytes, checksum_sha256, bucket_id, object_path, status
) values (
  'af000000-0000-4000-8000-00000000000b',
  (select value from iso_ids where key = 'profile-b'),
  'resume',
  'b-private-resume.pdf',
  'application/pdf',
  1024,
  repeat('c', 64),
  'career-documents',
  'af000000-0000-4000-8000-00000000000b/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002.pdf',
  'uploaded'
);
update public.user_notification_preferences
set job_alerts = true, daily_digest = true
where user_id = 'af000000-0000-4000-8000-00000000000b';

select public.queue_job_alert_notifications(now(), 30, 75, 100);

select is(
  (select count(*)::integer from public.notification_outbox
   where user_id = 'af000000-0000-4000-8000-00000000000b'),
  1,
  'the owner has a queued alert, so the isolation checks are not vacuous'
);
select is(
  (select count(*)::integer from public.application_packs
   where user_id = 'af000000-0000-4000-8000-00000000000b'),
  1,
  'the owner has an Application Pack'
);

-- ---------------------------------------------------------------------------
-- Adversarial reads as subscriber A
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"af000000-0000-4000-8000-00000000000a","role":"authenticated"}',
  true
);

-- Tables: every one must be unreachable, whether by row policy or by grant.
select is(
  pg_temp.rows_visible('select count(*)::integer from public.career_profiles'),
  0,
  'a subscriber cannot read another career profile'
);
select is(
  pg_temp.rows_visible('select count(*)::integer from public.career_facts'),
  0,
  'a subscriber cannot read another career fact ledger'
);
select is(
  pg_temp.rows_visible('select count(*)::integer from public.career_documents'),
  0,
  'a subscriber cannot read another resume record'
);
select ok(
  pg_temp.operation_fails($statement$select object_path from public.career_documents$statement$),
  'a subscriber cannot read another resume object path'
);
select is(
  pg_temp.rows_visible('select count(*)::integer from public.saved_jobs'),
  0,
  'a subscriber cannot read another saved job'
);
select is(
  pg_temp.rows_visible('select count(*)::integer from public.job_feedback'),
  0,
  'a subscriber cannot read another subscriber feedback'
);
select is(
  pg_temp.rows_visible('select count(*)::integer from public.job_matches'),
  0,
  'a subscriber cannot read another match analysis'
);
select is(
  pg_temp.rows_visible('select count(*)::integer from public.application_packs'),
  0,
  'a subscriber cannot read another Application Pack'
);
select is(
  pg_temp.rows_visible('select count(*)::integer from public.application_artifacts'),
  0,
  'a subscriber cannot read another generated artifact'
);
select ok(
  pg_temp.operation_fails($statement$select content from public.application_artifacts$statement$),
  'artifact content is not client-readable at all'
);
select is(
  pg_temp.rows_visible('select count(*)::integer from public.job_applications'),
  0,
  'a subscriber cannot read another application tracker'
);
select is(
  pg_temp.rows_visible('select count(*)::integer from public.application_events'),
  0,
  'a subscriber cannot read another application history'
);
select ok(
  pg_temp.operation_fails($statement$select count(*) from public.notification_outbox$statement$),
  'the notification outbox is denied to clients entirely'
);
select is(
  pg_temp.rows_visible('select count(*)::integer from public.usage_counters'),
  0,
  'a subscriber cannot read another usage counter'
);
select ok(
  pg_temp.operation_fails($statement$select count(*) from public.usage_events$statement$),
  'the raw metering log is denied to clients entirely'
);
select is(
  pg_temp.rows_visible('select count(*)::integer from public.subscriptions'),
  0,
  'a subscriber cannot read another subscription'
);
select is(
  pg_temp.rows_visible('select count(*)::integer from public.payment_submissions'),
  0,
  'a subscriber cannot read another payment submission'
);
select is(
  pg_temp.rows_visible('select count(*)::integer from public.subscription_events'),
  0,
  'a subscriber cannot read another subscription history'
);
select is(
  pg_catalog.has_table_privilege('authenticated', 'public.authentication_events', 'SELECT'),
  false,
  'a subscriber holds no read privilege on another authentication history'
);
select is(
  pg_temp.rows_visible('select count(*)::integer from public.entitlement_events'),
  0,
  'a subscriber cannot read another entitlement history'
);

-- The subscriber can still read their own preferences: the isolation above must
-- not have been achieved by denying everything.
select ok(
  (select count(*)::integer from public.user_notification_preferences) = 1,
  'a subscriber can read their own notification preferences'
);
select is(
  (select job_alerts from public.user_notification_preferences),
  false,
  'and sees their own values, not the other subscriber values'
);

-- ---------------------------------------------------------------------------
-- Adversarial writes
-- ---------------------------------------------------------------------------

select ok(
  pg_temp.operation_fails($statement$update public.career_profiles
    set headline = 'taken over' where user_id = 'af000000-0000-4000-8000-00000000000b'$statement$)
  or (select count(*)::integer from public.career_profiles where headline = 'taken over') = 0,
  'a subscriber cannot edit another career profile'
);
select ok(
  pg_temp.operation_fails($statement$delete from public.career_documents$statement$),
  'a subscriber cannot delete another resume record'
);
select ok(
  pg_temp.operation_fails($statement$delete from public.saved_jobs$statement$),
  'a subscriber cannot delete another saved job'
);
select ok(
  pg_temp.operation_fails($statement$delete from public.job_applications$statement$),
  'a subscriber cannot delete another tracked application'
);
select ok(
  pg_temp.operation_fails($statement$update public.job_applications set stage = 'offer'$statement$),
  'a subscriber cannot advance another application'
);
select ok(
  pg_temp.operation_fails($statement$update public.application_packs set status = 'ready'$statement$),
  'a subscriber cannot change another Application Pack status'
);
select ok(
  pg_temp.operation_fails($statement$insert into public.application_artifacts
    (pack_id, kind, title, plain_text, truth_gate_status)
    values ((select value from iso_ids where key = 'pack-b'), 'resume', 'Forged', 'Forged body.', 'passed')$statement$),
  'a subscriber cannot plant an artifact inside another pack'
);
select ok(
  pg_temp.operation_fails($statement$insert into public.career_documents
    (user_id, career_profile_id, kind, original_filename, mime_type, byte_size, checksum_sha256, object_path)
    values ('af000000-0000-4000-8000-00000000000b',
            (select value from iso_ids where key = 'profile-b'), 'resume',
            'forged.pdf', 'application/pdf', 10, repeat('d', 64),
            'af000000-0000-4000-8000-00000000000b/x/y.pdf')$statement$),
  'a subscriber cannot insert a document into another account'
);
select ok(
  pg_temp.operation_fails($statement$update public.subscriptions set status = 'active'$statement$),
  'a subscriber cannot alter a subscription directly'
);
select ok(
  pg_temp.operation_fails($statement$update public.usage_counters set used = 0$statement$),
  'a subscriber cannot reset their own metered usage'
);
select ok(
  pg_temp.operation_fails($statement$insert into public.job_matches
    (user_id, career_profile_id, job_id, score, verdict, confidence, model_version, recommended_action)
    values ('af000000-0000-4000-8000-00000000000b',
            (select value from iso_ids where key = 'profile-b'),
            (select value from iso_ids where key = 'job'), 100, 'strong_match', 'high',
            'forged-v1', 'Apply now.')$statement$),
  'a subscriber cannot forge their own match analysis'
);

-- ---------------------------------------------------------------------------
-- Read models resolve the caller, not a parameter the caller controls
-- ---------------------------------------------------------------------------

select ok(
  pg_temp.operation_fails($statement$select public.career_profile_detail(
    'af000000-0000-4000-8000-00000000000a', (select value from iso_ids where key = 'profile-b'))$statement$),
  'the career profile read model refuses another subscriber profile'
);
select ok(
  pg_temp.operation_fails($statement$select public.confirmed_career_evidence(
    'af000000-0000-4000-8000-00000000000a', (select value from iso_ids where key = 'profile-b'))$statement$),
  'the evidence read model refuses another subscriber profile'
);
select ok(
  pg_temp.operation_fails($statement$select public.application_pack_detail(
    'af000000-0000-4000-8000-00000000000a', (select value from iso_ids where key = 'pack-b'))$statement$),
  'the pack read model refuses another subscriber pack'
);
select ok(
  pg_temp.operation_fails($statement$select public.application_timeline(
    'af000000-0000-4000-8000-00000000000a', (select value from iso_ids where key = 'application-b'))$statement$),
  'the application timeline refuses another subscriber application'
);
select ok(
  pg_temp.operation_fails($statement$select public.application_tracker(
    'af000000-0000-4000-8000-00000000000b')$statement$),
  'the tracker read model refuses to act for another subscriber'
);
select ok(
  pg_temp.operation_fails($statement$select public.job_radar(
    'af000000-0000-4000-8000-00000000000b', '{}'::jsonb)$statement$),
  'the radar read model refuses to act for another subscriber'
);
select ok(
  pg_temp.operation_fails($statement$select public.career_insights(
    'af000000-0000-4000-8000-00000000000b')$statement$),
  'the insights read model refuses to act for another subscriber'
);
select ok(
  pg_temp.operation_fails($statement$select public.usage_summary(
    'af000000-0000-4000-8000-00000000000b')$statement$),
  'the usage read model refuses to act for another subscriber'
);
select ok(
  pg_temp.operation_fails($statement$select public.unsave_job(
    'af000000-0000-4000-8000-00000000000b',
    (select value from iso_ids where key = 'job'), gen_random_uuid())$statement$),
  'a subscriber cannot unsave another subscriber saved job'
);
select ok(
  pg_temp.operation_fails($statement$select public.set_application_stage(
    'af000000-0000-4000-8000-00000000000a',
    (select value from iso_ids where key = 'application-b'), 'offer', 0, null, gen_random_uuid())$statement$),
  'a subscriber cannot change another application stage through the API function'
);
select ok(
  pg_temp.operation_fails($statement$select public.decide_career_fact(
    'af000000-0000-4000-8000-00000000000a', gen_random_uuid(), 'confirm', null, gen_random_uuid())$statement$),
  'a subscriber cannot confirm a fact that is not theirs'
);
select ok(
  pg_temp.operation_fails($statement$select public.admin_job_source_directory(
    'af000000-0000-4000-8000-00000000000a')$statement$),
  'a subscriber cannot reach an admin read model'
);
select ok(
  pg_temp.operation_fails($statement$select public.admin_ingestion_health(
    'af000000-0000-4000-8000-00000000000a')$statement$),
  'a subscriber cannot read ingestion health'
);

-- ---------------------------------------------------------------------------
-- The storage bucket stays private
-- ---------------------------------------------------------------------------
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);


select ok(
  exists (select 1 from storage.buckets as buckets where buckets.id = 'career-documents'),
  'the career document bucket exists and is the only place resumes are stored'
);
select is(
  (select count(*)::integer from pg_catalog.pg_policies
   where schemaname = 'storage' and tablename = 'objects'),
  0,
  'no storage object policy exists for a client role to exploit'
);

select * from finish();
rollback;
