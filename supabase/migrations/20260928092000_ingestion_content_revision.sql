-- Hanaply ingestion behaviour on the canonical content revision.
--
-- The trigger added by 20260928090000_job_content_hash.sql already keeps
-- `public.jobs.content_hash` correct on every write, including the writes
-- `upsert_ingested_job` performs, because it computes from `NEW`. Nothing here
-- recomputes the hash: duplicating the derivation would create a second
-- implementation that can disagree with the trigger, and a hash computed twice is
-- a hash that is eventually wrong once.
--
-- What this migration adds is the caller's half of the answer. `upsert_ingested_job`
-- now reports whether the canonical content actually changed, so an ingestion run
-- can be read as "N re-observed, M changed" rather than "N written". Every other
-- behaviour is preserved exactly: source-record identity, the content-fingerprint
-- merge path, the composite-key path with posting-date proximity, the
-- dedup-candidate audit rows, provenance, `source_count`, freshness, and the
-- audit action names.
--
-- Re-observation semantics, stated because they are the point:
--
--   * A re-observation whose meaningful content is unchanged refreshes
--     `last_seen_at`, `last_verified_at`, provenance, and `status`, and leaves
--     `content_hash` and `content_changed_at` alone. The generic
--     `jobs_set_updated_at` trigger still moves `updated_at` — that is what it is
--     for — and nothing reads it as a revision any more.
--   * A meaningful change moves the hash and `content_changed_at`, and the worker
--     sees the posting as a candidate again on its next pass.
--   * A second provider's record for the same canonical job follows the same
--     rule: it moves the hash only when the canonical row's meaningful content
--     actually moves. A merge that fills in a salary the canonical row did not
--     have is a content change and moves it; a merge that changes only
--     `source_count`, `last_seen_at`, or provenance does not.
--
-- `record_job_matches` is extended in the same file because the two halves are
-- one contract: ingestion decides the revision, and the match writer records
-- which revision a result was computed from. Without the second half the
-- eligibility comparison in 20260928091000_matching_version_eligibility.sql would
-- have nothing to compare against.

-- ---------------------------------------------------------------------------
-- The single write path for ingested postings
-- ---------------------------------------------------------------------------

create or replace function public.upsert_ingested_job(
  target_source_id uuid,
  job_input jsonb,
  action_request_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  payload jsonb;
  source public.job_sources;
  resolved_company_id uuid;
  company_name text;
  job_title text;
  job_description text;
  location_raw text;
  fingerprint text;
  dedup text;
  checksum text;
  incoming_source_job_id text;
  incoming_source_url text;
  incoming_apply_url text;
  provenance public.job_source_records;
  target_job public.jobs;
  created boolean := false;
  merged boolean := false;
  matched_by text := 'created';
  poster timestamptz;
  expiry timestamptz;
  review_candidate_id uuid;
  -- The canonical revision before this call touched anything. Read from the row
  -- rather than from the payload: the question is whether the canonical content
  -- moved, and only the canonical row can answer that.
  previous_content_hash text;
begin
  perform app_private.require_service_role();
  payload := app_private.career_require_object(job_input, 'job');

  select * into source from public.job_sources where id = target_source_id;
  if source.id is null then
    raise exception 'job source does not exist' using errcode = 'P0002';
  end if;
  if source.status = 'disabled' then
    raise exception 'job source is disabled' using errcode = '22023';
  end if;

  incoming_source_job_id := app_private.career_text(payload, 'sourceJobId', 200, true);
  incoming_source_url := app_private.career_text(payload, 'sourceUrl', 1000, true);
  incoming_apply_url := coalesce(app_private.career_text(payload, 'applyUrl', 1000, false), incoming_source_url);
  job_title := app_private.career_text(payload, 'title', 300, true);
  company_name := app_private.career_text(payload, 'companyName', 200, true);
  job_description := app_private.career_text(payload, 'description', 40000, true);
  location_raw := app_private.career_text(payload, 'locationRaw', 300, false);
  fingerprint := app_private.career_text(payload, 'contentFingerprint', 64, true);
  checksum := app_private.career_text(payload, 'payloadChecksum', 64, true);
  dedup := app_private.job_dedup_key(job_title, company_name, location_raw);
  poster := (app_private.career_text(payload, 'postedAt', 40, false))::timestamptz;
  expiry := (app_private.career_text(payload, 'expiresAt', 40, false))::timestamptz;

  -- Fast path: this exact posting has already been ingested from this source.
  select * into provenance
  from public.job_source_records
  where source_id = source.id and source_job_id = incoming_source_job_id;

  if provenance.id is not null then
    /*
     * The row is locked before its revision is read, and that ordering is the
     * whole point of the statement.
     *
     * Two ingestion sessions can reach this point at the same time for the same
     * posting. Without the lock both read the revision that is current before
     * either commits, so both compute "the content changed" — one of them
     * correctly, the other about a revision that has already been superseded —
     * and one provider edit produces two re-queued postings. With it, the second
     * session waits, then reads the revision the first one committed, and finds
     * that the content it is about to write is already there.
     */
    select jobs.content_hash into previous_content_hash
    from public.jobs as jobs
    where jobs.id = provenance.job_id
    for update of jobs;

    update public.jobs
    set last_seen_at = now(),
        last_verified_at = now(),
        status = 'active',
        title = job_title,
        description = job_description,
        description_excerpt = app_private.job_description_excerpt(job_description),
        apply_url = incoming_apply_url,
        canonical_url = incoming_source_url,
        expires_at = coalesce(expiry, expires_at)
    where id = provenance.job_id
    returning * into target_job;

    update public.job_source_records
    set raw_payload = coalesce(payload -> 'rawPayload', '{}'::jsonb),
        payload_checksum = checksum,
        source_url = incoming_source_url,
        status = 'active',
        last_seen_at = now(),
        last_verified_at = now()
    where id = provenance.id;

    /*
     * The fast path audits its observation too.
     *
     * It used to return without one, which made the commonest write in the system
     * — a provider re-sending a posting it has already sent — the only one that
     * left no trace. That is exactly backwards for a change whose whole subject is
     * which writes counted as content changes: the observation that changed
     * nothing is the one an operator most needs to be able to see. The `metadata`
     * and the action name are the same shape the slow path writes, so a query over
     * the trail does not have to know which branch produced a row.
     */
    insert into public.audit_events (actor_type, action, target_type, target_id, request_id, metadata)
    values (
      'system',
      'job.observed',
      'job',
      target_job.id,
      action_request_id,
      pg_catalog.jsonb_build_object(
        'sourceCode', source.code,
        'sourceJobId', incoming_source_job_id,
        'matchedBy', 'source_identity',
        'contentChanged', target_job.content_hash is distinct from previous_content_hash
      )
    );

    return pg_catalog.jsonb_build_object(
      'jobId', target_job.id,
      'sourceRecordId', provenance.id,
      'created', false,
      'merged', false,
      'matchedBy', 'source_identity',
      -- The trigger recomputed the hash from the row it just wrote. Equal hashes
      -- mean this was an observation, not a change: `last_seen_at`,
      -- `last_verified_at`, `expires_at`, `canonical_url`, and the raw payload
      -- may all have moved, and none of them are content.
      'contentChanged', target_job.content_hash is distinct from previous_content_hash
    );
  end if;

  resolved_company_id := app_private.resolve_company(
    company_name,
    app_private.career_text(payload, 'companyDomain', 200, false),
    app_private.career_text(payload, 'companyCountryCode', 2, false)
  );

  -- Signal 1: identical normalized content is the same opportunity.
  select * into target_job
  from public.jobs
  where content_fingerprint = fingerprint
    and company_id = resolved_company_id
    and status in ('active', 'stale')
  order by last_seen_at desc
  limit 1;

  if target_job.id is not null then
    merged := true;
    matched_by := 'content_fingerprint';
  else
    -- Signal 2: same composite key, and the posting dates are close enough that
    -- this is a repost rather than a separate opening.
    select * into target_job
    from public.jobs
    where dedup_key = dedup
      and company_id = resolved_company_id
      and status in ('active', 'stale')
      and (
        poster is null
        or posted_at is null
        or pg_catalog.abs(extract(epoch from (posted_at - poster))) <= 1814400
      )
    order by pg_catalog.abs(
      extract(epoch from (coalesce(posted_at, now()) - coalesce(poster, now())))
    )
    limit 1;

    if target_job.id is not null then
      merged := true;
      matched_by := 'composite_key';
    end if;
  end if;

  if target_job.id is not null then
    -- Locked before the revision is read, for the reason the source-identity path
    -- above states: a merge and a concurrent observation of the same posting must
    -- not both conclude that they are the one that changed it.
    perform 1
    from public.jobs as jobs
    where jobs.id = target_job.id
    for update of jobs;

    select jobs.content_hash into previous_content_hash
    from public.jobs as jobs
    where jobs.id = target_job.id;

    update public.jobs
    set last_seen_at = now(),
        last_verified_at = now(),
        status = 'active',
        source_count = source_count + 1,
        -- The earliest posting time is the truest freshness signal.
        posted_at = least(coalesce(posted_at, poster), coalesce(poster, posted_at)),
        salary_min_minor = coalesce(
          salary_min_minor, app_private.career_integer(payload, 'salaryMinMinor', 1, 2000000000)
        ),
        salary_max_minor = coalesce(
          salary_max_minor, app_private.career_integer(payload, 'salaryMaxMinor', 1, 2000000000)
        )
    where id = target_job.id
    returning * into target_job;

    if matched_by = 'composite_key' then
      insert into public.audit_events (actor_type, action, target_type, target_id, metadata)
      values (
        'system',
        'job.deduplicated',
        'job',
        target_job.id,
        pg_catalog.jsonb_build_object('matchedBy', matched_by, 'dedupKey', dedup)
      );
    end if;
  else
    -- Signal 3: the same composite key but a distant posting date. The records
    -- stay separate, and the pair is queued for human review instead of being
    -- silently collapsed.
    select existing.id into review_candidate_id
    from public.jobs as existing
    where existing.dedup_key = dedup
      and existing.company_id = resolved_company_id
      and existing.status in ('active', 'stale')
    order by existing.last_seen_at desc
    limit 1;

    insert into public.jobs (
      company_id, title, normalized_title, description, description_excerpt,
      employment_type, seniority, remote_state, location_raw, city, region, country_code,
      is_philippines, is_international,
      salary_min_minor, salary_max_minor, salary_currency, salary_period, salary_is_estimate,
      requirements, preferred_qualifications, skills,
      experience_years_min, experience_years_max,
      language, apply_url, canonical_url, content_fingerprint, dedup_key,
      source_count, status, posted_at, expires_at, first_seen_at, last_seen_at, last_verified_at
    ) values (
      resolved_company_id,
      job_title,
      app_private.normalize_job_title(job_title),
      job_description,
      app_private.job_description_excerpt(job_description),
      coalesce(app_private.career_enum(
        payload, 'employmentType',
        array['full_time','part_time','contract','freelance','internship','temporary','volunteer'],
        false
      ), 'full_time')::public.employment_type,
      coalesce(app_private.career_enum(
        payload, 'seniority',
        array['internship','entry','junior','mid','senior','lead','principal','manager','director','executive','unspecified'],
        false
      ), 'unspecified')::public.job_seniority,
      coalesce(app_private.career_enum(
        payload, 'remoteState', array['remote','hybrid','onsite','unspecified'], false
      ), 'unspecified')::public.job_remote_state,
      location_raw,
      app_private.career_text(payload, 'city', 120, false),
      app_private.career_text(payload, 'region', 120, false),
      app_private.career_text(payload, 'countryCode', 2, false),
      coalesce(app_private.career_text(payload, 'countryCode', 2, false), '') = 'PH',
      coalesce(app_private.career_boolean(payload, 'isInternational', false), false),
      app_private.career_integer(payload, 'salaryMinMinor', 1, 2000000000),
      app_private.career_integer(payload, 'salaryMaxMinor', 1, 2000000000),
      app_private.career_text(payload, 'salaryCurrency', 3, false),
      app_private.career_enum(
        payload, 'salaryPeriod', array['hourly','daily','monthly','annual'], false
      )::public.salary_period,
      coalesce(app_private.career_boolean(payload, 'salaryIsEstimate', true), true),
      app_private.career_text_array(payload, 'requirements', 30, 500),
      app_private.career_text_array(payload, 'preferredQualifications', 20, 500),
      app_private.career_text_array(payload, 'skills', 40, 60),
      app_private.career_numeric(payload, 'experienceYearsMin', 0, 60),
      app_private.career_numeric(payload, 'experienceYearsMax', 0, 60),
      coalesce(app_private.career_text(payload, 'language', 5, false), 'en'),
      incoming_apply_url,
      incoming_source_url,
      fingerprint,
      dedup,
      1,
      'active',
      poster,
      expiry,
      now(), now(), now()
    )
    returning * into target_job;

    created := true;

    if review_candidate_id is not null and review_candidate_id <> target_job.id then
      insert into public.job_dedup_candidates (job_id, duplicate_job_id, score, signals)
      values (
        review_candidate_id,
        target_job.id,
        0.6,
        pg_catalog.jsonb_build_object(
          'matchedBy', 'composite_key_distant_date',
          'dedupKey', dedup
        )
      )
      on conflict (job_id, duplicate_job_id) do nothing;
    end if;
  end if;

  insert into public.job_source_records (
    job_id, source_id, source_job_id, source_url, raw_payload, payload_checksum, is_primary
  ) values (
    target_job.id, source.id, incoming_source_job_id, incoming_source_url,
    coalesce(payload -> 'rawPayload', '{}'::jsonb),
    checksum,
    not exists (select 1 from public.job_source_records where job_id = target_job.id)
  )
  returning * into provenance;

  insert into public.audit_events (actor_type, action, target_type, target_id, request_id, metadata)
  values (
    'system',
    case when created then 'job.ingested' else 'job.observed' end,
    'job',
    target_job.id,
    action_request_id,
    pg_catalog.jsonb_build_object(
      'sourceCode', source.code,
      'sourceJobId', incoming_source_job_id,
      'matchedBy', matched_by,
      -- Whether the canonical content moved, recorded next to the write that
      -- decided it, so a reprocessing question can be answered from the audit
      -- trail without reconstructing the payload.
      'contentChanged', target_job.content_hash is distinct from previous_content_hash
    )
  );

  return pg_catalog.jsonb_build_object(
    'jobId', target_job.id,
    'sourceRecordId', provenance.id,
    'created', created,
    'merged', merged,
    'matchedBy', matched_by,
    -- A creation is a content change by definition: there was no canonical
    -- revision before it, so anything derived from one is stale or absent.
    'contentChanged', target_job.content_hash is distinct from previous_content_hash
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Match result persistence
-- ---------------------------------------------------------------------------

/**
 * Records the revision each result was computed from.
 *
 * The only change is that `public.jobs.content_hash` is read alongside
 * `updated_at` and stored, so the eligibility comparison added by
 * 20260928091000_matching_version_eligibility.sql has a value to compare. Every
 * other behaviour — the truth gate on evidence, the conflict target, the fields
 * written on a re-score, `computed_at` — is unchanged.
 */
create or replace function public.record_job_matches(
  actor_user_id uuid,
  match_input jsonb,
  action_request_id uuid default null
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  payload jsonb;
  element jsonb;
  stored integer := 0;
  target_profile uuid;
  profile public.career_profiles;
  job_updated timestamptz;
  job_hash text;
  evidence uuid[];
begin
  perform app_private.require_active_actor(actor_user_id);
  payload := app_private.career_require_object(match_input, 'matches');
  if pg_catalog.jsonb_typeof(payload -> 'items') <> 'array' then
    raise exception 'items must be an array' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_array_length(payload -> 'items') > 200 then
    raise exception 'at most 200 match results may be recorded at once' using errcode = '22023';
  end if;

  target_profile := (app_private.career_text(payload, 'careerProfileId', 40, true))::uuid;
  profile := app_private.require_career_profile_owner(actor_user_id, target_profile);
  evidence := app_private.confirmed_fact_ids(target_profile);

  for element in select pg_catalog.jsonb_array_elements(payload -> 'items')
  loop
    if pg_catalog.jsonb_typeof(element) <> 'object' then
      raise exception 'each match result must be an object' using errcode = '22023';
    end if;

    select jobs.updated_at, jobs.content_hash into job_updated, job_hash
    from public.jobs as jobs
    where jobs.id = (app_private.career_text(element, 'jobId', 40, true))::uuid;
    if job_updated is null then
      continue;
    end if;

    insert into public.job_matches (
      user_id, job_id, career_profile_id, score, verdict, confidence, model_version,
      dimensions, strengths, gaps, blockers, rejection_risks, requirement_mapping,
      recommended_action, evidence_fact_ids, data_quality, profile_version,
      job_updated_at, job_content_hash
    ) values (
      actor_user_id,
      (app_private.career_text(element, 'jobId', 40, true))::uuid,
      target_profile,
      app_private.career_integer(element, 'score', 0, 100),
      app_private.career_enum(
        element, 'verdict',
        array['strong_match','good_match','stretch','weak_match','not_recommended'],
        true
      )::public.job_match_verdict,
      app_private.career_enum(
        element, 'confidence', array['high','medium','low'], true
      )::public.job_match_confidence,
      app_private.career_text(element, 'modelVersion', 60, true),
      coalesce(element -> 'dimensions', '[]'::jsonb),
      coalesce(element -> 'strengths', '[]'::jsonb),
      coalesce(element -> 'gaps', '[]'::jsonb),
      coalesce(element -> 'blockers', '[]'::jsonb),
      coalesce(element -> 'rejectionRisks', '[]'::jsonb),
      coalesce(element -> 'requirementMapping', '[]'::jsonb),
      app_private.career_text(element, 'recommendedAction', 600, true),
      -- The evidence set is the profile's confirmed facts intersected with what
      -- the generator claims it used. Nothing outside this set can be cited.
      coalesce((
        select pg_catalog.array_agg(value::uuid)
        from pg_catalog.jsonb_array_elements_text(coalesce(element -> 'evidenceFactIds', '[]'::jsonb)) as value
        where value::uuid = any (evidence)
      ), '{}'),
      coalesce(element -> 'dataQuality', '{}'::jsonb),
      profile.version,
      job_updated,
      job_hash
    )
    on conflict (user_id, job_id, career_profile_id) do update
      set score = excluded.score,
          verdict = excluded.verdict,
          confidence = excluded.confidence,
          model_version = excluded.model_version,
          dimensions = excluded.dimensions,
          strengths = excluded.strengths,
          gaps = excluded.gaps,
          blockers = excluded.blockers,
          rejection_risks = excluded.rejection_risks,
          requirement_mapping = excluded.requirement_mapping,
          recommended_action = excluded.recommended_action,
          evidence_fact_ids = excluded.evidence_fact_ids,
          data_quality = excluded.data_quality,
          profile_version = excluded.profile_version,
          job_updated_at = excluded.job_updated_at,
          job_content_hash = excluded.job_content_hash,
          computed_at = now();

    stored := stored + 1;
  end loop;

  return stored;
end;
$$;

revoke all on function public.upsert_ingested_job(uuid, jsonb, uuid)
  from public, anon, authenticated;
revoke all on function public.record_job_matches(uuid, jsonb, uuid)
  from public, anon, authenticated;

grant execute on function public.upsert_ingested_job(uuid, jsonb, uuid) to service_role;
grant execute on function public.record_job_matches(uuid, jsonb, uuid) to service_role;
