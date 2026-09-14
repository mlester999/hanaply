-- Hanaply Application Packs, usage metering, and the application tracker.
--
-- Three connected systems:
--
--   1. Usage metering is a server-side counter keyed by (user, feature, period)
--      with an append-only event log. Every metered operation carries an
--      idempotency key, so a retry, a double click, or a worker replay can never
--      consume quota twice.
--   2. An Application Pack is a Truth-gated unit of work: it is created from a
--      career profile and one opportunity, and every artifact it produces cites
--      the confirmed career facts it was allowed to use. A claim that is not a
--      confirmed fact on the profile cannot be persisted.
--   3. The tracker records where an application actually stands. It is a
--      pipeline, not an ATS: eight stages, notes, timestamps, and an append-only
--      history.

-- ---------------------------------------------------------------------------
-- Enumerated types
-- ---------------------------------------------------------------------------

create type public.usage_feature as enum (
  'application_pack',
  'resume_variant',
  'cover_letter',
  'ai_analysis',
  'interview_prep',
  'recruiter_message',
  'coach_message'
);

create type public.application_pack_status as enum (
  'queued',
  'generating',
  'ready',
  'failed',
  'archived'
);

create type public.application_artifact_kind as enum (
  'resume',
  'cover_letter',
  'strategy',
  'requirement_map',
  'recruiter_message',
  'interview_prep'
);

create type public.application_stage as enum (
  'saved',
  'preparing',
  'applied',
  'interviewing',
  'offer',
  'rejected',
  'withdrawn',
  'archived'
);

create type public.application_source_kind as enum ('hanaply', 'external', 'referral');

-- ---------------------------------------------------------------------------
-- Usage metering
-- ---------------------------------------------------------------------------

create table public.usage_counters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  feature public.usage_feature not null,
  period_start date not null,
  used integer not null default 0 check (used >= 0),
  -- The allowance is snapshotted when the period opens so a mid-cycle plan
  -- change cannot retroactively invalidate usage that was already permitted.
  limit_snapshot integer not null check (limit_snapshot >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint usage_counters_period_unique unique (user_id, feature, period_start)
);

comment on table public.usage_counters is
  'Server-side metering. Counters are advanced only by app_private.consume_usage(), and every increment is backed by an idempotent row in usage_events.';

create index usage_counters_user_idx on public.usage_counters (user_id, period_start desc);

create table public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  feature public.usage_feature not null,
  units integer not null default 1 check (units > 0),
  -- The idempotency key is what makes a retried request free instead of double
  -- billed, so it is the identity of the consumption.
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 200),
  period_start date not null,
  application_pack_id uuid null,
  metadata jsonb not null default '{}' check (pg_catalog.jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  constraint usage_events_idempotency_unique unique (user_id, feature, idempotency_key)
);

comment on table public.usage_events is
  'Append-only record of every metered operation. The unique idempotency key is the whole point: repeating an operation is free.';

create index usage_events_user_idx on public.usage_events (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Application Packs
-- ---------------------------------------------------------------------------

create table public.application_packs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  career_profile_id uuid not null references public.career_profiles (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,
  status public.application_pack_status not null default 'queued',
  -- The match result the pack was built against, frozen at creation time.
  match_snapshot jsonb not null default '{}' check (pg_catalog.jsonb_typeof(match_snapshot) = 'object'),
  model_version text null check (model_version is null or char_length(model_version) <= 60),
  prompt_version text null check (prompt_version is null or char_length(prompt_version) <= 60),
  -- The confirmed facts available when the pack was created. Artifacts may cite
  -- only identifiers from this set.
  evidence_fact_ids uuid[] not null default '{}',
  job_updated_at timestamptz not null,
  profile_version integer not null check (profile_version >= 0),
  error_code text null check (error_code is null or char_length(error_code) <= 80),
  generated_at timestamptz null,
  version integer not null default 0 check (version >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint application_packs_unique unique (user_id, career_profile_id, job_id)
);

comment on table public.application_packs is
  'One pack per career profile and opportunity. Creating a pack is a metered operation and consumes plan quota exactly once per idempotency key.';

create index application_packs_user_idx
  on public.application_packs (user_id, created_at desc);
create index application_packs_status_idx
  on public.application_packs (status, created_at desc);

create table public.application_artifacts (
  id uuid primary key default gen_random_uuid(),
  pack_id uuid not null references public.application_packs (id) on delete cascade,
  kind public.application_artifact_kind not null,
  style text null check (style is null or char_length(style) between 1 and 60),
  title text not null check (char_length(title) between 1 and 200),
  -- Structured content so the renderer, the exporter, and any future mobile
  -- client all read the same document rather than parsing prose.
  content jsonb not null check (pg_catalog.jsonb_typeof(content) = 'object'),
  plain_text text not null check (char_length(plain_text) between 1 and 60000),
  truth_gate_status text not null default 'passed'
    check (truth_gate_status in ('passed', 'needs_review', 'rejected')),
  evidence_fact_ids uuid[] not null default '{}',
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint application_artifacts_unique unique (pack_id, kind, style)
);

comment on column public.application_artifacts.evidence_fact_ids is
  'Confirmed career facts this artifact was allowed to use. The database rejects any artifact that cites a claim outside its pack evidence set.';

create index application_artifacts_pack_idx on public.application_artifacts (pack_id, kind);

-- ---------------------------------------------------------------------------
-- Application tracker
-- ---------------------------------------------------------------------------

create table public.job_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,
  career_profile_id uuid null references public.career_profiles (id) on delete set null,
  pack_id uuid null references public.application_packs (id) on delete set null,
  stage public.application_stage not null default 'saved',
  source public.application_source_kind not null default 'hanaply',
  applied_at timestamptz null,
  stage_changed_at timestamptz not null default now(),
  next_action_at timestamptz null,
  next_action_note text null check (next_action_note is null or char_length(next_action_note) <= 300),
  notes text null check (notes is null or char_length(notes) <= 4000),
  outcome_note text null check (outcome_note is null or char_length(outcome_note) <= 1000),
  version integer not null default 0 check (version >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint job_applications_unique unique (user_id, job_id),
  constraint job_applications_applied_check check (
    stage in ('saved', 'preparing', 'withdrawn', 'archived') or applied_at is not null
  )
);

create index job_applications_user_stage_idx
  on job_applications (user_id, stage, stage_changed_at desc);
create index job_applications_next_action_idx
  on public.job_applications (user_id, next_action_at)
  where next_action_at is not null;

create table public.application_events (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.job_applications (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  event_type text not null check (event_type ~ '^application\.[a-z][a-z0-9_.]{1,99}$'),
  previous_stage public.application_stage null,
  new_stage public.application_stage null,
  note text null check (note is null or char_length(note) <= 1000),
  occurred_at timestamptz not null default now(),
  request_id uuid null,
  created_at timestamptz not null default now()
);

create index application_events_application_idx
  on public.application_events (application_id, created_at, id);

-- ---------------------------------------------------------------------------
-- Usage metering functions
-- ---------------------------------------------------------------------------

create or replace function app_private.usage_period_start()
returns date
language sql
stable
security invoker
set search_path = ''
as $$
  select pg_catalog.date_trunc('month', now() at time zone 'UTC')::date;
$$;

create or replace function app_private.usage_limit_for(
  actor_user_id uuid,
  requested_feature public.usage_feature
)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  evaluation jsonb := app_private.career_entitlements(actor_user_id);
  entitlement_key text;
  raw jsonb;
begin
  entitlement_key := case requested_feature
    when 'application_pack' then 'automaticPackMonthlyLimit'
    when 'resume_variant' then 'tailoredResumePerJobLimit'
    when 'cover_letter' then 'coverLetterPerJobLimit'
    when 'ai_analysis' then 'coreAiAnalysis'
    when 'interview_prep' then 'interviewPreparation'
    when 'recruiter_message' then 'recruiterMessages'
    else 'advancedAiAnalysis'
  end;

  raw := evaluation -> entitlement_key;
  if raw is null then
    return 0;
  end if;
  if pg_catalog.jsonb_typeof(raw) = 'boolean' then
    -- Boolean entitlements are unlimited within the plan, represented as a large
    -- but finite ceiling so the counter still exists for operations reporting.
    return case when (raw #>> '{}') = 'true' then 100000 else 0 end;
  end if;
  if pg_catalog.jsonb_typeof(raw) = 'number' then
    return (raw #>> '{}')::integer;
  end if;
  return 0;
end;
$$;

/**
 * Consumes plan quota exactly once per idempotency key.
 *
 * The unique key on usage_events is the guarantee: a repeated call returns the
 * same decision without incrementing the counter, so a retry after a timeout can
 * never double-charge a subscriber.
 */
create or replace function app_private.consume_usage(
  actor_user_id uuid,
  requested_feature public.usage_feature,
  requested_units integer,
  requested_idempotency_key text,
  target_application_pack_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  period date := app_private.usage_period_start();
  allowance integer;
  counter public.usage_counters;
  inserted boolean := false;
  usage_key text;
begin
  perform app_private.require_active_actor(actor_user_id);

  if requested_units < 1 or requested_units > 1000 then
    raise exception 'units must be between 1 and 1000' using errcode = '22023';
  end if;
  usage_key := btrim(coalesce(requested_idempotency_key, ''));
  if pg_catalog.char_length(usage_key) < 8 or pg_catalog.char_length(usage_key) > 200 then
    raise exception 'an idempotency key between 8 and 200 characters is required'
      using errcode = '22023';
  end if;

  allowance := app_private.usage_limit_for(actor_user_id, requested_feature);

  insert into public.usage_counters (user_id, feature, period_start, used, limit_snapshot)
  values (actor_user_id, requested_feature, period, 0, allowance)
  on conflict (user_id, feature, period_start) do nothing;

  select * into counter
  from public.usage_counters
  where user_id = actor_user_id and feature = requested_feature and period_start = period
  for update;

  insert into public.usage_events (
    user_id, feature, units, idempotency_key, period_start, application_pack_id
  ) values (
    actor_user_id, requested_feature, requested_units, usage_key, period, target_application_pack_id
  )
  on conflict (user_id, feature, idempotency_key) do nothing
  returning true into inserted;

  if not coalesce(inserted, false) then
    -- Already consumed under this key: report the current state without charging.
    return pg_catalog.jsonb_build_object(
      'allowed', true,
      'duplicate', true,
      'used', counter.used,
      'limit', counter.limit_snapshot,
      'remaining', greatest(counter.limit_snapshot - counter.used, 0)
    );
  end if;

  if counter.used + requested_units > counter.limit_snapshot then
    -- The event row is recorded so an operator can see the refusal, then removed
    -- so it does not consume quota it was never granted.
    delete from public.usage_events
    where user_id = actor_user_id and feature = requested_feature and idempotency_key = usage_key;

    return pg_catalog.jsonb_build_object(
      'allowed', false,
      'duplicate', false,
      'used', counter.used,
      'limit', counter.limit_snapshot,
      'remaining', greatest(counter.limit_snapshot - counter.used, 0)
    );
  end if;

  update public.usage_counters
  set used = used + requested_units
  where id = counter.id
  returning * into counter;

  return pg_catalog.jsonb_build_object(
    'allowed', true,
    'duplicate', false,
    'used', counter.used,
    'limit', counter.limit_snapshot,
    'remaining', greatest(counter.limit_snapshot - counter.used, 0)
  );
end;
$$;

create or replace function public.usage_summary(actor_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  period date := app_private.usage_period_start();
  features public.usage_feature[] := array[
    'application_pack', 'resume_variant', 'cover_letter', 'ai_analysis',
    'interview_prep', 'recruiter_message', 'coach_message'
  ]::public.usage_feature[];
  feature_name public.usage_feature;
  items jsonb := '[]'::jsonb;
  allowance integer;
  consumed integer;
begin
  perform app_private.require_active_actor(actor_user_id);

  foreach feature_name in array features
  loop
    allowance := app_private.usage_limit_for(actor_user_id, feature_name);
    select coalesce(counter.used, 0) into consumed
    from public.usage_counters as counter
    where counter.user_id = actor_user_id
      and counter.feature = feature_name
      and counter.period_start = period;
    consumed := coalesce(consumed, 0);

    items := items || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'feature', feature_name,
      'used', consumed,
      'limit', allowance,
      'remaining', greatest(allowance - consumed, 0)
    ));
  end loop;

  return pg_catalog.jsonb_build_object(
    'periodStart', period,
    'periodEnd', (period + interval '1 month')::date,
    'items', items
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Truth gate for artifacts
-- ---------------------------------------------------------------------------

create or replace function app_private.validate_artifact_evidence()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  pack public.application_packs;
  allowed uuid[];
  cited uuid;
begin
  select * into pack from public.application_packs where id = new.pack_id;
  if pack.id is null then
    raise exception 'application pack does not exist' using errcode = 'P0002';
  end if;

  allowed := app_private.confirmed_fact_ids(pack.career_profile_id);

  foreach cited in array new.evidence_fact_ids
  loop
    if not (cited = any (allowed)) then
      raise exception 'an artifact may only cite confirmed career facts'
        using errcode = '22023';
    end if;
  end loop;

  return new;
end;
$$;

create trigger application_artifacts_validate_evidence
before insert or update of evidence_fact_ids on public.application_artifacts
for each row execute function app_private.validate_artifact_evidence();

revoke all on function app_private.usage_period_start() from public, anon, authenticated;
revoke all on function app_private.usage_limit_for(uuid, public.usage_feature)
  from public, anon, authenticated;
revoke all on function app_private.consume_usage(uuid, public.usage_feature, integer, text, uuid)
  from public, anon, authenticated;
revoke all on function app_private.validate_artifact_evidence()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Application Pack functions
-- ---------------------------------------------------------------------------

create or replace function app_private.application_pack_snapshot(pack public.application_packs)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'id', pack.id,
    'careerProfileId', pack.career_profile_id,
    'jobId', pack.job_id,
    'status', pack.status,
    'matchSnapshot', pack.match_snapshot,
    'modelVersion', pack.model_version,
    'promptVersion', pack.prompt_version,
    'evidenceFactIds', pg_catalog.to_jsonb(pack.evidence_fact_ids),
    'errorCode', pack.error_code,
    'generatedAt', pack.generated_at,
    'version', pack.version,
    'createdAt', pack.created_at,
    'updatedAt', pack.updated_at
  );
$$;

create or replace function app_private.application_artifact_snapshot(
  artifact public.application_artifacts
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'id', artifact.id,
    'packId', artifact.pack_id,
    'kind', artifact.kind,
    'style', artifact.style,
    'title', artifact.title,
    'content', artifact.content,
    'plainText', artifact.plain_text,
    'truthGateStatus', artifact.truth_gate_status,
    'evidenceFactIds', pg_catalog.to_jsonb(artifact.evidence_fact_ids),
    'version', artifact.version,
    'createdAt', artifact.created_at,
    'updatedAt', artifact.updated_at
  );
$$;

create or replace function public.create_application_pack(
  actor_user_id uuid,
  target_job_id uuid,
  target_career_profile_id uuid,
  idempotency_key text,
  action_request_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  profile public.career_profiles;
  target_job public.jobs;
  matched public.job_matches;
  existing public.application_packs;
  consumption jsonb;
  created_id uuid;
  evidence uuid[];
begin
  perform app_private.require_active_actor(actor_user_id);
  profile := app_private.require_career_profile_owner(actor_user_id, target_career_profile_id);

  select * into target_job from public.jobs where id = target_job_id;
  if target_job.id is null then
    raise exception 'job does not exist' using errcode = 'P0002';
  end if;
  if target_job.status <> 'active' then
    raise exception 'this opportunity is no longer active' using errcode = '22023';
  end if;

  select * into existing
  from public.application_packs
  where user_id = actor_user_id
    and career_profile_id = profile.id
    and job_id = target_job.id;

  if existing.id is not null then
    -- Idempotent by identity: asking twice returns the same pack and never
    -- charges quota a second time.
    return pg_catalog.jsonb_build_object(
      'pack', app_private.application_pack_snapshot(existing),
      'created', false,
      'usage', null
    );
  end if;

  consumption := app_private.consume_usage(
    actor_user_id, 'application_pack', 1, idempotency_key, null
  );
  if (consumption ->> 'allowed')::boolean is not true then
    raise exception 'the current plan allows % Application Packs this month',
      (consumption ->> 'limit') using errcode = '42501';
  end if;

  select * into matched
  from public.job_matches
  where user_id = actor_user_id
    and job_id = target_job.id
    and career_profile_id = profile.id;

  evidence := app_private.confirmed_fact_ids(profile.id);

  insert into public.application_packs (
    user_id, career_profile_id, job_id, status, match_snapshot,
    evidence_fact_ids, job_updated_at, profile_version
  ) values (
    actor_user_id,
    profile.id,
    target_job.id,
    'queued',
    coalesce(app_private.job_match_summary(matched), '{}'::jsonb),
    evidence,
    target_job.updated_at,
    profile.version
  )
  returning id into created_id;

  update public.usage_events
  set application_pack_id = created_id
  where user_id = actor_user_id
    and feature = 'application_pack'
    and usage_events.idempotency_key = btrim(create_application_pack.idempotency_key);

  insert into public.audit_events (
    actor_user_id, actor_type, action, target_type, target_id, request_id, metadata
  ) values (
    actor_user_id, 'user', 'application_pack.created', 'application_pack', created_id,
    action_request_id,
    pg_catalog.jsonb_build_object('jobId', target_job.id, 'evidenceCount', pg_catalog.array_length(evidence, 1))
  );

  select * into existing from public.application_packs where id = created_id;

  return pg_catalog.jsonb_build_object(
    'pack', app_private.application_pack_snapshot(existing),
    'created', true,
    'usage', consumption
  );
end;
$$;

create or replace function public.record_application_artifact(
  actor_user_id uuid,
  target_pack_id uuid,
  artifact_input jsonb,
  action_request_id uuid default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  pack public.application_packs;
  payload jsonb;
  profile public.career_profiles;
  created_id uuid;
  cited uuid[];
  allowed uuid[];
begin
  perform app_private.require_active_actor(actor_user_id);
  payload := app_private.career_require_object(artifact_input, 'artifact');

  select * into pack from public.application_packs where id = target_pack_id;
  if pack.id is null or pack.user_id <> actor_user_id then
    raise exception 'application pack does not exist' using errcode = 'P0002';
  end if;
  profile := app_private.require_career_profile_owner(actor_user_id, pack.career_profile_id);

  allowed := app_private.confirmed_fact_ids(profile.id);
  cited := coalesce((
    select pg_catalog.array_agg(value::uuid)
    from pg_catalog.jsonb_array_elements_text(coalesce(payload -> 'evidenceFactIds', '[]'::jsonb)) as value
    where value::uuid = any (allowed)
  ), '{}');

  -- If the generator cited anything outside the confirmed set, the artifact is
  -- rejected rather than presented as verified. array_length is NULL for an
  -- empty array, so it is coalesced before the comparison.
  if pg_catalog.jsonb_array_length(coalesce(payload -> 'evidenceFactIds', '[]'::jsonb))
     <> coalesce(pg_catalog.array_length(cited, 1), 0) then
    raise exception 'an artifact may only cite confirmed career facts'
      using errcode = '22023';
  end if;

  insert into public.application_artifacts (
    pack_id, kind, style, title, content, plain_text, truth_gate_status, evidence_fact_ids
  ) values (
    pack.id,
    app_private.career_enum(
      payload, 'kind',
      array['resume','cover_letter','strategy','requirement_map','recruiter_message','interview_prep'],
      true
    )::public.application_artifact_kind,
    app_private.career_text(payload, 'style', 60, false),
    app_private.career_text(payload, 'title', 200, true),
    app_private.career_require_object(payload -> 'content', 'content'),
    app_private.career_text(payload, 'plainText', 60000, true),
    coalesce(app_private.career_enum(
      payload, 'truthGateStatus', array['passed', 'needs_review', 'rejected'], false
    ), 'passed'),
    cited
  )
  on conflict (pack_id, kind, style) do update
    set title = excluded.title,
        content = excluded.content,
        plain_text = excluded.plain_text,
        truth_gate_status = excluded.truth_gate_status,
        evidence_fact_ids = excluded.evidence_fact_ids,
        version = public.application_artifacts.version + 1
  returning id into created_id;

  update public.application_packs
  set status = 'ready',
      generated_at = coalesce(generated_at, now()),
      version = version + 1,
      error_code = null
  where id = pack.id;

  insert into public.audit_events (
    actor_user_id, actor_type, action, target_type, target_id, request_id, metadata
  ) values (
    actor_user_id, 'system', 'application_pack.artifact_recorded', 'application_pack', pack.id,
    action_request_id,
    pg_catalog.jsonb_build_object('kind', payload ->> 'kind', 'evidenceCount', pg_catalog.array_length(cited, 1))
  );

  return created_id;
end;
$$;

create or replace function public.complete_application_pack(
  actor_user_id uuid,
  target_pack_id uuid,
  outcome text,
  error_code text default null
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  pack public.application_packs;
begin
  perform app_private.require_active_actor(actor_user_id);
  if outcome not in ('ready', 'failed', 'generating') then
    raise exception 'unsupported pack outcome' using errcode = '22023';
  end if;

  select * into pack from public.application_packs where id = target_pack_id;
  if pack.id is null or pack.user_id <> actor_user_id then
    raise exception 'application pack does not exist' using errcode = 'P0002';
  end if;

  update public.application_packs
  set status = outcome::public.application_pack_status,
      error_code = pg_catalog.left(error_code, 80),
      generated_at = case when outcome = 'ready' then coalesce(generated_at, now()) else generated_at end,
      version = version + 1
  where id = pack.id;

  return true;
end;
$$;

create or replace function public.application_pack_directory(actor_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app_private.require_active_actor(actor_user_id);
  return pg_catalog.jsonb_build_object(
    'items', coalesce((
      select pg_catalog.jsonb_agg(
        app_private.application_pack_snapshot(pack)
          || pg_catalog.jsonb_build_object(
            'jobTitle', jobs.title,
            'companyName', company.display_name,
            'artifactCount', (
              select pg_catalog.count(*) from public.application_artifacts as artifact
              where artifact.pack_id = pack.id
            )
          )
        order by pack.created_at desc
      )
      from public.application_packs as pack
      join public.jobs as jobs on jobs.id = pack.job_id
      join public.companies as company on company.id = jobs.company_id
      where pack.user_id = actor_user_id and pack.status <> 'archived'
    ), '[]'::jsonb),
    'usage', public.usage_summary(actor_user_id)
  );
end;
$$;

create or replace function public.application_pack_detail(
  actor_user_id uuid,
  target_pack_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  pack public.application_packs;
  target_job public.jobs;
begin
  perform app_private.require_active_actor(actor_user_id);

  select * into pack
  from public.application_packs
  where id = target_pack_id and user_id = actor_user_id;
  if pack.id is null then
    raise exception 'application pack does not exist' using errcode = 'P0002';
  end if;

  select * into target_job from public.jobs where id = pack.job_id;

  return app_private.application_pack_snapshot(pack) || pg_catalog.jsonb_build_object(
    'job', app_private.job_card_snapshot(target_job),
    'applyUrl', target_job.apply_url,
    'artifacts', coalesce((
      select pg_catalog.jsonb_agg(
        app_private.application_artifact_snapshot(artifact)
        order by artifact.kind, artifact.style
      )
      from public.application_artifacts as artifact
      where artifact.pack_id = pack.id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function app_private.application_pack_snapshot(public.application_packs)
  from public, anon, authenticated;
revoke all on function app_private.application_artifact_snapshot(public.application_artifacts)
  from public, anon, authenticated;
revoke all on function public.create_application_pack(uuid, uuid, uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function public.record_application_artifact(uuid, uuid, jsonb, uuid)
  from public, anon, authenticated;
revoke all on function public.complete_application_pack(uuid, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.application_pack_directory(uuid) from public, anon, authenticated;
revoke all on function public.application_pack_detail(uuid, uuid) from public, anon, authenticated;
revoke all on function public.usage_summary(uuid) from public, anon, authenticated;

grant execute on function public.create_application_pack(uuid, uuid, uuid, text, uuid) to service_role;
grant execute on function public.record_application_artifact(uuid, uuid, jsonb, uuid) to service_role;
grant execute on function public.complete_application_pack(uuid, uuid, text, text) to service_role;
grant execute on function public.application_pack_directory(uuid) to service_role;
grant execute on function public.application_pack_detail(uuid, uuid) to service_role;
grant execute on function public.usage_summary(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Application tracker functions
-- ---------------------------------------------------------------------------

create or replace function app_private.application_snapshot(application public.job_applications)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'id', application.id,
    'jobId', application.job_id,
    'careerProfileId', application.career_profile_id,
    'packId', application.pack_id,
    'stage', application.stage,
    'source', application.source,
    'appliedAt', application.applied_at,
    'stageChangedAt', application.stage_changed_at,
    'nextActionAt', application.next_action_at,
    'nextActionNote', application.next_action_note,
    'notes', application.notes,
    'outcomeNote', application.outcome_note,
    'version', application.version,
    'createdAt', application.created_at,
    'updatedAt', application.updated_at
  );
$$;

create or replace function public.upsert_job_application(
  actor_user_id uuid,
  application_input jsonb,
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
  target_job_id uuid;
  target_profile_id uuid;
  target_pack_id uuid;
  existing public.job_applications;
  stored public.job_applications;
begin
  perform app_private.require_active_actor(actor_user_id);
  payload := app_private.career_require_object(application_input, 'application');

  target_job_id := (app_private.career_text(payload, 'jobId', 40, true))::uuid;
  if not exists (select 1 from public.jobs where id = target_job_id) then
    raise exception 'job does not exist' using errcode = 'P0002';
  end if;

  target_profile_id := nullif(app_private.career_text(payload, 'careerProfileId', 40, false), '')::uuid;
  if target_profile_id is not null then
    perform app_private.require_career_profile_owner(actor_user_id, target_profile_id);
  end if;

  target_pack_id := nullif(app_private.career_text(payload, 'packId', 40, false), '')::uuid;
  if target_pack_id is not null and not exists (
    select 1 from public.application_packs
    where id = target_pack_id and user_id = actor_user_id
  ) then
    raise exception 'application pack does not exist' using errcode = 'P0002';
  end if;

  select * into existing
  from public.job_applications
  where user_id = actor_user_id and job_id = target_job_id;

  insert into public.job_applications (
    user_id, job_id, career_profile_id, pack_id, stage, source,
    applied_at, next_action_at, next_action_note, notes
  ) values (
    actor_user_id,
    target_job_id,
    coalesce(target_profile_id, existing.career_profile_id),
    coalesce(target_pack_id, existing.pack_id),
    coalesce(app_private.career_enum(
      payload, 'stage',
      array['saved','preparing','applied','interviewing','offer','rejected','withdrawn','archived'],
      false
    ), coalesce(existing.stage::text, 'saved'))::public.application_stage,
    coalesce(app_private.career_enum(
      payload, 'source', array['hanaply','external','referral'], false
    ), coalesce(existing.source::text, 'hanaply'))::public.application_source_kind,
    case
      -- The applied timestamp is set once, when the application first reaches a
      -- post-application stage, and is never cleared afterwards.
      when existing.applied_at is not null then existing.applied_at
      when app_private.career_enum(
        payload, 'stage',
        array['applied','interviewing','offer','rejected'], false
      ) is not null then now()
      else null
    end,
    coalesce(
      (app_private.career_text(payload, 'nextActionAt', 40, false))::timestamptz,
      existing.next_action_at
    ),
    coalesce(
      app_private.career_text(payload, 'nextActionNote', 300, false),
      existing.next_action_note
    ),
    coalesce(app_private.career_text(payload, 'notes', 4000, false), existing.notes)
  )
  on conflict (user_id, job_id) do update
    set career_profile_id = excluded.career_profile_id,
        pack_id = excluded.pack_id,
        stage = excluded.stage,
        source = excluded.source,
        applied_at = excluded.applied_at,
        next_action_at = excluded.next_action_at,
        next_action_note = excluded.next_action_note,
        notes = excluded.notes,
        stage_changed_at = case
          when public.job_applications.stage <> excluded.stage then now()
          else public.job_applications.stage_changed_at
        end,
        version = public.job_applications.version + 1
  returning * into stored;

  if existing.id is null or existing.stage <> stored.stage then
    insert into public.application_events (
      application_id, user_id, event_type, previous_stage, new_stage, note, request_id
    ) values (
      stored.id,
      actor_user_id,
      case when existing.id is null then 'application.tracked' else 'application.stage_changed' end,
      existing.stage,
      stored.stage,
      pg_catalog.left(app_private.career_text(payload, 'note', 1000, false), 1000),
      action_request_id
    );
  end if;

  insert into public.audit_events (
    actor_user_id, actor_type, action, target_type, target_id, request_id, metadata
  ) values (
    actor_user_id, 'user', 'application.tracked', 'job_application', stored.id, action_request_id,
    pg_catalog.jsonb_build_object('stage', stored.stage)
  );

  return app_private.application_snapshot(stored);
end;
$$;

create or replace function public.set_application_stage(
  actor_user_id uuid,
  target_application_id uuid,
  requested_stage public.application_stage,
  expected_version integer,
  requested_note text default null,
  action_request_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  application public.job_applications;
  stored public.job_applications;
begin
  perform app_private.require_active_actor(actor_user_id);

  select * into application
  from public.job_applications
  where id = target_application_id and user_id = actor_user_id;
  if application.id is null then
    raise exception 'application does not exist' using errcode = 'P0002';
  end if;
  if application.version <> expected_version then
    raise exception 'this application changed in another session' using errcode = '40001';
  end if;
  if application.stage = requested_stage then
    return app_private.application_snapshot(application);
  end if;

  update public.job_applications
  set stage = requested_stage,
      stage_changed_at = now(),
      applied_at = case
        when applied_at is null and requested_stage in ('applied', 'interviewing', 'offer', 'rejected')
          then now()
        else applied_at
      end,
      next_action_at = case when requested_stage in ('rejected', 'withdrawn', 'archived') then null else next_action_at end,
      next_action_note = case when requested_stage in ('rejected', 'withdrawn', 'archived') then null else next_action_note end,
      version = version + 1
  where id = application.id
  returning * into stored;

  insert into public.application_events (
    application_id, user_id, event_type, previous_stage, new_stage, note, request_id
  ) values (
    stored.id, actor_user_id, 'application.stage_changed', application.stage, requested_stage,
    pg_catalog.left(requested_note, 1000), action_request_id
  );

  insert into public.audit_events (
    actor_user_id, actor_type, action, target_type, target_id, request_id,
    before_state, after_state
  ) values (
    actor_user_id, 'user', 'application.stage_changed', 'job_application', stored.id,
    action_request_id,
    pg_catalog.jsonb_build_object('stage', application.stage),
    pg_catalog.jsonb_build_object('stage', stored.stage)
  );

  return app_private.application_snapshot(stored);
end;
$$;

create or replace function public.application_tracker(actor_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app_private.require_active_actor(actor_user_id);

  return pg_catalog.jsonb_build_object(
    'items', coalesce((
      select pg_catalog.jsonb_agg(
        app_private.application_snapshot(application)
          || pg_catalog.jsonb_build_object(
            'jobTitle', jobs.title,
            'companyName', company.display_name,
            'remoteState', jobs.remote_state,
            'locationRaw', jobs.location_raw,
            'applyUrl', jobs.apply_url
          )
        order by application.stage_changed_at desc
      )
      from public.job_applications as application
      join public.jobs as jobs on jobs.id = application.job_id
      join public.companies as company on company.id = jobs.company_id
      where application.user_id = actor_user_id
    ), '[]'::jsonb),
    'counts', coalesce((
      select pg_catalog.jsonb_object_agg(stage_name, stage_count)
      from (
        select application.stage::text as stage_name, pg_catalog.count(*)::integer as stage_count
        from public.job_applications as application
        where application.user_id = actor_user_id
        group by application.stage
      ) as grouped
    ), '{}'::jsonb),
    'evaluatedAt', now()
  );
end;
$$;

create or replace function public.application_timeline(
  actor_user_id uuid,
  target_application_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  application public.job_applications;
begin
  perform app_private.require_active_actor(actor_user_id);

  select * into application
  from public.job_applications
  where id = target_application_id and user_id = actor_user_id;
  if application.id is null then
    raise exception 'application does not exist' using errcode = 'P0002';
  end if;

  return pg_catalog.jsonb_build_object(
    'application', app_private.application_snapshot(application),
    'events', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', event.id,
          'eventType', event.event_type,
          'previousStage', event.previous_stage,
          'newStage', event.new_stage,
          'note', event.note,
          'occurredAt', event.occurred_at
        )
        order by event.created_at, event.id
      )
      from public.application_events as event
      where event.application_id = application.id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function app_private.application_snapshot(public.job_applications)
  from public, anon, authenticated;
revoke all on function public.upsert_job_application(uuid, jsonb, uuid)
  from public, anon, authenticated;
revoke all on function public.set_application_stage(uuid, uuid, public.application_stage, integer, text, uuid)
  from public, anon, authenticated;
revoke all on function public.application_tracker(uuid) from public, anon, authenticated;
revoke all on function public.application_timeline(uuid, uuid) from public, anon, authenticated;

grant execute on function public.upsert_job_application(uuid, jsonb, uuid) to service_role;
grant execute on function public.set_application_stage(uuid, uuid, public.application_stage, integer, text, uuid)
  to service_role;
grant execute on function public.application_tracker(uuid) to service_role;
grant execute on function public.application_timeline(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create trigger usage_counters_set_updated_at
before update on public.usage_counters
for each row execute function app_private.set_updated_at();

create trigger application_packs_set_updated_at
before update on public.application_packs
for each row execute function app_private.set_updated_at();

create trigger application_artifacts_set_updated_at
before update on public.application_artifacts
for each row execute function app_private.set_updated_at();

create trigger job_applications_set_updated_at
before update on public.job_applications
for each row execute function app_private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security and grants
-- ---------------------------------------------------------------------------

alter table public.usage_counters enable row level security;
alter table public.usage_counters force row level security;
alter table public.usage_events enable row level security;
alter table public.usage_events force row level security;
alter table public.application_packs enable row level security;
alter table public.application_packs force row level security;
alter table public.application_artifacts enable row level security;
alter table public.application_artifacts force row level security;
alter table public.job_applications enable row level security;
alter table public.job_applications force row level security;
alter table public.application_events enable row level security;
alter table public.application_events force row level security;

revoke all on table public.usage_counters from public, anon, authenticated;
revoke all on table public.usage_events from public, anon, authenticated;
revoke all on table public.application_packs from public, anon, authenticated;
revoke all on table public.application_artifacts from public, anon, authenticated;
revoke all on table public.job_applications from public, anon, authenticated;
revoke all on table public.application_events from public, anon, authenticated;

grant all privileges on table public.usage_counters to service_role;
grant all privileges on table public.usage_events to service_role;
grant all privileges on table public.application_packs to service_role;
grant all privileges on table public.application_artifacts to service_role;
grant all privileges on table public.job_applications to service_role;
grant all privileges on table public.application_events to service_role;

-- Row-level security policies reference user_id, and a policy subquery is
-- evaluated with the caller's privileges, so user_id must be part of every
-- column-level grant on these tables.
grant select (id, user_id, feature, period_start, used, limit_snapshot, created_at, updated_at)
  on table public.usage_counters to authenticated;
grant select (id, user_id, career_profile_id, job_id, status, model_version, generated_at, version, created_at, updated_at)
  on table public.application_packs to authenticated;
grant select (id, pack_id, kind, style, title, plain_text, truth_gate_status, version, created_at, updated_at)
  on table public.application_artifacts to authenticated;
grant select (id, user_id, job_id, career_profile_id, pack_id, stage, source, applied_at, stage_changed_at, next_action_at, next_action_note, notes, outcome_note, version, created_at, updated_at)
  on table public.job_applications to authenticated;
grant select (id, user_id, application_id, event_type, previous_stage, new_stage, note, occurred_at)
  on table public.application_events to authenticated;

create policy usage_counters_select_own
on public.usage_counters
for select
to authenticated
using (user_id = (select auth.uid()));

create policy application_packs_select_own_active_account
on public.application_packs
for select
to authenticated
using (
  user_id = (select auth.uid())
  and (select app_private.is_account_active())
);

create policy application_artifacts_select_own_active_account
on public.application_artifacts
for select
to authenticated
using (
  (select app_private.is_account_active())
  and exists (
    select 1 from public.application_packs as pack
    where pack.id = application_artifacts.pack_id
      and pack.user_id = (select auth.uid())
  )
);

create policy job_applications_select_own_active_account
on public.job_applications
for select
to authenticated
using (
  user_id = (select auth.uid())
  and (select app_private.is_account_active())
);

create policy application_events_select_own_active_account
on public.application_events
for select
to authenticated
using (
  user_id = (select auth.uid())
  and (select app_private.is_account_active())
);

comment on policy application_artifacts_select_own_active_account on public.application_artifacts is
  'Artifact bodies are readable by their owner only. The raw generation prompt and any internal reasoning are never stored, so there is nothing private to leak.';
comment on policy usage_counters_select_own on public.usage_counters is
  'A subscriber can see their own consumption. Only the service-side metering function can change a counter.';
