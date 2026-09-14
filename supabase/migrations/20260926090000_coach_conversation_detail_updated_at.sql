-- The coach thread detail is missing the timestamp its own contract publishes.
--
-- `packages/contracts` describes a coach conversation with `updatedAt` — every
-- other reader of `public.coach_conversations` supplies it, including the
-- directory read the API performs directly against the table — but
-- `public.coach_conversation_detail` builds its payload key by key and never
-- projected `conversation.updated_at`. The column exists, is `not null`, and is
-- maintained by the `coach_conversations_set_updated_at` trigger, so the only
-- thing missing was the field in the JSON.
--
-- The consequence was not cosmetic. `AiRepository.coachConversationDetail`
-- validates the payload against `coachConversationDetailRowSchema`, which
-- requires a timestamp there, so *every* detail read failed and the API answered
-- 503 "That coach conversation could not be read". Opening a thread navigated
-- nowhere — the browser stayed on `/dashboard/coach` while the conversation row
-- had in fact been written — and sending a message failed the same way after the
-- member's text had already been stored. Four launch requirements were
-- unverifiable because of one absent key.
--
-- Nothing else about the function changes: the same signature, the same
-- ownership check, the same `require_active_actor` gate, the same ordering of
-- messages, and the same grants — which are keyed on the argument list and so
-- continue to apply unchanged. Adding a key to the returned object cannot widen
-- what a caller may read, because the function still only ever reads the row
-- whose `user_id` is the acting subscriber.
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
    'updatedAt', conversation.updated_at,
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

comment on function public.coach_conversation_detail(uuid, uuid) is
  'One coach thread, its messages in sequence order, and the conversation timestamps the published contract requires.';
