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

select plan(40);

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
    'authenticated', 'authenticated', 'alerts-plus@hanaply.test',
    crypt('AlertsPlus1', gen_salt('bf')), now(), '{}',
    '{"display_name":"Alerts Plus"}', now(), now(), false, false
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'ac000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'alerts-pro@hanaply.test',
    crypt('AlertsPro1', gen_salt('bf')), now(), '{}',
    '{"display_name":"Alerts Pro"}', now(), now(), false, false
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'ac000000-0000-4000-8000-000000000003',
    'authenticated', 'authenticated', 'alerts-none@hanaply.test',
    crypt('AlertsNone1', gen_salt('bf')), now(), '{}',
    '{"display_name":"Alerts None"}', now(), now(), false, false
  );

insert into public.subscriptions (user_id, plan_id, status, starts_at, ends_at, source)
select seed.user_id, plans.id, 'active', now() - interval '1 day', now() + interval '30 days',
       'admin_grant'
from (
  values
    ('ac000000-0000-4000-8000-000000000001'::uuid, 'plus_monthly'::text),
    ('ac000000-0000-4000-8000-000000000002'::uuid, 'pro_monthly'::text)
) as seed (user_id, plan_code)
join public.plans on plans.code = seed.plan_code;

insert into public.job_sources (code, display_name, source_kind, base_url, attribution, min_scan_interval_minutes)
values ('alert_fixture', 'Alert Fixture', 'manual', 'https://example.test/alerts', 'Synthetic test source.', 60)
on conflict (code) do nothing;

create temporary table alert_ids (key text primary key, value uuid not null);
grant all on table alert_ids to service_role;

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into alert_ids (key, value)
select 'source', id from public.job_sources where code = 'alert_fixture';

insert into alert_ids (key, value)
select 'profile-plus', public.create_career_profile(
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

insert into alert_ids (key, value)
select 'job', (public.upsert_ingested_job(
  (select value from alert_ids where key = 'source'),
  pg_catalog.jsonb_build_object(
    'sourceJobId', 'alert-job-1',
    'sourceUrl', 'https://example.test/jobs/alert-1',
    'title', 'Workflow Automation Engineer',
    'companyName', 'Northstar Systems',
    'description', repeat('Automate business workflows for operations teams. ', 10),
    'employmentType', 'full_time',
    'remoteState', 'remote',
    'locationRaw', 'Remote - Philippines',
    'countryCode', 'PH',
    'postedAt', (now() - interval '1 hour'),
    'contentFingerprint', repeat('5', 64),
    'payloadChecksum', repeat('6', 64),
    'rawPayload', '{"id":"alert-job-1"}'::jsonb
  ),
  gen_random_uuid()
) ->> 'jobId')::uuid;

-- ---------------------------------------------------------------------------
-- Preferences are real consent toggles
-- ---------------------------------------------------------------------------

select is(
  (select job_alerts from public.user_notification_preferences
   where user_id = 'ac000000-0000-4000-8000-000000000001'),
  false,
  'job alerts start disabled until the subscriber opts in'
);
select is(
  (select daily_digest from public.user_notification_preferences
   where user_id = 'ac000000-0000-4000-8000-000000000001'),
  false,
  'the digest starts disabled until the subscriber opts in'
);
select ok(
  (select count(*)::integer from information_schema.columns
   where table_schema = 'public'
     and table_name = 'user_notification_preferences'
     and column_name in ('job_alerts', 'daily_digest', 'instant_alerts', 'weekly_strategy')) = 4,
  'every notification toggle exists as a real column'
);
select ok(
  pg_temp.operation_fails($statement$insert into public.user_notification_preferences (user_id, quiet_hours_start)
    values ('ac000000-0000-4000-8000-000000000003', 25)$statement$),
  'an out-of-range quiet hour is rejected'
);

-- ---------------------------------------------------------------------------
-- Nothing is queued without consent
-- ---------------------------------------------------------------------------

select public.record_job_matches(
  'ac000000-0000-4000-8000-000000000001',
  pg_catalog.jsonb_build_object(
    'careerProfileId', (select value from alert_ids where key = 'profile-plus'),
    'items', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'jobId', (select value from alert_ids where key = 'job'),
      'score', 91,
      'verdict', 'strong_match',
      'confidence', 'high',
      'modelVersion', 'matching-v1',
      'recommendedAction', 'Apply now.',
      'dataQuality', '{}'::jsonb
    ))
  ),
  gen_random_uuid()
);

select is(
  public.queue_job_alert_notifications(now(), 30, 75, 100),
  0,
  'no alert is queued while the subscriber has not opted in'
);
select is(
  public.queue_job_digest_notifications(now(), 55, 100),
  0,
  'no digest is queued while the subscriber has not opted in'
);
select is(
  (select count(*)::integer from public.notification_outbox),
  0,
  'the outbox stays empty without consent'
);

-- ---------------------------------------------------------------------------
-- Consent plus entitlement queues exactly once
-- ---------------------------------------------------------------------------

update public.user_notification_preferences
set job_alerts = true, daily_digest = true
where user_id = 'ac000000-0000-4000-8000-000000000001';

select is(
  public.queue_job_alert_notifications(now(), 30, 75, 100),
  1,
  'an opted-in subscriber with the entitlement receives one alert'
);
select is(
  public.queue_job_alert_notifications(now(), 30, 75, 100),
  0,
  'queueing the same window again is idempotent'
);
select is(
  (select count(*)::integer from public.notification_outbox where category = 'job_alert'),
  1,
  'exactly one alert row exists for the window'
);
select is(
  (select template_id from public.notification_outbox where category = 'job_alert'),
  'job-alert',
  'the alert uses the job-alert template'
);
select is(
  (select (variables ->> 'jobCount')::integer from public.notification_outbox where category = 'job_alert'),
  1,
  'the alert payload reports how many opportunities it contains'
);
select is(
  (select variables -> 'jobs' -> 0 ->> 'companyName' from public.notification_outbox where category = 'job_alert'),
  'Northstar Systems',
  'the alert payload carries the employer for each opportunity'
);
select is(
  (select (variables ->> 'displayName') from public.notification_outbox where category = 'job_alert'),
  'Alerts Plus',
  'the alert personalises the greeting from the profile'
);
select is(
  (select idempotency_key ~ '^alert:ac000000-0000-4000-8000-000000000001:[0-9]{12}$'
   from public.notification_outbox where category = 'job_alert'),
  true,
  'the alert idempotency key names the subscriber and the window'
);

select is(
  public.queue_job_digest_notifications(now(), 55, 100),
  1,
  'an opted-in subscriber receives one digest'
);
select is(
  public.queue_job_digest_notifications(now(), 55, 100),
  0,
  'queueing the digest twice for the same day is idempotent'
);
select is(
  (select idempotency_key ~ '^digest:ac000000-0000-4000-8000-000000000001:[0-9]{8}$'
   from public.notification_outbox where category = 'daily_digest'),
  true,
  'the digest idempotency key names the subscriber and the local day'
);
select is(
  (select variables ? 'savedCount' from public.notification_outbox where category = 'daily_digest'),
  true,
  'the digest reports the saved opportunity count'
);

select is(
  (select count(*)::integer from public.notification_outbox
   where user_id = 'ac000000-0000-4000-8000-000000000002'),
  0,
  'a subscriber with no profile and no match receives nothing'
);

-- ---------------------------------------------------------------------------
-- Quiet hours
-- ---------------------------------------------------------------------------

update public.user_notification_preferences
set quiet_hours_start = 22, quiet_hours_end = 6
where user_id = 'ac000000-0000-4000-8000-000000000001';

delete from public.notification_outbox;

select is(
  public.queue_job_alert_notifications(
    (pg_catalog.date_trunc('day', now() at time zone 'Asia/Manila') + interval '23 hours') at time zone 'Asia/Manila',
    30, 75, 100
  ),
  0,
  'a non-urgent alert is held during the subscriber quiet hours'
);
select is(
  public.queue_job_alert_notifications(now(), 30, 75, 100) >= 0,
  true,
  'the queueing pass reports a count rather than failing outside quiet hours'
);

-- ---------------------------------------------------------------------------
-- Claim, complete, and release
-- ---------------------------------------------------------------------------

insert into alert_ids (key, value)
select 'claim', gen_random_uuid();

select is(
  (select count(*)::integer from public.claim_notification_outbox(
    (select value from alert_ids where key = 'claim'), 10
  )),
  1,
  'a worker claims a pending notification'
);
select is(
  (select count(*)::integer from public.claim_notification_outbox(
    gen_random_uuid(), 10
  )),
  0,
  'a second worker cannot claim an already claimed row'
);
select ok(
  (select claim_token is not null from public.notification_outbox where status = 'pending' and category = 'job_alert' limit 1),
  'the claim records an opaque token'
);
select is(
  public.complete_notification_outbox(
    (select id from public.notification_outbox where status = 'pending' and category = 'job_alert' limit 1),
    gen_random_uuid(),
    'delivered'
  ),
  false,
  'a completion with the wrong claim token is refused'
);
select is(
  public.complete_notification_outbox(
    (select id from public.notification_outbox where status = 'pending' and category = 'job_alert' limit 1),
    (select claim_token from public.notification_outbox where status = 'pending' and category = 'job_alert' limit 1),
    'delivered',
    'provider-message-1'
  ),
  true,
  'the owning worker completes its claim'
);
select is(
  (select status from public.notification_outbox where status = 'delivered' and category = 'job_alert' limit 1),
  'delivered',
  'the delivered notification leaves the pending queue'
);
select is(
  (select provider_message_id from public.notification_outbox where status = 'delivered' and category = 'job_alert' limit 1),
  'provider-message-1',
  'the provider message identifier is retained for support'
);

update public.notification_outbox
set status = 'pending', claim_token = null, claimed_at = null
where status = 'delivered' and category = 'job_alert';

select is(
  (select count(*)::integer from public.claim_notification_outbox(
    (select value from alert_ids where key = 'claim'), 10
  )),
  1,
  'a released notification can be claimed again'
);
select is(
  public.release_notification_outbox(
    (select id from public.notification_outbox where status = 'pending' and category = 'job_alert' limit 1),
    (select claim_token from public.notification_outbox where status = 'pending' and category = 'job_alert' limit 1),
    now() + interval '5 minutes'
  ),
  true,
  'a transport failure releases the claim for retry'
);
select ok(
  (select attempts from public.notification_outbox where status = 'pending' and category = 'job_alert' limit 1) >= 1,
  'the attempt count is recorded so a retry cap can be enforced'
);
select ok(
  pg_temp.operation_fails($statement$select public.release_notification_outbox(
    (select id from public.notification_outbox where category = 'job_alert' limit 1),
    gen_random_uuid(),
    now() + interval '2 days'
  )$statement$),
  'a retry may not be scheduled more than a day ahead'
);
select ok(
  pg_temp.operation_fails($statement$select public.complete_notification_outbox(
    (select id from public.notification_outbox where category = 'job_alert' limit 1),
    gen_random_uuid(),
    'anything_else'
  )$statement$),
  'an unsupported completion status is rejected'
);

-- ---------------------------------------------------------------------------
-- Freshness of the match drives the alert
-- ---------------------------------------------------------------------------

delete from public.notification_outbox;
update public.job_matches set computed_at = now() - interval '30 days';

select is(
  public.queue_job_alert_notifications(now(), 30, 75, 100),
  0,
  'an alert is not queued for matches computed outside the window'
);
select is(
  public.queue_job_digest_notifications(now(), 55, 100),
  0,
  'the digest only includes matches from the last day'
);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"ac000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

select ok(
  pg_temp.operation_fails($statement$select count(*) from public.notification_outbox$statement$),
  'the notification outbox is denied to clients entirely'
);
select ok(
  pg_temp.operation_fails($statement$update public.notification_outbox set status = 'delivered'$statement$),
  'a client cannot mark its own notification delivered'
);
select ok(
  pg_temp.operation_fails($statement$select public.queue_job_alert_notifications()$statement$),
  'a client cannot trigger the alert queue'
);
select ok(
  pg_temp.operation_fails($statement$insert into public.notification_outbox (user_id, category, template_id, idempotency_key)
    values (auth.uid(), 'job_alert', 'job-alert', 'forged-alert-key-0001')$statement$),
  'a client cannot forge a notification'
);

select * from finish();
rollback;
