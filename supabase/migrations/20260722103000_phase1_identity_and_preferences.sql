-- Hanaply Phase 1: registration reconciliation, preferences, authentication history, and throttling.

alter table public.profiles
  add column first_name text null check (first_name is null or char_length(first_name) between 1 and 80),
  add column last_name text null check (last_name is null or char_length(last_name) between 1 and 80),
  add column email_verified_at timestamptz null,
  add column last_password_changed_at timestamptz null;

create table public.user_legal_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  policy_type text not null check (policy_type in ('terms', 'privacy')),
  policy_version text not null check (policy_version ~ '^[a-z0-9][a-z0-9._-]{2,79}$'),
  accepted_at timestamptz not null,
  source text not null check (source in ('registration', 'policy_update', 'reconciliation')),
  created_at timestamptz not null default now(),
  unique (user_id, policy_type, policy_version)
);

create index user_legal_acceptances_user_created_idx
  on public.user_legal_acceptances (user_id, created_at desc);

create table public.user_notification_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  product_updates boolean not null default false,
  marketing_emails boolean not null default false,
  future_job_alerts boolean not null default false,
  future_daily_digest boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not future_job_alerts and not future_daily_digest)
);

create trigger user_notification_preferences_set_updated_at
before update on public.user_notification_preferences
for each row execute function app_private.set_updated_at();

create table public.authentication_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null references auth.users (id) on delete set null,
  event_type text not null check (event_type ~ '^[a-z][a-z0-9_.]{2,100}$'),
  outcome text not null check (outcome in ('succeeded', 'failed', 'requested')),
  request_id uuid null,
  ip_address inet null,
  user_agent text null check (user_agent is null or char_length(user_agent) <= 500),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz not null default now()
);

create index authentication_events_user_occurred_idx
  on public.authentication_events (user_id, occurred_at desc)
  where user_id is not null;
create index authentication_events_type_occurred_idx
  on public.authentication_events (event_type, occurred_at desc);

create table public.account_status_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null references auth.users (id) on delete set null,
  previous_status public.account_status not null,
  new_status public.account_status not null,
  changed_by uuid null references auth.users (id) on delete set null,
  reason text not null check (char_length(reason) between 10 and 500),
  request_id uuid null,
  created_at timestamptz not null default now(),
  check (previous_status <> new_status)
);

create index account_status_history_user_created_idx
  on public.account_status_history (user_id, created_at desc);

create table public.account_suspensions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'resolved')),
  reason text not null check (char_length(reason) between 10 and 500),
  suspended_by uuid not null references auth.users (id) on delete restrict,
  suspended_at timestamptz not null default now(),
  resolved_by uuid null references auth.users (id) on delete set null,
  resolved_at timestamptz null,
  resolution_note text null check (
    resolution_note is null or char_length(resolution_note) between 10 and 500
  ),
  check (
    (status = 'active' and resolved_by is null and resolved_at is null and resolution_note is null)
    or
    (status = 'resolved' and resolved_by is not null and resolved_at is not null)
  )
);

create unique index account_suspensions_one_active_per_user_idx
  on public.account_suspensions (user_id)
  where status = 'active';

create table public.email_delivery_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null references auth.users (id) on delete set null,
  provider text not null check (provider in ('capture', 'resend', 'supabase_auth')),
  category text not null check (category in ('authentication', 'account', 'administrative')),
  template_id text not null check (template_id ~ '^[a-z][a-z0-9_.-]{2,100}$'),
  template_version text not null check (template_version ~ '^[a-z0-9][a-z0-9._-]{0,79}$'),
  idempotency_key_hash text not null check (idempotency_key_hash ~ '^[a-f0-9]{64}$'),
  provider_message_id text null check (
    provider_message_id is null or char_length(provider_message_id) <= 200
  ),
  status text not null check (status in ('captured', 'queued', 'delivered', 'failed')),
  failure_code text null check (failure_code is null or char_length(failure_code) <= 100),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, idempotency_key_hash)
);

create trigger email_delivery_events_set_updated_at
before update on public.email_delivery_events
for each row execute function app_private.set_updated_at();

create table app_private.auth_rate_limits (
  bucket text not null,
  key_hash text not null check (key_hash ~ '^[a-f0-9]{64}$'),
  window_started_at timestamptz not null,
  attempt_count integer not null check (attempt_count > 0),
  updated_at timestamptz not null default now(),
  primary key (bucket, key_hash)
);

revoke all on table app_private.auth_rate_limits from public, anon, authenticated;

create or replace function public.consume_auth_rate_limit(
  rate_bucket text,
  rate_key_hash text
)
returns table (allowed boolean, retry_after_seconds integer, remaining integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  allowed_attempts integer;
  window_seconds integer;
  current_record app_private.auth_rate_limits%rowtype;
  evaluated_at timestamptz := now();
begin
  select limits.allowed_attempts, limits.window_seconds
  into allowed_attempts, window_seconds
  from (
    values
      ('registration', 5, 3600),
      ('login', 10, 900),
      ('verification_resend', 3, 3600),
      ('password_recovery', 5, 3600),
      ('password_reset', 5, 900),
      ('profile_update', 20, 3600),
      ('session_revocation', 10, 3600),
      ('admin_user_search', 120, 60),
      ('admin_account_action', 20, 3600)
  ) as limits(bucket, allowed_attempts, window_seconds)
  where limits.bucket = rate_bucket;

  if allowed_attempts is null then
    raise exception 'unknown authentication rate-limit bucket' using errcode = '22023';
  end if;
  if rate_key_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid authentication rate-limit key' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(rate_bucket || ':' || rate_key_hash, 0)
  );

  select * into current_record
  from app_private.auth_rate_limits
  where bucket = rate_bucket and key_hash = rate_key_hash
  for update;

  if not found or current_record.window_started_at + pg_catalog.make_interval(secs => window_seconds) <= evaluated_at then
    insert into app_private.auth_rate_limits (
      bucket, key_hash, window_started_at, attempt_count, updated_at
    ) values (
      rate_bucket, rate_key_hash, evaluated_at, 1, evaluated_at
    )
    on conflict (bucket, key_hash) do update set
      window_started_at = excluded.window_started_at,
      attempt_count = 1,
      updated_at = excluded.updated_at
    returning * into current_record;
  else
    update app_private.auth_rate_limits
    set attempt_count = attempt_count + 1,
        updated_at = evaluated_at
    where bucket = rate_bucket and key_hash = rate_key_hash
    returning * into current_record;
  end if;

  allowed := current_record.attempt_count <= allowed_attempts;
  remaining := greatest(allowed_attempts - current_record.attempt_count, 0);
  retry_after_seconds := case
    when allowed then 0
    else greatest(
      pg_catalog.ceil(
        extract(epoch from (
          current_record.window_started_at
          + pg_catalog.make_interval(secs => window_seconds)
          - evaluated_at
        ))
      )::integer,
      1
    )
  end;
  return next;
end;
$$;

revoke all on function public.consume_auth_rate_limit(text, text) from public;

create or replace function app_private.prevent_security_history_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  old_record jsonb := pg_catalog.to_jsonb(old);
  new_record jsonb := pg_catalog.to_jsonb(new);
begin
  if tg_op = 'UPDATE' and pg_catalog.pg_trigger_depth() > 1 then
    if tg_table_name = 'authentication_events'
      and old_record ->> 'user_id' is not null
      and new_record ->> 'user_id' is null
      and (new_record - 'user_id') = (old_record - 'user_id') then
      return new;
    end if;

    if tg_table_name = 'account_status_history'
      and (
        (old_record ->> 'user_id' is not null and new_record ->> 'user_id' is null)
        or
        (old_record ->> 'changed_by' is not null and new_record ->> 'changed_by' is null)
      )
      and (new_record - 'user_id' - 'changed_by') = (old_record - 'user_id' - 'changed_by') then
      return new;
    end if;
  end if;

  raise exception 'security history is append-only' using errcode = '42501';
end;
$$;

revoke all on function app_private.prevent_security_history_mutation()
  from public, anon, authenticated;

create trigger authentication_events_prevent_update_delete
before update or delete on public.authentication_events
for each row execute function app_private.prevent_security_history_mutation();

create trigger account_status_history_prevent_update_delete
before update or delete on public.account_status_history
for each row execute function app_private.prevent_security_history_mutation();

create or replace function app_private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  given_first_name text;
  given_last_name text;
  given_display_name text;
  accepted_at timestamptz := coalesce(new.created_at, now());
begin
  given_first_name := nullif(pg_catalog.left(pg_catalog.btrim(coalesce(new.raw_user_meta_data ->> 'first_name', '')), 80), '');
  given_last_name := nullif(pg_catalog.left(pg_catalog.btrim(coalesce(new.raw_user_meta_data ->> 'last_name', '')), 80), '');
  given_display_name := nullif(pg_catalog.left(pg_catalog.btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), 120), '');
  if given_display_name is null then
    given_display_name := nullif(pg_catalog.left(pg_catalog.btrim(pg_catalog.concat_ws(' ', given_first_name, given_last_name)), 120), '');
  end if;

  insert into public.profiles (
    id,
    first_name,
    last_name,
    display_name,
    email_verified_at
  ) values (
    new.id,
    given_first_name,
    given_last_name,
    given_display_name,
    new.email_confirmed_at
  )
  on conflict (id) do update set
    first_name = coalesce(public.profiles.first_name, excluded.first_name),
    last_name = coalesce(public.profiles.last_name, excluded.last_name),
    display_name = coalesce(public.profiles.display_name, excluded.display_name),
    email_verified_at = coalesce(public.profiles.email_verified_at, excluded.email_verified_at);

  insert into public.user_notification_preferences (user_id, marketing_emails)
  values (
    new.id,
    pg_catalog.lower(coalesce(new.raw_user_meta_data ->> 'marketing_consent', 'false')) = 'true'
  )
  on conflict (user_id) do nothing;

  if pg_catalog.lower(coalesce(new.raw_user_meta_data ->> 'terms_accepted', 'false')) = 'true'
    and new.raw_user_meta_data ->> 'terms_version' = 'draft-2026-07-22' then
    insert into public.user_legal_acceptances (
      user_id, policy_type, policy_version, accepted_at, source
    ) values (
      new.id, 'terms', 'draft-2026-07-22', accepted_at, 'registration'
    ) on conflict do nothing;
  end if;

  if pg_catalog.lower(coalesce(new.raw_user_meta_data ->> 'privacy_accepted', 'false')) = 'true'
    and new.raw_user_meta_data ->> 'privacy_version' = 'draft-2026-07-22' then
    insert into public.user_legal_acceptances (
      user_id, policy_type, policy_version, accepted_at, source
    ) values (
      new.id, 'privacy', 'draft-2026-07-22', accepted_at, 'registration'
    ) on conflict do nothing;
  end if;

  insert into public.authentication_events (user_id, event_type, outcome)
  values (new.id, 'user.registered', 'succeeded');

  return new;
end;
$$;

revoke all on function app_private.handle_new_auth_user() from public, anon, authenticated;

insert into public.user_notification_preferences (user_id)
select id from auth.users
on conflict (user_id) do nothing;

update public.profiles profile
set email_verified_at = auth_user.email_confirmed_at
from auth.users auth_user
where profile.id = auth_user.id
  and profile.email_verified_at is distinct from auth_user.email_confirmed_at;

create or replace function app_private.handle_auth_user_security_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.email_confirmed_at is distinct from new.email_confirmed_at then
    update public.profiles
    set email_verified_at = new.email_confirmed_at
    where id = new.id;

    if old.email_confirmed_at is null and new.email_confirmed_at is not null then
      insert into public.authentication_events (user_id, event_type, outcome)
      values (new.id, 'user.email_verified', 'succeeded');
    end if;
  end if;

  if old.encrypted_password is distinct from new.encrypted_password then
    update public.profiles
    set last_password_changed_at = now()
    where id = new.id;

    insert into public.authentication_events (user_id, event_type, outcome)
    values (new.id, 'user.password_changed', 'succeeded');
  end if;

  return new;
end;
$$;

revoke all on function app_private.handle_auth_user_security_update()
  from public, anon, authenticated;

create trigger auth_user_security_update_sync_profile
after update of email_confirmed_at, encrypted_password on auth.users
for each row execute function app_private.handle_auth_user_security_update();

create or replace function public.reconcile_my_profile()
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  auth_user auth.users%rowtype;
  inserted boolean := false;
begin
  if auth.uid() is null then
    raise exception 'authentication is required' using errcode = '42501';
  end if;

  select * into auth_user from auth.users where id = auth.uid();
  if not found then
    raise exception 'auth user is unavailable' using errcode = '23503';
  end if;

  insert into public.profiles (
    id, first_name, last_name, display_name, email_verified_at
  ) values (
    auth_user.id,
    nullif(pg_catalog.left(pg_catalog.btrim(coalesce(auth_user.raw_user_meta_data ->> 'first_name', '')), 80), ''),
    nullif(pg_catalog.left(pg_catalog.btrim(coalesce(auth_user.raw_user_meta_data ->> 'last_name', '')), 80), ''),
    nullif(pg_catalog.left(pg_catalog.btrim(coalesce(auth_user.raw_user_meta_data ->> 'display_name', '')), 120), ''),
    auth_user.email_confirmed_at
  )
  on conflict (id) do update set
    email_verified_at = excluded.email_verified_at;

  get diagnostics inserted = row_count;

  insert into public.user_notification_preferences (user_id)
  values (auth_user.id)
  on conflict (user_id) do nothing;

  return inserted;
end;
$$;

revoke all on function public.reconcile_my_profile() from public, anon;

create or replace function public.record_my_auth_event(
  requested_event_type text,
  requested_request_id uuid default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  event_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication is required' using errcode = '42501';
  end if;
  if requested_event_type not in (
    'user.login_succeeded',
    'user.logged_out',
    'user.sessions_revoked',
    'admin.login_succeeded',
    'admin.permission_denied'
  ) then
    raise exception 'authentication event type is not client-recordable' using errcode = '22023';
  end if;

  insert into public.authentication_events (
    user_id, event_type, outcome, request_id
  ) values (
    auth.uid(), requested_event_type, 'succeeded', requested_request_id
  ) returning id into event_id;

  return event_id;
end;
$$;

revoke all on function public.record_my_auth_event(text, uuid) from public, anon;

create or replace function public.update_my_notification_preferences(
  requested_product_updates boolean,
  requested_marketing_emails boolean,
  requested_request_id uuid default null
)
returns public.user_notification_preferences
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  previous_record public.user_notification_preferences%rowtype;
  updated_record public.user_notification_preferences%rowtype;
begin
  if auth.uid() is null or not app_private.is_account_active() then
    raise exception 'an active account is required' using errcode = '42501';
  end if;

  select * into previous_record
  from public.user_notification_preferences
  where user_id = auth.uid();

  insert into public.user_notification_preferences (
    user_id, product_updates, marketing_emails
  ) values (
    auth.uid(), requested_product_updates, requested_marketing_emails
  )
  on conflict (user_id) do update set
    product_updates = excluded.product_updates,
    marketing_emails = excluded.marketing_emails
  returning * into updated_record;

  if previous_record.product_updates is distinct from updated_record.product_updates
    or previous_record.marketing_emails is distinct from updated_record.marketing_emails then
    insert into public.audit_events (
      actor_user_id, actor_type, action, target_type, target_id, request_id,
      before_state, after_state
    ) values (
      auth.uid(), 'user', 'user.notification_preferences_updated', 'profile', auth.uid(),
      requested_request_id,
      pg_catalog.jsonb_build_object(
        'productUpdates', previous_record.product_updates,
        'marketingEmails', previous_record.marketing_emails
      ),
      pg_catalog.jsonb_build_object(
        'productUpdates', updated_record.product_updates,
        'marketingEmails', updated_record.marketing_emails
      )
    );
  end if;

  return updated_record;
end;
$$;

revoke all on function public.update_my_notification_preferences(boolean, boolean, uuid)
  from public, anon;

create or replace function app_private.audit_safe_profile_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (old.first_name, old.last_name, old.display_name, old.locale, old.timezone, old.country_code)
    is distinct from
    (new.first_name, new.last_name, new.display_name, new.locale, new.timezone, new.country_code) then
    insert into public.audit_events (
      actor_user_id, actor_type, action, target_type, target_id, before_state, after_state
    ) values (
      coalesce(auth.uid(), new.id),
      case when auth.uid() = new.id then 'user'::public.audit_actor_type else 'service'::public.audit_actor_type end,
      'user.profile_updated',
      'profile',
      new.id,
      pg_catalog.jsonb_build_object(
        'firstName', old.first_name,
        'lastName', old.last_name,
        'displayName', old.display_name,
        'locale', old.locale,
        'timezone', old.timezone,
        'countryCode', old.country_code
      ),
      pg_catalog.jsonb_build_object(
        'firstName', new.first_name,
        'lastName', new.last_name,
        'displayName', new.display_name,
        'locale', new.locale,
        'timezone', new.timezone,
        'countryCode', new.country_code
      )
    );
  end if;
  return new;
end;
$$;

revoke all on function app_private.audit_safe_profile_update()
  from public, anon, authenticated;

create trigger profiles_audit_safe_update
after update on public.profiles
for each row execute function app_private.audit_safe_profile_update();

alter table public.user_legal_acceptances enable row level security;
alter table public.user_legal_acceptances force row level security;
alter table public.user_notification_preferences enable row level security;
alter table public.user_notification_preferences force row level security;
alter table public.authentication_events enable row level security;
alter table public.authentication_events force row level security;
alter table public.account_status_history enable row level security;
alter table public.account_status_history force row level security;
alter table public.account_suspensions enable row level security;
alter table public.account_suspensions force row level security;
alter table public.email_delivery_events enable row level security;
alter table public.email_delivery_events force row level security;

comment on function public.consume_auth_rate_limit(text, text) is
  'Atomic database-backed limits for authentication and account actions. Callers cannot supply limit values.';
comment on table public.authentication_events is
  'Append-only safe authentication outcomes. Tokens, passwords, and raw email links are forbidden.';
comment on table public.email_delivery_events is
  'Safe delivery metadata only. Recipient addresses, message bodies, and authentication tokens are excluded.';
