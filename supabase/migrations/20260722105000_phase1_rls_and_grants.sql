-- Hanaply Phase 1: least-privilege grants and RLS for account and authentication data.

revoke all on table public.user_legal_acceptances from public, anon, authenticated;
revoke all on table public.user_notification_preferences from public, anon, authenticated;
revoke all on table public.authentication_events from public, anon, authenticated;
revoke all on table public.account_status_history from public, anon, authenticated;
revoke all on table public.account_suspensions from public, anon, authenticated;
revoke all on table public.email_delivery_events from public, anon, authenticated;

revoke update on table public.profiles from authenticated;
grant update (
  first_name,
  last_name,
  display_name,
  locale,
  timezone,
  country_code
) on table public.profiles to authenticated;

grant select on table public.user_legal_acceptances to authenticated;
grant select on table public.user_notification_preferences to authenticated;
grant select (id, event_type, outcome, request_id, occurred_at)
  on table public.authentication_events to authenticated;

grant all privileges on table public.user_legal_acceptances to service_role;
grant all privileges on table public.user_notification_preferences to service_role;
grant all privileges on table public.authentication_events to service_role;
grant all privileges on table public.account_status_history to service_role;
grant all privileges on table public.account_suspensions to service_role;
grant all privileges on table public.email_delivery_events to service_role;
grant all privileges on table app_private.auth_rate_limits to service_role;

create policy user_legal_acceptances_select_own
on public.user_legal_acceptances
for select
to authenticated
using (user_id = (select auth.uid()));

create policy user_notification_preferences_select_own_active
on public.user_notification_preferences
for select
to authenticated
using (
  user_id = (select auth.uid())
  and (select app_private.is_account_active())
);

create policy authentication_events_select_own
on public.authentication_events
for select
to authenticated
using (user_id = (select auth.uid()));

grant execute on function public.consume_auth_rate_limit(text, text) to anon, authenticated;
grant execute on function public.reconcile_my_profile() to authenticated;
grant execute on function public.record_my_auth_event(text, uuid) to authenticated;
grant execute on function public.update_my_notification_preferences(boolean, boolean, uuid)
  to authenticated;
grant execute on function public.list_my_sessions() to authenticated;

grant execute on function public.admin_user_directory(uuid, text, text, public.account_status, timestamptz, timestamptz, integer, integer)
  to service_role;
grant execute on function public.admin_user_detail(uuid, uuid) to service_role;
grant execute on function public.admin_overview(uuid) to service_role;
grant execute on function public.admin_audit_event_directory(uuid, uuid, text, text, uuid, uuid, timestamptz, timestamptz, integer, integer)
  to service_role;
grant execute on function public.admin_set_account_status(uuid, uuid, public.account_status, text, uuid)
  to service_role;
grant execute on function public.admin_revoke_user_sessions(uuid, uuid, text, uuid)
  to service_role;
grant execute on function public.is_auth_session_active(uuid, uuid) to service_role;

create or replace function public.get_my_admin_access()
returns table (roles text[], permissions text[])
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(array_agg(distinct role.code order by role.code), '{}'::text[]) as roles,
    coalesce(
      array_agg(distinct role_permission.permission_code order by role_permission.permission_code)
        filter (where role_permission.permission_code is not null),
      '{}'::text[]
    ) as permissions
  from public.admin_memberships membership
  join public.profiles profile on profile.id = membership.user_id
  join public.admin_role_assignments assignment
    on assignment.admin_user_id = membership.user_id
  join public.admin_roles role on role.id = assignment.role_id
  left join public.admin_role_permissions role_permission
    on role_permission.role_id = role.id
  where membership.user_id = auth.uid()
    and membership.status = 'active'::public.admin_membership_status
    and profile.account_status = 'active'::public.account_status
  having count(distinct role.id) > 0;
$$;

revoke all on function public.get_my_admin_access() from public, anon;
grant execute on function public.get_my_admin_access() to authenticated;

comment on policy authentication_events_select_own on public.authentication_events is
  'A user may read only allowlisted columns from their own safe authentication history.';
comment on table public.account_suspensions is
  'Service-only operational reasons. End users never receive internal suspension notes.';
