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

select plan(24);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous
)
values
  ('00000000-0000-0000-0000-000000000000', '60000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'operator@hanaply.test', crypt('CareerReady1', gen_salt('bf')), now(), '{}', '{"first_name":"Opal","last_name":"Reyes"}', now(), now(), false, false),
  ('00000000-0000-0000-0000-000000000000', '60000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'member@hanaply.test', crypt('CareerReady2', gen_salt('bf')), now(), '{}', '{"first_name":"Mika","last_name":"Santos"}', now(), now(), false, false),
  ('00000000-0000-0000-0000-000000000000', '60000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'normal@hanaply.test', crypt('CareerReady3', gen_salt('bf')), now(), '{}', '{"first_name":"Noel","last_name":"Cruz"}', now(), now(), false, false),
  ('00000000-0000-0000-0000-000000000000', '60000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'last-super@hanaply.test', crypt('CareerReady4', gen_salt('bf')), now(), '{}', '{"first_name":"Super","last_name":"Owner"}', now(), now(), false, false);

insert into public.admin_memberships (user_id, status)
values
  ('60000000-0000-4000-8000-000000000001', 'active'),
  ('60000000-0000-4000-8000-000000000004', 'active');
insert into public.admin_role_assignments (admin_user_id, role_id)
select '60000000-0000-4000-8000-000000000001', id
from public.admin_roles where code = 'operations_administrator';
insert into public.admin_role_assignments (admin_user_id, role_id)
select '60000000-0000-4000-8000-000000000004', id
from public.admin_roles where code = 'super_admin';

insert into auth.sessions (id, user_id, created_at, updated_at, aal, user_agent)
values
  ('61000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000002', now(), now(), 'aal1', 'Hanaply Test Browser'),
  ('61000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000002', now(), now(), 'aal1', 'Hanaply Test Mobile');

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select is(
  (select count(*)::integer from public.admin_user_directory('60000000-0000-4000-8000-000000000001')),
  4,
  'authorized administrator lists real users'
);
select is(
  (select count(*)::integer from public.admin_user_directory('60000000-0000-4000-8000-000000000001', 'mika')),
  1,
  'user directory searches safe identity fields'
);
select is(
  (select email from public.admin_user_directory('60000000-0000-4000-8000-000000000001', null, 'verified', null, null, null, 1, 0)),
  'operator@hanaply.test',
  'directory pagination is deterministic'
);
select is(
  (select total_count::integer from public.admin_user_directory('60000000-0000-4000-8000-000000000001', null, 'verified', null, null, null, 1, 0)),
  4,
  'directory reports the filtered total independently from page size'
);
select ok(
  pg_temp.operation_fails($statement$select * from public.admin_user_directory('60000000-0000-4000-8000-000000000003')$statement$),
  'a normal user ID cannot authorize a service directory call'
);
select is(
  (select email from public.admin_user_detail('60000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000002')),
  'member@hanaply.test',
  'authorized user detail returns the selected real identity'
);
select is(
  (select registered_users::integer from public.admin_overview('60000000-0000-4000-8000-000000000001')),
  4,
  'admin overview reports a real registered-user count'
);
select is(
  (select active_administrators::integer from public.admin_overview('60000000-0000-4000-8000-000000000001')),
  2,
  'admin overview reports active database memberships'
);

select is(
  public.admin_set_account_status(
    '60000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000002',
    'suspended',
    'Confirmed security review reason.',
    '62000000-0000-4000-8000-000000000001'
  ),
  true,
  'users.manage administrator can suspend another account'
);
select is(
  (select account_status::text from public.profiles where id = '60000000-0000-4000-8000-000000000002'),
  'suspended',
  'suspension changes authoritative profile state'
);
select is(
  (select count(*)::integer from public.account_suspensions where user_id = '60000000-0000-4000-8000-000000000002' and status = 'active'),
  1,
  'suspension creates one active reason record'
);
select is(
  (select count(*)::integer from public.account_status_history where user_id = '60000000-0000-4000-8000-000000000002'),
  1,
  'suspension appends account-status history'
);
select is(
  (select count(*)::integer from public.audit_events where action = 'user.account_suspended' and target_id = '60000000-0000-4000-8000-000000000002'),
  1,
  'suspension appends an administrator audit event'
);
select is(
  public.admin_set_account_status(
    '60000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000002',
    'suspended',
    'Repeated security review reason.',
    null
  ),
  false,
  'repeated suspension is idempotent'
);
select is(
  public.admin_set_account_status(
    '60000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000002',
    'active',
    'Security review completed safely.',
    '62000000-0000-4000-8000-000000000002'
  ),
  true,
  'users.manage administrator can restore a suspended account'
);
select is(
  (select status from public.account_suspensions where user_id = '60000000-0000-4000-8000-000000000002'),
  'resolved',
  'restore resolves the active suspension record'
);
select is(
  (select count(*)::integer from public.audit_events where action = 'user.account_restored' and target_id = '60000000-0000-4000-8000-000000000002'),
  1,
  'restore appends an administrator audit event'
);
select ok(
  pg_temp.operation_fails($statement$select public.admin_set_account_status('60000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000004', 'suspended', 'Attempt to remove final owner.', null)$statement$),
  'the last active Super Admin cannot be suspended'
);
select ok(
  pg_temp.operation_fails($statement$select public.admin_set_account_status('60000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', 'suspended', 'Attempted self suspension reason.', null)$statement$),
  'administrators cannot suspend themselves'
);

select is(
  public.admin_revoke_user_sessions(
    '60000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000002',
    'User requested a security reset.',
    '62000000-0000-4000-8000-000000000003'
  ),
  2,
  'authorized administrator revokes every target refresh session'
);
select is(
  public.is_auth_session_active(
    '60000000-0000-4000-8000-000000000002',
    '61000000-0000-4000-8000-000000000001'
  ),
  false,
  'revoked target sessions are removed from Supabase Auth'
);
select is(
  (select count(*)::integer from public.authentication_events where user_id = '60000000-0000-4000-8000-000000000002' and event_type = 'user.sessions_revoked'),
  1,
  'session revocation appends safe authentication history'
);
select ok(
  (select count(*) > 0 from public.admin_audit_event_directory('60000000-0000-4000-8000-000000000001', null, 'user.account_suspended')),
  'audit.read administrator can filter safe audit history'
);
select ok(
  pg_temp.operation_fails($statement$select * from public.admin_audit_event_directory('60000000-0000-4000-8000-000000000003')$statement$),
  'normal user ID cannot authorize audit inspection'
);

select * from finish();
rollback;
