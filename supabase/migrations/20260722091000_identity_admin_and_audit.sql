-- Hanaply Phase 0: user profiles, explicit administrator authorization, and append-only audit events.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text null check (display_name is null or char_length(display_name) between 1 and 120),
  locale text not null default 'en-PH' check (char_length(locale) between 2 and 35),
  timezone text not null default 'Asia/Manila' check (char_length(timezone) between 1 and 80),
  country_code text not null default 'PH' check (country_code ~ '^[A-Z]{2}$'),
  onboarding_status public.onboarding_status not null default 'not_started',
  account_status public.account_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function app_private.set_updated_at();

create or replace function app_private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function app_private.handle_new_auth_user() from public, anon, authenticated;

create trigger auth_user_created_create_profile
after insert on auth.users
for each row execute function app_private.handle_new_auth_user();

insert into public.profiles (id)
select id from auth.users
on conflict (id) do nothing;

create table public.admin_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  status public.admin_membership_status not null default 'active',
  created_by uuid null references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.admin_roles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z][a-z0-9_]{2,63}$'),
  name text not null check (char_length(name) between 2 and 100),
  description text not null check (char_length(description) between 2 and 500),
  system_role boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.admin_permissions (
  code text primary key check (code ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  description text not null check (char_length(description) between 2 and 500),
  created_at timestamptz not null default now()
);

create table public.admin_role_permissions (
  role_id uuid not null references public.admin_roles (id) on delete cascade,
  permission_code text not null references public.admin_permissions (code) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (role_id, permission_code)
);

create table public.admin_role_assignments (
  admin_user_id uuid not null references public.admin_memberships (user_id) on delete cascade,
  role_id uuid not null references public.admin_roles (id) on delete cascade,
  assigned_by uuid null references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (admin_user_id, role_id)
);

create index admin_role_assignments_role_id_idx on public.admin_role_assignments (role_id);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid null references auth.users (id) on delete set null,
  actor_type public.audit_actor_type not null,
  action text not null check (action ~ '^[a-z][a-z0-9_.]{2,100}$'),
  target_type text not null check (target_type ~ '^[a-z][a-z0-9_]{1,80}$'),
  target_id uuid null,
  request_id uuid null,
  ip_address inet null,
  user_agent text null check (user_agent is null or char_length(user_agent) <= 500),
  before_state jsonb null check (before_state is null or jsonb_typeof(before_state) = 'object'),
  after_state jsonb null check (after_state is null or jsonb_typeof(after_state) = 'object'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index audit_events_actor_created_at_idx
  on public.audit_events (actor_user_id, created_at desc)
  where actor_user_id is not null;
create index audit_events_target_idx
  on public.audit_events (target_type, target_id, created_at desc);
create index audit_events_created_at_idx on public.audit_events (created_at desc);

create or replace function app_private.prevent_audit_event_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'audit events are append-only' using errcode = '42501';
end;
$$;

revoke all on function app_private.prevent_audit_event_mutation() from public, anon, authenticated;

create trigger audit_events_prevent_update_delete
before update or delete on public.audit_events
for each row execute function app_private.prevent_audit_event_mutation();

create or replace function app_private.is_account_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.account_status = 'active'::public.account_status
  );
$$;

revoke all on function app_private.is_account_active() from public;
grant execute on function app_private.is_account_active() to authenticated;

create or replace function public.get_my_admin_access()
returns table (roles text[], permissions text[])
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(array_agg(distinct r.code order by r.code), '{}'::text[]) as roles,
    coalesce(
      array_agg(distinct rp.permission_code order by rp.permission_code)
        filter (where rp.permission_code is not null),
      '{}'::text[]
    ) as permissions
  from public.admin_memberships m
  join public.admin_role_assignments a on a.admin_user_id = m.user_id
  join public.admin_roles r on r.id = a.role_id
  left join public.admin_role_permissions rp on rp.role_id = r.id
  where m.user_id = auth.uid()
    and m.status = 'active'::public.admin_membership_status
  having count(distinct r.id) > 0;
$$;

revoke all on function public.get_my_admin_access() from public, anon;
grant execute on function public.get_my_admin_access() to authenticated;

create trigger admin_memberships_set_updated_at
before update on public.admin_memberships
for each row execute function app_private.set_updated_at();
create trigger admin_roles_set_updated_at
before update on public.admin_roles
for each row execute function app_private.set_updated_at();

alter table public.profiles enable row level security;
alter table public.profiles force row level security;
alter table public.admin_memberships enable row level security;
alter table public.admin_memberships force row level security;
alter table public.admin_roles enable row level security;
alter table public.admin_roles force row level security;
alter table public.admin_permissions enable row level security;
alter table public.admin_permissions force row level security;
alter table public.admin_role_permissions enable row level security;
alter table public.admin_role_permissions force row level security;
alter table public.admin_role_assignments enable row level security;
alter table public.admin_role_assignments force row level security;
alter table public.audit_events enable row level security;
alter table public.audit_events force row level security;

comment on function public.get_my_admin_access() is
  'Returns roles and permissions for the current active admin membership. Never trusts JWT permission claims.';
