-- Coach message citation check: close the unlinked-conversation gap.
--
-- `public.append_coach_message` has always verified that every cited fact id is
-- confirmed *for the conversation's profile*:
--
--     if conversation.career_profile_id is not null then
--       ... cite <> all (confirmed_fact_ids(conversation.career_profile_id)) ...
--     end if;
--
-- The guard reads as if a conversation without a career profile has nothing to
-- verify. It does: `coach_conversations.career_profile_id` is nullable, and
-- `open_coach_conversation` accepts null deliberately, because a subscriber may
-- open a thread before they have a profile. On that path the citation check was
-- skipped entirely, while `coach_messages_grounding_check` still required a
-- non-empty `cited_fact_ids` array — and that array is only checked for
-- cardinality, never for admissibility. An assistant message asserting anything
-- at all therefore became storable by naming *some* uuid: a fact confirmed on
-- any other profile the same subscriber owns, or a random value entirely.
--
-- That is the failure mode the whole AI layer exists to prevent. The database is
-- the last line of defence for "never state inferred information as a fact about
-- the user" (`packages/ai` refuses it first and the API demotes an uncited fact
-- out of the facts channel before calling here), and it was open for every
-- thread that had no profile attached.
--
-- The fix keeps the rule identical where a profile is linked and states it for
-- the unlinked case: a cited fact must be confirmed for the conversation's
-- profile when there is one, and must be one of the acting subscriber's own
-- confirmed facts when there is not. Nothing else about the function changes —
-- the same signature, the same defaults, the same conversation-ownership check,
-- the same role validation, and the same return value, so every existing caller
-- and every existing grant (which is keyed on the argument list) continues to
-- apply, and `AiService.sendMessage` — which only ever cites facts it just read
-- from `confirmed_career_evidence` for that same profile — is unaffected.
--
-- A consequence worth naming: once a thread is linked to a second profile, a
-- message citing a fact from the first profile is refused. That is correct. A
-- thread that spans two ledgers has no single admissible set, and the honest
-- answer is to cite only what the conversation is about.
--
-- What is deliberately not changed is the constraint that a message with no
-- citation cannot be resolved by *looking up* one, because the array holds
-- identifiers and identifiers carry no statement. Requiring the citation to be
-- admissible is the part the database can enforce on its own, and it does.

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
  -- The confirmed ledger every citation in this message is measured against:
  -- the conversation's own profile when it has one, and the acting subscriber's
  -- own profiles otherwise. Never another subscriber's, and never nobody's, so
  -- a thread with no profile attached cannot be used to cite a fact the
  -- subscriber is not entitled to state.
  allowed_fact_ids uuid[];
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
    allowed_fact_ids := app_private.confirmed_fact_ids(conversation.career_profile_id);
  else
    select coalesce(pg_catalog.array_agg(fact.id order by fact.category, fact.created_at), '{}')
    into allowed_fact_ids
    from public.career_facts as fact
    join public.career_profiles as profile on profile.id = fact.career_profile_id
    where profile.user_id = actor_user_id
      and fact.status = 'confirmed';
  end if;

  select pg_catalog.array_agg(cited) into inadmissible
  from pg_catalog.unnest(coalesce(requested_cited_fact_ids, '{}'::uuid[])) as cited
  where cited <> all (allowed_fact_ids);

  if inadmissible is not null then
    raise exception 'coach messages may only cite confirmed career facts'
      using errcode = '22023';
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

comment on function public.append_coach_message(
  uuid, uuid, text, text, jsonb, jsonb, uuid[], text, text, integer, integer
) is
  'Appends one coach message, refusing any cited fact id that is not confirmed for the conversation profile, or for the acting subscriber when the thread has no profile linked.';
