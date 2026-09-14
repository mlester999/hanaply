-- Hanaply Application Pack artifact generation.
--
-- Pack creation, metering, storage, and the database truth gate already exist.
-- What this migration adds is the server-side half of the operation that
-- actually writes artifact content:
--
--   1. app_private.require_application_pack_owner() names the ownership check
--      that every pack-scoped function performs inline today, so a new entry
--      point cannot get it subtly wrong.
--   2. public.complete_application_pack() refuses to mark a pack ready while it
--      still has zero artifacts. "Ready" is presented to the subscriber as a
--      finished pack, and a finished pack with nothing in it is a false
--      statement about what was produced.
--   3. public.generate_application_pack_artifacts() is the generation context
--      and finalisation entry point. It verifies ownership, refuses a pack that
--      cannot be generated, and returns everything the deterministic generator
--      in services/api/src/pack-generation.ts is allowed to read: the frozen
--      match snapshot, the confirmed career facts it may cite, the career
--      profile, and the posting.
--
-- Generation itself is not in the database, and that is deliberate. The
-- generator is a pure function that quotes confirmed facts verbatim and never
-- computes a number, so it can be unit tested against realistic fixtures.
-- Artifact writes still go through public.record_application_artifact(), which
-- applies app_private.validate_artifact_evidence(); this migration does not
-- duplicate or weaken that validation in any way.
--
-- The function is idempotent and two-phase. Called before anything is recorded
-- it returns the context and leaves the pack generating. Called again after the
-- generator has recorded the artifacts it returns the same context, reports
-- finalized = true, and marks the pack ready through the existing helper. The
-- requested kinds and style are what "already recorded" is measured against, so
-- a retry or a double click resolves to the same artifacts rather than a second
-- copy: uniqueness is still the (pack_id, kind, style) constraint on
-- public.application_artifacts and nothing else.

-- ---------------------------------------------------------------------------
-- Ownership
-- ---------------------------------------------------------------------------

/**
 * Resolves a pack the caller actually owns, or raises. `P0002` is the same code
 * the pack functions already raise for a pack that does not exist, so a caller
 * cannot use the response to distinguish "not yours" from "not there".
 */
create or replace function app_private.require_application_pack_owner(
  actor_user_id uuid,
  target_pack_id uuid
)
returns public.application_packs
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  pack public.application_packs;
begin
  perform app_private.require_active_actor(actor_user_id);

  select * into pack
  from public.application_packs
  where id = target_pack_id and user_id = actor_user_id;

  if pack.id is null then
    raise exception 'application pack does not exist' using errcode = 'P0002';
  end if;

  return pack;
end;
$$;

comment on function app_private.require_application_pack_owner(uuid, uuid) is
  'Returns one Application Pack owned by the actor, raising P0002 otherwise. Every pack-scoped entry point resolves ownership through this function.';

-- ---------------------------------------------------------------------------
-- Ready means produced
-- ---------------------------------------------------------------------------

/**
 * Completes a pack.
 *
 * Identical to the original definition except for two things, both of which the
 * pack generation entry point needs:
 *
 *   1. `ready` is refused while the pack has no artifact. Recording an artifact
 *      marks a pack ready on its own, so this guard only closes the path where a
 *      caller could declare a pack finished without producing anything.
 *   2. The error code is copied into a local variable before the update. The
 *      original wrote `error_code = left(error_code, 80)` against a target table
 *      that also has an `error_code` column, which PostgreSQL rejects as an
 *      ambiguous reference. Nothing had ever called this function, so the
 *      ambiguity had never been reached.
 */
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
  artifact_count integer;
  failure_code text;
begin
  perform app_private.require_active_actor(actor_user_id);
  if outcome not in ('ready', 'failed', 'generating') then
    raise exception 'unsupported pack outcome' using errcode = '22023';
  end if;

  failure_code := error_code;
  pack := app_private.require_application_pack_owner(actor_user_id, target_pack_id);

  if outcome = 'ready' then
    select pg_catalog.count(*)::integer into artifact_count
    from public.application_artifacts as artifact
    where artifact.pack_id = pack.id;

    if artifact_count = 0 then
      raise exception 'an Application Pack cannot be marked ready before it has an artifact'
        using errcode = '22023';
    end if;
  end if;

  update public.application_packs
  set status = outcome::public.application_pack_status,
      error_code = pg_catalog.left(failure_code, 80),
      generated_at = case when outcome = 'ready' then coalesce(generated_at, now()) else generated_at end,
      version = version + 1
  where id = pack.id;

  return true;
end;
$$;

comment on function public.complete_application_pack(uuid, uuid, text, text) is
  'Sets a pack outcome. A pack cannot be marked ready while it has zero artifacts, because ready is shown to the subscriber as a finished pack.';

-- ---------------------------------------------------------------------------
-- Generation context and finalisation
-- ---------------------------------------------------------------------------

/**
 * Prepares and finalises artifact generation for one pack.
 *
 * Returns the pack snapshot (so the response is the same shape as the pack
 * detail read model), the frozen match snapshot, the confirmed career facts the
 * generator may cite, the career profile detail, the posting, and the artifacts
 * stored so far. `finalized` is true only on the call made after the generator
 * has recorded at least one artifact for the requested kinds and style, and
 * that is the only path that marks the pack ready.
 *
 * The allowed evidence is the intersection of two sets: the facts that are
 * confirmed right now, which is exactly what the truth-gate trigger checks, and
 * the identifiers frozen onto the pack at creation time, which the pack table
 * documents as the only set an artifact may cite. A fact confirmed after the
 * pack was created is therefore never cited behind the subscriber's back.
 */
create or replace function public.generate_application_pack_artifacts(
  actor_user_id uuid,
  target_pack_id uuid,
  requested_kinds public.application_artifact_kind[],
  requested_style text,
  action_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  pack public.application_packs;
  profile public.career_profiles;
  target_job public.jobs;
  allowed uuid[];
  evidence jsonb := '[]'::jsonb;
  stored jsonb := '[]'::jsonb;
  artifact_count integer := 0;
  finalized boolean := false;
  style_value text;
begin
  perform app_private.require_active_actor(actor_user_id);

  if requested_kinds is null or pg_catalog.cardinality(requested_kinds) = 0 then
    raise exception 'at least one artifact kind must be requested' using errcode = '22023';
  end if;
  if pg_catalog.cardinality(requested_kinds) > 6 then
    raise exception 'at most six artifact kinds may be generated at once' using errcode = '22023';
  end if;
  if exists (
    select 1 from pg_catalog.unnest(requested_kinds) as requested(kind) where requested.kind is null
  ) then
    raise exception 'artifact kinds must not be null' using errcode = '22023';
  end if;

  -- Ownership first, so nothing below can be reached for a pack the caller does
  -- not own.
  pack := app_private.require_application_pack_owner(actor_user_id, target_pack_id);

  -- An archived pack is a record of something that was sent, not a workspace.
  if pack.status = 'archived' then
    raise exception 'an archived Application Pack cannot be generated' using errcode = '22023';
  end if;

  style_value := pg_catalog.left(
    nullif(pg_catalog.btrim(coalesce(requested_style, '')), ''), 60
  );
  if style_value is not null
     and style_value not in ('concise', 'standard', 'achievement_led') then
    raise exception 'unsupported artifact style' using errcode = '22023';
  end if;

  profile := app_private.require_career_profile_owner(actor_user_id, pack.career_profile_id);

  select * into target_job from public.jobs where id = pack.job_id;
  if target_job.id is null then
    raise exception 'job does not exist' using errcode = 'P0002';
  end if;

  allowed := app_private.confirmed_fact_ids(profile.id);

  select coalesce(
    pg_catalog.jsonb_agg(
      app_private.career_fact_snapshot(fact)
      order by fact.category, fact.created_at, fact.id
    ),
    '[]'::jsonb
  )
  into evidence
  from public.career_facts as fact
  where fact.career_profile_id = profile.id
    and fact.status = 'confirmed'
    and fact.id = any (pack.evidence_fact_ids)
    and fact.id = any (allowed);

  select pg_catalog.count(*)::integer into artifact_count
  from public.application_artifacts as artifact
  where artifact.pack_id = pack.id
    and artifact.kind = any (requested_kinds)
    and artifact.style is not distinct from style_value;

  if artifact_count > 0 then
    -- Every requested artifact exists, so the pack is finished. This is the only
    -- place a pack reaches ready through generation, and the helper refuses to
    -- do it while the pack has no artifacts at all.
    perform public.complete_application_pack(actor_user_id, pack.id, 'ready', null);
    finalized := true;
  elsif pack.status in ('queued', 'failed') then
    -- Nothing has been generated yet: the pack is being worked on. A pack that
    -- is already ready keeps its status until a regenerated artifact replaces
    -- one of its own.
    perform public.complete_application_pack(actor_user_id, pack.id, 'generating', null);
  end if;

  select * into pack from public.application_packs where id = pack.id;

  select coalesce(
    pg_catalog.jsonb_agg(
      app_private.application_artifact_snapshot(artifact)
      order by artifact.kind, artifact.style
    ),
    '[]'::jsonb
  )
  into stored
  from public.application_artifacts as artifact
  where artifact.pack_id = pack.id;

  insert into public.audit_events (
    actor_user_id, actor_type, action, target_type, target_id, request_id, metadata
  ) values (
    actor_user_id,
    'system',
    case
      when finalized then 'application_pack.generation_finalized'
      else 'application_pack.generation_prepared'
    end,
    'application_pack',
    pack.id,
    action_request_id,
    pg_catalog.jsonb_build_object(
      'kinds', pg_catalog.to_jsonb(requested_kinds),
      'style', style_value,
      'artifactCount', artifact_count,
      'evidenceCount', pg_catalog.jsonb_array_length(evidence)
    )
  );

  return app_private.application_pack_snapshot(pack) || pg_catalog.jsonb_build_object(
    'job', app_private.job_card_snapshot(target_job) || pg_catalog.jsonb_build_object(
      'description', target_job.description,
      'requirements', pg_catalog.to_jsonb(target_job.requirements),
      'preferredQualifications', pg_catalog.to_jsonb(target_job.preferred_qualifications),
      'experienceYearsMin', target_job.experience_years_min,
      'experienceYearsMax', target_job.experience_years_max
    ),
    'applyUrl', target_job.apply_url,
    'artifacts', stored,
    'match', pack.match_snapshot,
    'evidence', evidence,
    'profile', app_private.career_profile_detail_value(profile.id),
    'requestedKinds', pg_catalog.to_jsonb(requested_kinds),
    'style', style_value,
    'finalized', finalized
  );
end;
$$;

comment on function public.generate_application_pack_artifacts(uuid, uuid, public.application_artifact_kind[], text, uuid) is
  'Generation context and finalisation for one Application Pack. Returns the frozen match snapshot, the confirmed facts the generator may cite, the profile, and the posting; marks the pack ready only once artifacts for the requested kinds and style exist.';

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function app_private.require_application_pack_owner(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.generate_application_pack_artifacts(
  uuid, uuid, public.application_artifact_kind[], text, uuid
) from public, anon, authenticated;
revoke all on function public.complete_application_pack(uuid, uuid, text, text)
  from public, anon, authenticated;

grant execute on function public.generate_application_pack_artifacts(
  uuid, uuid, public.application_artifact_kind[], text, uuid
) to service_role;
grant execute on function public.complete_application_pack(uuid, uuid, text, text)
  to service_role;
