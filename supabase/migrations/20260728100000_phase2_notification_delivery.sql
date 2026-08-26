-- Hanaply Phase 2: concurrency-safe notification outbox claims and expiry reminders.

alter table public.payment_notifications
  add column available_at timestamptz not null default now(),
  add column claimed_at timestamptz null,
  add column claim_token uuid null,
  add column last_attempt_at timestamptz null,
  add column completed_at timestamptz null,
  add constraint payment_notifications_claim_pair_check check (
    (claimed_at is null and claim_token is null)
    or (claimed_at is not null and claim_token is not null)
  );

create index payment_notifications_delivery_queue_idx
  on public.payment_notifications (available_at, created_at)
  where status = 'pending';

create or replace function public.claim_payment_notifications(
  requested_claim_token uuid,
  requested_batch_size integer default 25
)
returns table (
  id uuid,
  user_id uuid,
  payment_submission_id uuid,
  subscription_id uuid,
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
  if requested_claim_token is null or requested_batch_size not between 1 and 100 then
    raise exception 'notification claim input is invalid' using errcode = '22023';
  end if;
  return query
  with candidates as (
    select notification.id
    from public.payment_notifications notification
    where notification.status = 'pending'
      and notification.available_at <= now()
      and (
        notification.claimed_at is null
        or notification.claimed_at < now() - interval '5 minutes'
      )
    order by notification.created_at
    for update skip locked
    limit requested_batch_size
  ), claimed as (
    update public.payment_notifications notification
    set claimed_at = now(),
        claim_token = requested_claim_token
    from candidates
    where notification.id = candidates.id
    returning notification.*
  )
  select
    claimed.id,
    claimed.user_id,
    claimed.payment_submission_id,
    claimed.subscription_id,
    claimed.template_id,
    claimed.template_version,
    claimed.idempotency_key,
    claimed.variables,
    claimed.attempts
  from claimed
  order by claimed.created_at;
end;
$$;

create or replace function public.complete_payment_notification(
  target_notification_id uuid,
  requested_claim_token uuid,
  requested_status text,
  requested_provider_message_id text,
  requested_failure_code text,
  requested_attempts integer
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform app_private.require_service_role();
  if requested_status not in ('captured', 'queued', 'delivered', 'failed', 'disabled')
    or requested_attempts < 0 then
    raise exception 'notification delivery result is invalid' using errcode = '22023';
  end if;
  update public.payment_notifications
  set status = requested_status,
      provider_message_id = nullif(requested_provider_message_id, ''),
      failure_code = nullif(requested_failure_code, ''),
      attempts = requested_attempts,
      last_attempt_at = now(),
      completed_at = now(),
      claimed_at = null,
      claim_token = null
  where id = target_notification_id
    and claim_token = requested_claim_token
    and status = 'pending';
  return found;
end;
$$;

create or replace function public.release_payment_notification_claim(
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
begin
  perform app_private.require_service_role();
  if retry_at is null or retry_at > now() + interval '1 day' then
    raise exception 'notification retry timestamp is invalid' using errcode = '22023';
  end if;
  update public.payment_notifications
  set available_at = greatest(retry_at, now()),
      attempts = attempts + 1,
      last_attempt_at = now(),
      claimed_at = null,
      claim_token = null
  where id = target_notification_id
    and claim_token = requested_claim_token
    and status = 'pending';
  return found;
end;
$$;

create or replace function public.queue_subscription_expiry_reminders(
  evaluated_at timestamptz default now(),
  reminder_days integer default 7
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  queued_count integer;
begin
  perform app_private.require_service_role();
  if evaluated_at is null or reminder_days not between 1 and 365 then
    raise exception 'expiry reminder input is invalid' using errcode = '22023';
  end if;
  insert into public.payment_notifications (
    user_id,
    subscription_id,
    template_id,
    idempotency_key,
    variables
  )
  select
    subscription.user_id,
    subscription.id,
    'subscription-expires-soon',
    'subscription:' || subscription.id::text || ':expires-soon:' || reminder_days::text || ':' || subscription.version::text,
    pg_catalog.jsonb_build_object(
      'planCode', plan.code,
      'endsAt', subscription.ends_at,
      'daysRemaining', reminder_days
    )
  from public.subscriptions subscription
  join public.plans plan on plan.id = subscription.plan_id
  join public.profiles profile on profile.id = subscription.user_id
  where subscription.status = 'active'
    and subscription.ends_at > evaluated_at
    and subscription.ends_at <= evaluated_at + pg_catalog.make_interval(days => reminder_days)
    and profile.account_status = 'active'
  on conflict (idempotency_key) do nothing;
  get diagnostics queued_count = row_count;
  return queued_count;
end;
$$;

revoke all on function public.claim_payment_notifications(uuid, integer)
  from public, anon, authenticated;
revoke all on function public.complete_payment_notification(uuid, uuid, text, text, text, integer)
  from public, anon, authenticated;
revoke all on function public.release_payment_notification_claim(uuid, uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function public.queue_subscription_expiry_reminders(timestamptz, integer)
  from public, anon, authenticated;

grant execute on function public.claim_payment_notifications(uuid, integer) to service_role;
grant execute on function public.complete_payment_notification(uuid, uuid, text, text, text, integer)
  to service_role;
grant execute on function public.release_payment_notification_claim(uuid, uuid, timestamptz)
  to service_role;
grant execute on function public.queue_subscription_expiry_reminders(timestamptz, integer)
  to service_role;

comment on function public.claim_payment_notifications(uuid, integer) is
  'Claims pending payment and subscription notifications with row locking and a five-minute stale-claim recovery window.';
comment on function public.queue_subscription_expiry_reminders(timestamptz, integer) is
  'Queues one idempotent expiry reminder per subscription version and configured day threshold.';
