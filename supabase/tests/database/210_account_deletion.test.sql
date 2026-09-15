begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

create or replace function pg_temp.operation_fails(statement text)
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

-- Deleting an account has to remove everything that belongs to it. The career
-- tables cascade from `auth.users`, and every child delete fires an AFTER DELETE
-- trigger that refreshed the profile's cached completeness percentage by reading
-- the profile row — which the cascade had already removed. The read raised
-- `P0002: career profile does not exist`, and the account deletion failed with
-- it, so no account owning career records could be removed at all.
--
-- These assertions delete a real account through the same statement the auth
-- service issues, and check that the records went with it. The first assertion
-- exists so the guard cannot be mistaken for "completeness no longer refreshes":
-- the normal path must still recompute the cached percentage.
select plan(8);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    'c0000000-0000-4000-8000-00000000000a',
    'authenticated', 'authenticated', 'deletion-a@hanaply.test',
    crypt('DeletionA1', gen_salt('bf')), now(), '{}',
    '{"display_name":"Deletion A"}', now(), now(), false, false
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'c0000000-0000-4000-8000-00000000000b',
    'authenticated', 'authenticated', 'deletion-b@hanaply.test',
    crypt('DeletionB1', gen_salt('bf')), now(), '{}',
    '{"display_name":"Deletion B"}', now(), now(), false, false
  );

insert into public.subscriptions (user_id, plan_id, status, starts_at, ends_at, source)
select seed.user_id, plans.id, 'active', now() - interval '1 day', now() + interval '30 days',
       'admin_grant'
from (
  values ('c0000000-0000-4000-8000-00000000000a'::uuid)
) as seed (user_id)
join public.plans on plans.code = 'plus_monthly';

create temporary table deletion_ids (key text primary key, value uuid not null);
grant all on table deletion_ids to service_role;

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into deletion_ids (key, value)
select 'profile-a', public.create_career_profile(
  'c0000000-0000-4000-8000-00000000000a',
  '{
    "name":"Primary search",
    "headline":"Workflow automation specialist",
    "currentRoleTitle":"Automation Specialist",
    "careerLevel":"mid",
    "yearsExperience":3.5,
    "targetRoleTitles":["Workflow Automation Engineer"],
    "preferredEmploymentTypes":["full_time"],
    "preferredWorkArrangement":"remote",
    "salaryMinMinor":8000000,
    "salaryPeriod":"monthly"
  }'::jsonb,
  gen_random_uuid()
);

select public.upsert_career_record(
  'c0000000-0000-4000-8000-00000000000a',
  (select value from deletion_ids where key = 'profile-a'),
  'skill', null, '{"name":"n8n","skillKind":"tool","isPrimary":true}'::jsonb, gen_random_uuid()
);
select public.upsert_career_record(
  'c0000000-0000-4000-8000-00000000000a',
  (select value from deletion_ids where key = 'profile-a'),
  'skill', null, '{"name":"TypeScript","skillKind":"technology"}'::jsonb, gen_random_uuid()
);
select public.upsert_career_record(
  'c0000000-0000-4000-8000-00000000000a',
  (select value from deletion_ids where key = 'profile-a'),
  'employment', null,
  '{
    "companyName":"Northstar Systems",
    "roleTitle":"Automation Specialist",
    "startDate":"2023-02-01",
    "isCurrent":true,
    "skills":["n8n"]
  }'::jsonb,
  gen_random_uuid()
);
select public.record_career_facts(
  'c0000000-0000-4000-8000-00000000000a',
  (select value from deletion_ids where key = 'profile-a'),
  '[
    {"statement":"Rebuilt onboarding automation for a 40-person team.","category":"achievement"},
    {"statement":"Cut manual handoffs between billing and support by half.","category":"achievement"}
  ]'::jsonb,
  'user_entered',
  null,
  gen_random_uuid()
);

select ok(
  (select profile.completeness_percent from public.career_profiles as profile
   where profile.id = (select value from deletion_ids where key = 'profile-a')) > 0,
  'adding career records still refreshes the cached profile completeness'
);

-- ---------------------------------------------------------------------------
-- Deleting the account
-- ---------------------------------------------------------------------------

-- The auth service deletes the account row itself, as the owner of the auth
-- schema, so the delete is issued as the session role rather than as
-- service_role.
reset role;

select ok(
  not pg_temp.operation_fails(pg_catalog.format(
    'delete from auth.users where id = %L::uuid',
    'c0000000-0000-4000-8000-00000000000a'
  )),
  'deleting an account that owns skills, employment, and confirmed facts succeeds'
);
select is(
  (select pg_catalog.count(*)::integer from public.career_profiles
   where user_id = 'c0000000-0000-4000-8000-00000000000a'),
  0,
  'the career profile goes with the account'
);
select is(
  (select pg_catalog.count(*)::integer from public.career_skills
   where career_profile_id = (select value from deletion_ids where key = 'profile-a')),
  0,
  'its skills go with it'
);
select is(
  (select pg_catalog.count(*)::integer from public.career_facts
   where career_profile_id = (select value from deletion_ids where key = 'profile-a')),
  0,
  'its confirmed facts go with it'
);
select is(
  (select pg_catalog.count(*)::integer from public.career_employment_history
   where career_profile_id = (select value from deletion_ids where key = 'profile-a')),
  0,
  'its employment history goes with it'
);
select is(
  (select pg_catalog.count(*)::integer from public.profiles
   where id = 'c0000000-0000-4000-8000-00000000000a'),
  0,
  'the account row goes with it'
);
select ok(
  not pg_temp.operation_fails(pg_catalog.format(
    'delete from auth.users where id = %L::uuid',
    'c0000000-0000-4000-8000-00000000000b'
  )),
  'deleting an account with no career records still succeeds'
);

select * from finish();
rollback;
