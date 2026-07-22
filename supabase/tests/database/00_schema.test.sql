begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(18);

select has_table('public', 'profiles', 'profiles table exists');
select has_table('public', 'admin_memberships', 'admin memberships table exists');
select has_table('public', 'plans', 'plans table exists');
select has_table('public', 'subscriptions', 'subscriptions table exists');
select has_table('public', 'feature_flags', 'feature flags table exists');
select has_table('public', 'platform_settings', 'platform settings table exists');
select has_table('public', 'audit_events', 'audit events table exists');

select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.profiles'::regclass),
  'profiles has enabled and forced RLS'
);
select ok(
  (select bool_and(relrowsecurity and relforcerowsecurity)
   from pg_class
   where oid = any (array[
     'public.admin_memberships'::regclass,
     'public.admin_roles'::regclass,
     'public.admin_permissions'::regclass,
     'public.admin_role_permissions'::regclass,
     'public.admin_role_assignments'::regclass,
     'public.audit_events'::regclass,
     'public.entitlement_definitions'::regclass,
     'public.plans'::regclass,
     'public.plan_entitlements'::regclass,
     'public.subscriptions'::regclass,
     'public.feature_flags'::regclass,
     'public.feature_flag_rules'::regclass,
     'public.platform_settings'::regclass,
     'public.branding_settings'::regclass
   ])),
  'every exposed table has enabled and forced RLS'
);

select col_type_is(
  'public',
  'subscriptions',
  'starts_at',
  'timestamp with time zone',
  'subscription timestamps use timestamptz'
);
select has_column(
  'public',
  'subscriptions',
  'activation_metadata',
  'service-only activation metadata exists'
);
select ok(
  not has_column_privilege('authenticated', 'public.subscriptions', 'activation_metadata', 'SELECT'),
  'authenticated clients cannot select activation metadata'
);
select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'account_status', 'UPDATE'),
  'authenticated clients cannot change account status'
);
select ok(
  not has_table_privilege('authenticated', 'public.admin_memberships', 'SELECT'),
  'authenticated clients have no direct administrator-table access'
);
select ok(
  not has_table_privilege('authenticated', 'public.audit_events', 'SELECT'),
  'authenticated clients have no direct audit access'
);
select is(
  (select count(*)::integer
   from pg_indexes
   where schemaname = 'public'
     and indexname = 'subscriptions_one_active_per_user_idx'
     and indexdef like '%WHERE (status = %active%'),
  1,
  'one-active-subscription partial unique index exists'
);
select is(
  (select count(*)::integer
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'get_my_admin_access'
     and p.prosecdef),
  1,
  'administrator self-inspection is security definer'
);
select is(
  (select count(*)::integer
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'app_private')
     and array_to_string(p.proconfig, ',') like '%search_path=%'),
  6,
  'security-sensitive foundation functions pin an empty search path'
);

select * from finish();
rollback;
