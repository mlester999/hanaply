-- Hanaply opportunity intelligence: saved/dismissed jobs, ranking feedback,
-- cached match results, and the ranked radar feed.
--
-- The ranking model is deliberately explainable. Every score is stored together
-- with the ordered list of dimension contributions that produced it, so the
-- product can always answer "why is this here?" without re-running the model,
-- and an operator can audit a ranking decision after the fact.
--
-- Truthfulness rules carried into the schema:
--
--   1. A match result cites only confirmed career facts. `evidence_fact_ids`
--      holds the exact ledger rows that were used, and the generator cannot
--      reference a claim that is not in that list.
--   2. Confidence is stored separately from score. A high score built on thin
--      profile data must never be presented as certainty.
--   3. Requirement coverage records unmet requirements explicitly. A gap is a
--      first-class value, not a missing row.

-- ---------------------------------------------------------------------------
-- Enumerated types
-- ---------------------------------------------------------------------------

create type public.job_feedback_kind as enum (
  'interested',
  'not_interested',
  'wrong_role',
  'wrong_seniority',
  'wrong_location',
  'salary_too_low',
  'already_applied',
  'irrelevant',
  'saved'
);

create type public.job_match_verdict as enum (
  'strong_match',
  'good_match',
  'stretch',
  'weak_match',
  'not_recommended'
);

create type public.job_requirement_status as enum ('met', 'partially_met', 'unmet', 'unknown');

create type public.job_match_confidence as enum ('high', 'medium', 'low');

-- ---------------------------------------------------------------------------
-- Saved jobs and ranking feedback
-- ---------------------------------------------------------------------------

create table public.saved_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,
  career_profile_id uuid null references public.career_profiles (id) on delete set null,
  note text null check (note is null or char_length(note) between 1 and 2000),
  saved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint saved_jobs_unique unique (user_id, job_id)
);

create index saved_jobs_user_idx on public.saved_jobs (user_id, saved_at desc);

create table public.job_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,
  career_profile_id uuid null references public.career_profiles (id) on delete set null,
  feedback public.job_feedback_kind not null,
  reason text null check (reason is null or char_length(reason) between 1 and 500),
  -- Feedback that hides an opportunity stays auditable but stops influencing
  -- future rankings once it is superseded.
  active boolean not null default true,
  superseded_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.job_feedback is
  'Explicit user ranking feedback. Suppression is reversible and always auditable: rows are superseded, never deleted.';

create index job_feedback_user_idx on public.job_feedback (user_id, created_at desc);
create unique index job_feedback_active_unique_idx
  on public.job_feedback (user_id, job_id)
  where active;

-- ---------------------------------------------------------------------------
-- Cached match results
-- ---------------------------------------------------------------------------

create table public.job_matches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,
  career_profile_id uuid not null references public.career_profiles (id) on delete cascade,
  score smallint not null check (score between 0 and 100),
  verdict public.job_match_verdict not null,
  confidence public.job_match_confidence not null,
  model_version text not null check (char_length(model_version) between 1 and 60),
  -- Ordered dimension contributions: [{ key, label, weight, score, contribution }].
  dimensions jsonb not null default '[]'::jsonb
    check (pg_catalog.jsonb_typeof(dimensions) = 'array'),
  strengths jsonb not null default '[]'::jsonb
    check (pg_catalog.jsonb_typeof(strengths) = 'array'),
  gaps jsonb not null default '[]'::jsonb
    check (pg_catalog.jsonb_typeof(gaps) = 'array'),
  blockers jsonb not null default '[]'::jsonb
    check (pg_catalog.jsonb_typeof(blockers) = 'array'),
  rejection_risks jsonb not null default '[]'::jsonb
    check (pg_catalog.jsonb_typeof(rejection_risks) = 'array'),
  requirement_mapping jsonb not null default '[]'::jsonb
    check (pg_catalog.jsonb_typeof(requirement_mapping) = 'array'),
  recommended_action text not null check (char_length(recommended_action) between 1 and 600),
  -- The truth gate: exactly which confirmed ledger rows supported this result.
  evidence_fact_ids uuid[] not null default '{}',
  data_quality jsonb not null default '{}'::jsonb
    check (pg_catalog.jsonb_typeof(data_quality) = 'object'),
  profile_version integer not null check (profile_version >= 0),
  job_updated_at timestamptz not null,
  computed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint job_matches_unique unique (user_id, job_id, career_profile_id)
);

comment on table public.job_matches is
  'Cached, explainable match results. Every dimension contribution and the exact confirmed fact identifiers used are retained so a ranking can always be justified after the fact.';
comment on column public.job_matches.evidence_fact_ids is
  'Confirmed career_facts rows used as evidence. Generated text must never assert a claim that is absent from this list.';
comment on column public.job_matches.confidence is
  'Separate from score: a high score computed from a thin profile is still low confidence and must be presented that way.';

create index job_matches_user_score_idx
  on public.job_matches (user_id, career_profile_id, score desc, computed_at desc);
create index job_matches_job_idx on public.job_matches (job_id);

-- ---------------------------------------------------------------------------
-- Truth-gate helpers
-- ---------------------------------------------------------------------------

create or replace function app_private.confirmed_fact_ids(target_career_profile_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(pg_catalog.array_agg(fact.id order by fact.category, fact.created_at), '{}')
  from public.career_facts as fact
  where fact.career_profile_id = target_career_profile_id
    and fact.status = 'confirmed';
$$;

/**
 * Rejects a match result that cites evidence the profile does not actually have.
 * This is the database-side half of the truth gate: the generator is expected to
 * be honest, and the schema makes dishonesty impossible to persist.
 */
create or replace function app_private.validate_match_evidence()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  allowed uuid[];
  cited uuid;
begin
  allowed := app_private.confirmed_fact_ids(new.career_profile_id);
  foreach cited in array new.evidence_fact_ids
  loop
    if not (cited = any (allowed)) then
      raise exception 'match evidence cites a fact that is not a confirmed claim on this profile'
        using errcode = '22023';
    end if;
  end loop;
  return new;
end;
$$;

create trigger job_matches_validate_evidence
before insert or update of evidence_fact_ids, career_profile_id on public.job_matches
for each row execute function app_private.validate_match_evidence();

revoke all on function app_private.confirmed_fact_ids(uuid) from public, anon, authenticated;
revoke all on function app_private.validate_match_evidence() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Snapshot helpers
-- ---------------------------------------------------------------------------

create or replace function app_private.job_match_snapshot(match public.job_matches)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'jobId', match.job_id,
    'careerProfileId', match.career_profile_id,
    'score', match.score,
    'verdict', match.verdict,
    'confidence', match.confidence,
    'modelVersion', match.model_version,
    'dimensions', match.dimensions,
    'strengths', match.strengths,
    'gaps', match.gaps,
    'blockers', match.blockers,
    'rejectionRisks', match.rejection_risks,
    'requirementMapping', match.requirement_mapping,
    'recommendedAction', match.recommended_action,
    'evidenceFactIds', pg_catalog.to_jsonb(match.evidence_fact_ids),
    'dataQuality', match.data_quality,
    'profileVersion', match.profile_version,
    'computedAt', match.computed_at
  );
$$;

create or replace function app_private.job_card_snapshot(job public.jobs)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'id', job.id,
    'title', job.title,
    'companyName', company.display_name,
    'employmentType', job.employment_type,
    'seniority', job.seniority,
    'remoteState', job.remote_state,
    'locationRaw', job.location_raw,
    'city', job.city,
    'region', job.region,
    'countryCode', job.country_code,
    'isPhilippines', job.is_philippines,
    'isInternational', job.is_international,
    'salaryMinMinor', job.salary_min_minor,
    'salaryMaxMinor', job.salary_max_minor,
    'salaryCurrency', job.salary_currency,
    'salaryPeriod', job.salary_period,
    'salaryIsEstimate', job.salary_is_estimate,
    'skills', pg_catalog.to_jsonb(job.skills),
    'postedAt', job.posted_at,
    'expiresAt', job.expires_at,
    'firstSeenAt', job.first_seen_at,
    'lastSeenAt', job.last_seen_at,
    'lastVerifiedAt', job.last_verified_at,
    'sourceCount', job.source_count,
    'status', job.status,
    'excerpt', job.description_excerpt
  )
  from public.companies as company
  where company.id = job.company_id;
$$;

revoke all on function app_private.job_match_snapshot(public.job_matches)
  from public, anon, authenticated;
revoke all on function app_private.job_card_snapshot(public.jobs)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Saved jobs and feedback
-- ---------------------------------------------------------------------------

create or replace function public.save_job(
  actor_user_id uuid,
  target_job_id uuid,
  target_career_profile_id uuid default null,
  requested_note text default null,
  action_request_id uuid default null
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  created boolean := false;
begin
  perform app_private.require_active_actor(actor_user_id);
  if not exists (select 1 from public.jobs where id = target_job_id) then
    raise exception 'job does not exist' using errcode = 'P0002';
  end if;
  if target_career_profile_id is not null then
    perform app_private.require_career_profile_owner(actor_user_id, target_career_profile_id);
  end if;

  insert into public.saved_jobs (user_id, job_id, career_profile_id, note)
  values (
    actor_user_id,
    target_job_id,
    target_career_profile_id,
    pg_catalog.left(pg_catalog.nullif(pg_catalog.btrim(requested_note), ''), 2000)
  )
  on conflict (user_id, job_id) do update
    set note = coalesce(excluded.note, public.saved_jobs.note),
        career_profile_id = coalesce(excluded.career_profile_id, public.saved_jobs.career_profile_id)
  returning (xmax = 0) into created;

  insert into public.audit_events (
    actor_user_id, actor_type, action, target_type, target_id, request_id
  ) values (
    actor_user_id, 'user', 'job.saved', 'job', target_job_id, action_request_id
  );

  return created;
end;
$$;

create or replace function public.unsave_job(
  actor_user_id uuid,
  target_job_id uuid,
  action_request_id uuid default null
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  removed integer := 0;
begin
  perform app_private.require_active_actor(actor_user_id);
  delete from public.saved_jobs where user_id = actor_user_id and job_id = target_job_id;
  get diagnostics removed = row_count;

  if removed > 0 then
    insert into public.audit_events (
      actor_user_id, actor_type, action, target_type, target_id, request_id
    ) values (
      actor_user_id, 'user', 'job.unsaved', 'job', target_job_id, action_request_id
    );
  end if;

  return removed > 0;
end;
$$;

create or replace function public.record_job_feedback(
  actor_user_id uuid,
  target_job_id uuid,
  requested_feedback public.job_feedback_kind,
  requested_reason text default null,
  target_career_profile_id uuid default null,
  action_request_id uuid default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  created_id uuid;
begin
  perform app_private.require_active_actor(actor_user_id);
  if not exists (select 1 from public.jobs where id = target_job_id) then
    raise exception 'job does not exist' using errcode = 'P0002';
  end if;
  if target_career_profile_id is not null then
    perform app_private.require_career_profile_owner(actor_user_id, target_career_profile_id);
  end if;

  update public.job_feedback
  set active = false, superseded_at = now()
  where user_id = actor_user_id and job_id = target_job_id and active;

  insert into public.job_feedback (
    user_id, job_id, career_profile_id, feedback, reason
  ) values (
    actor_user_id,
    target_job_id,
    target_career_profile_id,
    requested_feedback,
    pg_catalog.left(pg_catalog.nullif(pg_catalog.btrim(requested_reason), ''), 500)
  )
  returning id into created_id;

  if requested_feedback = 'saved' then
    perform public.save_job(actor_user_id, target_job_id, target_career_profile_id, null, action_request_id);
  end if;

  insert into public.audit_events (
    actor_user_id, actor_type, action, target_type, target_id, request_id, metadata
  ) values (
    actor_user_id, 'user', 'job.feedback_recorded', 'job', target_job_id, action_request_id,
    pg_catalog.jsonb_build_object('feedback', requested_feedback)
  );

  return created_id;
end;
$$;

revoke all on function public.save_job(uuid, uuid, uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function public.unsave_job(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.record_job_feedback(uuid, uuid, public.job_feedback_kind, text, uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.save_job(uuid, uuid, uuid, text, uuid) to service_role;
grant execute on function public.unsave_job(uuid, uuid, uuid) to service_role;
grant execute on function public.record_job_feedback(uuid, uuid, public.job_feedback_kind, text, uuid, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- Match result persistence
-- ---------------------------------------------------------------------------

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

    select jobs.updated_at into job_updated
    from public.jobs as jobs
    where jobs.id = (app_private.career_text(element, 'jobId', 40, true))::uuid;
    if job_updated is null then
      continue;
    end if;

    insert into public.job_matches (
      user_id, job_id, career_profile_id, score, verdict, confidence, model_version,
      dimensions, strengths, gaps, blockers, rejection_risks, requirement_mapping,
      recommended_action, evidence_fact_ids, data_quality, profile_version, job_updated_at
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
      job_updated
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
          computed_at = now();

    stored := stored + 1;
  end loop;

  return stored;
end;
$$;

revoke all on function public.record_job_matches(uuid, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.record_job_matches(uuid, jsonb, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create trigger saved_jobs_set_updated_at
before update on public.saved_jobs
for each row execute function app_private.set_updated_at();

create trigger job_feedback_set_updated_at
before update on public.job_feedback
for each row execute function app_private.set_updated_at();

create trigger job_matches_set_updated_at
before update on public.job_matches
for each row execute function app_private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security and grants
-- ---------------------------------------------------------------------------

alter table public.saved_jobs enable row level security;
alter table public.saved_jobs force row level security;
alter table public.job_feedback enable row level security;
alter table public.job_feedback force row level security;
alter table public.job_matches enable row level security;
alter table public.job_matches force row level security;

revoke all on table public.saved_jobs from public, anon, authenticated;
revoke all on table public.job_feedback from public, anon, authenticated;
revoke all on table public.job_matches from public, anon, authenticated;

grant all privileges on table public.saved_jobs to service_role;
grant all privileges on table public.job_feedback to service_role;
grant all privileges on table public.job_matches to service_role;

grant select (id, job_id, career_profile_id, note, saved_at, created_at, updated_at)
  on table public.saved_jobs to authenticated;
grant select (id, job_id, career_profile_id, feedback, reason, active, created_at)
  on table public.job_feedback to authenticated;
grant select (
  id, job_id, career_profile_id, score, verdict, confidence, model_version,
  dimensions, strengths, gaps, blockers, rejection_risks, requirement_mapping,
  recommended_action, evidence_fact_ids, data_quality, computed_at
) on table public.job_matches to authenticated;

create policy saved_jobs_select_own_active_account
on public.saved_jobs
for select
to authenticated
using (
  user_id = (select auth.uid())
  and (select app_private.is_account_active())
);

create policy job_feedback_select_own_active_account
on public.job_feedback
for select
to authenticated
using (
  user_id = (select auth.uid())
  and (select app_private.is_account_active())
);

create policy job_matches_select_own_active_account
on public.job_matches
for select
to authenticated
using (
  user_id = (select auth.uid())
  and (select app_private.is_account_active())
);

comment on policy job_matches_select_own_active_account on public.job_matches is
  'A match result is readable only by its owner, and only while the account is active. Saving, dismissing, and recomputing all go through audited functions.';
