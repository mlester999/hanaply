-- Hanaply Phase 0: database-authoritative plans, typed entitlements, and safe subscriptions.

create table public.entitlement_definitions (
  key text primary key check (key ~ '^[a-z][a-zA-Z0-9]{2,80}$'),
  value_type public.entitlement_value_type not null,
  default_value jsonb not null,
  description text not null check (char_length(description) between 2 and 500),
  unit text null check (unit is null or char_length(unit) <= 50),
  constraints jsonb not null default '{}'::jsonb check (jsonb_typeof(constraints) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z][a-z0-9_]{2,63}$'),
  tier_code public.plan_tier not null,
  name text not null check (char_length(name) between 2 and 100),
  billing_period public.billing_period not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  price_minor integer not null check (price_minor > 0),
  active boolean not null default true,
  display_order integer not null default 0 check (display_order >= 0),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tier_code, billing_period)
);

create table public.plan_entitlements (
  plan_id uuid not null references public.plans (id) on delete cascade,
  entitlement_key text not null references public.entitlement_definitions (key) on delete restrict,
  value jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (plan_id, entitlement_key)
);

create or replace function app_private.validate_entitlement_json_value()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  definition public.entitlement_definitions%rowtype;
  numeric_value numeric;
begin
  select * into definition
  from public.entitlement_definitions
  where key = new.entitlement_key;

  if not found then
    raise exception 'unknown entitlement definition' using errcode = '23503';
  end if;

  if definition.value_type = 'boolean'::public.entitlement_value_type then
    if jsonb_typeof(new.value) <> 'boolean' then
      raise exception 'entitlement value must be boolean' using errcode = '23514';
    end if;
  elsif definition.value_type = 'integer'::public.entitlement_value_type then
    if jsonb_typeof(new.value) <> 'number' then
      raise exception 'entitlement value must be an integer' using errcode = '23514';
    end if;
    numeric_value := (new.value #>> '{}')::numeric;
    if numeric_value < 0 or trunc(numeric_value) <> numeric_value then
      raise exception 'entitlement integer must be nonnegative' using errcode = '23514';
    end if;
  elsif definition.value_type = 'string'::public.entitlement_value_type then
    if jsonb_typeof(new.value) <> 'string' then
      raise exception 'entitlement value must be a string' using errcode = '23514';
    end if;
    if definition.constraints ? 'allowedValues'
      and not (definition.constraints -> 'allowedValues') ? (new.value #>> '{}') then
      raise exception 'entitlement string is outside its allowed values' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function app_private.validate_entitlement_json_value() from public, anon, authenticated;

create trigger plan_entitlements_validate_value
before insert or update on public.plan_entitlements
for each row execute function app_private.validate_entitlement_json_value();

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  plan_id uuid not null references public.plans (id) on delete restrict,
  status public.subscription_status not null default 'pending_activation',
  starts_at timestamptz not null,
  ends_at timestamptz null,
  source public.subscription_source not null,
  activation_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(activation_metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);

create unique index subscriptions_one_active_per_user_idx
  on public.subscriptions (user_id)
  where status = 'active'::public.subscription_status;
create index subscriptions_user_created_at_idx
  on public.subscriptions (user_id, created_at desc);
create index subscriptions_plan_status_idx on public.subscriptions (plan_id, status);

create trigger entitlement_definitions_set_updated_at
before update on public.entitlement_definitions
for each row execute function app_private.set_updated_at();
create trigger plans_set_updated_at
before update on public.plans
for each row execute function app_private.set_updated_at();
create trigger plan_entitlements_set_updated_at
before update on public.plan_entitlements
for each row execute function app_private.set_updated_at();
create trigger subscriptions_set_updated_at
before update on public.subscriptions
for each row execute function app_private.set_updated_at();

alter table public.entitlement_definitions enable row level security;
alter table public.entitlement_definitions force row level security;
alter table public.plans enable row level security;
alter table public.plans force row level security;
alter table public.plan_entitlements enable row level security;
alter table public.plan_entitlements force row level security;
alter table public.subscriptions enable row level security;
alter table public.subscriptions force row level security;

comment on table public.plan_entitlements is
  'Runtime plan behavior. Frontend components must never substitute hardcoded entitlement values.';
