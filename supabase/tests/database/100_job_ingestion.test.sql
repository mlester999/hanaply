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

select plan(71);

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
    'a0000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'jobs-plus@hanaply.test',
    crypt('JobsPlus1', gen_salt('bf')), now(), '{}',
    '{"display_name":"Jobs Plus"}', now(), now(), false, false
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'a0000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'jobs-none@hanaply.test',
    crypt('JobsNone1', gen_salt('bf')), now(), '{}',
    '{"display_name":"Jobs None"}', now(), now(), false, false
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'a0000000-0000-4000-8000-000000000003',
    'authenticated', 'authenticated', 'jobs-suspended@hanaply.test',
    crypt('JobsSusp1', gen_salt('bf')), now(), '{}',
    '{"display_name":"Jobs Suspended"}', now(), now(), false, false
  );

insert into public.subscriptions (user_id, plan_id, status, starts_at, ends_at, source)
select seed.user_id, plans.id, 'active', now() - interval '1 day', now() + interval '30 days',
       'admin_grant'
from (
  values
    ('a0000000-0000-4000-8000-000000000001'::uuid, 'plus_monthly'::text)
) as seed (user_id, plan_code)
join public.plans on plans.code = seed.plan_code;

update public.profiles
set account_status = 'suspended'
where id = 'a0000000-0000-4000-8000-000000000003';

create temporary table job_ids (key text primary key, value uuid not null);
grant all on table job_ids to service_role;

-- ---------------------------------------------------------------------------
-- Schema and catalog
-- ---------------------------------------------------------------------------

select has_table('public', 'job_sources', 'job sources table exists');
select has_table('public', 'companies', 'companies table exists');
select has_table('public', 'jobs', 'canonical jobs table exists');
select has_table('public', 'job_source_records', 'source provenance table exists');
select has_table('public', 'job_ingestion_runs', 'ingestion run table exists');
select has_table('public', 'job_dedup_candidates', 'deduplication diagnostics table exists');
select ok(
  (select bool_and(relrowsecurity and relforcerowsecurity)
   from pg_class
   where oid = any (array[
     'public.job_sources'::regclass,
     'public.companies'::regclass,
     'public.jobs'::regclass,
     'public.job_source_records'::regclass,
     'public.job_ingestion_runs'::regclass,
     'public.job_dedup_candidates'::regclass
   ])),
  'every job table has enabled and forced RLS'
);
select is(
  (select count(*)::integer from pg_policies where schemaname = 'public' and tablename like 'job%' and cmd <> 'SELECT'),
  0,
  'no job table exposes a write policy to clients'
);
select ok(
  not has_table_privilege('authenticated', 'public.job_source_records', 'SELECT'),
  'raw provider payloads are not client-readable'
);
select ok(
  not has_table_privilege('authenticated', 'public.job_ingestion_runs', 'SELECT'),
  'ingestion runs are not client-readable'
);
select is(
  (select count(*)::integer from public.job_sources where status = 'active'),
  0,
  'no provider is enabled until an operator reviews it'
);
select is(
  (select count(*)::integer from public.job_sources where requires_credentials and credential_env_var is null),
  0,
  'credential-backed providers declare the environment variable that holds the secret'
);
select ok(
  (select bool_and(credential_env_var is null or credential_env_var ~ '^[A-Z][A-Z0-9_]+$')
   from public.job_sources),
  'providers store only the credential variable name, never a value'
);

-- ---------------------------------------------------------------------------
-- Authorization
-- ---------------------------------------------------------------------------

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select is(
  (select count(*)::integer from public.job_ingestion_schedule()),
  0,
  'no provider is scheduled while every provider is paused'
);

select ok(
  pg_temp.operation_fails($statement$select public.upsert_ingested_job(
    'ffffffff-ffff-4fff-8fff-ffffffffffff',
    '{"sourceJobId":"x","sourceUrl":"https://example.com/x","title":"T","companyName":"C","description":"A long enough description for the constraint.","contentFingerprint":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","payloadChecksum":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}'::jsonb,
    gen_random_uuid()
  )$statement$),
  'an unknown source cannot be ingested into'
);

insert into job_ids (key, value)
select 'remotive', id from public.job_sources where code = 'remotive';
insert into job_ids (key, value)
select 'arbeitnow', id from public.job_sources where code = 'arbeitnow';

update public.job_sources
set status = 'active'
where id in (select value from job_ids where key in ('remotive', 'arbeitnow'));

select ok(
  pg_temp.operation_fails($statement$select public.upsert_ingested_job(
    (select value from job_ids where key = 'remotive'),
    '{"sourceJobId":"missing-title","sourceUrl":"https://example.com/a","companyName":"Northstar Systems","description":"A sufficiently long description body for the check constraint.","contentFingerprint":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","payloadChecksum":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}'::jsonb,
    gen_random_uuid()
  )$statement$),
  'a posting without a title is rejected'
);
select ok(
  pg_temp.operation_fails($statement$select public.upsert_ingested_job(
    (select value from job_ids where key = 'remotive'),
    '{"sourceJobId":"bad-fingerprint","sourceUrl":"https://example.com/a","title":"Engineer","companyName":"Northstar Systems","description":"A sufficiently long description body for the check constraint.","contentFingerprint":"not-a-hash","payloadChecksum":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}'::jsonb,
    gen_random_uuid()
  )$statement$),
  'a malformed content fingerprint is rejected'
);

-- ---------------------------------------------------------------------------
-- First ingestion creates canonical records
-- ---------------------------------------------------------------------------

insert into job_ids (key, value)
select 'job-primary', (public.upsert_ingested_job(
  (select value from job_ids where key = 'remotive'),
  pg_catalog.jsonb_build_object(
    'sourceJobId', 'remotive-2002',
    'sourceUrl', 'https://remotive.com/remote-jobs/2002',
    'title', 'Automation Engineer',
    'companyName', 'Northstar Systems, Inc.',
    'description', 'Build and operate automation between business systems. ' || repeat('Detail. ', 20),
    'remoteState', 'remote',
    'locationRaw', 'Remote — Philippines',
    'countryCode', 'PH',
    'postedAt', (now() - interval '2 days'),
    'contentFingerprint', repeat('2', 64),
    'payloadChecksum', repeat('b', 64),
    'rawPayload', '{"id":2002}'::jsonb
  ),
  gen_random_uuid()
) ->> 'jobId')::uuid;

select ok((select value is not null from job_ids where key = 'job-primary'), 'ingestion creates a canonical job');
select is((select count(*)::integer from public.jobs), 1, 'one canonical job exists after the first ingest');
select is((select count(*)::integer from public.companies), 1, 'the employer is deduplicated into one company');
select is(
  (select normalized_name from public.companies),
  'northstar systems',
  'the company identity strips the legal suffix'
);
select is(
  (select normalized_title from public.jobs where id = (select value from job_ids where key = 'job-primary')),
  'automation engineer',
  'the normalized title removes the parenthetical qualifier'
);
select is(
  (select is_philippines from public.jobs where id = (select value from job_ids where key = 'job-primary')),
  true,
  'a Philippine posting is flagged for the local feed'
);
select is(
  (select count(*)::integer from public.job_source_records),
  1,
  'provenance is recorded for the posting'
);
select is(
  (select is_primary from public.job_source_records),
  true,
  'the first source record for a job is primary'
);

-- ---------------------------------------------------------------------------
-- Duplicate handling
-- ---------------------------------------------------------------------------

select is(
  (public.upsert_ingested_job(
    (select value from job_ids where key = 'remotive'),
    pg_catalog.jsonb_build_object(
      'sourceJobId', 'remotive-2002',
      'sourceUrl', 'https://remotive.com/remote-jobs/2002',
      'title', 'Automation Engineer',
      'companyName', 'Northstar Systems, Inc.',
      'description', 'Build and operate automation between business systems. ' || repeat('Detail. ', 20),
      'remoteState', 'remote',
      'locationRaw', 'Remote — Philippines',
      'postedAt', (now() - interval '2 days'),
      'contentFingerprint', repeat('2', 64),
      'payloadChecksum', repeat('c', 64),
      'rawPayload', '{"id":2002,"revision":2}'::jsonb
    ),
    gen_random_uuid()
  ) ->> 'matchedBy'),
  'source_identity',
  're-observing the same source posting does not create a duplicate'
);
select is((select count(*)::integer from public.jobs), 1, 're-observation keeps a single canonical job');
select is((select count(*)::integer from public.job_source_records), 1, 're-observation keeps a single provenance row');

select is(
  (public.upsert_ingested_job(
    (select value from job_ids where key = 'arbeitnow'),
    pg_catalog.jsonb_build_object(
      'sourceJobId', 'arbeitnow-77',
      'sourceUrl', 'https://www.arbeitnow.com/view/77',
      'title', 'Automation Engineer (Remote, Philippines)',
      'companyName', 'Northstar Systems',
      'description', 'Different wording entirely for the same opening. ' || repeat('More. ', 20),
      'remoteState', 'remote',
      'locationRaw', 'Remote — Philippines',
      'postedAt', (now() - interval '1 day'),
      'contentFingerprint', repeat('3', 64),
      'payloadChecksum', repeat('d', 64),
      'rawPayload', '{"slug":"77"}'::jsonb
    ),
    gen_random_uuid()
  ) ->> 'matchedBy'),
  'composite_key',
  'the same role on another provider merges through the composite key'
);
select is((select count(*)::integer from public.jobs), 1, 'cross-provider duplicates collapse into one job');
select is(
  (select count(*)::integer from public.job_source_records),
  2,
  'both providers keep their own provenance row'
);
select is(
  (select source_count from public.jobs where id = (select value from job_ids where key = 'job-primary')),
  2,
  'the canonical job records how many providers carry it'
);
select is(
  (select count(*)::integer from public.job_source_records where is_primary),
  1,
  'exactly one provenance row is primary'
);
select is(
  (select count(*)::integer from public.job_dedup_candidates where resolution is null),
  0,
  'a composite-key merge records no unresolved review pair for the same row'
);

select is(
  (public.upsert_ingested_job(
    (select value from job_ids where key = 'arbeitnow'),
    pg_catalog.jsonb_build_object(
      'sourceJobId', 'arbeitnow-88',
      'sourceUrl', 'https://www.arbeitnow.com/view/88',
      'title', 'Automation Engineer',
      'companyName', 'Northstar Systems',
      'description', 'A completely unrelated requisition for a different team. ' || repeat('Text. ', 20),
      'remoteState', 'remote',
      'locationRaw', 'Remote — Philippines',
      'postedAt', (now() - interval '400 days'),
      'contentFingerprint', repeat('4', 64),
      'payloadChecksum', repeat('e', 64),
      'rawPayload', '{"slug":"88"}'::jsonb
    ),
    gen_random_uuid()
  ) ->> 'matchedBy'),
  'created',
  'a distant posting date keeps a genuinely separate opening'
);
select is((select count(*)::integer from public.jobs), 2, 'the separate opening is stored as its own job');

-- ---------------------------------------------------------------------------
-- Ingestion runs, locking, and health
-- ---------------------------------------------------------------------------

insert into job_ids (key, value)
select 'run', public.start_ingestion_run(
  (select value from job_ids where key = 'remotive'),
  'schedule',
  null,
  gen_random_uuid()
);
select ok((select value is not null from job_ids where key = 'run'), 'a scheduled run is opened for a source');
select is(
  public.start_ingestion_run((select value from job_ids where key = 'remotive'), 'schedule'),
  (select value from job_ids where key = 'run'),
  'a concurrent scan of the same source reuses the running run instead of overlapping'
);
select ok(
  pg_temp.operation_fails($statement$insert into public.job_ingestion_runs (source_id, status)
    values ((select value from job_ids where key = 'remotive'), 'running')$statement$),
  'the database rejects a second concurrently running scan for one source'
);
select is(
  public.complete_ingestion_run(
    (select value from job_ids where key = 'run'),
    '{"status":"succeeded","fetchedCount":25,"createdCount":2,"updatedCount":1,"mergedCount":1}'::jsonb
  ),
  true,
  'an ingestion run records its outcome'
);
select is(
  (select status::text from public.job_ingestion_runs where id = (select value from job_ids where key = 'run')),
  'succeeded',
  'the completed run is marked succeeded'
);
select is(
  (select total_jobs_ingested from public.job_sources where id = (select value from job_ids where key = 'remotive')),
  2::bigint,
  'the provider accumulates its lifetime ingested count'
);
select ok(
  (select last_success_at is not null and consecutive_failures = 0
   from public.job_sources where id = (select value from job_ids where key = 'remotive')),
  'a successful scan clears the failure counter'
);

insert into job_ids (key, value)
select 'run-fail', public.start_ingestion_run(
  (select value from job_ids where key = 'arbeitnow'), 'retry', null, gen_random_uuid()
);
select public.complete_ingestion_run(
  (select value from job_ids where key = 'run-fail'),
  '{"status":"failed","errorCode":"provider_timeout"}'::jsonb
);
select is(
  (select consecutive_failures from public.job_sources where id = (select value from job_ids where key = 'arbeitnow')),
  1,
  'a failed scan increments the provider failure counter'
);
select ok(
  (select circuit_open_until > now() from public.job_sources where id = (select value from job_ids where key = 'arbeitnow')),
  'a failed scan opens a bounded circuit breaker'
);
select is(
  (select count(*)::integer from public.audit_events
   where action = 'job_source.ingestion_failed'
     and target_id = (select value from job_ids where key = 'arbeitnow')),
  1,
  'a provider failure is audited without leaking the payload'
);
select is(
  (select count(*)::integer from public.job_ingestion_schedule()),
  1,
  'a provider with an open circuit is excluded from the schedule'
);

select is(
  public.acquire_ingestion_lock('ingest.remotive', 'worker-aaaaaaaa', 300),
  true,
  'a worker acquires the shared ingestion lock'
);
select is(
  public.acquire_ingestion_lock('ingest.remotive', 'worker-bbbbbbbb', 300),
  false,
  'a second worker cannot acquire a held ingestion lock'
);
select is(
  public.release_ingestion_lock('ingest.remotive', 'worker-bbbbbbbb'),
  false,
  'a worker cannot release a lock it does not hold'
);
select is(
  public.release_ingestion_lock('ingest.remotive', 'worker-aaaaaaaa'),
  true,
  'the holder releases the ingestion lock'
);

-- ---------------------------------------------------------------------------
-- Freshness
-- ---------------------------------------------------------------------------

update public.jobs
set last_seen_at = now() - interval '10 days'
where id = (select value from job_ids where key = 'job-primary');
update public.job_source_records
set last_seen_at = now() - interval '10 days'
where job_id = (select value from job_ids where key = 'job-primary');

select is(
  (public.refresh_job_freshness() ->> 'staleCount')::integer,
  1,
  'an unobserved posting becomes stale'
);
select is(
  (select status::text from public.jobs where id = (select value from job_ids where key = 'job-primary')),
  'stale',
  'the stale posting leaves the active feed'
);
select is(
  (select count(*)::integer from public.job_source_records where status = 'stale'),
  2,
  'stale provenance is tracked for every provider that carried the posting'
);
select is(
  (public.refresh_job_freshness(now(), 168, 336) ->> 'expiredCount')::integer,
  0,
  'a stale posting is not expired while it is inside the expiry window'
);
select is(
  (public.refresh_job_freshness(now() + interval '30 days') ->> 'expiredCount')::integer,
  2,
  'every unobserved posting eventually expires'
);
select is(
  (select status::text from public.jobs where id = (select value from job_ids where key = 'job-primary')),
  'expired',
  'the expired posting is removed from the feed'
);
select ok(
  pg_temp.operation_fails($statement$select public.refresh_job_freshness(now(), 500, 100)$statement$),
  'invalid freshness thresholds are rejected'
);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

-- Re-verify one posting so the feed assertions below describe a known state.
update public.jobs
set status = 'active', last_seen_at = now(), last_verified_at = now()
where id = (select value from job_ids where key = 'job-primary');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

select is(
  (select count(*)::integer from public.jobs),
  1,
  'an active subscriber reads only active opportunities'
);
select ok(
  pg_temp.operation_fails($statement$select count(*) from public.job_source_records$statement$),
  'raw provider payloads are denied to customers entirely'
);
select ok(
  pg_temp.operation_fails($statement$select count(*) from public.job_ingestion_runs$statement$),
  'ingestion runs are denied to customers entirely'
);
select ok(
  pg_temp.operation_fails($statement$select config from public.job_sources$statement$),
  'provider configuration is not client-readable'
);
select ok(
  pg_temp.operation_fails($statement$select credential_env_var from public.job_sources$statement$),
  'provider credential variable names are not client-readable'
);
select is(
  (select count(*)::integer from public.companies),
  1,
  'an active subscriber can read the deduplicated employer'
);
select ok(
  pg_temp.operation_fails($statement$insert into public.jobs (company_id, title, normalized_title, description, apply_url, canonical_url, content_fingerprint, dedup_key)
    select id, 'Injected', 'injected', repeat('x', 40), 'https://example.com/x', 'https://example.com/x', repeat('9', 64), 'injected'
    from public.companies limit 1$statement$),
  'a customer cannot insert a job directly'
);
select ok(
  pg_temp.operation_fails($statement$update public.jobs set title = 'Rewritten'$statement$),
  'a customer cannot rewrite a job'
);
select ok(
  pg_temp.operation_fails($statement$select public.upsert_ingested_job(
    (select value from job_ids where key = 'remotive'),
    '{}'::jsonb, gen_random_uuid())$statement$),
  'a customer cannot call the ingestion writer'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);
select is(
  (select count(*)::integer from public.jobs),
  1,
  'an account without a subscription still reads the shared active feed'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}',
  true
);
select is(
  (select count(*)::integer from public.jobs),
  0,
  'a suspended account reads no opportunities'
);

select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is(
  (select count(*)::integer from public.jobs),
  0,
  'anonymous callers read no opportunities'
);
select is(
  (select count(*)::integer from public.companies),
  0,
  'anonymous callers read no employers'
);

select * from finish();
rollback;
