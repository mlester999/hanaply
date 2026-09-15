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
 * The canonical content revision, and what it is for.
 *
 * `public.jobs.updated_at` used to be the marker that decided whether an
 * already-scored posting was due again. It is not a content revision: the generic
 * `jobs_set_updated_at` trigger moves it on any update, and
 * `public.refresh_job_freshness` stamps `freshness_checked_at` on every posting
 * on every pass, so the worker's own maintenance cycle re-opened every posting on
 * the next due pass. Thousands of jobs on a schedule re-ran matching, AI
 * enrichment, writes, and notification evaluation for content that had not
 * changed.
 *
 * This suite asserts the replacement end to end, from the ingestion write path
 * through the candidate read to the notification outbox: a canonical fingerprint
 * that moves only when meaningful content moves, a matching-engine version the
 * caller states rather than the database guesses, and a notification queue that a
 * harmless refresh cannot duplicate.
 *
 * One timing note that shapes several assertions: inside a single pgTAP
 * transaction `now()` is fixed, so every write in this file stamps the same
 * timestamp and a timestamp comparison cannot show that a write happened. Where a
 * test needs to show that a re-observation reached the row at all, the *first*
 * write backdates the column rather than the second advancing it — the posting is
 * aged with `last_seen_at = now() - interval '1 day'` before the re-ingest, and
 * the assertion is that the re-ingest brought it back.
 */
select plan(78);

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
    'ae000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'revision-a@hanaply.test',
    crypt('RevisionA1', gen_salt('bf')), now(), '{}',
    '{"display_name":"Revision A"}', now(), now(), false, false
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'ae000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'revision-b@hanaply.test',
    crypt('RevisionB1', gen_salt('bf')), now(), '{}',
    '{"display_name":"Revision B"}', now(), now(), false, false
  );

insert into public.subscriptions (user_id, plan_id, status, starts_at, ends_at, source)
select seed.user_id, plans.id, 'active', now() - interval '1 day', now() + interval '30 days',
       'admin_grant'
from (
  values ('ae000000-0000-4000-8000-000000000001'::uuid)
) as seed (user_id)
join public.plans on plans.code = 'plus_monthly';

insert into public.job_sources (
  code, display_name, source_kind, base_url, attribution, min_scan_interval_minutes
)
values
  ('revision_primary', 'Revision Primary', 'manual', 'https://example.test/primary',
   'Synthetic test source.', 60),
  ('revision_second', 'Revision Second', 'manual', 'https://example.test/second',
   'Synthetic test source.', 60)
on conflict (code) do nothing;

create temporary table revision_ids (key text primary key, value uuid not null);
grant all on table revision_ids to service_role;
create temporary table revision_outcome (key text primary key, value jsonb not null);
grant all on table revision_outcome to service_role;
create temporary table revision_text (key text primary key, value text not null);
grant all on table revision_text to service_role;

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into revision_ids (key, value)
select 'source', id from public.job_sources where code = 'revision_primary';
insert into revision_ids (key, value)
select 'source-two', id from public.job_sources where code = 'revision_second';

insert into revision_ids (key, value)
select 'profile', public.create_career_profile(
  'ae000000-0000-4000-8000-000000000001',
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

/**
 * The posting every scenario below starts from.
 *
 * `content_changed_at` is put back to null afterwards, which is the state the
 * migration's backfill leaves an existing row in: the revision is known, the
 * moment it last moved is not. That is what makes the "no change was invented"
 * assertions meaningful rather than tautological.
 *
 * The column really is set by the insert — an insert is a change by definition —
 * so only the observation of this row is reset, not the mechanism.
 */
insert into revision_ids (key, value)
select 'job', (public.upsert_ingested_job(
  (select value from revision_ids where key = 'source'),
  pg_catalog.jsonb_build_object(
    'sourceJobId', 'revision-1',
    'sourceUrl', 'https://example.test/jobs/revision-1',
    'title', 'Revision Automation Engineer',
    'companyName', 'Revision Systems',
    'description', repeat('Automate business workflows between systems. ', 8),
    'employmentType', 'full_time',
    'seniority', 'mid',
    'remoteState', 'remote',
    'locationRaw', 'Remote - Philippines',
    'countryCode', 'PH',
    'salaryMinMinor', 9000000,
    'salaryCurrency', 'PHP',
    'salaryPeriod', 'monthly',
    'skills', '["n8n"]'::jsonb,
    'requirements', '["Strong n8n experience"]'::jsonb,
    'contentFingerprint', repeat('1', 64),
    'payloadChecksum', repeat('2', 64),
    'rawPayload', '{"id":"revision-1"}'::jsonb
  ),
  gen_random_uuid()
) ->> 'jobId')::uuid;

/*
 * The fixture posting is put into the state the migration's backfill leaves an
 * existing row in. `content_changed_at` belongs to the trigger, which preserves
 * it precisely so a bookkeeping write cannot forge a change — so the only
 * supported way to set it back is the escape hatch the backfill itself uses.
 * `set_config(..., true)` scopes the hatch to this transaction, and it is closed
 * again immediately.
 */
select pg_catalog.set_config('hanaply.job_content_hash_backfill', 'on', true);

update public.jobs
set content_changed_at = null
where id = (select value from revision_ids where key = 'job');

select pg_catalog.set_config('hanaply.job_content_hash_backfill', 'off', true);

select is(
  (select content_changed_at from public.jobs
   where id = (select value from revision_ids where key = 'job')),
  null,
  'the fixture posting is in the state a backfilled posting is left in'
);

update public.jobs
set last_seen_at = now() - interval '1 day'
where id = (select value from revision_ids where key = 'job');

insert into revision_text (key, value)
select 'hash-original', content_hash from public.jobs
where id = (select value from revision_ids where key = 'job');

/**
 * A payload for the fixture source, built from the fixture posting's own current
 * canonical values, so that a scenario changes exactly the fields it names and
 * nothing else. `overrides` is applied last.
 *
 * This is not a convenience: `public.upsert_ingested_job` deliberately does not
 * overwrite canonical content from a re-observation — a source re-sending a
 * posting is an observation, and only a merge brings new content in. A payload
 * that restated fixed literals would therefore not describe the row under test.
 */
create or replace function pg_temp.revision_payload(overrides jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
as $$
  select pg_catalog.jsonb_build_object(
    'sourceJobId', 'revision-1',
    'sourceUrl', 'https://example.test/jobs/revision-1',
    'title', jobs.title,
    'companyName', 'Revision Systems',
    'description', jobs.description,
    'employmentType', jobs.employment_type::text,
    'seniority', jobs.seniority::text,
    'remoteState', jobs.remote_state::text,
    'locationRaw', jobs.location_raw,
    'city', jobs.city,
    'region', jobs.region,
    'countryCode', jobs.country_code,
    'salaryMinMinor', jobs.salary_min_minor,
    'salaryCurrency', jobs.salary_currency,
    'salaryPeriod', jobs.salary_period::text,
    'skills', pg_catalog.to_jsonb(jobs.skills),
    'requirements', pg_catalog.to_jsonb(jobs.requirements),
    'contentFingerprint', repeat('1', 64),
    'payloadChecksum', repeat('2', 64),
    'rawPayload', '{"id":"revision-1"}'::jsonb
  ) || coalesce(overrides, '{}'::jsonb)
  from public.jobs as jobs
  where jobs.id = (select value from pg_temp.revision_ids where key = 'job');
$$;

/** The candidate read for the fixture profile, so assertions read as questions. */
create or replace function pg_temp.candidates(batch integer default 60, model text default 'matching-v1')
returns jsonb
language sql
as $$
  select public.matching_job_candidates(
    'ae000000-0000-4000-8000-000000000001',
    (select value from pg_temp.revision_ids where key = 'profile'),
    batch,
    model
  );
$$;

/** Scores whatever the queue offers, exactly as the worker does. */
create or replace function pg_temp.score_candidates(model text default 'matching-v1')
returns integer
language plpgsql
as $$
declare
  written integer;
begin
  select public.record_job_matches(
    'ae000000-0000-4000-8000-000000000001',
    pg_catalog.jsonb_build_object(
      'careerProfileId', (select value from pg_temp.revision_ids where key = 'profile'),
      'items', (
        select coalesce(
          pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'jobId', entry ->> 'id',
            'score', 70,
            'verdict', 'good_match',
            'confidence', 'medium',
            'modelVersion', model,
            'recommendedAction', 'Apply, and address the gap in your summary honestly rather than leaving it unexplained.',
            'evidenceFactIds', '[]'::jsonb,
            'dataQuality', '{}'::jsonb
          )),
          '[]'::jsonb
        )
        from pg_catalog.jsonb_array_elements(pg_temp.candidates(60, model) -> 'items') as entry
      )
    ),
    gen_random_uuid()
  )
  into written;

  return written;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. First ingestion creates a revision
-- ---------------------------------------------------------------------------

select is(
  pg_catalog.length((select content_hash from public.jobs
    where id = (select value from revision_ids where key = 'job'))),
  64,
  'the first ingestion stores a 64-character canonical content revision'
);
select matches(
  (select content_hash from public.jobs where id = (select value from revision_ids where key = 'job')),
  '^[a-f0-9]{64}$',
  'the revision is a lower-case SHA-256 digest'
);
select is(
  (select content_changed_at from public.jobs
   where id = (select value from revision_ids where key = 'job')),
  null,
  'a revision nobody has observed changing does not claim a change time'
);
select is(
  pg_catalog.jsonb_array_length(pg_temp.candidates() -> 'items'),
  1,
  'and the posting is offered for scoring'
);
select is(
  pg_temp.candidates() -> 'items' -> 0 ->> 'eligibleReason',
  'new_job',
  'because it has never been scored'
);

-- ---------------------------------------------------------------------------
-- 2. An identical re-ingest is an observation, not a change
-- ---------------------------------------------------------------------------

insert into revision_outcome (key, value)
select 'identical', public.upsert_ingested_job(
  (select value from revision_ids where key = 'source'),
  pg_catalog.jsonb_build_object(
    'sourceJobId', 'revision-1',
    'sourceUrl', 'https://example.test/jobs/revision-1',
    'title', 'Revision Automation Engineer',
    'companyName', 'Revision Systems',
    'description', repeat('Automate business workflows between systems. ', 8),
    'employmentType', 'full_time',
    'seniority', 'mid',
    'remoteState', 'remote',
    'locationRaw', 'Remote - Philippines',
    'countryCode', 'PH',
    'salaryMinMinor', 9000000,
    'salaryCurrency', 'PHP',
    'salaryPeriod', 'monthly',
    'skills', '["n8n"]'::jsonb,
    'requirements', '["Strong n8n experience"]'::jsonb,
    'contentFingerprint', repeat('1', 64),
    'payloadChecksum', repeat('5', 64),
    'rawPayload', '{"id":"revision-1","revision":2}'::jsonb
  ),
  gen_random_uuid()
);

select is(
  (select value ->> 'contentChanged' from revision_outcome where key = 'identical'),
  'false',
  'an identical re-ingest reports that the canonical content did not change'
);
select is(
  (select content_hash from public.jobs where id = (select value from revision_ids where key = 'job')),
  (select value from revision_text where key = 'hash-original'),
  'and the canonical revision is unchanged'
);
select is(
  (select content_changed_at from public.jobs
   where id = (select value from revision_ids where key = 'job')),
  null,
  'and no change time was invented'
);
select ok(
  (select last_seen_at > now() - interval '1 hour'
   from public.jobs where id = (select value from revision_ids where key = 'job')),
  'and the posting was observed again, so it is known to be alive'
);
select is(
  (select status::text from public.jobs where id = (select value from revision_ids where key = 'job')),
  'active',
  'and confirmed active'
);
select is(
  (select payload_checksum from public.job_source_records
   where source_id = (select value from revision_ids where key = 'source')),
  repeat('5', 64),
  'and the provider payload checksum was updated even though the content did not change'
);

-- ---------------------------------------------------------------------------
-- 3. Whitespace and case are not content
-- ---------------------------------------------------------------------------

update public.jobs
set last_seen_at = now() - interval '1 day'
where id = (select value from revision_ids where key = 'job');

insert into revision_outcome (key, value)
select 'whitespace', public.upsert_ingested_job(
  (select value from revision_ids where key = 'source'),
  pg_catalog.jsonb_build_object(
    'sourceJobId', 'revision-1',
    'sourceUrl', 'https://example.test/jobs/revision-1',
    'title', '  Revision   Automation Engineer  ',
    'companyName', 'Revision Systems',
    'description', '  ' || repeat('Automate   business workflows between systems. ', 8) || ' ',
    'employmentType', 'FULL_TIME',
    'seniority', 'mid',
    'remoteState', 'remote',
    'locationRaw', 'remote   -   philippines',
    'countryCode', 'ph',
    'salaryMinMinor', 9000000,
    'salaryCurrency', 'php',
    'salaryPeriod', 'monthly',
    'skills', '["n8n","n8n"," N8N "]'::jsonb,
    'requirements', '["Strong n8n experience","  strong N8N experience  "]'::jsonb,
    'contentFingerprint', repeat('1', 64),
    'payloadChecksum', repeat('6', 64),
    'rawPayload', '{"id":"revision-1","revision":3}'::jsonb
  ),
  gen_random_uuid()
);

select is(
  (select value ->> 'contentChanged' from revision_outcome where key = 'whitespace'),
  'false',
  'a whitespace, case, and duplicate-only change is not a content change'
);
select is(
  (select content_hash from public.jobs where id = (select value from revision_ids where key = 'job')),
  (select value from revision_text where key = 'hash-original'),
  'and it produces the same revision as the original'
);

-- ---------------------------------------------------------------------------
-- 4. A meaningful change moves the revision exactly once
-- ---------------------------------------------------------------------------

select is(
  pg_temp.score_candidates(),
  1,
  'the posting is scored against its current revision'
);
select is(
  pg_catalog.jsonb_array_length(pg_temp.candidates() -> 'items'),
  0,
  'and nothing is due immediately afterwards'
);

update public.jobs
set last_seen_at = now() - interval '1 day'
where id = (select value from revision_ids where key = 'job');

insert into revision_outcome (key, value)
select 'description', public.upsert_ingested_job(
  (select value from revision_ids where key = 'source'),
  pg_catalog.jsonb_build_object(
    'sourceJobId', 'revision-1',
    'sourceUrl', 'https://example.test/jobs/revision-1',
    'title', 'Revision Automation Engineer',
    'companyName', 'Revision Systems',
    'description', 'The role now also owns reporting reliability across the team. ' || repeat('Detail. ', 20),
    'employmentType', 'full_time',
    'seniority', 'mid',
    'remoteState', 'remote',
    'locationRaw', 'Remote - Philippines',
    'countryCode', 'PH',
    'salaryMinMinor', 9000000,
    'salaryCurrency', 'PHP',
    'salaryPeriod', 'monthly',
    'skills', '["n8n"]'::jsonb,
    'requirements', '["Strong n8n experience"]'::jsonb,
    'contentFingerprint', repeat('1', 64),
    'payloadChecksum', repeat('7', 64),
    'rawPayload', '{"id":"revision-1","revision":4}'::jsonb
  ),
  gen_random_uuid()
);

select is(
  (select value ->> 'contentChanged' from revision_outcome where key = 'description'),
  'true',
  'a changed description is reported as a content change'
);
select isnt(
  (select content_hash from public.jobs where id = (select value from revision_ids where key = 'job')),
  (select value from revision_text where key = 'hash-original'),
  'and the canonical revision moves'
);
select ok(
  (select content_changed_at is not null from public.jobs
   where id = (select value from revision_ids where key = 'job')),
  'and the change is timed'
);
insert into revision_text (key, value)
select 'changed-at', content_changed_at::text from public.jobs
where id = (select value from revision_ids where key = 'job');

select is(
  pg_catalog.jsonb_array_length(pg_temp.candidates() -> 'items'),
  1,
  'and the changed posting becomes a candidate again'
);
select is(
  pg_temp.candidates() -> 'items' -> 0 ->> 'eligibleReason',
  'content_changed',
  'and it says the content is why'
);
select is(
  pg_temp.score_candidates(),
  1,
  'scoring it stores a result against the new revision'
);
select is(
  pg_catalog.jsonb_array_length(pg_temp.candidates() -> 'items'),
  0,
  'and the queue empties, so one change queues exactly one recomputation'
);
select is(
  (select content_changed_at::text from public.jobs
   where id = (select value from revision_ids where key = 'job')),
  (select value from revision_text where key = 'changed-at'),
  'and a later pass leaves the change time where the change put it'
);

-- ---------------------------------------------------------------------------
-- 5. The canonical revision covers every field a match score reads
-- ---------------------------------------------------------------------------

/*
 * The revision is derived from the canonical row, and a source re-observation
 * does not overwrite canonical content — that is deliberate: a provider
 * re-sending a posting is an observation, and only a merge brings new content in.
 * So a field-change scenario writes the canonical row, which is exactly what the
 * write path does when a merge supplies a value the row did not have, and asserts
 * the two things the revision is for: it moves, and it queues the posting once.
 */

insert into revision_text (key, value)
select 'hash-before-salary', content_hash from public.jobs
where id = (select value from revision_ids where key = 'job');

update public.jobs
set salary_min_minor = 11000000
where id = (select value from revision_ids where key = 'job');

select isnt(
  (select content_hash from public.jobs where id = (select value from revision_ids where key = 'job')),
  (select value from revision_text where key = 'hash-before-salary'),
  'a changed salary floor moves the fingerprint'
);
select ok(
  (select content_changed_at is not null from public.jobs
   where id = (select value from revision_ids where key = 'job')),
  'and the change is timed'
);
select is(
  pg_catalog.jsonb_array_length(pg_temp.candidates() -> 'items'),
  1,
  'and the salary change queues the posting for scoring'
);
select is(
  pg_temp.score_candidates(),
  1,
  'and scoring it clears the queue'
);
select is(
  pg_catalog.jsonb_array_length(pg_temp.candidates() -> 'items'),
  0,
  'and the queue now holds nothing at all'
);

-- A source re-observation must not overwrite the canonical salary it disagrees
-- with, and because it does not, it must not move the revision either.
update public.jobs
set last_seen_at = now() - interval '1 day'
where id = (select value from revision_ids where key = 'job');
insert into revision_text (key, value)
select 'hash-before-source-disagreement', content_hash from public.jobs
where id = (select value from revision_ids where key = 'job');

insert into revision_outcome (key, value)
select 'source-disagreement', public.upsert_ingested_job(
  (select value from revision_ids where key = 'source'),
  pg_temp.revision_payload('{"salaryMinMinor": 9000000}'::jsonb),
  gen_random_uuid()
);

select is(
  (select salary_min_minor from public.jobs where id = (select value from revision_ids where key = 'job')),
  11000000,
  'a re-observation does not overwrite a canonical salary the source disagrees about'
);
select is(
  (select value ->> 'contentChanged' from revision_outcome where key = 'source-disagreement'),
  'false',
  'so it reports no content change'
);
select is(
  (select content_hash from public.jobs where id = (select value from revision_ids where key = 'job')),
  (select value from revision_text where key = 'hash-before-source-disagreement'),
  'and the canonical revision stays where it was'
);

-- ---------------------------------------------------------------------------
-- 6. Provider metadata is not content
-- ---------------------------------------------------------------------------

insert into revision_text (key, value)
select 'hash-before-metadata', content_hash from public.jobs
where id = (select value from revision_ids where key = 'job');

update public.jobs
set last_seen_at = now() - interval '1 day'
where id = (select value from revision_ids where key = 'job');

insert into revision_outcome (key, value)
select 'metadata', public.upsert_ingested_job(
  (select value from revision_ids where key = 'source'),
  pg_temp.revision_payload(pg_catalog.jsonb_build_object(
    -- Everything below is provider bookkeeping: a fresh payload checksum, a new
    -- raw payload, a revised provider-side revision, a new source-supplied dedup
    -- fingerprint, and an expiry.
    'contentFingerprint', repeat('f', 64),
    'payloadChecksum', repeat('a', 64),
    'rawPayload', '{"id":"revision-1","revision":8,"scrapedAt":"now"}'::jsonb,
    'expiresAt', (now() + interval '30 days')
  )),
  gen_random_uuid()
);

select is(
  (select value ->> 'contentChanged' from revision_outcome where key = 'metadata'),
  'false',
  'a provider metadata refresh is not a content change'
);
select is(
  (select content_hash from public.jobs where id = (select value from revision_ids where key = 'job')),
  (select value from revision_text where key = 'hash-before-metadata'),
  'so the canonical revision does not move'
);
select is(
  (select payload_checksum from public.job_source_records
   where source_id = (select value from revision_ids where key = 'source')),
  repeat('a', 64),
  'even though the provider payload checksum was updated'
);
select is(
  (select raw_payload ->> 'revision' from public.job_source_records
   where source_id = (select value from revision_ids where key = 'source')),
  '8',
  'and the raw payload was retained'
);
select ok(
  (select expires_at > now() + interval '29 days' from public.jobs
   where id = (select value from revision_ids where key = 'job')),
  'and the expiry was refreshed'
);
select is(
  pg_catalog.jsonb_array_length(pg_temp.candidates() -> 'items'),
  0,
  'and none of it queued any recomputation'
);

-- ---------------------------------------------------------------------------
-- 7. A second provider does not repeat processing
-- ---------------------------------------------------------------------------

insert into revision_text (key, value)
select 'hash-before-second-source', content_hash from public.jobs
where id = (select value from revision_ids where key = 'job');

/*
 * The same opening as the second provider publishes it. Its title, employer, and
 * location must agree with the canonical row for the composite key to match —
 * "same role, same employer, same place" is what that signal means — so they are
 * read from the row rather than restated. The description differs, which is what
 * makes this a second source rather than the same one; it is not applied, because
 * a merge only fills values the canonical row is missing.
 */
insert into revision_outcome (key, value)
select 'second-source', public.upsert_ingested_job(
  (select value from revision_ids where key = 'source-two'),
  pg_temp.revision_payload('{}'::jsonb) || pg_catalog.jsonb_build_object(
    'sourceJobId', 'revision-second-1',
    'sourceUrl', 'https://example.test/second/revision-1',
    'description', 'A different provider describes the same opening in its own words. ' || repeat('Words. ', 20),
    'contentFingerprint', repeat('3', 64),
    'payloadChecksum', repeat('b', 64),
    'rawPayload', '{"slug":"revision-1","revision":2}'::jsonb
  ),
  gen_random_uuid()
);

select is(
  (select value ->> 'matchedBy' from revision_outcome where key = 'second-source'),
  'composite_key',
  'the second provider is matched to the same posting by the composite key'
);
select is(
  (select value ->> 'contentChanged' from revision_outcome where key = 'second-source'),
  'false',
  'a second provider observing the same posting does not move its content'
);
select is(
  (select content_hash from public.jobs where id = (select value from revision_ids where key = 'job')),
  (select value from revision_text where key = 'hash-before-second-source'),
  'so the canonical revision is unchanged'
);

-- ---------------------------------------------------------------------------
-- 8. Location and employment type are content: the change is visible once the
--    second provider has been merged, so it cannot be confused with the merge.
-- ---------------------------------------------------------------------------

insert into revision_text (key, value)
select 'hash-before-location', content_hash from public.jobs
where id = (select value from revision_ids where key = 'job');

update public.jobs
set remote_state = 'hybrid',
    location_raw = 'Makati, Metro Manila',
    city = 'Makati'
where id = (select value from revision_ids where key = 'job');

select isnt(
  (select content_hash from public.jobs where id = (select value from revision_ids where key = 'job')),
  (select value from revision_text where key = 'hash-before-location'),
  'a changed location and remote state move the fingerprint'
);
select is(
  pg_catalog.jsonb_array_length(pg_temp.candidates() -> 'items'),
  1,
  'and queue the posting for scoring'
);
select is(
  pg_temp.score_candidates(),
  1,
  'and scoring it clears the queue'
);

insert into revision_text (key, value)
select 'hash-before-employment', content_hash from public.jobs
where id = (select value from revision_ids where key = 'job');

update public.jobs
set employment_type = 'contract', seniority = 'senior'
where id = (select value from revision_ids where key = 'job');

select isnt(
  (select content_hash from public.jobs where id = (select value from revision_ids where key = 'job')),
  (select value from revision_text where key = 'hash-before-employment'),
  'a changed employment type and seniority move the fingerprint'
);
select is(
  pg_catalog.jsonb_array_length(pg_temp.candidates() -> 'items'),
  1,
  'and queue the posting for scoring'
);
select is(
  pg_temp.score_candidates(),
  1,
  'and scoring it clears the queue'
);

-- ---------------------------------------------------------------------------
-- 9. The matching engine version is the caller's to state
-- ---------------------------------------------------------------------------

select is(
  (select model_version from public.job_matches
   where job_id = (select value from revision_ids where key = 'job')),
  'matching-v1',
  'the stored result records the engine version it was computed with'
);
select is(
  (select job_content_hash from public.job_matches
   where job_id = (select value from revision_ids where key = 'job')),
  (select content_hash from public.jobs where id = (select value from revision_ids where key = 'job')),
  'and the canonical revision it was computed from'
);
select is(
  pg_catalog.jsonb_array_length(pg_temp.candidates(60, 'matching-v1') -> 'items'),
  0,
  'the recorded version re-queues nothing'
);
select is(
  pg_catalog.jsonb_array_length(pg_temp.candidates(60, 'matching-v2') -> 'items'),
  1,
  'a new engine version re-queues the posting even though its content is unchanged'
);
select is(
  pg_temp.candidates(60, 'matching-v2') -> 'items' -> 0 ->> 'eligibleReason',
  'matching_version_changed',
  'and it says the version is why'
);
select is(
  pg_temp.candidates(60, 'matching-v2') ->> 'modelVersion',
  'matching-v2',
  'and the read reports the version it was asked for'
);
select is(
  pg_temp.score_candidates('matching-v2'),
  1,
  'scoring it under the new version stores the new version'
);
select is(
  (select model_version from public.job_matches
   where job_id = (select value from revision_ids where key = 'job')),
  'matching-v2',
  'and the stored result now names the new engine'
);
select is(
  pg_catalog.jsonb_array_length(pg_temp.candidates(60, 'matching-v2') -> 'items'),
  0,
  'and the version change queued work exactly once'
);

-- ---------------------------------------------------------------------------
-- 9. A profile change re-queues without touching the posting
-- ---------------------------------------------------------------------------

insert into revision_text (key, value)
select 'hash-before-profile-edit', content_hash from public.jobs
where id = (select value from revision_ids where key = 'job');

select public.upsert_career_record(
  'ae000000-0000-4000-8000-000000000001',
  (select value from revision_ids where key = 'profile'),
  'skill', null, '{"name":"supabase","skillKind":"tool"}'::jsonb, gen_random_uuid()
);

select is(
  (select content_hash from public.jobs where id = (select value from revision_ids where key = 'job')),
  (select value from revision_text where key = 'hash-before-profile-edit'),
  'a profile edit leaves the posting revision exactly where it was'
);
select is(
  pg_catalog.jsonb_array_length(pg_temp.candidates(60, 'matching-v2') -> 'items'),
  1,
  'and the posting is still queued because the profile changed'
);
select is(
  pg_temp.candidates(60, 'matching-v2') -> 'items' -> 0 ->> 'eligibleReason',
  'profile_changed',
  'and the reason names the profile, not the posting'
);
select is(
  pg_temp.score_candidates('matching-v2'),
  1,
  're-scoring stores the result against the new profile version'
);
select is(
  pg_catalog.jsonb_array_length(pg_temp.candidates(60, 'matching-v2') -> 'items'),
  0,
  'and an unchanged posting revision never permanently stales a match'
);

-- ---------------------------------------------------------------------------
-- 10. An unchanged refresh cannot duplicate a notification
-- ---------------------------------------------------------------------------

update public.user_notification_preferences
set job_alerts = true
where user_id = 'ae000000-0000-4000-8000-000000000001';

update public.job_matches
set score = 91, verdict = 'strong_match', confidence = 'high', computed_at = now()
where job_id = (select value from revision_ids where key = 'job');

select is(
  public.queue_job_alert_notifications(now(), 30, 75, 100),
  1,
  'a strong match inside the window queues one alert'
);
select is(
  public.queue_job_alert_notifications(now(), 30, 75, 100),
  0,
  'queueing the same window twice is idempotent'
);
select is(
  (select count(*)::integer from public.notification_outbox where category = 'job_alert'),
  1,
  'exactly one alert row exists for the window'
);
insert into revision_text (key, value)
select 'computed-at', computed_at::text from public.job_matches
where job_id = (select value from revision_ids where key = 'job');

/*
 * The harmless refresh: the provider re-sends the posting, nothing about it
 * changes, and the maintenance cycle stamps its bookkeeping columns — including
 * `updated_at`, which is what used to re-open the posting. The revision is
 * captured here rather than earlier because section 8 changed the posting on
 * purpose, and the question this paragraph asks is about this refresh.
 */
insert into revision_text (key, value)
select 'hash-before-refresh', content_hash from public.jobs
where id = (select value from revision_ids where key = 'job');

update public.jobs
set last_seen_at = now() + interval '5 minutes',
    freshness_checked_at = now() + interval '5 minutes',
    updated_at = now() + interval '5 minutes'
where id = (select value from revision_ids where key = 'job');

select is(
  (select content_hash from public.jobs where id = (select value from revision_ids where key = 'job')),
  (select value from revision_text where key = 'hash-before-refresh'),
  'a harmless refresh leaves the canonical revision where it was'
);
select is(
  pg_catalog.jsonb_array_length(pg_temp.candidates(60, 'matching-v2') -> 'items'),
  0,
  'so it queues no recomputation'
);
select is(
  (select computed_at::text from public.job_matches
   where job_id = (select value from revision_ids where key = 'job')),
  (select value from revision_text where key = 'computed-at'),
  'so the stored result is untouched and the analysis cache key built from it is still valid'
);
select is(
  public.queue_job_alert_notifications(now(), 30, 75, 100),
  0,
  'and the alert cannot be queued a second time'
);
select is(
  (select count(*)::integer from public.notification_outbox where category = 'job_alert'),
  1,
  'so no duplicate alert exists after the refresh'
);

-- ---------------------------------------------------------------------------
-- 11. The backfill produced a usable revision for every posting
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::integer from public.jobs where content_hash is null),
  0,
  'every posting in the database has a canonical revision'
);
select ok(
  (select bool_and(content_hash ~ '^[a-f0-9]{64}$') from public.jobs),
  'and every one of them is a well-formed SHA-256 digest'
);
select is(
  (select count(*)::integer from public.jobs
   where content_hash <> app_private.job_content_hash(
     title, description, requirements, preferred_qualifications, skills,
     salary_min_minor, salary_max_minor, salary_currency, salary_period::text,
     salary_is_estimate, location_raw, city, region, country_code,
     remote_state::text, employment_type::text, seniority::text,
     experience_years_min, experience_years_max, apply_url, status::text,
     posted_at, company_id
   )),
  0,
  'and every one of them is exactly what the derivation produces from its own content'
);

-- ---------------------------------------------------------------------------
-- 12. The derivation is deterministic and sensitive to what it should be
-- ---------------------------------------------------------------------------

/*
 * One helper keeps these calls readable. The point of each assertion is which
 * *scalar* field moves the digest, so the array fields are held constant and the
 * scalars are named; the array rules have their own assertion below.
 */
create or replace function pg_temp.hash_of(
  scalar_title text,
  scalar_description text,
  scalar_salary integer default null,
  scalar_url text default 'https://example.test/apply',
  scalar_status text default 'active',
  array_requirements jsonb default '[]'::jsonb,
  scalar_company uuid default null
)
returns text
language sql
stable
as $$
  select app_private.job_content_hash(
    scalar_title,
    scalar_description,
    array(select value from pg_catalog.jsonb_array_elements_text(array_requirements)),
    '{}'::text[],
    '{}'::text[],
    scalar_salary,
    null::integer,
    null::text,
    null::text,
    false,
    null::text,
    null::text,
    null::text,
    null::text,
    null::text,
    null::text,
    null::text,
    null::numeric,
    null::numeric,
    scalar_url,
    scalar_status,
    null::timestamptz,
    scalar_company
  );
$$;

select is(
  pg_temp.hash_of('Title', 'A long enough description body for the hash.'),
  pg_temp.hash_of('  title  ', 'a   long enough description body for the   hash.', null, 'HTTPS://Example.Test/apply', 'ACTIVE'),
  'case, surrounding whitespace, whitespace runs, and URL scheme are not content'
);
select isnt(
  pg_temp.hash_of('Title', 'A long enough description body for the hash.'),
  pg_temp.hash_of('Title', 'A long enough description body for the hash.', 9000000),
  'a salary is content'
);
select is(
  pg_temp.hash_of('Title', 'A long enough description body for the hash.', null, 'https://example.test/apply', 'active', '["b","a","a"]'::jsonb),
  pg_temp.hash_of('Title', 'A long enough description body for the hash.', null, 'https://example.test/apply', 'active', '["a","b"," a "]'::jsonb),
  'array order, duplicates, and element whitespace are not content'
);
select isnt(
  pg_temp.hash_of('Title', 'A long enough description body for the hash.', null, 'https://example.test/apply', 'active', '["a"]'::jsonb),
  pg_temp.hash_of('Title', 'A long enough description body for the hash.', null, 'https://example.test/apply', 'active', '["b"]'::jsonb),
  'a different requirement is content'
);
select isnt(
  pg_temp.hash_of('Title', 'A long enough description body for the hash.'),
  pg_temp.hash_of('Title', 'A long enough description body for the hash.', null, 'https://example.test/other'),
  'a different apply URL is content'
);
select is(
  pg_temp.hash_of('Title', 'A long enough description body for the hash.', null, 'https://example.test/apply', 'active', '[]'::jsonb),
  pg_temp.hash_of('Title', 'A long enough description body for the hash.', null, 'https://example.test/apply', 'active', '["  ",""]'::jsonb),
  'an empty array and an array of blanks are the same content'
);

select * from finish();
rollback;