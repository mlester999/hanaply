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

select plan(8);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous
)
values
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'owner-one@hanaply.test', crypt('Phase0Password1', gen_salt('bf')), now(), '{}', '{}', now(), now(), false, false),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'owner-two@hanaply.test', crypt('Phase0Password2', gen_salt('bf')), now(), '{}', '{}', now(), now(), false, false);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"20000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select ok(
  pg_temp.operation_fails($statement$select public.bootstrap_first_super_admin('20000000-0000-0000-0000-000000000001', 'ASSIGN_FIRST_SUPER_ADMIN')$statement$),
  'authenticated callers cannot execute bootstrap'
);

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is(
  public.bootstrap_first_super_admin(
    '20000000-0000-0000-0000-000000000001',
    'ASSIGN_FIRST_SUPER_ADMIN'
  ),
  true,
  'confirmed service bootstrap creates the first Super Admin'
);
select is(
  (select count(*)::integer from public.admin_memberships where user_id = '20000000-0000-0000-0000-000000000001' and status = 'active'),
  1,
  'bootstrap creates an active membership'
);
select is(
  (select count(*)::integer
   from public.admin_role_assignments assignment
   join public.admin_roles role on role.id = assignment.role_id
   where assignment.admin_user_id = '20000000-0000-0000-0000-000000000001'
     and role.code = 'super_admin'),
  1,
  'bootstrap assigns the expanded Super Admin role'
);
select is(
  (select count(*)::integer from public.audit_events where action = 'admin.bootstrap_super_admin' and target_id = '20000000-0000-0000-0000-000000000001'),
  1,
  'bootstrap appends its audit event'
);
select is(
  public.bootstrap_first_super_admin(
    '20000000-0000-0000-0000-000000000001',
    'ASSIGN_FIRST_SUPER_ADMIN'
  ),
  false,
  'same-user retry is idempotent'
);
select is(
  (select count(*)::integer from public.audit_events where action = 'admin.bootstrap_super_admin'),
  1,
  'idempotent retry does not duplicate audit history'
);
select ok(
  pg_temp.operation_fails($statement$select public.bootstrap_first_super_admin('20000000-0000-0000-0000-000000000002', 'WRONG')$statement$),
  'wrong confirmation is rejected'
);

select * from finish();
rollback;
