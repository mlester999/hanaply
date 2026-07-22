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

create function pg_temp.operation_succeeds(statement text)
returns boolean
language plpgsql
as $$
begin
  execute statement;
  return true;
exception when others then
  return false;
end;
$$;

create function pg_temp.affected_rows(statement text)
returns integer
language plpgsql
as $$
declare
  affected integer;
begin
  execute statement;
  get diagnostics affected = row_count;
  return affected;
end;
$$;

select plan(29);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous
)
values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'one@hanaply.test', crypt('Phase0Password1', gen_salt('bf')), now(), '{}', '{}', now(), now(), false, false),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'two@hanaply.test', crypt('Phase0Password2', gen_salt('bf')), now(), '{}', '{}', now(), now(), false, false),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'suspended@hanaply.test', crypt('Phase0Password3', gen_salt('bf')), now(), '{}', '{}', now(), now(), false, false),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'admin@hanaply.test', crypt('Phase0Password4', gen_salt('bf')), now(), '{}', '{}', now(), now(), false, false),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'service@hanaply.test', crypt('Phase0Password5', gen_salt('bf')), now(), '{}', '{}', now(), now(), false, false);

update public.profiles
set account_status = 'suspended'
where id = '10000000-0000-0000-0000-000000000003';

insert into public.subscriptions (user_id, plan_id, status, starts_at, ends_at, source)
select users.id, plans.id, 'active', now() - interval '1 day', now() + interval '30 days', 'admin_grant'
from (values
  ('10000000-0000-0000-0000-000000000001'::uuid),
  ('10000000-0000-0000-0000-000000000002'::uuid),
  ('10000000-0000-0000-0000-000000000003'::uuid),
  ('10000000-0000-0000-0000-000000000004'::uuid)
) users(id)
cross join (select id from public.plans where code = 'plus_monthly') plans;

insert into public.admin_memberships (user_id, status)
values ('10000000-0000-0000-0000-000000000004', 'active');
insert into public.admin_role_assignments (admin_user_id, role_id)
select '10000000-0000-0000-0000-000000000004', id
from public.admin_roles
where code = 'security_administrator';
insert into public.audit_events (actor_type, action, target_type, metadata)
values ('system', 'test.fixture_created', 'test_fixture', '{}');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);

select is((select count(*)::integer from public.profiles), 1, 'user sees only their profile');
select is((select count(*)::integer from public.profiles where id = '10000000-0000-0000-0000-000000000002'), 0, 'cross-user profile read is denied');
update public.profiles set display_name = 'Allowed Name' where id = '10000000-0000-0000-0000-000000000001';
select is((select display_name from public.profiles), 'Allowed Name', 'user can update an allowlisted profile column');
select is(
  pg_temp.affected_rows($statement$update public.profiles set display_name = 'Blocked' where id = '10000000-0000-0000-0000-000000000002'$statement$),
  0,
  'cross-user profile update changes no rows'
);
select ok(pg_temp.operation_fails($statement$update public.profiles set account_status = 'active' where id = '10000000-0000-0000-0000-000000000001'$statement$), 'account-status escalation is rejected');
select is((select count(*)::integer from public.subscriptions), 1, 'user sees only their subscription');
select ok(pg_temp.operation_fails($statement$select activation_metadata from public.subscriptions$statement$), 'activation metadata is not selectable');
select ok(pg_temp.operation_fails($statement$insert into public.subscriptions (user_id, plan_id, status, starts_at, source) select auth.uid(), id, 'active', now(), 'promotion' from public.plans limit 1$statement$), 'user cannot create a subscription');
select ok(pg_temp.operation_fails($statement$insert into public.admin_memberships (user_id) values (auth.uid())$statement$), 'user cannot self-promote');
select ok(pg_temp.operation_fails($statement$select * from public.admin_memberships$statement$), 'administrator tables are not directly readable');
select ok(pg_temp.operation_fails($statement$select * from public.audit_events$statement$), 'audit events are not directly readable');
select is((select count(*)::integer from public.get_my_admin_access()), 0, 'normal user receives no administrator access row');
select ok(pg_temp.operation_fails($statement$update public.plans set active = false$statement$), 'authenticated users cannot mutate plans');
select is((select count(*)::integer from public.plans), 4, 'authenticated user can read active plans');
select is((select count(*)::integer from public.plan_entitlements), 96, 'authenticated user can read active plan entitlements');

select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
select is((select count(*)::integer from public.profiles), 1, 'suspended user can read the profile status needed for safe routing');
select is((select count(*)::integer from public.subscriptions), 0, 'suspended user cannot read subscriptions');
select is(
  pg_temp.affected_rows($statement$update public.profiles set display_name = 'Blocked Suspended' where id = auth.uid()$statement$),
  0,
  'suspended user cannot update profile fields'
);

select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', true);
select is((select roles from public.get_my_admin_access()), array['security_administrator']::text[], 'active admin resolves database roles');
select ok((select 'admins.manage' = any(permissions) from public.get_my_admin_access()), 'active admin resolves database permissions');
select ok(pg_temp.operation_fails($statement$select * from public.admin_role_assignments$statement$), 'admin self-inspection does not grant direct table access');

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select set_config('request.jwt.claim.sub', '', true);
select is((select count(*)::integer from public.plans), 4, 'anonymous users can read active plans');
select is((select count(*)::integer from public.plan_entitlements), 96, 'anonymous users can read active plan entitlements');
select ok(pg_temp.operation_fails($statement$select * from public.profiles$statement$), 'anonymous users cannot read profiles');
select ok(pg_temp.operation_fails($statement$update public.plans set price_minor = 1$statement$), 'anonymous users cannot mutate plans');

set local role service_role;
select ok(
  pg_temp.operation_succeeds($statement$insert into public.subscriptions (user_id, plan_id, status, starts_at, source) select '10000000-0000-0000-0000-000000000005', id, 'pending_activation', now(), 'admin_grant' from public.plans where code = 'pro_monthly'$statement$),
  'service role can create a pending subscription'
);
select ok(
  pg_temp.operation_succeeds($statement$insert into public.audit_events (actor_type, action, target_type) values ('service', 'test.service_operation', 'test_fixture')$statement$),
  'service role can append an audit event'
);
select ok(pg_temp.operation_fails($statement$update public.audit_events set metadata = '{"tampered":true}'$statement$), 'audit updates are rejected even for service operations');
select ok(pg_temp.operation_fails($statement$delete from public.audit_events$statement$), 'audit deletes are rejected even for service operations');

select * from finish();
rollback;
