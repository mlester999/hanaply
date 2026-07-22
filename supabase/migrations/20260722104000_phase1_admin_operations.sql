-- Hanaply Phase 1: permission-gated operational administration and safe session metadata.

create or replace function app_private.admin_has_permission(
  actor_user_id uuid,
  required_permission text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.admin_memberships membership
    join public.profiles profile on profile.id = membership.user_id
    join public.admin_role_assignments assignment
      on assignment.admin_user_id = membership.user_id
    join public.admin_role_permissions role_permission
      on role_permission.role_id = assignment.role_id
    where membership.user_id = actor_user_id
      and membership.status = 'active'::public.admin_membership_status
      and profile.account_status = 'active'::public.account_status
      and role_permission.permission_code = required_permission
  );
$$;

revoke all on function app_private.admin_has_permission(uuid, text)
  from public, anon, authenticated;

create or replace function public.admin_user_directory(
  actor_user_id uuid,
  search_query text default null,
  verification_filter text default 'all',
  status_filter public.account_status default null,
  created_from timestamptz default null,
  created_to timestamptz default null,
  page_size integer default 25,
  page_offset integer default 0
)
returns table (
  user_id uuid,
  email text,
  email_verified boolean,
  email_verified_at timestamptz,
  first_name text,
  last_name text,
  display_name text,
  account_status public.account_status,
  subscription_plan_code text,
  subscription_status text,
  admin_roles text[],
  created_at timestamptz,
  updated_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role is required' using errcode = '42501';
  end if;
  if not app_private.admin_has_permission(actor_user_id, 'users.read') then
    raise exception 'users.read permission is required' using errcode = '42501';
  end if;
  if verification_filter not in ('all', 'verified', 'unverified') then
    raise exception 'invalid verification filter' using errcode = '22023';
  end if;
  if page_size < 1 or page_size > 100 or page_offset < 0 then
    raise exception 'invalid pagination' using errcode = '22023';
  end if;

  return query
  with filtered as (
    select
      auth_user.id as user_id,
      auth_user.email::text as email,
      auth_user.email_confirmed_at is not null as email_verified,
      auth_user.email_confirmed_at as email_verified_at,
      profile.first_name,
      profile.last_name,
      profile.display_name,
      profile.account_status,
      plan.code as subscription_plan_code,
      subscription.status::text as subscription_status,
      coalesce(admin_access.roles, '{}'::text[]) as admin_roles,
      profile.created_at,
      profile.updated_at
    from auth.users auth_user
    join public.profiles profile on profile.id = auth_user.id
    left join lateral (
      select current_subscription.plan_id, current_subscription.status
      from public.subscriptions current_subscription
      where current_subscription.user_id = auth_user.id
      order by current_subscription.created_at desc
      limit 1
    ) subscription on true
    left join public.plans plan on plan.id = subscription.plan_id
    left join lateral (
      select array_agg(distinct role.code order by role.code) as roles
      from public.admin_memberships membership
      join public.admin_role_assignments assignment
        on assignment.admin_user_id = membership.user_id
      join public.admin_roles role on role.id = assignment.role_id
      where membership.user_id = auth_user.id
        and membership.status = 'active'::public.admin_membership_status
    ) admin_access on true
    where (
      search_query is null
      or search_query = ''
      or position(
        pg_catalog.lower(search_query)
        in pg_catalog.lower(
          coalesce(auth_user.email, '') || ' ' ||
          coalesce(profile.first_name, '') || ' ' ||
          coalesce(profile.last_name, '') || ' ' ||
          coalesce(profile.display_name, '')
        )
      ) > 0
    )
      and (
        verification_filter = 'all'
        or (verification_filter = 'verified' and auth_user.email_confirmed_at is not null)
        or (verification_filter = 'unverified' and auth_user.email_confirmed_at is null)
      )
      and (status_filter is null or profile.account_status = status_filter)
      and (created_from is null or profile.created_at >= created_from)
      and (created_to is null or profile.created_at <= created_to)
  )
  select filtered.*, count(*) over () as total_count
  from filtered
  order by filtered.created_at desc, filtered.user_id
  limit page_size offset page_offset;
end;
$$;

create or replace function public.admin_user_detail(
  actor_user_id uuid,
  target_user_id uuid
)
returns table (
  user_id uuid,
  email text,
  email_verified boolean,
  email_verified_at timestamptz,
  first_name text,
  last_name text,
  display_name text,
  locale text,
  timezone text,
  country_code text,
  onboarding_status public.onboarding_status,
  account_status public.account_status,
  subscription_plan_code text,
  subscription_status text,
  subscription_starts_at timestamptz,
  subscription_ends_at timestamptz,
  admin_membership_status text,
  admin_roles text[],
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role is required' using errcode = '42501';
  end if;
  if not app_private.admin_has_permission(actor_user_id, 'users.read') then
    raise exception 'users.read permission is required' using errcode = '42501';
  end if;

  return query
  select
    auth_user.id,
    auth_user.email::text,
    auth_user.email_confirmed_at is not null,
    auth_user.email_confirmed_at,
    profile.first_name,
    profile.last_name,
    profile.display_name,
    profile.locale,
    profile.timezone,
    profile.country_code,
    profile.onboarding_status,
    profile.account_status,
    plan.code,
    subscription.status::text,
    subscription.starts_at,
    subscription.ends_at,
    membership.status::text,
    coalesce(admin_access.roles, '{}'::text[]),
    profile.created_at,
    profile.updated_at
  from auth.users auth_user
  join public.profiles profile on profile.id = auth_user.id
  left join lateral (
    select current_subscription.*
    from public.subscriptions current_subscription
    where current_subscription.user_id = auth_user.id
    order by current_subscription.created_at desc
    limit 1
  ) subscription on true
  left join public.plans plan on plan.id = subscription.plan_id
  left join public.admin_memberships membership on membership.user_id = auth_user.id
  left join lateral (
    select array_agg(distinct role.code order by role.code) as roles
    from public.admin_role_assignments assignment
    join public.admin_roles role on role.id = assignment.role_id
    where assignment.admin_user_id = auth_user.id
  ) admin_access on true
  where auth_user.id = target_user_id;
end;
$$;

create or replace function public.admin_overview(actor_user_id uuid)
returns table (
  registered_users bigint,
  verified_users bigint,
  suspended_users bigint,
  active_administrators bigint,
  auth_events_last_24_hours bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role is required' using errcode = '42501';
  end if;
  if not app_private.admin_has_permission(actor_user_id, 'users.read') then
    raise exception 'users.read permission is required' using errcode = '42501';
  end if;

  return query select
    (select count(*) from auth.users),
    (select count(*) from auth.users where email_confirmed_at is not null),
    (select count(*) from public.profiles where account_status = 'suspended'::public.account_status),
    (
      select count(*)
      from public.admin_memberships membership
      join public.profiles profile on profile.id = membership.user_id
      where membership.status = 'active'::public.admin_membership_status
        and profile.account_status = 'active'::public.account_status
    ),
    (
      select count(*)
      from public.authentication_events
      where occurred_at >= now() - interval '24 hours'
    );
end;
$$;

create or replace function public.admin_audit_event_directory(
  actor_user_id uuid,
  filter_actor_user_id uuid default null,
  filter_action text default null,
  filter_target_type text default null,
  filter_target_id uuid default null,
  filter_request_id uuid default null,
  occurred_from timestamptz default null,
  occurred_to timestamptz default null,
  page_size integer default 25,
  page_offset integer default 0
)
returns table (
  event_id uuid,
  event_actor_user_id uuid,
  event_actor_type public.audit_actor_type,
  action text,
  target_type text,
  target_id uuid,
  request_id uuid,
  before_state jsonb,
  after_state jsonb,
  metadata jsonb,
  created_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role is required' using errcode = '42501';
  end if;
  if not app_private.admin_has_permission(actor_user_id, 'audit.read') then
    raise exception 'audit.read permission is required' using errcode = '42501';
  end if;
  if page_size < 1 or page_size > 100 or page_offset < 0 then
    raise exception 'invalid pagination' using errcode = '22023';
  end if;

  return query
  with filtered as (
    select audit_event.*
    from public.audit_events audit_event
    where (filter_actor_user_id is null or audit_event.actor_user_id = filter_actor_user_id)
      and (filter_action is null or audit_event.action = filter_action)
      and (filter_target_type is null or audit_event.target_type = filter_target_type)
      and (filter_target_id is null or audit_event.target_id = filter_target_id)
      and (filter_request_id is null or audit_event.request_id = filter_request_id)
      and (occurred_from is null or audit_event.created_at >= occurred_from)
      and (occurred_to is null or audit_event.created_at <= occurred_to)
  )
  select
    filtered.id,
    filtered.actor_user_id,
    filtered.actor_type,
    filtered.action,
    filtered.target_type,
    filtered.target_id,
    filtered.request_id,
    filtered.before_state,
    filtered.after_state,
    filtered.metadata,
    filtered.created_at,
    count(*) over ()
  from filtered
  order by filtered.created_at desc, filtered.id
  limit page_size offset page_offset;
end;
$$;

create or replace function public.admin_set_account_status(
  actor_user_id uuid,
  target_user_id uuid,
  requested_status public.account_status,
  action_reason text,
  action_request_id uuid default null
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  previous_status public.account_status;
  active_super_admin_count integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role is required' using errcode = '42501';
  end if;
  if not app_private.admin_has_permission(actor_user_id, 'users.manage') then
    raise exception 'users.manage permission is required' using errcode = '42501';
  end if;
  if actor_user_id = target_user_id then
    raise exception 'administrators cannot change their own account status' using errcode = '42501';
  end if;
  if requested_status not in ('active'::public.account_status, 'suspended'::public.account_status) then
    raise exception 'Phase 1 admin actions support only suspend and restore' using errcode = '22023';
  end if;
  if action_reason is null or char_length(pg_catalog.btrim(action_reason)) < 10
    or char_length(action_reason) > 500 then
    raise exception 'a reason between 10 and 500 characters is required' using errcode = '22023';
  end if;

  select profile.account_status into previous_status
  from public.profiles profile
  where profile.id = target_user_id
  for update;
  if not found then
    raise exception 'target user does not exist' using errcode = 'P0002';
  end if;
  if previous_status = requested_status then
    return false;
  end if;
  if requested_status = 'active'::public.account_status
    and previous_status <> 'suspended'::public.account_status then
    raise exception 'only suspended accounts can be restored in Phase 1' using errcode = '22023';
  end if;

  if requested_status = 'suspended'::public.account_status and exists (
    select 1
    from public.admin_role_assignments assignment
    join public.admin_roles role on role.id = assignment.role_id
    where assignment.admin_user_id = target_user_id
      and role.code = 'super_admin'
  ) then
    select count(*) into active_super_admin_count
    from public.admin_role_assignments assignment
    join public.admin_roles role on role.id = assignment.role_id
    join public.admin_memberships membership on membership.user_id = assignment.admin_user_id
    join public.profiles profile on profile.id = assignment.admin_user_id
    where role.code = 'super_admin'
      and membership.status = 'active'::public.admin_membership_status
      and profile.account_status = 'active'::public.account_status;
    if active_super_admin_count <= 1 then
      raise exception 'the last active Super Admin cannot be suspended' using errcode = '42501';
    end if;
  end if;

  update public.profiles
  set account_status = requested_status
  where id = target_user_id;

  if requested_status = 'suspended'::public.account_status then
    insert into public.account_suspensions (user_id, reason, suspended_by)
    values (target_user_id, pg_catalog.btrim(action_reason), actor_user_id);
  else
    update public.account_suspensions
    set status = 'resolved',
        resolved_by = actor_user_id,
        resolved_at = now(),
        resolution_note = pg_catalog.btrim(action_reason)
    where user_id = target_user_id and status = 'active';
  end if;

  insert into public.account_status_history (
    user_id, previous_status, new_status, changed_by, reason, request_id
  ) values (
    target_user_id, previous_status, requested_status, actor_user_id,
    pg_catalog.btrim(action_reason), action_request_id
  );

  insert into public.audit_events (
    actor_user_id, actor_type, action, target_type, target_id, request_id,
    before_state, after_state, metadata
  ) values (
    actor_user_id,
    'admin',
    case
      when requested_status = 'suspended'::public.account_status then 'user.account_suspended'
      else 'user.account_restored'
    end,
    'profile',
    target_user_id,
    action_request_id,
    pg_catalog.jsonb_build_object('accountStatus', previous_status),
    pg_catalog.jsonb_build_object('accountStatus', requested_status),
    pg_catalog.jsonb_build_object('reason', pg_catalog.btrim(action_reason))
  );

  return true;
end;
$$;

create or replace function public.admin_revoke_user_sessions(
  actor_user_id uuid,
  target_user_id uuid,
  action_reason text,
  action_request_id uuid default null
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  revoked_count integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role is required' using errcode = '42501';
  end if;
  if not (
    app_private.admin_has_permission(actor_user_id, 'security.manage')
    or app_private.admin_has_permission(actor_user_id, 'users.manage')
  ) then
    raise exception 'security.manage or users.manage permission is required' using errcode = '42501';
  end if;
  if action_reason is null or char_length(pg_catalog.btrim(action_reason)) < 10
    or char_length(action_reason) > 500 then
    raise exception 'a reason between 10 and 500 characters is required' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users where id = target_user_id) then
    raise exception 'target user does not exist' using errcode = 'P0002';
  end if;

  delete from auth.sessions where user_id = target_user_id;
  get diagnostics revoked_count = row_count;

  insert into public.authentication_events (
    user_id, event_type, outcome, request_id, metadata
  ) values (
    target_user_id,
    'user.sessions_revoked',
    'succeeded',
    action_request_id,
    pg_catalog.jsonb_build_object('revokedSessionCount', revoked_count)
  );

  insert into public.audit_events (
    actor_user_id, actor_type, action, target_type, target_id, request_id, metadata
  ) values (
    actor_user_id,
    'admin',
    'user.sessions_revoked',
    'auth_user',
    target_user_id,
    action_request_id,
    pg_catalog.jsonb_build_object(
      'reason', pg_catalog.btrim(action_reason),
      'revokedSessionCount', revoked_count
    )
  );

  return revoked_count;
end;
$$;

create or replace function public.list_my_sessions()
returns table (
  session_id uuid,
  created_at timestamptz,
  last_seen_at timestamptz,
  user_agent text,
  current_session boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not app_private.is_account_active() then
    raise exception 'an active account is required' using errcode = '42501';
  end if;

  return query
  select
    session.id,
    session.created_at,
    coalesce(session.updated_at, session.created_at),
    nullif(pg_catalog.left(coalesce(session.user_agent, ''), 200), ''),
    session.id = nullif(auth.jwt() ->> 'session_id', '')::uuid
  from auth.sessions session
  where session.user_id = auth.uid()
  order by coalesce(session.updated_at, session.created_at) desc;
end;
$$;

create or replace function public.is_auth_session_active(
  target_user_id uuid,
  target_session_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role is required' using errcode = '42501';
  end if;
  return exists (
    select 1 from auth.sessions
    where id = target_session_id and user_id = target_user_id
  );
end;
$$;

revoke all on function public.admin_user_directory(uuid, text, text, public.account_status, timestamptz, timestamptz, integer, integer)
  from public, anon, authenticated;
revoke all on function public.admin_user_detail(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.admin_overview(uuid)
  from public, anon, authenticated;
revoke all on function public.admin_audit_event_directory(uuid, uuid, text, text, uuid, uuid, timestamptz, timestamptz, integer, integer)
  from public, anon, authenticated;
revoke all on function public.admin_set_account_status(uuid, uuid, public.account_status, text, uuid)
  from public, anon, authenticated;
revoke all on function public.admin_revoke_user_sessions(uuid, uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function public.list_my_sessions() from public, anon;
revoke all on function public.is_auth_session_active(uuid, uuid)
  from public, anon, authenticated;

comment on function public.admin_set_account_status(uuid, uuid, public.account_status, text, uuid) is
  'Service-only, permission-checked suspend/restore with reason, history, audit, and last-Super-Admin protection.';
comment on function public.list_my_sessions() is
  'Returns only safe session timestamps and a truncated user agent for the current active account.';
