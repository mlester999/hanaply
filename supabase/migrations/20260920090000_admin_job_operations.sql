-- Hanaply job operations: provider governance, ingestion health, job records,
-- and deduplication diagnostics.
--
-- Operators need to answer four questions without touching SQL by hand:
--
--   1. Which providers are enabled, and are they healthy?
--   2. What did the last scans actually do?
--   3. Is the canonical job table sensible, and is anything obviously wrong?
--   4. Did deduplication merge something it should not have?
--
-- Every function here is service-role only and requires an explicit catalogue
-- permission, and every state change writes an audit event. No function in this
-- migration can be reached by an anon or authenticated caller.

-- ---------------------------------------------------------------------------
-- Provider governance
-- ---------------------------------------------------------------------------

create or replace function public.admin_job_source_directory(actor_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app_private.require_admin_actor(actor_user_id, 'job_sources.read');

  return pg_catalog.jsonb_build_object(
    'items', coalesce((
      select pg_catalog.jsonb_agg(
        app_private.job_source_snapshot(source)
          || pg_catalog.jsonb_build_object(
            'jobCount', (
              select pg_catalog.count(*) from public.job_source_records as record
              where record.source_id = source.id and record.status = 'active'
            ),
            'credentialConfigured', case
              when not source.requires_credentials then true
              when source.credential_env_var is null then false
              else null
            end,
            'due', (
              source.status = 'active'
              and (source.circuit_open_until is null or source.circuit_open_until <= now())
              and (
                source.last_success_at is null
                or source.last_success_at
                   <= now() - pg_catalog.make_interval(mins => source.min_scan_interval_minutes)
              )
            )
          )
        order by source.status, source.code
      )
      from public.job_sources as source
    ), '[]'::jsonb),
    'evaluatedAt', now()
  );
end;
$$;

comment on function public.admin_job_source_directory(uuid) is
  'Provider catalogue with health and due state. credentialConfigured is null when the environment variable name is known but whether the secret is present can only be answered by the worker process, never by the database.';

create or replace function public.admin_set_job_source_state(
  actor_user_id uuid,
  target_source_id uuid,
  requested_action text,
  action_reason text,
  action_request_id uuid default null
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  source public.job_sources;
  next_status public.job_source_status;
  updated integer := 0;
begin
  perform app_private.require_admin_actor(actor_user_id, 'job_sources.manage');

  if requested_action not in ('enable', 'pause', 'disable') then
    raise exception 'unsupported provider action' using errcode = '22023';
  end if;
  if action_reason is null or pg_catalog.char_length(pg_catalog.btrim(action_reason)) < 10 then
    raise exception 'a reason of at least 10 characters is required' using errcode = '22023';
  end if;

  select * into source from public.job_sources where id = target_source_id;
  if source.id is null then
    raise exception 'job source does not exist' using errcode = 'P0002';
  end if;

  -- A credential-backed provider cannot be enabled until the operator has named
  -- the environment variable that holds its secret.
  if requested_action = 'enable'
    and source.requires_credentials
    and source.credential_env_var is null then
    raise exception 'this provider needs a credential environment variable before it can be enabled'
      using errcode = '22023';
  end if;

  next_status := case requested_action
    when 'enable' then 'active'::public.job_source_status
    when 'pause' then 'paused'::public.job_source_status
    else 'disabled'::public.job_source_status
  end;

  update public.job_sources
  set status = next_status,
      -- Enabling clears a stale circuit; pausing or disabling leaves health
      -- history intact so the operator can still see why it was paused.
      circuit_open_until = case when requested_action = 'enable' then null else circuit_open_until end,
      consecutive_failures = case when requested_action = 'enable' then 0 else consecutive_failures end
  where id = source.id;
  get diagnostics updated = row_count;

  insert into public.audit_events (
    actor_user_id, actor_type, action, target_type, target_id, request_id,
    before_state, after_state, metadata
  ) values (
    actor_user_id, 'admin', 'job_source.state_changed', 'job_source', source.id, action_request_id,
    pg_catalog.jsonb_build_object('status', source.status),
    pg_catalog.jsonb_build_object('status', next_status),
    pg_catalog.jsonb_build_object('reason', pg_catalog.left(action_reason, 500))
  );

  return updated;
end;
$$;

create or replace function public.admin_update_job_source_config(
  actor_user_id uuid,
  target_source_id uuid,
  requested_config jsonb,
  action_reason text,
  action_request_id uuid default null
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  source public.job_sources;
begin
  perform app_private.require_admin_actor(actor_user_id, 'job_sources.manage');

  if pg_catalog.jsonb_typeof(requested_config) <> 'object' then
    raise exception 'provider configuration must be a JSON object' using errcode = '22023';
  end if;
  -- Only credential-shaped *keys* are refused. A substring match on the whole
  -- document would reject legitimate field names such as boardTokens, which
  -- lists public board slugs and holds no secret.
  if exists (
    select 1
    from pg_catalog.jsonb_object_keys(requested_config) as config_key
    where pg_catalog.lower(config_key) in (
      'apikey', 'api_key', 'key', 'secret', 'client_secret', 'password',
      'private_key', 'access_token', 'refresh_token', 'bearer', 'authorization'
    )
  ) then
    raise exception 'provider configuration must not contain credentials'
      using errcode = '22023';
  end if;
  if action_reason is null or pg_catalog.char_length(pg_catalog.btrim(action_reason)) < 10 then
    raise exception 'a reason of at least 10 characters is required' using errcode = '22023';
  end if;

  select * into source from public.job_sources where id = target_source_id;
  if source.id is null then
    raise exception 'job source does not exist' using errcode = 'P0002';
  end if;

  update public.job_sources
  set config = requested_config
  where id = source.id;

  insert into public.audit_events (
    actor_user_id, actor_type, action, target_type, target_id, request_id,
    before_state, after_state, metadata
  ) values (
    actor_user_id, 'admin', 'job_source.config_updated', 'job_source', source.id, action_request_id,
    pg_catalog.jsonb_build_object('config', source.config),
    pg_catalog.jsonb_build_object('config', requested_config),
    pg_catalog.jsonb_build_object('reason', pg_catalog.left(action_reason, 500))
  );

  return true;
end;
$$;

create or replace function public.admin_request_source_scan(
  actor_user_id uuid,
  target_source_id uuid,
  action_request_id uuid default null
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  source public.job_sources;
begin
  perform app_private.require_admin_actor(actor_user_id, 'job_sources.manage');

  select * into source from public.job_sources where id = target_source_id;
  if source.id is null then
    raise exception 'job source does not exist' using errcode = 'P0002';
  end if;
  if source.status <> 'active' then
    raise exception 'only an enabled provider can be scanned' using errcode = '22023';
  end if;

  -- The worker decides what is due from last_success_at, so clearing it makes
  -- the provider due on the next tick without any queue table of its own. The
  -- per-source lock still prevents this from overlapping a scan in progress.
  update public.job_sources
  set last_success_at = null,
      circuit_open_until = null
  where id = source.id;

  insert into public.audit_events (
    actor_user_id, actor_type, action, target_type, target_id, request_id, metadata
  ) values (
    actor_user_id, 'admin', 'job_source.scan_requested', 'job_source', source.id, action_request_id,
    pg_catalog.jsonb_build_object('sourceCode', source.code)
  );

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Ingestion health
-- ---------------------------------------------------------------------------

create or replace function public.admin_ingestion_health(
  actor_user_id uuid,
  run_limit integer default 25
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app_private.require_admin_actor(actor_user_id, 'job_sources.read');

  if run_limit < 1 or run_limit > 200 then
    raise exception 'run_limit must be between 1 and 200' using errcode = '22023';
  end if;

  return pg_catalog.jsonb_build_object(
    'sources', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'sourceId', source.id,
          'sourceCode', source.code,
          'displayName', source.display_name,
          'status', source.status,
          'lastSuccessAt', source.last_success_at,
          'lastFailureAt', source.last_failure_at,
          'lastErrorCode', source.last_error_code,
          'consecutiveFailures', source.consecutive_failures,
          'circuitOpenUntil', source.circuit_open_until,
          'totalJobsIngested', source.total_jobs_ingested,
          'recentRuns', coalesce((
            select pg_catalog.jsonb_agg(
              pg_catalog.jsonb_build_object(
                'id', run.id,
                'trigger', run.trigger,
                'status', run.status,
                'startedAt', run.started_at,
                'finishedAt', run.finished_at,
                'durationMs', run.duration_ms,
                'fetchedCount', run.fetched_count,
                'createdCount', run.created_count,
                'updatedCount', run.updated_count,
                'mergedCount', run.merged_count,
                'skippedCount', run.skipped_count,
                'rejectedCount', run.rejected_count,
                'errorCode', run.error_code
              )
              order by run.started_at desc
            )
            from (
              select * from public.job_ingestion_runs as candidate
              where candidate.source_id = source.id
              order by candidate.started_at desc
              limit 5
            ) as run
          ), '[]'::jsonb)
        )
        order by source.code
      )
      from public.job_sources as source
    ), '[]'::jsonb),
    'recentRuns', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', run.id,
          'sourceCode', source.code,
          'status', run.status,
          'startedAt', run.started_at,
          'durationMs', run.duration_ms,
          'createdCount', run.created_count,
          'errorCode', run.error_code
        )
        order by run.started_at desc
      )
      from (
        select * from public.job_ingestion_runs order by started_at desc limit run_limit
      ) as run
      join public.job_sources as source on source.id = run.source_id
    ), '[]'::jsonb),
    'totals', pg_catalog.jsonb_build_object(
      'activeJobs', (select pg_catalog.count(*) from public.jobs where status = 'active'),
      'staleJobs', (select pg_catalog.count(*) from public.jobs where status = 'stale'),
      'expiredJobs', (select pg_catalog.count(*) from public.jobs where status = 'expired'),
      'companies', (select pg_catalog.count(*) from public.companies),
      'sourceRecords', (select pg_catalog.count(*) from public.job_source_records),
      'openDeduplicationCandidates', (
        select pg_catalog.count(*) from public.job_dedup_candidates where resolution is null
      )
    ),
    'evaluatedAt', now()
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Job records
-- ---------------------------------------------------------------------------

create or replace function public.admin_job_directory(
  actor_user_id uuid,
  search_query text default null,
  status_filter public.job_status default null,
  page_size integer default 25,
  page_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  search_term text := nullif(pg_catalog.btrim(search_query), '');
  total bigint;
begin
  perform app_private.require_admin_actor(actor_user_id, 'jobs.read');

  if page_size < 1 or page_size > 100 then
    raise exception 'page_size must be between 1 and 100' using errcode = '22023';
  end if;
  if page_offset < 0 then
    raise exception 'page_offset must not be negative' using errcode = '22023';
  end if;

  select pg_catalog.count(*) into total
  from public.jobs as jobs
  join public.companies as company on company.id = jobs.company_id
  where (status_filter is null or jobs.status = status_filter)
    and (
      search_term is null
      or jobs.title ilike '%' || search_term || '%'
      or company.display_name ilike '%' || search_term || '%'
    );

  return pg_catalog.jsonb_build_object(
    'items', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', jobs.id,
          'title', jobs.title,
          'companyName', jobs.company_name,
          'status', jobs.status,
          'remoteState', jobs.remote_state,
          'countryCode', jobs.country_code,
          'sourceCount', jobs.source_count,
          'postedAt', jobs.posted_at,
          'firstSeenAt', jobs.first_seen_at,
          'lastSeenAt', jobs.last_seen_at,
          'dedupKey', jobs.dedup_key
        )
        order by coalesce(jobs.posted_at, jobs.first_seen_at) desc, jobs.id
      )
      from (
        select
          candidate.id,
          candidate.title,
          candidate.status,
          candidate.remote_state,
          candidate.country_code,
          candidate.source_count,
          candidate.posted_at,
          candidate.first_seen_at,
          candidate.last_seen_at,
          candidate.dedup_key,
          company.display_name as company_name
        from public.jobs as candidate
        join public.companies as company on company.id = candidate.company_id
        where (status_filter is null or candidate.status = status_filter)
          and (
            search_term is null
            or candidate.title ilike '%' || search_term || '%'
            or company.display_name ilike '%' || search_term || '%'
          )
        order by coalesce(candidate.posted_at, candidate.first_seen_at) desc, candidate.id
        limit page_size offset page_offset
      ) as jobs
    ), '[]'::jsonb),
    'total', total,
    'pageSize', page_size,
    'pageOffset', page_offset
  );
end;
$$;

create or replace function public.admin_job_detail(
  actor_user_id uuid,
  target_job_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target public.jobs;
begin
  perform app_private.require_admin_actor(actor_user_id, 'jobs.read');

  select * into target from public.jobs where id = target_job_id;
  if target.id is null then
    raise exception 'job does not exist' using errcode = 'P0002';
  end if;

  return app_private.job_card_snapshot(target) || pg_catalog.jsonb_build_object(
    'description', target.description,
    'dedupKey', target.dedup_key,
    'contentFingerprint', target.content_fingerprint,
    'normalizedTitle', target.normalized_title,
    'requirements', pg_catalog.to_jsonb(target.requirements),
    'preferredQualifications', pg_catalog.to_jsonb(target.preferred_qualifications),
    'firstSeenAt', target.first_seen_at,
    'lastSeenAt', target.last_seen_at,
    'lastVerifiedAt', target.last_verified_at,
    'sources', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'sourceRecordId', record.id,
          'sourceCode', source.code,
          'displayName', source.display_name,
          'sourceJobId', record.source_job_id,
          'sourceUrl', record.source_url,
          'status', record.status,
          'isPrimary', record.is_primary,
          'firstSeenAt', record.first_seen_at,
          'lastSeenAt', record.last_seen_at,
          'payloadChecksum', record.payload_checksum
        )
        order by record.is_primary desc, source.code
      )
      from public.job_source_records as record
      join public.job_sources as source on source.id = record.source_id
      where record.job_id = target.id
    ), '[]'::jsonb),
    'duplicateCandidates', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', candidate.id,
          'otherJobId', case
            when candidate.job_id = target.id then candidate.duplicate_job_id
            else candidate.job_id
          end,
          'score', candidate.score,
          'signals', candidate.signals,
          'resolution', candidate.resolution,
          'createdAt', candidate.created_at
        )
        order by candidate.created_at desc
      )
      from public.job_dedup_candidates as candidate
      where candidate.job_id = target.id or candidate.duplicate_job_id = target.id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.admin_set_job_status(
  actor_user_id uuid,
  target_job_id uuid,
  requested_status public.job_status,
  action_reason text,
  action_request_id uuid default null
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target public.jobs;
begin
  perform app_private.require_admin_actor(actor_user_id, 'jobs.moderate');

  if requested_status not in ('active', 'rejected', 'closed', 'expired') then
    raise exception 'unsupported job status change' using errcode = '22023';
  end if;
  if action_reason is null or pg_catalog.char_length(pg_catalog.btrim(action_reason)) < 10 then
    raise exception 'a reason of at least 10 characters is required' using errcode = '22023';
  end if;

  select * into target from public.jobs where id = target_job_id;
  if target.id is null then
    raise exception 'job does not exist' using errcode = 'P0002';
  end if;

  update public.jobs
  set status = requested_status,
      freshness_checked_at = now()
  where id = target.id;

  insert into public.audit_events (
    actor_user_id, actor_type, action, target_type, target_id, request_id,
    before_state, after_state, metadata
  ) values (
    actor_user_id, 'admin', 'job.status_changed', 'job', target.id, action_request_id,
    pg_catalog.jsonb_build_object('status', target.status),
    pg_catalog.jsonb_build_object('status', requested_status),
    pg_catalog.jsonb_build_object('reason', pg_catalog.left(action_reason, 500))
  );

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Deduplication diagnostics
-- ---------------------------------------------------------------------------

create or replace function public.admin_dedup_candidates(
  actor_user_id uuid,
  include_resolved boolean default false,
  page_size integer default 25,
  page_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app_private.require_admin_actor(actor_user_id, 'jobs.moderate');

  if page_size < 1 or page_size > 100 then
    raise exception 'page_size must be between 1 and 100' using errcode = '22023';
  end if;

  return pg_catalog.jsonb_build_object(
    'items', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', candidate.id,
          'jobId', candidate.job_id,
          'jobTitle', primary_job.title,
          'jobCompany', primary_company.display_name,
          'duplicateJobId', candidate.duplicate_job_id,
          'duplicateTitle', duplicate_job.title,
          'duplicateCompany', duplicate_company.display_name,
          'duplicateSourceCount', duplicate_job.source_count,
          'score', candidate.score,
          'signals', candidate.signals,
          'resolution', candidate.resolution,
          'resolvedAt', candidate.resolved_at,
          'createdAt', candidate.created_at
        )
        order by candidate.created_at desc
      )
      from (
        select * from public.job_dedup_candidates as entry
        where include_resolved or entry.resolution is null
        order by entry.created_at desc
        limit page_size offset page_offset
      ) as candidate
      join public.jobs as primary_job on primary_job.id = candidate.job_id
      join public.companies as primary_company on primary_company.id = primary_job.company_id
      join public.jobs as duplicate_job on duplicate_job.id = candidate.duplicate_job_id
      join public.companies as duplicate_company on duplicate_company.id = duplicate_job.company_id
    ), '[]'::jsonb),
    'openCount', (
      select pg_catalog.count(*) from public.job_dedup_candidates where resolution is null
    ),
    'evaluatedAt', now()
  );
end;
$$;

create or replace function public.admin_resolve_dedup_candidate(
  actor_user_id uuid,
  target_candidate_id uuid,
  requested_resolution text,
  action_reason text,
  action_request_id uuid default null
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  candidate public.job_dedup_candidates;
  removed integer := 0;
begin
  perform app_private.require_admin_actor(actor_user_id, 'jobs.moderate');

  if requested_resolution not in ('merged', 'kept_separate') then
    raise exception 'resolution must be merged or kept_separate' using errcode = '22023';
  end if;
  if action_reason is null or pg_catalog.char_length(pg_catalog.btrim(action_reason)) < 10 then
    raise exception 'a reason of at least 10 characters is required' using errcode = '22023';
  end if;

  select * into candidate from public.job_dedup_candidates where id = target_candidate_id;
  if candidate.id is null then
    raise exception 'deduplication candidate does not exist' using errcode = 'P0002';
  end if;
  if candidate.resolution is not null then
    raise exception 'this candidate has already been resolved' using errcode = '22023';
  end if;

  if requested_resolution = 'merged' then
    -- Merging re-points provenance from the duplicate onto the surviving record
    -- and marks the duplicate as such. Nothing is deleted: source records keep
    -- their attribution so the merge stays reversible by inspection.
    update public.job_source_records
    set job_id = candidate.job_id
    where job_id = candidate.duplicate_job_id;

    update public.jobs
    set status = 'duplicate',
        source_count = greatest(source_count - 1, 1)
    where id = candidate.duplicate_job_id;

    update public.jobs
    set source_count = (
      select pg_catalog.count(*) from public.job_source_records as record
      where record.job_id = candidate.job_id
    )
    where id = candidate.job_id;
  end if;

  -- Any other open pair that named the duplicate is settled by the same decision.
  update public.job_dedup_candidates
  set resolution = requested_resolution,
      resolved_by = actor_user_id,
      resolved_at = now()
  where id = candidate.id;
  get diagnostics removed = row_count;

  if requested_resolution = 'merged' then
    update public.job_dedup_candidates
    set resolution = 'merged',
        resolved_by = actor_user_id,
        resolved_at = now()
    where resolution is null
      and (job_id = candidate.duplicate_job_id or duplicate_job_id = candidate.duplicate_job_id);
  end if;

  insert into public.audit_events (
    actor_user_id, actor_type, action, target_type, target_id, request_id,
    before_state, after_state, metadata
  ) values (
    actor_user_id, 'admin', 'job_dedup.resolved', 'job', candidate.job_id, action_request_id,
    pg_catalog.jsonb_build_object('candidateId', candidate.id, 'score', candidate.score),
    pg_catalog.jsonb_build_object('resolution', requested_resolution),
    pg_catalog.jsonb_build_object(
      'reason', pg_catalog.left(action_reason, 500),
      'duplicateJobId', candidate.duplicate_job_id
    )
  );

  return removed > 0;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function public.admin_job_source_directory(uuid)
  from public, anon, authenticated;
revoke all on function public.admin_set_job_source_state(uuid, uuid, text, text, uuid)
  from public, anon, authenticated;
revoke all on function public.admin_update_job_source_config(uuid, uuid, jsonb, text, uuid)
  from public, anon, authenticated;
revoke all on function public.admin_request_source_scan(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.admin_ingestion_health(uuid, integer) from public, anon, authenticated;
revoke all on function public.admin_job_directory(uuid, text, public.job_status, integer, integer)
  from public, anon, authenticated;
revoke all on function public.admin_job_detail(uuid, uuid) from public, anon, authenticated;
revoke all on function public.admin_set_job_status(uuid, uuid, public.job_status, text, uuid)
  from public, anon, authenticated;
revoke all on function public.admin_dedup_candidates(uuid, boolean, integer, integer)
  from public, anon, authenticated;
revoke all on function public.admin_resolve_dedup_candidate(uuid, uuid, text, text, uuid)
  from public, anon, authenticated;

grant execute on function public.admin_job_source_directory(uuid) to service_role;
grant execute on function public.admin_set_job_source_state(uuid, uuid, text, text, uuid)
  to service_role;
grant execute on function public.admin_update_job_source_config(uuid, uuid, jsonb, text, uuid)
  to service_role;
grant execute on function public.admin_request_source_scan(uuid, uuid, uuid) to service_role;
grant execute on function public.admin_ingestion_health(uuid, integer) to service_role;
grant execute on function public.admin_job_directory(uuid, text, public.job_status, integer, integer)
  to service_role;
grant execute on function public.admin_job_detail(uuid, uuid) to service_role;
grant execute on function public.admin_set_job_status(uuid, uuid, public.job_status, text, uuid)
  to service_role;
grant execute on function public.admin_dedup_candidates(uuid, boolean, integer, integer)
  to service_role;
grant execute on function public.admin_resolve_dedup_candidate(uuid, uuid, text, text, uuid)
  to service_role;
