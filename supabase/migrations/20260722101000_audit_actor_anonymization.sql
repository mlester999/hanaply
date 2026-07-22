-- Preserve append-only audit history while allowing auth-user deletion to anonymize its FK.

create or replace function app_private.prevent_audit_event_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
    and pg_catalog.pg_trigger_depth() > 1
    and old.actor_user_id is not null
    and new.actor_user_id is null
    and (pg_catalog.to_jsonb(new) - 'actor_user_id') =
      (pg_catalog.to_jsonb(old) - 'actor_user_id') then
    return new;
  end if;

  raise exception 'audit events are append-only' using errcode = '42501';
end;
$$;

revoke all on function app_private.prevent_audit_event_mutation() from public, anon, authenticated;

comment on function app_private.prevent_audit_event_mutation() is
  'Blocks audit mutation except the nested FK action that nulls actor_user_id when an auth user is deleted.';
