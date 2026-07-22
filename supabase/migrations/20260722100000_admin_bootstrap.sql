-- Hanaply Phase 0: atomic, service-only bootstrap for the first Super Admin.

create or replace function public.bootstrap_first_super_admin(
  target_user_id uuid,
  confirmation text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  super_admin_role_id uuid;
  existing_super_admin_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role is required' using errcode = '42501';
  end if;
  if confirmation <> 'ASSIGN_FIRST_SUPER_ADMIN' then
    raise exception 'bootstrap confirmation is invalid' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('hanaply.bootstrap_first_super_admin')::bigint
  );

  if not exists (select 1 from auth.users where id = target_user_id) then
    raise exception 'target auth user does not exist' using errcode = '23503';
  end if;

  select id into super_admin_role_id
  from public.admin_roles
  where code = 'super_admin';
  if super_admin_role_id is null then
    raise exception 'Super Admin role is not cataloged' using errcode = '55000';
  end if;

  select assignment.admin_user_id into existing_super_admin_id
  from public.admin_role_assignments assignment
  where assignment.role_id = super_admin_role_id
  order by assignment.created_at
  limit 1;

  if existing_super_admin_id is not null then
    if existing_super_admin_id = target_user_id
      and exists (
        select 1
        from public.admin_memberships membership
        where membership.user_id = target_user_id
          and membership.status = 'active'::public.admin_membership_status
      ) then
      return false;
    end if;
    raise exception 'a Super Admin has already been bootstrapped' using errcode = '23505';
  end if;

  insert into public.admin_memberships (user_id, status, created_by)
  values (target_user_id, 'active', target_user_id)
  on conflict (user_id) do update set
    status = 'active'::public.admin_membership_status,
    updated_at = now();

  insert into public.admin_role_assignments (admin_user_id, role_id, assigned_by)
  values (target_user_id, super_admin_role_id, target_user_id)
  on conflict (admin_user_id, role_id) do nothing;

  insert into public.audit_events (
    actor_user_id,
    actor_type,
    action,
    target_type,
    target_id,
    after_state,
    metadata
  )
  values (
    target_user_id,
    'admin',
    'admin.bootstrap_super_admin',
    'admin_membership',
    target_user_id,
    pg_catalog.jsonb_build_object('membershipStatus', 'active', 'role', 'super_admin'),
    pg_catalog.jsonb_build_object('source', 'owner_confirmed_bootstrap')
  );

  return true;
end;
$$;

revoke all on function public.bootstrap_first_super_admin(uuid, text) from public, anon, authenticated;
grant execute on function public.bootstrap_first_super_admin(uuid, text) to service_role;

comment on function public.bootstrap_first_super_admin(uuid, text) is
  'Atomically assigns the first Super Admin and appends an audit event. Service-role and explicit confirmation required.';
