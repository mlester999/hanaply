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

select plan(31);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '50000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'ana@hanaply.test',
    crypt('CareerReady7', gen_salt('bf')), now(), '{}',
    '{"first_name":"Ana","last_name":"Reyes","terms_accepted":true,"terms_version":"draft-2026-07-22","privacy_accepted":true,"privacy_version":"draft-2026-07-22","marketing_consent":true}',
    now(), now(), false, false
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '50000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'ben@hanaply.test',
    crypt('CareerReady8', gen_salt('bf')), null, '{}',
    '{"first_name":"Ben","last_name":"Santos"}',
    now(), now(), false, false
  );

select is(
  (select first_name from public.profiles where id = '50000000-0000-4000-8000-000000000001'),
  'Ana',
  'signup provisioning stores a bounded first name'
);
select is(
  (select last_name from public.profiles where id = '50000000-0000-4000-8000-000000000001'),
  'Reyes',
  'signup provisioning stores a bounded last name'
);
select is(
  (select display_name from public.profiles where id = '50000000-0000-4000-8000-000000000001'),
  'Ana Reyes',
  'signup provisioning derives a safe display name'
);
select ok(
  (select email_verified_at is not null from public.profiles where id = '50000000-0000-4000-8000-000000000001'),
  'verified auth state is synchronized to the profile'
);
select is(
  (select count(*)::integer from public.user_legal_acceptances where user_id = '50000000-0000-4000-8000-000000000001'),
  2,
  'registration records versioned Terms and Privacy acceptance'
);
select is(
  (select marketing_emails from public.user_notification_preferences where user_id = '50000000-0000-4000-8000-000000000001'),
  true,
  'optional marketing consent is stored explicitly'
);
select is(
  (select count(*)::integer from public.user_legal_acceptances where user_id = '50000000-0000-4000-8000-000000000002'),
  0,
  'missing legal assertions never create acceptance records'
);
select is(
  (select count(*)::integer from public.authentication_events where event_type = 'user.registered'),
  2,
  'registration is recorded for each provisioned auth identity'
);

update auth.users set email_confirmed_at = now() where id = '50000000-0000-4000-8000-000000000002';
select ok(
  (select email_verified_at is not null from public.profiles where id = '50000000-0000-4000-8000-000000000002'),
  'verification updates the protected profile timestamp'
);
select is(
  (select count(*)::integer from public.authentication_events where user_id = '50000000-0000-4000-8000-000000000002' and event_type = 'user.email_verified'),
  1,
  'verification appends one authentication event'
);

update auth.users
set encrypted_password = crypt('ChangedPassword9', gen_salt('bf'))
where id = '50000000-0000-4000-8000-000000000001';
select ok(
  (select last_password_changed_at is not null from public.profiles where id = '50000000-0000-4000-8000-000000000001'),
  'password changes synchronize a protected timestamp'
);
select is(
  (select count(*)::integer from public.authentication_events where user_id = '50000000-0000-4000-8000-000000000001' and event_type = 'user.password_changed'),
  1,
  'password changes append safe authentication history'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"50000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '50000000-0000-4000-8000-000000000001', true);

select is((select count(*)::integer from public.user_legal_acceptances), 2, 'user reads only their legal records');
select is((select count(*)::integer from public.user_notification_preferences), 1, 'user reads only their preference row');
select is(
  (select count(event_type)::integer from public.authentication_events),
  2,
  'user sees only their own authentication history through RLS'
);
select ok(
  pg_temp.operation_fails($statement$select ip_address from public.authentication_events$statement$),
  'user cannot select authentication-event network metadata'
);

update public.profiles
set first_name = 'Ana Maria', last_name = 'Reyes Cruz', display_name = 'Ana R.',
    country_code = 'PH', locale = 'en-PH', timezone = 'Asia/Manila'
where id = auth.uid();
select is((select first_name from public.profiles), 'Ana Maria', 'user can update an allowlisted name field');
select ok(
  pg_temp.operation_fails($statement$update public.profiles set email_verified_at = null where id = auth.uid()$statement$),
  'user cannot alter email verification state'
);
select ok(
  pg_temp.operation_fails($statement$update public.profiles set last_password_changed_at = null where id = auth.uid()$statement$),
  'user cannot alter password security timestamps'
);
select ok(
  pg_temp.operation_fails($statement$update public.profiles set account_status = 'suspended' where id = auth.uid()$statement$),
  'user cannot suspend themselves'
);
select ok(
  pg_temp.operation_fails($statement$insert into public.user_legal_acceptances (user_id, policy_type, policy_version, accepted_at, source) values (auth.uid(), 'terms', 'fake-version', now(), 'policy_update')$statement$),
  'user cannot forge legal acceptance rows directly'
);
select ok(
  pg_temp.operation_fails($statement$insert into public.authentication_events (user_id, event_type, outcome) values (auth.uid(), 'fake.event', 'succeeded')$statement$),
  'user cannot insert arbitrary authentication history'
);
select ok(
  pg_temp.operation_fails($statement$update public.user_notification_preferences set marketing_emails = false where user_id = auth.uid()$statement$),
  'preference writes must use the validated function'
);
select is(
  (select marketing_emails from public.update_my_notification_preferences(false, false, null)),
  false,
  'validated preference function updates the caller row'
);
select ok(
  pg_temp.operation_fails($statement$select * from public.audit_events$statement$),
  'direct audit table access remains hidden'
);
select is(
  (select allowed from public.consume_auth_rate_limit('login', repeat('a', 64))),
  true,
  'database-backed authentication throttle accepts an initial attempt'
);
select ok(
  pg_temp.operation_fails($statement$select * from public.consume_auth_rate_limit('unknown', repeat('a', 64))$statement$),
  'unknown rate-limit buckets fail closed'
);
select ok(
  pg_temp.operation_fails($statement$select * from public.admin_user_directory(auth.uid())$statement$),
  'normal users cannot call service-only administrator directories'
);

reset role;
update public.profiles set account_status = 'suspended' where id = '50000000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"50000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '50000000-0000-4000-8000-000000000002', true);
select is((select count(*)::integer from public.user_notification_preferences), 0, 'suspended users cannot read account preferences');
select is(
  pg_temp.affected_rows($statement$update public.profiles set first_name = 'Blocked' where id = auth.uid()$statement$),
  0,
  'suspended users cannot update profile fields'
);
select ok(
  pg_temp.operation_fails($statement$select * from public.list_my_sessions()$statement$),
  'suspended users cannot inspect product session data'
);

select * from finish();
rollback;
