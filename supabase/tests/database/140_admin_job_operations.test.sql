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

select plan(42);

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
    'ad000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'ops-admin@hanaply.test',
    crypt('OpsAdmin1', gen_salt('bf')), now(), '{}',
    '{"display_name":"Ops Admin"}', now(), now(), false, false
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'ad000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'ops-customer@hanaply.test',
    crypt('OpsCustomer1', gen_salt('bf')), now(), '{}',
    '{"display_name":"Ops Customer"}', now(), now(), false, false
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'ad000000-0000-4000-8000-000000000003',
    'authenticated', 'authenticated', 'ops-readonly@hanaply.test',
    crypt('OpsReadonly1', gen_salt('bf')), now(), '{}',
    '{"display_name":"Ops Readonly"}', now(), now(), false, false
  );

insert into public.admin_memberships (user_id, status, created_by)
values
  ('ad000000-0000-4000-8000-000000000001', 'active', 'ad000000-0000-4000-8000-000000000001'),
  ('ad000000-0000-4000-8000-000000000003', 'active', 'ad000000-0000-4000-8000-000000000001');

insert into public.admin_role_assignments (admin_user_id, role_id, assigned_by)
select 'ad000000-0000-4000-8000-000000000001', role.id, 'ad000000-0000-4000-8000-000000000001'
from public.admin_roles as role
where role.code = 'operations_administrator';

insert into public.admin_role_assignments (admin_user_id, role_id, assigned_by)
select 'ad000000-0000-4000-8000-000000000003', role.id, 'ad000000-0000-4000-8000-000000000001'
from public.admin_roles as role
where role.code = 'read_only_analyst';

insert into public.subscriptions (user_id, plan_id, status, starts_at, ends_at, source)
select 'ad000000-0000-4000-8000-000000000002', plans.id, 'active',
       now() - interval '1 day', now() + interval '30 days', 'admin_grant'
from public.plans where code = 'plus_monthly';

insert into public.job_sources (
  code, display_name, source_kind, base_url, attribution, min_scan_interval_minutes,
  requires_credentials, credential_env_var
)
values
  ('ops_open', 'Ops Open', 'manual', 'https://example.test/open', 'Synthetic test source.', 60, false, null),
  ('ops_keyed', 'Ops Keyed', 'adzuna', 'https://example.test/keyed', 'Synthetic test source.', 60, true, 'ADZUNA_APP_ID')
on conflict (code) do nothing;

create temporary table ops_ids (key text primary key, value uuid not null);
grant all on table ops_ids to service_role;

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into ops_ids (key, value)
select 'open', id from public.job_sources where code = 'ops_open';
insert into ops_ids (key, value)
select 'keyed', id from public.job_sources where code = 'ops_keyed';

insert into ops_ids (key, value)
select 'job-a', (public.upsert_ingested_job(
  (select value from ops_ids where key = 'open'),
  pg_catalog.jsonb_build_object(
    'sourceJobId', 'ops-a',
    'sourceUrl', 'https://example.test/jobs/a',
    'title', 'Automation Engineer',
    'companyName', 'Northstar Systems',
    'description', repeat('Own automation between business systems. ', 10),
    'employmentType', 'full_time',
    'remoteState', 'remote',
    'locationRaw', 'Remote - Philippines',
    'countryCode', 'PH',
    'postedAt', (now() - interval '1 day'),
    'contentFingerprint', repeat('1', 64),
    'payloadChecksum', repeat('2', 64),
    'rawPayload', '{"id":"ops-a"}'::jsonb
  ),
  gen_random_uuid()
) ->> 'jobId')::uuid;

insert into ops_ids (key, value)
select 'job-b', (public.upsert_ingested_job(
  (select value from ops_ids where key = 'open'),
  pg_catalog.jsonb_build_object(
    'sourceJobId', 'ops-b',
    'sourceUrl', 'https://example.test/jobs/b',
    'title', 'Automation Engineer',
    'companyName', 'Northstar Systems',
    'description', repeat('A separate requisition for a different team entirely. ', 10),
    'employmentType', 'full_time',
    'remoteState', 'remote',
    'locationRaw', 'Remote - Philippines',
    'countryCode', 'PH',
    'postedAt', (now() - interval '300 days'),
    'contentFingerprint', repeat('3', 64),
    'payloadChecksum', repeat('4', 64),
    'rawPayload', '{"id":"ops-b"}'::jsonb
  ),
  gen_random_uuid()
) ->> 'jobId')::uuid;

select is(
  (select count(*)::integer from public.jobs),
  2,
  'the fixture produces two canonical jobs'
);
select is(
  (select count(*)::integer from public.job_dedup_candidates where resolution is null),
  1,
  'the distant posting date leaves one open deduplication candidate'
);

-- ---------------------------------------------------------------------------
-- Authorization
-- ---------------------------------------------------------------------------

select ok(
  pg_temp.operation_fails($statement$select public.admin_job_source_directory(
    'ad000000-0000-4000-8000-000000000002')$statement$),
  'a customer cannot read the provider catalogue'
);
select ok(
  pg_temp.operation_fails($statement$select public.admin_ingestion_health(
    'ad000000-0000-4000-8000-000000000002')$statement$),
  'a customer cannot read ingestion health'
);
select ok(
  pg_temp.operation_fails($statement$select public.admin_job_directory(
    'ad000000-0000-4000-8000-000000000002')$statement$),
  'a customer cannot read the internal job directory'
);
select ok(
  pg_temp.operation_fails($statement$select public.admin_set_job_source_state(
    'ad000000-0000-4000-8000-000000000003',
    (select value from ops_ids where key = 'open'), 'enable', 'Enable it please.', gen_random_uuid())$statement$),
  'a read-only analyst cannot enable a provider'
);
select ok(
  pg_temp.operation_fails($statement$select public.admin_resolve_dedup_candidate(
    'ad000000-0000-4000-8000-000000000003',
    (select id from public.job_dedup_candidates limit 1),
    'merged', 'Merging these records.', gen_random_uuid())$statement$),
  'a read-only analyst cannot resolve a duplication candidate'
);
select ok(
  pg_temp.operation_fails($statement$select public.admin_set_job_status(
    'ad000000-0000-4000-8000-000000000002',
    (select value from ops_ids where key = 'job-a'), 'rejected', 'Rejecting this posting.', gen_random_uuid())$statement$),
  'a customer cannot change a job status'
);
select ok(
  pg_catalog.jsonb_array_length(
    public.admin_job_source_directory('ad000000-0000-4000-8000-000000000003') -> 'items'
  ) > 0,
  'a read-only analyst can read the provider catalogue'
);

select ok(
  pg_catalog.jsonb_array_length(
    public.admin_job_source_directory('ad000000-0000-4000-8000-000000000001') -> 'items'
  ) >= 2,
  'the operations administrator sees every catalogued provider'
);
select ok(
  (public.admin_ingestion_health('ad000000-0000-4000-8000-000000000001') -> 'totals' ->> 'activeJobs')::integer >= 1,
  'ingestion health reports the active job count'
);
select is(
  (public.admin_ingestion_health('ad000000-0000-4000-8000-000000000001')
    -> 'totals' ->> 'openDeduplicationCandidates'),
  '1',
  'ingestion health reports the open deduplication count'
);
select ok(
  pg_temp.operation_fails($statement$select public.admin_ingestion_health(
    'ad000000-0000-4000-8000-000000000001', 500)$statement$),
  'an out-of-range run limit is rejected'
);

-- ---------------------------------------------------------------------------
-- Provider state changes
-- ---------------------------------------------------------------------------

select is(
  public.admin_set_job_source_state(
    'ad000000-0000-4000-8000-000000000001',
    (select value from ops_ids where key = 'open'),
    'enable',
    'Attribution and terms reviewed; enabling this provider.',
    gen_random_uuid()
  ),
  1,
  'an operations administrator enables a reviewed provider'
);
select is(
  (select status::text from public.job_sources where id = (select value from ops_ids where key = 'open')),
  'active',
  'the provider becomes active'
);
select ok(
  pg_temp.operation_fails($statement$update public.job_sources
    set credential_env_var = null where code = 'ops_keyed'$statement$),
  'a credential-backed provider cannot exist without a named credential variable'
);
select ok(
  pg_temp.operation_fails($statement$select public.admin_set_job_source_state(
    'ad000000-0000-4000-8000-000000000001',
    (select value from ops_ids where key = 'open'),
    'enable',
    'short',
    gen_random_uuid())$statement$),
  'a provider state change requires a recorded reason'
);
select is(
  (select count(*)::integer from public.audit_events where action = 'job_source.state_changed'),
  1,
  'the provider state change is audited'
);
select ok(
  pg_temp.operation_fails($statement$select public.admin_update_job_source_config(
    'ad000000-0000-4000-8000-000000000001',
    (select value from ops_ids where key = 'open'),
    '{"apiKey":"live-secret-value"}'::jsonb,
    'Setting the provider configuration.',
    gen_random_uuid())$statement$),
  'credentials are refused in provider configuration'
);
select is(
  public.admin_update_job_source_config(
    'ad000000-0000-4000-8000-000000000001',
    (select value from ops_ids where key = 'open'),
    '{"boardTokens":["northstar"]}'::jsonb,
    'Recording the approved board tokens for this provider.',
    gen_random_uuid()
  ),
  true,
  'a non-secret provider configuration is accepted'
);
select is(
  (select config -> 'boardTokens' ->> 0 from public.job_sources where id = (select value from ops_ids where key = 'open')),
  'northstar',
  'the provider configuration is stored'
);
select is(
  public.admin_request_source_scan(
    'ad000000-0000-4000-8000-000000000001',
    (select value from ops_ids where key = 'open'),
    gen_random_uuid()
  ),
  true,
  'an operator can request an immediate scan of an enabled provider'
);
select ok(
  (select last_success_at is null from public.job_sources where id = (select value from ops_ids where key = 'open')),
  'requesting a scan clears the last-success marker so the provider is due'
);
select is(
  (select count(*)::integer from public.audit_events where action = 'job_source.scan_requested'),
  1,
  'the scan request is audited'
);

-- ---------------------------------------------------------------------------
-- Job records
-- ---------------------------------------------------------------------------

select is(
  (public.admin_job_directory('ad000000-0000-4000-8000-000000000001', 'northstar') ->> 'total')::integer,
  2,
  'the internal job directory searches by employer'
);
select is(
  (public.admin_job_directory('ad000000-0000-4000-8000-000000000001', null, 'active') ->> 'total')::integer,
  2,
  'the internal job directory filters by status'
);
select is(
  (public.admin_job_detail(
    'ad000000-0000-4000-8000-000000000001',
    (select value from ops_ids where key = 'job-a')
  ) -> 'sources' -> 0 ->> 'sourceCode'),
  'ops_open',
  'job detail reports the provider that carried the posting'
);
select is(
  (select pg_catalog.jsonb_typeof(
    public.admin_job_detail(
      'ad000000-0000-4000-8000-000000000001',
      (select value from ops_ids where key = 'job-a')
    ) -> 'duplicateCandidates'
  )),
  'array',
  'job detail reports its duplication candidates'
);
select is(
  public.admin_set_job_status(
    'ad000000-0000-4000-8000-000000000001',
    (select value from ops_ids where key = 'job-b'),
    'rejected',
    'This posting violates the source content policy.',
    gen_random_uuid()
  ),
  true,
  'an operator can remove a posting from the feed'
);
select is(
  (select status::text from public.jobs where id = (select value from ops_ids where key = 'job-b')),
  'rejected',
  'the rejected posting leaves the active feed'
);
select is(
  (select count(*)::integer from public.audit_events where action = 'job.status_changed'),
  1,
  'the job status change is audited'
);

-- ---------------------------------------------------------------------------
-- Deduplication review
-- ---------------------------------------------------------------------------

select is(
  (public.admin_dedup_candidates('ad000000-0000-4000-8000-000000000001') ->> 'openCount')::integer,
  1,
  'the deduplication queue reports one open pair'
);
select is(
  (public.admin_dedup_candidates('ad000000-0000-4000-8000-000000000001') -> 'items' -> 0 ->> 'jobTitle'),
  'Automation Engineer',
  'the queue reports the surviving posting title'
);
select is(
  (public.admin_dedup_candidates('ad000000-0000-4000-8000-000000000001')
    -> 'items' -> 0 -> 'score'),
  '0.600'::jsonb,
  'the queue reports the similarity score that put the pair in review'
);
select is(
  public.admin_resolve_dedup_candidate(
    'ad000000-0000-4000-8000-000000000001',
    (select id from public.job_dedup_candidates where resolution is null limit 1),
    'kept_separate',
    'These are two genuine openings for different teams.',
    gen_random_uuid()
  ),
  true,
  'an operator can confirm that a pair is genuinely distinct'
);
select is(
  (select count(*)::integer from public.job_dedup_candidates where resolution is null),
  0,
  'the resolved pair leaves the review queue'
);
select ok(
  pg_temp.operation_fails($statement$select public.admin_resolve_dedup_candidate(
    'ad000000-0000-4000-8000-000000000001',
    (select id from public.job_dedup_candidates limit 1),
    'merged',
    'Resolving the same candidate twice.',
    gen_random_uuid())$statement$),
  'a resolved candidate cannot be resolved again'
);
select is(
  (select count(*)::integer from public.audit_events where action = 'job_dedup.resolved'),
  1,
  'the deduplication decision is audited'
);
select ok(
  pg_temp.operation_fails($statement$select public.admin_resolve_dedup_candidate(
    'ad000000-0000-4000-8000-000000000001',
    (select id from public.job_dedup_candidates limit 1),
    'delete_everything',
    'An unsupported resolution value.',
    gen_random_uuid())$statement$),
  'an unsupported resolution is rejected'
);

-- ---------------------------------------------------------------------------
-- Row-level security on the operational tables
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"ad000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);

select ok(
  pg_temp.operation_fails($statement$select count(*) from public.job_ingestion_runs$statement$),
  'ingestion runs are denied to any authenticated caller'
);
select ok(
  pg_temp.operation_fails($statement$select count(*) from public.job_dedup_candidates$statement$),
  'deduplication diagnostics are denied to any authenticated caller'
);
select ok(
  pg_temp.operation_fails($statement$select config from public.job_sources$statement$),
  'provider configuration stays private even when a provider is enabled'
);

select * from finish();
rollback;
