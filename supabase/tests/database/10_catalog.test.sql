begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(22);

select is((select count(*)::integer from public.plans), 4, 'exactly four plans are cataloged');
select is((select price_minor from public.plans where code = 'plus_monthly'), 49900, 'Plus monthly price is PHP 499');
select is((select price_minor from public.plans where code = 'plus_annual'), 479900, 'Plus annual price is PHP 4,799');
select is((select price_minor from public.plans where code = 'pro_monthly'), 99900, 'Pro monthly price is PHP 999');
select is((select price_minor from public.plans where code = 'pro_annual'), 959900, 'Pro annual price is PHP 9,599');
select is((select count(*)::integer from public.plans where currency = 'PHP' and active), 4, 'all plans are active PHP plans');

select is((select count(*)::integer from public.entitlement_definitions), 24, 'entitlement allowlist has 24 definitions');
select is((select count(*)::integer from public.plan_entitlements), 96, 'every plan has 24 entitlement values');
select is(
  (select count(*)::integer from (
    select plan_id from public.plan_entitlements group by plan_id having count(*) <> 24
  ) malformed),
  0,
  'no plan is missing an entitlement value'
);
select is(
  (select count(*)::integer from (
    (select entitlement_key, value from public.plan_entitlements pe join public.plans p on p.id = pe.plan_id where p.code = 'plus_monthly'
     except
     select entitlement_key, value from public.plan_entitlements pe join public.plans p on p.id = pe.plan_id where p.code = 'plus_annual')
    union all
    (select entitlement_key, value from public.plan_entitlements pe join public.plans p on p.id = pe.plan_id where p.code = 'plus_annual'
     except
     select entitlement_key, value from public.plan_entitlements pe join public.plans p on p.id = pe.plan_id where p.code = 'plus_monthly')
  ) differences),
  0,
  'Plus monthly and annual entitlements match'
);
select is(
  (select count(*)::integer from (
    (select entitlement_key, value from public.plan_entitlements pe join public.plans p on p.id = pe.plan_id where p.code = 'pro_monthly'
     except
     select entitlement_key, value from public.plan_entitlements pe join public.plans p on p.id = pe.plan_id where p.code = 'pro_annual')
    union all
    (select entitlement_key, value from public.plan_entitlements pe join public.plans p on p.id = pe.plan_id where p.code = 'pro_annual'
     except
     select entitlement_key, value from public.plan_entitlements pe join public.plans p on p.id = pe.plan_id where p.code = 'pro_monthly')
  ) differences),
  0,
  'Pro monthly and annual entitlements match'
);
select is(
  (select (value #>> '{}')::integer from public.plan_entitlements pe join public.plans p on p.id = pe.plan_id where p.code = 'plus_monthly' and entitlement_key = 'careerProfileLimit'),
  1,
  'Plus allows one career profile'
);
select is(
  (select (value #>> '{}')::integer from public.plan_entitlements pe join public.plans p on p.id = pe.plan_id where p.code = 'pro_monthly' and entitlement_key = 'careerProfileLimit'),
  3,
  'Pro allows three career profiles'
);
select is(
  (select (value #>> '{}')::integer from public.plan_entitlements pe join public.plans p on p.id = pe.plan_id where p.code = 'pro_monthly' and entitlement_key = 'subCareerLimitPerProfile'),
  5,
  'Pro allows five sub-careers per profile'
);
select is(
  (select count(*)::integer from public.feature_flags where not default_enabled),
  7,
  'all future feature flags start disabled'
);
select is((select count(*)::integer from public.feature_flags where client_exposed), 5, 'only five flags are client exposed');
select is((select count(*)::integer from public.platform_settings), 12, 'all environments have web, iOS, and Android settings');
select is((select count(*)::integer from public.platform_settings where platform = 'web' and status = 'active'), 4, 'web is active in each environment');
select is((select count(*)::integer from public.platform_settings where platform in ('ios', 'android') and status = 'planned'), 8, 'mobile platforms are planned');
select is((select count(*)::integer from public.admin_roles), 8, 'eight administrator roles are cataloged');
select is((select count(*)::integer from public.admin_permissions), 28, 'expanded permission catalog has 28 permissions');
select is(
  (select count(*)::integer from public.admin_role_permissions rp join public.admin_roles r on r.id = rp.role_id where r.code = 'super_admin'),
  28,
  'Super Admin receives every expanded permission'
);

select * from finish();
rollback;
