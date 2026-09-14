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

create or replace function pg_temp.operation_succeeds(statement text)
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

select plan(83);

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
    '90000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'career-plus-a@hanaply.test',
    crypt('CareerPlusA1', gen_salt('bf')), now(), '{}',
    '{"display_name":"Career Plus A"}', now(), now(), false, false
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '90000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'career-plus-b@hanaply.test',
    crypt('CareerPlusB1', gen_salt('bf')), now(), '{}',
    '{"display_name":"Career Plus B"}', now(), now(), false, false
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '90000000-0000-4000-8000-000000000003',
    'authenticated', 'authenticated', 'career-pro@hanaply.test',
    crypt('CareerPro1', gen_salt('bf')), now(), '{}',
    '{"display_name":"Career Pro"}', now(), now(), false, false
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '90000000-0000-4000-8000-000000000004',
    'authenticated', 'authenticated', 'career-free@hanaply.test',
    crypt('CareerFree1', gen_salt('bf')), now(), '{}',
    '{"display_name":"Career Free"}', now(), now(), false, false
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '90000000-0000-4000-8000-000000000005',
    'authenticated', 'authenticated', 'career-suspended@hanaply.test',
    crypt('CareerSusp1', gen_salt('bf')), now(), '{}',
    '{"display_name":"Career Suspended"}', now(), now(), false, false
  );

insert into public.subscriptions (user_id, plan_id, status, starts_at, ends_at, source)
select subscription_seed.user_id, plans.id, 'active', now() - interval '1 day',
       now() + interval '30 days', 'admin_grant'
from (
  values
    ('90000000-0000-4000-8000-000000000001'::uuid, 'plus_monthly'::text),
    ('90000000-0000-4000-8000-000000000002'::uuid, 'plus_monthly'::text),
    ('90000000-0000-4000-8000-000000000003'::uuid, 'pro_monthly'::text)
) as subscription_seed (user_id, plan_code)
join public.plans on plans.code = subscription_seed.plan_code;

update public.profiles
set account_status = 'suspended'
where id = '90000000-0000-4000-8000-000000000005';

create temporary table career_ids (key text primary key, value uuid not null);
grant all on table career_ids to service_role;

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------

select has_table('public', 'career_profiles', 'career profiles table exists');
select has_table('public', 'career_sub_careers', 'career sub-careers table exists');
select has_table('public', 'career_employment_history', 'employment history table exists');
select has_table('public', 'career_projects', 'projects table exists');
select has_table('public', 'career_education', 'education table exists');
select has_table('public', 'career_certifications', 'certifications table exists');
select has_table('public', 'career_profile_links', 'profile links table exists');
select has_table('public', 'career_skills', 'career skills table exists');
select has_table('public', 'career_facts', 'career fact ledger exists');
select has_table('public', 'career_documents', 'career document metadata table exists');
select ok(
  (select bool_and(relrowsecurity and relforcerowsecurity)
   from pg_class
   where oid = any (array[
     'public.career_profiles'::regclass,
     'public.career_sub_careers'::regclass,
     'public.career_employment_history'::regclass,
     'public.career_projects'::regclass,
     'public.career_education'::regclass,
     'public.career_certifications'::regclass,
     'public.career_profile_links'::regclass,
     'public.career_skills'::regclass,
     'public.career_facts'::regclass,
     'public.career_documents'::regclass
   ])),
  'every career table has enabled and forced RLS'
);
select is(
  (select count(*)::integer
   from pg_policies
   where schemaname = 'public'
     and tablename like 'career%'
     and cmd <> 'SELECT'),
  0,
  'no career table exposes a write policy to clients'
);
select ok(
  not has_column_privilege('authenticated', 'public.career_facts', 'evidence', 'SELECT'),
  'extraction evidence pointers are not client-readable'
);
select ok(
  not has_column_privilege('authenticated', 'public.career_documents', 'object_path', 'SELECT'),
  'career document storage paths are not client-readable'
);
select ok(
  not has_table_privilege('authenticated', 'public.career_profiles', 'INSERT'),
  'authenticated clients cannot insert career profiles directly'
);
select ok(
  (select bool_and(array_to_string(p.proconfig, ',') like '%search_path=%')
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'app_private')
     and p.proname in (
       'career_text',
       'career_text_array',
       'career_profile_completeness_value',
       'create_career_profile',
       'upsert_career_record',
       'record_career_facts',
       'decide_career_fact',
       'confirmed_career_evidence'
     )),
  'career functions pin an empty search path'
);

-- ---------------------------------------------------------------------------
-- Entitlement limits
-- ---------------------------------------------------------------------------

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select is(
  (public.career_profile_directory('90000000-0000-4000-8000-000000000001') -> 'items'),
  '[]'::jsonb,
  'a new account starts with no career profiles'
);
select is(
  (public.career_profile_directory('90000000-0000-4000-8000-000000000001') -> 'limits' -> 'careerProfileLimit'),
  '1'::jsonb,
  'the Plus plan allows one career profile'
);
select is(
  (public.career_profile_directory('90000000-0000-4000-8000-000000000003') -> 'limits' -> 'careerProfileLimit'),
  '3'::jsonb,
  'the Pro plan allows three career profiles'
);
select is(
  (public.career_profile_directory('90000000-0000-4000-8000-000000000004') -> 'limits' -> 'careerProfileLimit'),
  '0'::jsonb,
  'an account without an active subscription is denied by default'
);

select ok(
  pg_temp.operation_fails(
    $statement$select public.create_career_profile(
      '90000000-0000-4000-8000-000000000004',
      '{"name":"Denied"}'::jsonb,
      gen_random_uuid()
    )$statement$
  ),
  'an unsubscribed account cannot create a career profile'
);
select ok(
  pg_temp.operation_fails(
    $statement$select public.create_career_profile(
      '90000000-0000-4000-8000-000000000005',
      '{"name":"Suspended"}'::jsonb,
      gen_random_uuid()
    )$statement$
  ),
  'a suspended account cannot create a career profile'
);

insert into career_ids (key, value)
select 'profile-a', public.create_career_profile(
  '90000000-0000-4000-8000-000000000001',
  '{
    "name":"Primary search",
    "headline":"Workflow automation specialist",
    "summary":"I build reliable automation between business systems, with a focus on small teams that need dependable operations without hiring a platform team.",
    "currentRoleTitle":"Automation Specialist",
    "careerLevel":"mid",
    "yearsExperience":3.5,
    "industries":["SaaS","Professional services"],
    "targetRoleTitles":["Workflow Automation Engineer","Solutions Engineer"],
    "excludedRoleTitles":["Unpaid internship"],
    "preferredEmploymentTypes":["full_time","contract"],
    "preferredWorkArrangement":"remote",
    "preferredLocations":["Metro Manila","Remote"],
    "openToInternational":true,
    "openToRelocation":false,
    "workAuthorizations":["Philippines"],
    "availability":"two_weeks",
    "salaryMinMinor":8000000,
    "salaryMaxMinor":11000000,
    "salaryCurrency":"php",
    "salaryPeriod":"monthly",
    "careerGoals":"Move into a senior automation role with regional scope."
  }'::jsonb,
  gen_random_uuid()
);

select ok((select value is not null from career_ids where key = 'profile-a'), 'a Plus subscriber creates a career profile');
select is(
  (select count(*)::integer from public.career_profiles where user_id = '90000000-0000-4000-8000-000000000001'),
  1,
  'the career profile is persisted'
);
select is(
  (select is_primary from public.career_profiles where id = (select value from career_ids where key = 'profile-a')),
  true,
  'the first career profile becomes primary automatically'
);
select is(
  (select salary_currency from public.career_profiles where id = (select value from career_ids where key = 'profile-a')),
  'PHP',
  'salary currency is normalised to upper case'
);
select is(
  (select count(*)::integer from public.audit_events where action = 'career_profile.created'),
  1,
  'career profile creation is audited'
);
select ok(
  pg_temp.operation_fails(
    $statement$select public.create_career_profile(
      '90000000-0000-4000-8000-000000000001',
      '{"name":"Second profile"}'::jsonb,
      gen_random_uuid()
    )$statement$
  ),
  'the Plus plan limit blocks a second career profile'
);
select ok(
  pg_temp.operation_fails(
    $statement$select public.create_career_profile(
      '90000000-0000-4000-8000-000000000001',
      '{"name":"Bad level","careerLevel":"wizard"}'::jsonb,
      gen_random_uuid()
    )$statement$
  ),
  'an unknown career level is rejected'
);
select ok(
  pg_temp.operation_fails(
    $statement$select public.create_career_profile(
      '90000000-0000-4000-8000-000000000003',
      '{"name":"Bad salary","salaryMinMinor":9000000,"salaryMaxMinor":1000000}'::jsonb,
      gen_random_uuid()
    )$statement$
  ),
  'an inverted salary range is rejected'
);

-- ---------------------------------------------------------------------------
-- Child records
-- ---------------------------------------------------------------------------

insert into career_ids (key, value)
select 'sub-a', public.upsert_career_record(
  '90000000-0000-4000-8000-000000000001',
  (select value from career_ids where key = 'profile-a'),
  'sub_career', null,
  '{"name":"Revenue operations","focus":"Automation for go-to-market teams","keywords":["hubspot","reporting"],"priority":10}'::jsonb,
  gen_random_uuid()
);
insert into career_ids (key, value)
select 'sub-b', public.upsert_career_record(
  '90000000-0000-4000-8000-000000000001',
  (select value from career_ids where key = 'profile-a'),
  'sub_career', null,
  '{"name":"Support operations","focus":"Ticketing and knowledge workflows","priority":5}'::jsonb,
  gen_random_uuid()
);
select is(
  (select count(*)::integer from public.career_sub_careers),
  2,
  'the Plus plan allows two sub-careers'
);
select ok(
  pg_temp.operation_fails(
    $statement$select public.upsert_career_record(
      '90000000-0000-4000-8000-000000000001',
      (select value from career_ids where key = 'profile-a'),
      'sub_career', null,
      '{"name":"Third sub-career"}'::jsonb,
      gen_random_uuid()
    )$statement$
  ),
  'the sub-career limit is enforced server-side'
);

insert into career_ids (key, value)
select 'employment-a', public.upsert_career_record(
  '90000000-0000-4000-8000-000000000001',
  (select value from career_ids where key = 'profile-a'),
  'employment', null,
  '{
    "companyName":"Northstar Systems",
    "roleTitle":"Automation Specialist",
    "employmentType":"full_time",
    "workArrangement":"remote",
    "location":"Manila",
    "countryCode":"PH",
    "industry":"SaaS",
    "startDate":"2023-02-01",
    "isCurrent":true,
    "summary":"Own internal automation for a distributed services team.",
    "highlights":["Rebuilt onboarding automation for 40 staff","Cut manual reporting to one weekly review"],
    "skills":["n8n","Supabase","TypeScript"]
  }'::jsonb,
  gen_random_uuid()
);
select ok((select value is not null from career_ids where key = 'employment-a'), 'employment history is stored as a structured record');
select ok(
  pg_temp.operation_fails(
    $statement$select public.upsert_career_record(
      '90000000-0000-4000-8000-000000000001',
      (select value from career_ids where key = 'profile-a'),
      'employment', null,
      '{"companyName":"Broken","roleTitle":"Analyst","startDate":"2024-05-01","endDate":"2024-01-01"}'::jsonb,
      gen_random_uuid()
    )$statement$
  ),
  'employment end dates cannot precede start dates'
);
select ok(
  pg_temp.operation_fails(
    $statement$select public.upsert_career_record(
      '90000000-0000-4000-8000-000000000001',
      (select value from career_ids where key = 'profile-a'),
      'employment', null,
      '{"companyName":"Future Corp","roleTitle":"Analyst","startDate":"2099-01-01"}'::jsonb,
      gen_random_uuid()
    )$statement$
  ),
  'future-dated employment is rejected'
);
select ok(
  pg_temp.operation_fails(
    $statement$select public.upsert_career_record(
      '90000000-0000-4000-8000-000000000002',
      (select value from career_ids where key = 'profile-a'),
      'employment', null,
      '{"companyName":"Intruder","roleTitle":"Analyst","startDate":"2024-01-01"}'::jsonb,
      gen_random_uuid()
    )$statement$
  ),
  'another account cannot write to a career profile it does not own'
);
select ok(
  pg_temp.operation_fails(
    $statement$select public.upsert_career_record(
      '90000000-0000-4000-8000-000000000001',
      (select value from career_ids where key = 'profile-a'),
      'unknown_kind', null, '{}'::jsonb, gen_random_uuid()
    )$statement$
  ),
  'an unsupported record kind is rejected'
);

select public.upsert_career_record(
  '90000000-0000-4000-8000-000000000001',
  (select value from career_ids where key = 'profile-a'),
  'skill', null,
  '{"name":"n8n","skillKind":"tool","proficiency":"advanced","isPrimary":true}'::jsonb,
  gen_random_uuid()
);
select public.upsert_career_record(
  '90000000-0000-4000-8000-000000000001',
  (select value from career_ids where key = 'profile-a'),
  'skill', null,
  '{"name":"TypeScript","skillKind":"technology","proficiency":"advanced"}'::jsonb,
  gen_random_uuid()
);
select public.upsert_career_record(
  '90000000-0000-4000-8000-000000000001',
  (select value from career_ids where key = 'profile-a'),
  'skill', null,
  '{"name":"Supabase","skillKind":"technology","proficiency":"intermediate"}'::jsonb,
  gen_random_uuid()
);
select public.upsert_career_record(
  '90000000-0000-4000-8000-000000000001',
  (select value from career_ids where key = 'profile-a'),
  'skill', null,
  '{"name":"Process design","skillKind":"skill","proficiency":"advanced"}'::jsonb,
  gen_random_uuid()
);
select public.upsert_career_record(
  '90000000-0000-4000-8000-000000000001',
  (select value from career_ids where key = 'profile-a'),
  'skill', null,
  '{"name":"Stakeholder communication","skillKind":"soft_skill","proficiency":"advanced"}'::jsonb,
  gen_random_uuid()
);
select is(
  (select count(*)::integer from public.career_skills),
  5,
  'five structured skills are stored'
);
select ok(
  pg_temp.operation_fails(
    $statement$select public.upsert_career_record(
      '90000000-0000-4000-8000-000000000001',
      (select value from career_ids where key = 'profile-a'),
      'skill', null,
      '{"name":"n8n","skillKind":"tool"}'::jsonb,
      gen_random_uuid()
    )$statement$
  ),
  'duplicate skills on the same profile are rejected'
);

select public.upsert_career_record(
  '90000000-0000-4000-8000-000000000001',
  (select value from career_ids where key = 'profile-a'),
  'education', null,
  '{"institution":"University of the Philippines","degree":"BS Computer Science","startYear":2014,"endYear":2018}'::jsonb,
  gen_random_uuid()
);
select public.upsert_career_record(
  '90000000-0000-4000-8000-000000000001',
  (select value from career_ids where key = 'profile-a'),
  'certification', null,
  '{"name":"n8n Advanced","issuer":"n8n","issuedOn":"2024-06-01"}'::jsonb,
  gen_random_uuid()
);
select public.upsert_career_record(
  '90000000-0000-4000-8000-000000000001',
  (select value from career_ids where key = 'profile-a'),
  'link', null,
  '{"linkKind":"github","label":"GitHub","url":"https://github.com/example"}'::jsonb,
  gen_random_uuid()
);
select public.upsert_career_record(
  '90000000-0000-4000-8000-000000000001',
  (select value from career_ids where key = 'profile-a'),
  'project', null,
  '{"name":"Ops dashboard","roleTitle":"Builder","description":"Internal operations dashboard.","isFeatured":true,"skills":["TypeScript"]}'::jsonb,
  gen_random_uuid()
);
select is(
  (public.career_profile_detail(
    '90000000-0000-4000-8000-000000000001',
    (select value from career_ids where key = 'profile-a')
  ) -> 'completeness' -> 'percent'),
  '100'::jsonb,
  'a fully populated profile reports full completeness'
);
select is(
  (public.career_profile_detail(
    '90000000-0000-4000-8000-000000000001',
    (select value from career_ids where key = 'profile-a')
  ) -> 'employment' -> 0 -> 'companyName'),
  '"Northstar Systems"'::jsonb,
  'the detail read model returns structured employment'
);
select is(
  (public.career_profile_detail(
    '90000000-0000-4000-8000-000000000001',
    (select value from career_ids where key = 'profile-a')
  ) -> 'subCareers' -> 0 -> 'name'),
  '"Revenue operations"'::jsonb,
  'sub-careers are ordered by priority'
);

-- ---------------------------------------------------------------------------
-- Truth ledger
-- ---------------------------------------------------------------------------

insert into career_ids (key, value)
select 'document-a', gen_random_uuid();
insert into public.career_documents (
  id, user_id, career_profile_id, document_kind, status, original_filename, mime_type,
  size_bytes, checksum_sha256, object_path, parsed_at
) values (
  (select value from career_ids where key = 'document-a'),
  '90000000-0000-4000-8000-000000000001',
  (select value from career_ids where key = 'profile-a'),
  'resume', 'needs_review', 'resume.pdf', 'application/pdf', 24576,
  repeat('a', 64),
  '90000000-0000-4000-8000-000000000001/11111111-1111-4111-8111-111111111111.pdf',
  now()
);

select public.record_career_facts(
  '90000000-0000-4000-8000-000000000001',
  (select value from career_ids where key = 'profile-a'),
  '[
    {"statement":"Reduced manual reporting effort for a 40-person team","category":"achievement","evidence":{"kind":"employment","id":"2f6a6a5e-0000-4000-8000-000000000001"}},
    {"statement":"Owns internal automation for a distributed services team","category":"responsibility"}
  ]'::jsonb,
  'resume_extraction',
  (select value from career_ids where key = 'document-a'),
  gen_random_uuid()
);
select is(
  (select count(*)::integer from public.career_facts where status = 'candidate'),
  2,
  'resume extraction records candidate facts'
);
select is(
  (select count(*)::integer from public.career_facts where status = 'confirmed'),
  0,
  'extraction never confirms a fact on the user''s behalf'
);
select is(
  (public.confirmed_career_evidence(
    '90000000-0000-4000-8000-000000000001',
    (select value from career_ids where key = 'profile-a')
  ) -> 'facts'),
  '[]'::jsonb,
  'the truth gate exposes no unconfirmed evidence'
);

select ok(
  pg_temp.operation_fails(
    $statement$select public.record_career_facts(
      '90000000-0000-4000-8000-000000000001',
      (select value from career_ids where key = 'profile-a'),
      '[{"statement":"No source document"}]'::jsonb,
      'resume_extraction',
      null,
      gen_random_uuid()
    )$statement$
  ),
  'an extracted fact must reference its source document'
);
select ok(
  pg_temp.operation_fails(
    $statement$select public.record_career_facts(
      '90000000-0000-4000-8000-000000000002',
      (select value from career_ids where key = 'profile-a'),
      '[{"statement":"Cross account injection"}]'::jsonb,
      'user_entered',
      null,
      gen_random_uuid()
    )$statement$
  ),
  'another account cannot write facts onto a career profile it does not own'
);

insert into career_ids (key, value)
select 'fact-metric', (public.record_career_facts(
  '90000000-0000-4000-8000-000000000001',
  (select value from career_ids where key = 'profile-a'),
  '[{"statement":"Cut weekly reporting preparation from four hours to twenty minutes","category":"metric","metricValue":4,"metricUnit":"hours saved per week"}]'::jsonb,
  'user_entered',
  null,
  gen_random_uuid()
) -> 'createdIds' ->> 0)::uuid;


select is(
  (select status::text from public.career_facts where id = (select value from career_ids where key = 'fact-metric')),
  'confirmed',
  'a user-entered fact is confirmed immediately'
);
select is(
  (select metric_value from public.career_facts where id = (select value from career_ids where key = 'fact-metric')),
  4::numeric,
  'metric evidence is stored as a number, not free text'
);
select ok(
  pg_temp.operation_fails(
    $statement$select public.record_career_facts(
      '90000000-0000-4000-8000-000000000001',
      (select value from career_ids where key = 'profile-a'),
      '[{"statement":"Metric without unit","metricValue":12}]'::jsonb,
      'user_entered',
      null,
      gen_random_uuid()
    )$statement$
  ),
  'a structured metric requires a unit'
);
select is(
  (public.confirmed_career_evidence(
    '90000000-0000-4000-8000-000000000001',
    (select value from career_ids where key = 'profile-a')
  ) -> 'facts' -> 0 -> 'metricValue'),
  '4'::jsonb,
  'confirmed numeric evidence reaches the truth gate'
);

select public.decide_career_fact(
  '90000000-0000-4000-8000-000000000001',
  (select id from public.career_facts
   where career_profile_id = (select value from career_ids where key = 'profile-a')
     and statement = 'Owns internal automation for a distributed services team'),
  'confirm',
  null, null, null,
  gen_random_uuid()
);
select is(
  (select count(*)::integer from public.career_facts where status = 'confirmed'),
  2,
  'confirming a candidate fact adds it to the evidence set'
);
select public.decide_career_fact(
  '90000000-0000-4000-8000-000000000001',
  (select id from public.career_facts
   where career_profile_id = (select value from career_ids where key = 'profile-a')
     and statement = 'Reduced manual reporting effort for a 40-person team'),
  'reject',
  null, null, null,
  gen_random_uuid()
);
select is(
  (select count(*)::integer from public.career_facts where status = 'rejected'),
  1,
  'rejecting a candidate fact removes it from review'
);
select is(
  (select count(*)::integer
   from pg_catalog.jsonb_array_elements(
     public.confirmed_career_evidence(
       '90000000-0000-4000-8000-000000000001',
       (select value from career_ids where key = 'profile-a')
     ) -> 'facts'
   ) as evidence
   where evidence ->> 'statement' = 'Reduced manual reporting effort for a 40-person team'),
  0,
  'a rejected claim never reaches the truth gate'
);
select public.decide_career_fact(
  '90000000-0000-4000-8000-000000000001',
  (select id from public.career_facts where id = (select value from career_ids where key = 'fact-metric')),
  'correct',
  'Cut weekly reporting preparation from about four hours to twenty minutes',
  'hours saved per week',
  3.6,
  gen_random_uuid()
);
select is(
  (select status::text from public.career_facts where id = (select value from career_ids where key = 'fact-metric')),
  'superseded',
  'correcting a fact supersedes the original claim'
);
select is(
  (select count(*)::integer
   from public.career_facts
   where career_profile_id = (select value from career_ids where key = 'profile-a')
     and status = 'confirmed'
     and statement like 'Cut weekly reporting preparation from about four hours%'),
  1,
  'the correction is recorded as a new confirmed fact'
);
select ok(
  pg_temp.operation_fails(
    $statement$select public.decide_career_fact(
      '90000000-0000-4000-8000-000000000002',
      (select id from public.career_facts where status = 'confirmed' limit 1),
      'confirm', null, null, null, gen_random_uuid()
    )$statement$
  ),
  'another account cannot confirm a fact on a profile it does not own'
);
select ok(
  pg_temp.operation_fails(
    $statement$select public.decide_career_fact(
      '90000000-0000-4000-8000-000000000001',
      (select id from public.career_facts where status = 'confirmed' limit 1),
      'maybe', null, null, null, gen_random_uuid()
    )$statement$
  ),
  'an unsupported fact decision is rejected'
);

-- ---------------------------------------------------------------------------
-- Optimistic concurrency and audit
-- ---------------------------------------------------------------------------

create temporary table career_numbers (key text primary key, value integer not null);
grant all on table career_numbers to service_role;

insert into career_numbers (key, value)
select 'version-before-update', version
from public.career_profiles where id = (select value from career_ids where key = 'profile-a');

select is(
  public.update_career_profile(
    '90000000-0000-4000-8000-000000000001',
    (select value from career_ids where key = 'profile-a'),
    (select value from career_numbers where key = 'version-before-update'),
    '{"headline":"Workflow and revenue automation specialist"}'::jsonb,
    gen_random_uuid()
  ),
  (select value + 1 from career_numbers where key = 'version-before-update'),
  'a permitted profile update returns the next version'
);
select ok(
  pg_temp.operation_fails(
    $statement$select public.update_career_profile(
      '90000000-0000-4000-8000-000000000001',
      (select value from career_ids where key = 'profile-a'),
      0,
      '{"headline":"Stale write"}'::jsonb,
      gen_random_uuid()
    )$statement$
  ),
  'a stale expected version is rejected'
);
select is(
  (select headline from public.career_profiles where id = (select value from career_ids where key = 'profile-a')),
  'Workflow and revenue automation specialist',
  'the permitted update is persisted'
);
select is(
  (select count(*)::integer
   from public.audit_events
   where action = 'career_record.created'
     and target_id = (select value from career_ids where key = 'profile-a')),
  12,
  'every structured career record write is audited'
);

-- ---------------------------------------------------------------------------
-- Pro plan and multi-profile behaviour
-- ---------------------------------------------------------------------------

insert into career_ids (key, value)
select 'profile-pro-1', public.create_career_profile(
  '90000000-0000-4000-8000-000000000003', '{"name":"Primary search"}'::jsonb, gen_random_uuid()
);
select public.create_career_profile(
  '90000000-0000-4000-8000-000000000003', '{"name":"Technical track"}'::jsonb, gen_random_uuid()
);
select public.create_career_profile(
  '90000000-0000-4000-8000-000000000003', '{"name":"Leadership track"}'::jsonb, gen_random_uuid()
);
select is(
  (select count(*)::integer from public.career_profiles where user_id = '90000000-0000-4000-8000-000000000003'),
  3,
  'the Pro plan allows three career profiles'
);
select ok(
  pg_temp.operation_fails(
    $statement$select public.create_career_profile(
      '90000000-0000-4000-8000-000000000003', '{"name":"Fourth profile"}'::jsonb, gen_random_uuid()
    )$statement$
  ),
  'the Pro plan limit blocks a fourth career profile'
);
select is(
  (select count(*)::integer from public.career_profiles where user_id = '90000000-0000-4000-8000-000000000003' and is_primary),
  1,
  'exactly one career profile is primary'
);
select is(
  public.set_primary_career_profile(
    '90000000-0000-4000-8000-000000000003',
    (select id from public.career_profiles
     where user_id = '90000000-0000-4000-8000-000000000003' and name = 'Technical track'),
    gen_random_uuid()
  ),
  true,
  'the primary career profile can be switched'
);
select is(
  (select name from public.career_profiles
   where user_id = '90000000-0000-4000-8000-000000000003' and is_primary),
  'Technical track',
  'the switched profile becomes the single primary profile'
);
select is(
  public.set_career_profile_status(
    '90000000-0000-4000-8000-000000000003',
    (select id from public.career_profiles
     where user_id = '90000000-0000-4000-8000-000000000003' and name = 'Technical track'),
    'archived',
    gen_random_uuid()
  ) > 0,
  true,
  'a career profile can be archived'
);
select is(
  (select count(*)::integer from public.career_profiles
   where user_id = '90000000-0000-4000-8000-000000000003' and is_primary),
  1,
  'archiving the primary profile promotes another profile'
);
select is(
  (public.career_profile_directory('90000000-0000-4000-8000-000000000003') -> 'items' -> 2),
  null,
  'archived profiles are hidden from the directory'
);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"90000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

select is(
  (select count(*)::integer from public.career_profiles),
  1,
  'a customer sees only their own career profile'
);
select is(
  (select count(*)::integer from public.career_employment_history),
  1,
  'a customer sees only their own employment history'
);
select is(
  (select count(*)::integer from public.career_facts),
  4,
  'a customer sees their own fact ledger'
);
select is(
  (select count(*)::integer from public.career_documents),
  1,
  'a customer sees only their own document metadata'
);
select is(
  (select count(*)::integer from public.career_profiles where user_id = '90000000-0000-4000-8000-000000000003'),
  0,
  'another customer''s career profiles are invisible'
);
select ok(
  pg_temp.operation_fails(
    $statement$insert into public.career_profiles (user_id, name) values (auth.uid(), 'Direct insert')$statement$
  ),
  'a customer cannot insert a career profile directly'
);
select ok(
  pg_temp.operation_fails(
    $statement$update public.career_profiles set headline = 'Escalated'$statement$
  ),
  'a customer cannot update a career profile directly'
);
select ok(
  pg_temp.operation_fails(
    $statement$insert into public.career_facts (career_profile_id, statement, source, status, confirmed_at) values ((select id from public.career_profiles limit 1), 'Forged claim', 'user_entered', 'confirmed', now())$statement$
  ),
  'a customer cannot forge a confirmed fact'
);
select ok(
  pg_temp.operation_fails(
    $statement$select evidence from public.career_facts$statement$
  ),
  'a customer cannot read evidence pointers'
);
select ok(
  pg_temp.operation_fails(
    $statement$select object_path from public.career_documents$statement$
  ),
  'a customer cannot read private storage paths'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"90000000-0000-4000-8000-000000000005","role":"authenticated"}',
  true
);
select is(
  (select count(*)::integer from public.career_profiles),
  0,
  'a suspended account reads no career data'
);

select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is(
  (select count(*)::integer from public.career_profiles),
  0,
  'anonymous callers read no career data'
);
select is(
  (select count(*)::integer from public.career_skills),
  0,
  'anonymous callers read no career skills'
);

select * from finish();
rollback;
