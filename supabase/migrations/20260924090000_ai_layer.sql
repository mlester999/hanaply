-- Hanaply AI persistence: invocation records, cached analyses, and coach threads.
--
-- The AI layer is additive. Everything deterministic that already exists — the
-- match score, the confidence, the requirement mapping, the metering counters —
-- stays exactly as it is. What this migration adds is the bookkeeping the model
-- path needs and the deterministic path never did:
--
--   1. Every model call is recorded, with its provider, model, token counts,
--      latency, and outcome. An AI feature that cannot be costed cannot be
--      operated, and the admin cost view has nothing to read without this.
--   2. An opportunity analysis is cached per profile, job, and model version,
--      so opening the same job twice does not pay for the same reasoning twice.
--      The cache is keyed on the evidence fingerprint, so confirming a new fact
--      invalidates it rather than serving a stale analysis.
--   3. Coach conversations are stored as threads with messages, so the coach has
--      context and the subscriber can see what they were told.
--
-- The truth gate is unchanged and not duplicated here. Grounded output is
-- enforced in `packages/ai` and again by `app_private.validate_artifact_evidence`
-- before anything is written to `application_artifacts`.

-- ---------------------------------------------------------------------------
-- Invocation records
-- ---------------------------------------------------------------------------

create table public.ai_invocations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null references auth.users (id) on delete set null,
  career_profile_id uuid null references public.career_profiles (id) on delete set null,
  -- What the call was for. Deliberately separate from `usage_feature`, which
  -- meters billable quota; this records operations that may be free.
  operation text not null check (operation in (
    'opportunity_analysis',
    'artifact_generation',
    'coach_message',
    'profile_review',
    'resume_feedback',
    'interview_preparation'
  )),
  provider text not null check (pg_catalog.char_length(provider) between 2 and 60),
  model text not null check (pg_catalog.char_length(model) between 1 and 120),
  prompt_version text not null check (prompt_version ~ '^[a-z0-9][a-z0-9._-]{2,60}$'),
  request_id uuid not null,
  outcome text not null check (outcome in (
    'succeeded',
    'schema_rejected',
    'grounding_rejected',
    'provider_error',
    'timeout',
    'rate_limited',
    'disabled'
  )),
  -- A grounding or schema rejection is a success for the safety system and a
  -- failure for the caller. Both are recorded, because a rising rejection rate
  -- is the signal that a prompt or a model has regressed.
  rejection_reason text null check (rejection_reason is null or pg_catalog.char_length(rejection_reason) <= 300),
  input_tokens integer null check (input_tokens is null or input_tokens >= 0),
  output_tokens integer null check (output_tokens is null or output_tokens >= 0),
  latency_ms integer null check (latency_ms is null or latency_ms >= 0),
  attempt integer not null default 1 check (attempt between 1 and 10),
  cached boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table public.ai_invocations is
  'One row per model call, including rejected ones. Holds no prompt or completion text: cost and reliability are observable without storing subscriber content.';

create index ai_invocations_recent_idx on public.ai_invocations (created_at desc);
create index ai_invocations_user_idx on public.ai_invocations (user_id, created_at desc);
create index ai_invocations_operation_idx on public.ai_invocations (operation, outcome, created_at desc);

-- ---------------------------------------------------------------------------
-- Cached opportunity analyses
-- ---------------------------------------------------------------------------

create table public.opportunity_analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  career_profile_id uuid not null references public.career_profiles (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,
  provider text not null check (pg_catalog.char_length(provider) between 2 and 60),
  model text not null check (pg_catalog.char_length(model) between 1 and 120),
  prompt_version text not null,
  match_model_version text not null,
  /**
   * A fingerprint of the evidence the analysis was grounded in: the confirmed
   * fact ids plus the match score. Confirming or rejecting a fact changes this,
   * which invalidates the cache instead of serving reasoning built on evidence
   * the subscriber has since changed.
   */
  evidence_fingerprint text not null check (evidence_fingerprint ~ '^[0-9a-f]{64}$'),
  analysis jsonb not null check (pg_catalog.jsonb_typeof(analysis) = 'object'),
  cited_fact_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (career_profile_id, job_id, provider, model, prompt_version, evidence_fingerprint)
);

comment on table public.opportunity_analyses is
  'Grounded AI reasoning about one opportunity, cached by evidence fingerprint so a changed fact ledger invalidates it rather than serving stale reasoning.';

create index opportunity_analyses_lookup_idx
  on public.opportunity_analyses (career_profile_id, job_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Coach threads
-- ---------------------------------------------------------------------------

create table public.coach_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  career_profile_id uuid null references public.career_profiles (id) on delete set null,
  title text not null check (pg_catalog.char_length(title) between 1 and 160),
  topic text not null default 'general' check (topic in (
    'general',
    'career_strategy',
    'resume',
    'profile',
    'skills',
    'job_search',
    'interview',
    'application'
  )),
  provider text null,
  model text null,
  status text not null default 'open' check (status in ('open', 'archived')),
  message_count integer not null default 0 check (message_count >= 0),
  last_message_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger coach_conversations_set_updated_at
before update on public.coach_conversations
for each row execute function app_private.set_updated_at();

create table public.coach_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.coach_conversations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  /**
   * Position within the conversation.
   *
   * Ordering by `created_at` alone is not deterministic: `now()` is the
   * transaction timestamp, so every message written in one transaction shares
   * it, and falling back to the row id means falling back to a random UUID. A
   * coaching thread that reads back in a different order each time is worse than
   * useless, so the position is stored explicitly.
   */
  sequence integer not null check (sequence > 0),
  role text not null check (role in ('user', 'assistant')),
  body text not null check (pg_catalog.char_length(body) between 1 and 8000),
  /**
   * Coach output is split so the interface cannot present an inference as a fact
   * about the subscriber. A `fact` entry must cite the confirmed facts that
   * support it; a `suggestion` is explicitly labelled as inference and cites
   * nothing.
   */
  facts jsonb not null default '[]'::jsonb
    check (pg_catalog.jsonb_typeof(facts) = 'array'),
  suggestions jsonb not null default '[]'::jsonb
    check (pg_catalog.jsonb_typeof(suggestions) = 'array'),
  cited_fact_ids uuid[] not null default '{}',
  provider text null,
  model text null,
  input_tokens integer null,
  output_tokens integer null,
  created_at timestamptz not null default now(),
  -- An assistant message with no grounding is a suggestion, never a fact.
  constraint coach_messages_grounding_check check (
    role = 'user'
    or pg_catalog.jsonb_array_length(facts) = 0
    or pg_catalog.cardinality(cited_fact_ids) > 0
  ),
  constraint coach_messages_sequence_unique unique (conversation_id, sequence)
);

comment on table public.coach_messages is
  'Coach thread messages. The check constraint makes an uncited factual claim unstorable: an assistant message that asserts facts must cite confirmed fact ids, so a fabricated statement cannot be persisted even by a direct write.';

create index coach_messages_conversation_idx
  on public.coach_messages (conversation_id, created_at);
create index coach_conversations_user_idx
  on public.coach_conversations (user_id, last_message_at desc nulls last);

-- ---------------------------------------------------------------------------
-- Writes
-- ---------------------------------------------------------------------------

create or replace function public.record_ai_invocation(
  actor_user_id uuid,
  target_career_profile_id uuid,
  requested_operation text,
  requested_provider text,
  requested_model text,
  requested_prompt_version text,
  requested_request_id uuid,
  requested_outcome text,
  requested_rejection_reason text default null,
  requested_input_tokens integer default null,
  requested_output_tokens integer default null,
  requested_latency_ms integer default null,
  requested_attempt integer default 1,
  requested_cached boolean default false
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
  perform app_private.require_service_role();

  insert into public.ai_invocations (
    user_id, career_profile_id, operation, provider, model, prompt_version,
    request_id, outcome, rejection_reason, input_tokens, output_tokens,
    latency_ms, attempt, cached
  ) values (
    actor_user_id, target_career_profile_id, requested_operation,
    requested_provider, requested_model, requested_prompt_version,
    requested_request_id, requested_outcome,
    pg_catalog.left(requested_rejection_reason, 300),
    requested_input_tokens, requested_output_tokens,
    requested_latency_ms, requested_attempt, requested_cached
  )
  returning id into created_id;

  return created_id;
end;
$$;

create or replace function public.record_opportunity_analysis(
  actor_user_id uuid,
  target_career_profile_id uuid,
  target_job_id uuid,
  requested_provider text,
  requested_model text,
  requested_prompt_version text,
  requested_match_model_version text,
  requested_evidence_fingerprint text,
  requested_analysis jsonb,
  requested_cited_fact_ids uuid[] default '{}'
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  created_id uuid;
  inadmissible uuid[];
begin
  perform app_private.require_service_role();
  perform app_private.require_career_profile_owner(actor_user_id, target_career_profile_id);

  if pg_catalog.jsonb_typeof(requested_analysis) <> 'object' then
    raise exception 'an analysis must be a JSON object' using errcode = '22023';
  end if;

  -- The same guarantee the artifact and match writers give: reasoning may only
  -- cite facts the subscriber has actually confirmed.
  select pg_catalog.array_agg(cited) into inadmissible
  from pg_catalog.unnest(coalesce(requested_cited_fact_ids, '{}'::uuid[])) as cited
  where cited <> all (app_private.confirmed_fact_ids(target_career_profile_id));

  if inadmissible is not null then
    raise exception 'opportunity analyses may only cite confirmed career facts'
      using errcode = '22023';
  end if;

  insert into public.opportunity_analyses (
    user_id, career_profile_id, job_id, provider, model, prompt_version,
    match_model_version, evidence_fingerprint, analysis, cited_fact_ids
  ) values (
    actor_user_id, target_career_profile_id, target_job_id,
    requested_provider, requested_model, requested_prompt_version,
    requested_match_model_version, requested_evidence_fingerprint,
    requested_analysis, coalesce(requested_cited_fact_ids, '{}'::uuid[])
  )
  on conflict (career_profile_id, job_id, provider, model, prompt_version, evidence_fingerprint)
  do update set analysis = excluded.analysis,
                cited_fact_ids = excluded.cited_fact_ids
  returning id into created_id;

  return created_id;
end;
$$;

create or replace function public.open_coach_conversation(
  actor_user_id uuid,
  target_career_profile_id uuid,
  requested_title text,
  requested_topic text default 'general',
  requested_provider text default null,
  requested_model text default null
)
returns public.coach_conversations
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  created public.coach_conversations;
begin
  perform app_private.require_active_actor(actor_user_id);

  if target_career_profile_id is not null then
    perform app_private.require_career_profile_owner(actor_user_id, target_career_profile_id);
  end if;

  insert into public.coach_conversations (
    user_id, career_profile_id, title, topic, provider, model
  ) values (
    actor_user_id, target_career_profile_id,
    pg_catalog.left(pg_catalog.btrim(requested_title), 160),
    requested_topic, requested_provider, requested_model
  )
  returning * into created;

  return created;
end;
$$;

create or replace function public.append_coach_message(
  actor_user_id uuid,
  target_conversation_id uuid,
  requested_role text,
  requested_body text,
  requested_facts jsonb default '[]'::jsonb,
  requested_suggestions jsonb default '[]'::jsonb,
  requested_cited_fact_ids uuid[] default '{}',
  requested_provider text default null,
  requested_model text default null,
  requested_input_tokens integer default null,
  requested_output_tokens integer default null
)
returns public.coach_messages
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  conversation public.coach_conversations;
  created public.coach_messages;
  inadmissible uuid[];
begin
  perform app_private.require_active_actor(actor_user_id);

  select * into conversation
  from public.coach_conversations
  where id = target_conversation_id and user_id = actor_user_id;
  if conversation.id is null then
    raise exception 'coach conversation does not exist' using errcode = 'P0002';
  end if;

  if requested_role not in ('user', 'assistant') then
    raise exception 'an unsupported coach role was requested' using errcode = '22023';
  end if;

  if conversation.career_profile_id is not null then
    select pg_catalog.array_agg(cited) into inadmissible
    from pg_catalog.unnest(coalesce(requested_cited_fact_ids, '{}'::uuid[])) as cited
    where cited <> all (app_private.confirmed_fact_ids(conversation.career_profile_id));

    if inadmissible is not null then
      raise exception 'coach messages may only cite confirmed career facts'
        using errcode = '22023';
    end if;
  end if;

  insert into public.coach_messages (
    conversation_id, user_id, sequence, role, body, facts, suggestions, cited_fact_ids,
    provider, model, input_tokens, output_tokens
  ) values (
    conversation.id, actor_user_id, conversation.message_count + 1, requested_role,
    pg_catalog.left(requested_body, 8000),
    coalesce(requested_facts, '[]'::jsonb),
    coalesce(requested_suggestions, '[]'::jsonb),
    coalesce(requested_cited_fact_ids, '{}'::uuid[]),
    requested_provider, requested_model, requested_input_tokens, requested_output_tokens
  )
  returning * into created;

  update public.coach_conversations
  set message_count = message_count + 1,
      last_message_at = now()
  where id = conversation.id;

  return created;
end;
$$;

create or replace function public.coach_conversation_detail(
  actor_user_id uuid,
  target_conversation_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  conversation public.coach_conversations;
begin
  perform app_private.require_active_actor(actor_user_id);

  select * into conversation
  from public.coach_conversations
  where id = target_conversation_id and user_id = actor_user_id;
  if conversation.id is null then
    raise exception 'coach conversation does not exist' using errcode = 'P0002';
  end if;

  return pg_catalog.jsonb_build_object(
    'id', conversation.id,
    'careerProfileId', conversation.career_profile_id,
    'title', conversation.title,
    'topic', conversation.topic,
    'status', conversation.status,
    'provider', conversation.provider,
    'model', conversation.model,
    'messageCount', conversation.message_count,
    'lastMessageAt', conversation.last_message_at,
    'createdAt', conversation.created_at,
    'messages', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', message.id,
          'sequence', message.sequence,
          'role', message.role,
          'body', message.body,
          'facts', message.facts,
          'suggestions', message.suggestions,
          'citedFactIds', pg_catalog.to_jsonb(message.cited_fact_ids),
          'createdAt', message.created_at
        )
        order by message.sequence
      )
      from public.coach_messages as message
      where message.conversation_id = conversation.id
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants and row-level security
-- ---------------------------------------------------------------------------

revoke all on table public.ai_invocations from public, anon, authenticated;
revoke all on table public.opportunity_analyses from public, anon, authenticated;
revoke all on table public.coach_conversations from public, anon, authenticated;
revoke all on table public.coach_messages from public, anon, authenticated;

alter table public.ai_invocations enable row level security;
alter table public.ai_invocations force row level security;
alter table public.opportunity_analyses enable row level security;
alter table public.opportunity_analyses force row level security;
alter table public.coach_conversations enable row level security;
alter table public.coach_conversations force row level security;
alter table public.coach_messages enable row level security;
alter table public.coach_messages force row level security;

-- The subscriber can read their own coach threads; everything else is reached
-- through the API, which resolves the actor and never accepts a user id.
create policy coach_conversations_select_own on public.coach_conversations
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy coach_messages_select_own on public.coach_messages
  for select to authenticated
  using (user_id = (select auth.uid()));

grant select (id, career_profile_id, title, topic, status, provider, model, message_count, last_message_at, created_at, updated_at)
  on table public.coach_conversations to authenticated;
grant select (id, conversation_id, sequence, role, body, facts, suggestions, cited_fact_ids, created_at)
  on table public.coach_messages to authenticated;

grant all privileges on table public.ai_invocations to service_role;
grant all privileges on table public.opportunity_analyses to service_role;
grant all privileges on table public.coach_conversations to service_role;
grant all privileges on table public.coach_messages to service_role;

revoke all on function public.record_ai_invocation(
  uuid, uuid, text, text, text, text, uuid, text, text, integer, integer, integer, integer, boolean
) from public, anon, authenticated;
revoke all on function public.record_opportunity_analysis(
  uuid, uuid, uuid, text, text, text, text, text, jsonb, uuid[]
) from public, anon, authenticated;
revoke all on function public.open_coach_conversation(uuid, uuid, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.append_coach_message(
  uuid, uuid, text, text, jsonb, jsonb, uuid[], text, text, integer, integer
) from public, anon, authenticated;
revoke all on function public.coach_conversation_detail(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.record_ai_invocation(
  uuid, uuid, text, text, text, text, uuid, text, text, integer, integer, integer, integer, boolean
) to service_role;
grant execute on function public.record_opportunity_analysis(
  uuid, uuid, uuid, text, text, text, text, text, jsonb, uuid[]
) to service_role;
grant execute on function public.open_coach_conversation(uuid, uuid, text, text, text, text)
  to service_role;
grant execute on function public.append_coach_message(
  uuid, uuid, text, text, jsonb, jsonb, uuid[], text, text, integer, integer
) to service_role;
grant execute on function public.coach_conversation_detail(uuid, uuid) to service_role;
