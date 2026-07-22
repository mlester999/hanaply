-- Hanaply Phase 0: least-privilege grants and row-level security policies.

revoke all on all tables in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;
revoke all on schema app_private from public, anon, authenticated;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema app_private to service_role;

grant select on table public.plans to anon, authenticated;
grant select on table public.entitlement_definitions to anon, authenticated;
grant select on table public.plan_entitlements to anon, authenticated;

grant select on table public.profiles to authenticated;
grant update (display_name, locale, timezone, country_code)
  on table public.profiles to authenticated;

grant select (
  id,
  user_id,
  plan_id,
  status,
  starts_at,
  ends_at,
  source,
  created_at,
  updated_at
) on table public.subscriptions to authenticated;

grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;

create policy profiles_select_own
on public.profiles
for select
to authenticated
using (id = (select auth.uid()));

create policy profiles_update_own_active
on public.profiles
for update
to authenticated
using (
  id = (select auth.uid())
  and (select app_private.is_account_active())
)
with check (
  id = (select auth.uid())
  and (select app_private.is_account_active())
);

create policy active_plans_are_public
on public.plans
for select
to anon, authenticated
using (active);

create policy entitlement_definitions_are_public
on public.entitlement_definitions
for select
to anon, authenticated
using (true);

create policy active_plan_entitlements_are_public
on public.plan_entitlements
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.plans
    where plans.id = plan_entitlements.plan_id
      and plans.active
  )
);

create policy subscriptions_select_own_active_account
on public.subscriptions
for select
to authenticated
using (
  user_id = (select auth.uid())
  and (select app_private.is_account_active())
);

alter default privileges in schema public
  revoke all on tables from public, anon, authenticated;
alter default privileges in schema public
  revoke all on sequences from public, anon, authenticated;
alter default privileges in schema public
  revoke execute on functions from public, anon, authenticated;

comment on policy profiles_update_own_active on public.profiles is
  'Column grants prevent account-status or onboarding-status escalation; RLS rejects suspended accounts.';
comment on policy subscriptions_select_own_active_account on public.subscriptions is
  'Users receive only allowlisted subscription columns and never activation metadata.';
