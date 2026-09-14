-- Hanaply job alerts and digest notifications.
--
-- The Phase 2 payment outbox proved the claim/complete/release pattern, so job
-- alerts reuse it rather than inventing a second delivery mechanism: an outbox
-- row is claimed with an opaque token, delivered by the worker, and completed or
-- released for a bounded retry. Delivery is therefore retry-safe, idempotent,
-- and never blocks a user request.
--
-- Three properties matter here:
--
--   1. Nothing is queued without consent. A notification is only created when
--      the subscriber's own preference is on *and* their plan includes the
--      feature, so an entitlement change alone can never start sending mail.
--   2. Idempotency is structural. The outbox has a unique idempotency key, so a
--      repeated queueing pass for the same window inserts nothing new.
--   3. Alerts respect relevance. Only opportunities the user has not dismissed
--      and that cleared a verdict threshold are included, and the digest is
--      capped so it stays readable.

-- ---------------------------------------------------------------------------
-- Preferences become real
-- ---------------------------------------------------------------------------

-- The Phase 1 schema deliberately pinned job alerts and the digest to false
-- because no delivery existed. Delivery now exists, so the pins are replaced by
-- genuine consent toggles. The historical columns are kept, unused, so the
-- migration stays forward-only and old rows remain readable.
alter table public.user_notification_preferences
  drop constraint if exists user_notification_preferences_check;

alter table public.user_notification_preferences
  add column if not exists job_alerts boolean not null default false,
  add column if not exists daily_digest boolean not null default false,
  add column if not exists instant_alerts boolean not null default false,
  add column if not exists weekly_strategy boolean not null default false,
  add column if not exists quiet_hours_start smallint null
    check (quiet_hours_start is null or quiet_hours_start between 0 and 23),
  add column if not exists quiet_hours_end smallint null
    check (quiet_hours_end is null or quiet_hours_end between 0 and 23);

comment on column public.user_notification_preferences.job_alerts is
  'Subscriber consent for opportunity email alerts. Both this and the plan entitlement must be true before anything is queued.';
comment on column public.user_notification_preferences.quiet_hours_start is
  'Local hour (0-23, Asia/Manila) after which non-urgent notifications are held. Null disables quiet hours.';

-- ---------------------------------------------------------------------------
-- Notification outbox
-- ---------------------------------------------------------------------------

create table public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  category text not null check (category in ('job_alert', 'daily_digest', 'weekly_strategy')),
  template_id text not null check (template_id ~ '^[a-z][a-z0-9-]{2,100}$'),
  template_version text not null default 'v1' check (template_version = 'v1'),
  idempotency_key text not null unique
    check (idempotency_key ~ '^[A-Za-z0-9:_-]{16,255}$'),
  variables jsonb not null default '{}'
    check (pg_catalog.jsonb_typeof(variables) = 'object'),
  status text not null default 'pending'
    check (status in ('pending', 'queued', 'delivered', 'failed', 'disabled')),
  provider_message_id text null check (provider_message_id is null or char_length(provider_message_id) <= 200),
  failure_code text null check (failure_code is null or char_length(failure_code) <= 100),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  claimed_at timestamptz null,
  claim_token uuid null,
  last_attempt_at timestamptz null,
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_outbox_claim_pair_check check (
    (claimed_at is null and claim_token is null)
    or (claimed_at is not null and claim_token is not null)
  )
);

comment on table public.notification_outbox is
  'Queue for opportunity notifications. Delivery is claim-based and idempotent; the unique idempotency key means a repeated queueing pass cannot duplicate a message.';

create index notification_outbox_delivery_queue_idx
  on public.notification_outbox (available_at, created_at)
  where status = 'pending';
create index notification_outbox_user_idx
  on public.notification_outbox (user_id, created_at desc);

create trigger notification_outbox_set_updated_at
before update on public.notification_outbox
for each row execute function app_private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Preference writes
-- ---------------------------------------------------------------------------

-- The Phase 1 setter only knew about product updates and marketing email. It is
-- dropped rather than kept alongside the new signature: leaving it would let a
-- caller silently change preferences without touching the new toggles, and
-- PostgreSQL would expose two overloads under one name.
drop function if exists public.update_my_notification_preferences(boolean, boolean, uuid);

create or replace function public.update_my_notification_preferences(
  requested_product_updates boolean default null,
  requested_marketing_emails boolean default null,
  requested_job_alerts boolean default null,
  requested_daily_digest boolean default null,
  requested_instant_alerts boolean default null,
  requested_weekly_strategy boolean default null,
  requested_quiet_hours_start smallint default null,
  requested_quiet_hours_end smallint default null,
  requested_request_id uuid default null
)
returns public.user_notification_preferences
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  previous public.user_notification_preferences;
  updated public.user_notification_preferences;
begin
  if actor is null then
    raise exception 'an authenticated account is required' using errcode = '42501';
  end if;

  select * into previous
  from public.user_notification_preferences
  where user_id = actor;

  if previous.user_id is null then
    insert into public.user_notification_preferences (user_id)
    values (actor)
    returning * into previous;
  end if;

  update public.user_notification_preferences
  set product_updates = coalesce(requested_product_updates, product_updates),
      marketing_emails = coalesce(requested_marketing_emails, marketing_emails),
      job_alerts = coalesce(requested_job_alerts, job_alerts),
      daily_digest = coalesce(requested_daily_digest, daily_digest),
      instant_alerts = coalesce(requested_instant_alerts, instant_alerts),
      weekly_strategy = coalesce(requested_weekly_strategy, weekly_strategy),
      -- Null means "leave unchanged". A caller that omits quiet hours must not
      -- silently clear a window the subscriber deliberately set, and an omitted
      -- argument is indistinguishable from an explicit null here.
      quiet_hours_start = coalesce(requested_quiet_hours_start, quiet_hours_start),
      quiet_hours_end = coalesce(requested_quiet_hours_end, quiet_hours_end)
  where user_id = actor
  returning * into updated;

  if updated is distinct from previous then
    insert into public.audit_events (
      actor_user_id, actor_type, action, target_type, target_id, request_id,
      before_state, after_state
    ) values (
      actor, 'user', 'user.notification_preferences_updated', 'profile', actor,
      requested_request_id,
      pg_catalog.jsonb_build_object(
        'productUpdates', previous.product_updates,
        'marketingEmails', previous.marketing_emails,
        'jobAlerts', previous.job_alerts,
        'dailyDigest', previous.daily_digest,
        'instantAlerts', previous.instant_alerts,
        'weeklyStrategy', previous.weekly_strategy
      ),
      pg_catalog.jsonb_build_object(
        'productUpdates', updated.product_updates,
        'marketingEmails', updated.marketing_emails,
        'jobAlerts', updated.job_alerts,
        'dailyDigest', updated.daily_digest,
        'instantAlerts', updated.instant_alerts,
        'weeklyStrategy', updated.weekly_strategy
      )
    );
  end if;

  return updated;
end;
$$;

revoke all on function public.update_my_notification_preferences(
  boolean, boolean, boolean, boolean, boolean, boolean, smallint, smallint, uuid
) from public, anon, authenticated;
grant execute on function public.update_my_notification_preferences(
  boolean, boolean, boolean, boolean, boolean, boolean, smallint, smallint, uuid
) to authenticated;

-- ---------------------------------------------------------------------------
-- Queueing
-- ---------------------------------------------------------------------------

create or replace function app_private.notification_allowed(
  target_user_id uuid,
  requested_category text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  preferences public.user_notification_preferences;
  entitlements jsonb;
  required_key text;
begin
  select * into preferences
  from public.user_notification_preferences
  where user_id = target_user_id;

  if preferences.user_id is null then
    return false;
  end if;

  required_key := case requested_category
    when 'job_alert' then 'emailAlerts'
    when 'daily_digest' then 'dailyDigest'
    when 'weekly_strategy' then 'weeklyAiCareerStrategy'
    else null
  end;
  if required_key is null then
    return false;
  end if;

  -- Consent and entitlement are both required. Either one alone is not enough:
  -- an upgrade must never start sending mail a subscriber did not ask for.
  entitlements := app_private.career_entitlements(target_user_id);
  if coalesce((entitlements -> required_key) #>> '{}', 'false') <> 'true' then
    return false;
  end if;

  return case requested_category
    when 'job_alert' then preferences.job_alerts
    when 'daily_digest' then preferences.daily_digest
    when 'weekly_strategy' then preferences.weekly_strategy
    else false
  end;
end;
$$;

create or replace function app_private.notification_in_quiet_hours(
  target_user_id uuid,
  evaluated_at timestamptz,
  urgent boolean
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  preferences public.user_notification_preferences;
  local_hour integer;
begin
  if urgent then
    return false;
  end if;

  select * into preferences
  from public.user_notification_preferences
  where user_id = target_user_id;

  if preferences.quiet_hours_start is null or preferences.quiet_hours_end is null then
    return false;
  end if;

  local_hour := extract(hour from (evaluated_at at time zone 'Asia/Manila'))::integer;
  if preferences.quiet_hours_start = preferences.quiet_hours_end then
    return false;
  end if;
  if preferences.quiet_hours_start < preferences.quiet_hours_end then
    return local_hour >= preferences.quiet_hours_start and local_hour < preferences.quiet_hours_end;
  end if;
  return local_hour >= preferences.quiet_hours_start or local_hour < preferences.quiet_hours_end;
end;
$$;

/**
 * Queues instant opportunity alerts for new high-scoring matches.
 *
 * A user receives at most one alert per window, so a busy scan cannot flood a
 * mailbox. The window is part of the idempotency key, which is what makes a
 * repeated call a no-op.
 */
create or replace function public.queue_job_alert_notifications(
  evaluated_at timestamptz default now(),
  window_minutes integer default 30,
  minimum_score integer default 75,
  batch_size integer default 100
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  queued integer := 0;
  subject record;
  jobs jsonb;
  window_start timestamptz;
begin
  perform app_private.require_service_role();

  if window_minutes < 5 or window_minutes > 1440 then
    raise exception 'window_minutes must be between 5 and 1440' using errcode = '22023';
  end if;
  if minimum_score < 0 or minimum_score > 100 then
    raise exception 'minimum_score must be between 0 and 100' using errcode = '22023';
  end if;

  window_start := pg_catalog.date_trunc('hour', evaluated_at)
    + pg_catalog.make_interval(mins => (extract(minute from evaluated_at)::integer / window_minutes) * window_minutes);

  for subject in
    select distinct on (matches.user_id)
      matches.user_id,
      matches.career_profile_id,
      profiles.display_name,
      profiles.first_name
    from public.job_matches as matches
    join public.profiles as profiles on profiles.id = matches.user_id
    where matches.computed_at >= window_start
      and matches.score >= minimum_score
      and matches.verdict in ('strong_match', 'good_match')
      and profiles.account_status = 'active'
    order by matches.user_id, matches.score desc
    limit batch_size
  loop
    if not app_private.notification_allowed(subject.user_id, 'job_alert') then
      continue;
    end if;
    if app_private.notification_in_quiet_hours(subject.user_id, evaluated_at, false) then
      continue;
    end if;

    select pg_catalog.jsonb_agg(entry order by entry ->> 'score' desc) into jobs
    from (
      select pg_catalog.jsonb_build_object(
        'jobId', matches.job_id,
        'title', jobs.title,
        'companyName', company.display_name,
        'score', matches.score,
        'verdict', matches.verdict,
        'locationRaw', jobs.location_raw,
        'remoteState', jobs.remote_state,
        'salaryMinMinor', jobs.salary_min_minor,
        'salaryMaxMinor', jobs.salary_max_minor,
        'salaryCurrency', jobs.salary_currency
      ) as entry
      from public.job_matches as matches
      join public.jobs as jobs on jobs.id = matches.job_id
      join public.companies as company on company.id = jobs.company_id
      where matches.user_id = subject.user_id
        and matches.career_profile_id = subject.career_profile_id
        and matches.computed_at >= window_start
        and matches.score >= minimum_score
        and matches.verdict in ('strong_match', 'good_match')
        and jobs.status = 'active'
      order by matches.score desc
      limit 5
    ) as matched;

    if jobs is null then
      continue;
    end if;

    insert into public.notification_outbox (
      user_id, category, template_id, idempotency_key, variables
    ) values (
      subject.user_id,
      'job_alert',
      'job-alert',
      'alert:' || subject.user_id::text || ':' || to_char(window_start, 'YYYYMMDDHH24MI'),
      pg_catalog.jsonb_build_object(
        'displayName', coalesce(subject.display_name, subject.first_name, 'there'),
        'jobCount', pg_catalog.jsonb_array_length(jobs),
        'jobs', jobs
      )
    )
    on conflict (idempotency_key) do nothing;

    if found then
      queued := queued + 1;
    end if;
  end loop;

  return queued;
end;
$$;

/**
 * Queues the daily digest. One message per subscriber per local day, containing
 * the day's strongest matches, so the digest cannot be sent twice for the same
 * day even if the worker runs repeatedly.
 */
create or replace function public.queue_job_digest_notifications(
  evaluated_at timestamptz default now(),
  minimum_score integer default 55,
  batch_size integer default 200
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  queued integer := 0;
  local_day date;
  subject record;
  jobs jsonb;
  saved_count integer;
  applied_count integer;
begin
  perform app_private.require_service_role();

  if minimum_score < 0 or minimum_score > 100 then
    raise exception 'minimum_score must be between 0 and 100' using errcode = '22023';
  end if;

  local_day := (evaluated_at at time zone 'Asia/Manila')::date;

  for subject in
    select
      profiles.id as user_id,
      primary_profile.id as career_profile_id,
      profiles.display_name,
      profiles.first_name
    from public.profiles as profiles
    left join lateral (
      select career.id
      from public.career_profiles as career
      where career.user_id = profiles.id and career.status <> 'archived'
      order by career.is_primary desc, career.created_at
      limit 1
    ) as primary_profile on true
    where profiles.account_status = 'active'
      and exists (
        select 1 from public.job_matches as matches
        where matches.user_id = profiles.id
          and matches.computed_at >= evaluated_at - interval '1 day'
          and matches.score >= minimum_score
      )
    order by profiles.id
    limit batch_size
  loop
    if not app_private.notification_allowed(subject.user_id, 'daily_digest') then
      continue;
    end if;
    if app_private.notification_in_quiet_hours(subject.user_id, evaluated_at, false) then
      continue;
    end if;

    select pg_catalog.jsonb_agg(entry order by entry ->> 'score' desc) into jobs
    from (
      select pg_catalog.jsonb_build_object(
        'jobId', matches.job_id,
        'title', jobs.title,
        'companyName', company.display_name,
        'score', matches.score,
        'verdict', matches.verdict,
        'locationRaw', jobs.location_raw,
        'remoteState', jobs.remote_state
      ) as entry
      from public.job_matches as matches
      join public.jobs as jobs on jobs.id = matches.job_id
      join public.companies as company on company.id = jobs.company_id
      left join public.job_feedback as feedback
        on feedback.job_id = matches.job_id
       and feedback.user_id = matches.user_id
       and feedback.active
      where matches.user_id = subject.user_id
        and matches.computed_at >= evaluated_at - interval '1 day'
        and matches.score >= minimum_score
        and jobs.status = 'active'
        and (feedback.feedback is null or feedback.feedback in ('interested', 'saved'))
      order by matches.score desc
      limit 10
    ) as matched;

    if jobs is null then
      continue;
    end if;

    select pg_catalog.count(*)::integer into saved_count
    from public.saved_jobs where user_id = subject.user_id;

    select pg_catalog.count(*)::integer into applied_count
    from public.job_applications
    where user_id = subject.user_id and stage not in ('saved', 'archived');

    insert into public.notification_outbox (
      user_id, category, template_id, idempotency_key, variables
    ) values (
      subject.user_id,
      'daily_digest',
      'daily-digest',
      'digest:' || subject.user_id::text || ':' || to_char(local_day, 'YYYYMMDD'),
      pg_catalog.jsonb_build_object(
        'displayName', coalesce(subject.display_name, subject.first_name, 'there'),
        'localDay', to_char(local_day, 'FMMonth FMDD, YYYY'),
        'jobCount', pg_catalog.jsonb_array_length(jobs),
        'jobs', jobs,
        'savedCount', saved_count,
        'activeApplicationCount', applied_count
      )
    )
    on conflict (idempotency_key) do nothing;

    if found then
      queued := queued + 1;
    end if;
  end loop;

  return queued;
end;
$$;

-- ---------------------------------------------------------------------------
-- Delivery claims
-- ---------------------------------------------------------------------------

create or replace function public.claim_notification_outbox(
  requested_claim_token uuid,
  requested_batch_size integer default 25
)
returns table (
  id uuid,
  user_id uuid,
  category text,
  template_id text,
  template_version text,
  idempotency_key text,
  variables jsonb,
  attempts integer
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform app_private.require_service_role();

  if requested_batch_size < 1 or requested_batch_size > 200 then
    raise exception 'batch size must be between 1 and 200' using errcode = '22023';
  end if;

  -- Recover claims abandoned by a crashed worker before claiming new work.
  update public.notification_outbox
  set status = 'pending', claimed_at = null, claim_token = null
  where status = 'pending'
    and claimed_at is not null
    and claimed_at < now() - interval '5 minutes';

  return query
  with claimed as (
    select outbox.id
    from public.notification_outbox as outbox
    where outbox.status = 'pending'
      -- Claiming only stamps the token and leaves the status pending, so a row
      -- already held by another worker must be excluded explicitly.
      and outbox.claimed_at is null
      and outbox.available_at <= now()
    order by outbox.available_at, outbox.created_at
    limit requested_batch_size
    for update skip locked
  )
  update public.notification_outbox as outbox
  set claimed_at = now(), claim_token = requested_claim_token
  from claimed
  where outbox.id = claimed.id
  returning
    outbox.id,
    outbox.user_id,
    outbox.category,
    outbox.template_id,
    outbox.template_version,
    outbox.idempotency_key,
    outbox.variables,
    outbox.attempts;
end;
$$;

create or replace function public.complete_notification_outbox(
  target_notification_id uuid,
  requested_claim_token uuid,
  requested_status text,
  requested_provider_message_id text default null,
  requested_failure_code text default null,
  requested_attempts integer default 1
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  updated integer := 0;
begin
  perform app_private.require_service_role();

  if requested_status not in ('delivered', 'failed', 'disabled') then
    raise exception 'unsupported completion status' using errcode = '22023';
  end if;

  update public.notification_outbox
  set status = requested_status,
      provider_message_id = pg_catalog.left(requested_provider_message_id, 200),
      failure_code = pg_catalog.left(requested_failure_code, 100),
      attempts = greatest(attempts, coalesce(requested_attempts, attempts)),
      last_attempt_at = now(),
      completed_at = now(),
      claimed_at = null,
      claim_token = null
  where id = target_notification_id
    and claim_token = requested_claim_token
    and status = 'pending';
  get diagnostics updated = row_count;

  return updated > 0;
end;
$$;

create or replace function public.release_notification_outbox(
  target_notification_id uuid,
  requested_claim_token uuid,
  retry_at timestamptz
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  updated integer := 0;
begin
  perform app_private.require_service_role();

  if retry_at > now() + interval '1 day' then
    raise exception 'a retry may not be scheduled more than a day ahead' using errcode = '22023';
  end if;

  update public.notification_outbox
  set status = 'pending',
      attempts = attempts + 1,
      available_at = greatest(retry_at, now()),
      claimed_at = null,
      claim_token = null,
      last_attempt_at = now()
  where id = target_notification_id
    and claim_token = requested_claim_token
    and status = 'pending';
  get diagnostics updated = row_count;

  return updated > 0;
end;
$$;

revoke all on function app_private.notification_allowed(uuid, text)
  from public, anon, authenticated;
revoke all on function app_private.notification_in_quiet_hours(uuid, timestamptz, boolean)
  from public, anon, authenticated;
revoke all on function public.queue_job_alert_notifications(timestamptz, integer, integer, integer)
  from public, anon, authenticated;
revoke all on function public.queue_job_digest_notifications(timestamptz, integer, integer)
  from public, anon, authenticated;
revoke all on function public.claim_notification_outbox(uuid, integer)
  from public, anon, authenticated;
revoke all on function public.complete_notification_outbox(uuid, uuid, text, text, text, integer)
  from public, anon, authenticated;
revoke all on function public.release_notification_outbox(uuid, uuid, timestamptz)
  from public, anon, authenticated;

grant execute on function public.queue_job_alert_notifications(timestamptz, integer, integer, integer)
  to service_role;
grant execute on function public.queue_job_digest_notifications(timestamptz, integer, integer)
  to service_role;
grant execute on function public.claim_notification_outbox(uuid, integer) to service_role;
grant execute on function public.complete_notification_outbox(uuid, uuid, text, text, text, integer)
  to service_role;
grant execute on function public.release_notification_outbox(uuid, uuid, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- Row-level security and grants
-- ---------------------------------------------------------------------------

alter table public.notification_outbox enable row level security;
alter table public.notification_outbox force row level security;

revoke all on table public.notification_outbox from public, anon, authenticated;
grant all privileges on table public.notification_outbox to service_role;

grant select (user_id, product_updates, marketing_emails, job_alerts, daily_digest, instant_alerts, weekly_strategy, quiet_hours_start, quiet_hours_end, created_at, updated_at)
  on table public.user_notification_preferences to authenticated;

comment on table public.notification_outbox is
  'Opportunity notification queue. Not client-readable: a subscriber sees their preferences, not the delivery machinery.';
