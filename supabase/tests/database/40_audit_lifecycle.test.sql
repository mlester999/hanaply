begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

create function pg_temp.operation_fails(statement text)
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

select plan(3);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous
)
values (
  '00000000-0000-0000-0000-000000000000',
  '40000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'deleted-actor@hanaply.test',
  crypt('Phase0Password1', gen_salt('bf')),
  now(), '{}', '{}', now(), now(), false, false
);

insert into public.audit_events (actor_user_id, actor_type, action, target_type)
values (
  '40000000-0000-4000-8000-000000000001',
  'admin',
  'test.actor_lifecycle',
  'test_fixture'
);

set local role service_role;
select ok(
  pg_temp.operation_fails($statement$update public.audit_events set actor_user_id = null where action = 'test.actor_lifecycle'$statement$),
  'service callers cannot directly anonymize an audit actor'
);

reset role;
delete from auth.users where id = '40000000-0000-4000-8000-000000000001';
select is(
  (select count(*)::integer from public.audit_events where action = 'test.actor_lifecycle'),
  1,
  'auth-user deletion preserves audit history'
);
select is(
  (select count(*)::integer from public.audit_events where action = 'test.actor_lifecycle' and actor_user_id is null),
  1,
  'the FK action anonymizes only the deleted audit actor reference'
);

select * from finish();
rollback;
