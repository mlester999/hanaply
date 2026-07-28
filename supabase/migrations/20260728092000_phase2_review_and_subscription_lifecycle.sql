-- Hanaply Phase 2: review concurrency, atomic approval, renewal, refund, reversal, correction, and expiry.

create or replace function app_private.require_review_lock(
  payment public.payment_submissions,
  actor_user_id uuid,
  expected_version integer
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if payment.status <> 'under_review'::public.payment_submission_status then
    raise exception 'payment is not under review' using errcode = '22023';
  end if;
  if payment.version <> expected_version then
    raise exception 'payment submission version conflict' using errcode = '40001';
  end if;
  if payment.reviewer_id is distinct from actor_user_id
    or payment.review_lock_expires_at is null
    or payment.review_lock_expires_at <= now() then
    raise exception 'an active review lock owned by this reviewer is required' using errcode = '40001';
  end if;
end;
$$;

create or replace function app_private.release_review_assignment(
  target_submission_id uuid,
  requested_reason text
)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.payment_review_assignments
  set released_at = now(), release_reason = requested_reason
  where submission_id = target_submission_id and released_at is null;
$$;

create or replace function app_private.subscription_state(
  subscription public.subscriptions,
  plan_code text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'planCode', plan_code,
    'status', subscription.status,
    'startsAt', subscription.starts_at,
    'endsAt', subscription.ends_at,
    'version', subscription.version
  );
$$;

create or replace function app_private.append_subscription_event(
  target_subscription public.subscriptions,
  target_plan_code text,
  event_actor_user_id uuid,
  event_actor_type public.audit_actor_type,
  requested_event_type text,
  requested_previous_state jsonb,
  requested_new_state jsonb,
  requested_effective_at timestamptz,
  target_payment_submission_id uuid,
  requested_reason text,
  requested_request_id uuid
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
  insert into public.subscription_events (
    subscription_id,
    user_id,
    actor_user_id,
    actor_type,
    event_type,
    previous_state,
    new_state,
    effective_at,
    payment_submission_id,
    reason,
    request_id
  ) values (
    target_subscription.id,
    target_subscription.user_id,
    event_actor_user_id,
    event_actor_type,
    requested_event_type,
    coalesce(requested_previous_state, '{}'::jsonb),
    coalesce(
      requested_new_state,
      app_private.subscription_state(target_subscription, target_plan_code)
    ),
    requested_effective_at,
    target_payment_submission_id,
    requested_reason,
    requested_request_id
  ) returning id into event_id;
  return event_id;
end;
$$;

create or replace function app_private.append_entitlement_event(
  target_subscription public.subscriptions,
  event_actor_user_id uuid,
  requested_event_type text,
  requested_previous_state jsonb,
  requested_new_state jsonb,
  requested_effective_at timestamptz,
  target_payment_submission_id uuid,
  requested_request_id uuid
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
  insert into public.entitlement_events (
    user_id,
    subscription_id,
    plan_id,
    actor_user_id,
    event_type,
    previous_state,
    new_state,
    effective_at,
    payment_submission_id,
    request_id
  ) values (
    target_subscription.user_id,
    target_subscription.id,
    target_subscription.plan_id,
    event_actor_user_id,
    requested_event_type,
    coalesce(requested_previous_state, '{}'::jsonb),
    coalesce(requested_new_state, '{}'::jsonb),
    requested_effective_at,
    target_payment_submission_id,
    requested_request_id
  ) returning id into event_id;
  return event_id;
end;
$$;

revoke all on function app_private.require_review_lock(public.payment_submissions, uuid, integer)
  from public, anon, authenticated;
revoke all on function app_private.release_review_assignment(uuid, text)
  from public, anon, authenticated;
revoke all on function app_private.subscription_state(public.subscriptions, text)
  from public, anon, authenticated;
revoke all on function app_private.append_subscription_event(public.subscriptions, text, uuid, public.audit_actor_type, text, jsonb, jsonb, timestamptz, uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function app_private.append_entitlement_event(public.subscriptions, uuid, text, jsonb, jsonb, timestamptz, uuid, uuid)
  from public, anon, authenticated;

create or replace function public.start_payment_review(
  actor_user_id uuid,
  target_submission_id uuid,
  expected_version integer,
  action_request_id uuid default null
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  payment public.payment_submissions%rowtype;
  requested_lock_expires_at timestamptz := now() + interval '15 minutes';
begin
  perform app_private.require_admin_actor(actor_user_id, 'payments.review');
  select * into payment
  from public.payment_submissions
  where id = target_submission_id
  for update;
  if not found then
    raise exception 'payment submission was not found' using errcode = 'P0002';
  end if;
  if payment.version <> expected_version then
    raise exception 'payment submission version conflict' using errcode = '40001';
  end if;
  if payment.status not in ('submitted', 'resubmitted') then
    raise exception 'payment cannot enter review from its current state' using errcode = '22023';
  end if;
  if exists (
    select 1
    from public.payment_review_assignments assignment
    where assignment.submission_id = payment.id
      and assignment.released_at is null
      and assignment.lock_expires_at > now()
  ) then
    raise exception 'payment is already claimed by another review' using errcode = '40001';
  end if;

  update public.payment_review_assignments
  set released_at = now(), release_reason = 'lock_expired'
  where submission_id = payment.id
    and released_at is null
    and lock_expires_at <= now();

  insert into public.payment_review_assignments (
    submission_id, reviewer_id, lock_expires_at, request_id
  ) values (
    payment.id, actor_user_id, requested_lock_expires_at, action_request_id
  );

  perform pg_catalog.set_config('app.payment_lifecycle_context', 'allowed', true);
  update public.payment_submissions
  set status = 'under_review',
      reviewer_id = actor_user_id,
      review_started_at = now(),
      review_lock_expires_at = requested_lock_expires_at,
      version = version + 1
  where id = payment.id;

  perform app_private.append_payment_event(
    payment.id,
    actor_user_id,
    'admin',
    'payment_submission.review_started',
    payment.status,
    'under_review',
    null,
    null,
    null,
    pg_catalog.jsonb_build_object('lockExpiresAt', requested_lock_expires_at),
    action_request_id
  );
  insert into public.audit_events (
    actor_user_id, actor_type, action, target_type, target_id, request_id,
    before_state, after_state
  ) values (
    actor_user_id,
    'admin',
    'payment_submission.review_started',
    'payment_submission',
    payment.id,
    action_request_id,
    pg_catalog.jsonb_build_object('status', payment.status),
    pg_catalog.jsonb_build_object('status', 'under_review')
  );
  perform app_private.queue_payment_notification(
    payment.user_id,
    payment.id,
    null,
    'payment-under-review',
    'payment:' || payment.id::text || ':under-review:' || (payment.version + 1)::text,
    '{}'::jsonb
  );
  return payment.version + 1;
end;
$$;

create or replace function public.request_payment_information(
  actor_user_id uuid,
  target_submission_id uuid,
  expected_version integer,
  reason_category text,
  public_message text,
  internal_note text default null,
  action_reason text default null,
  action_request_id uuid default null
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  payment public.payment_submissions%rowtype;
begin
  perform app_private.require_admin_actor(actor_user_id, 'payments.review');
  if reason_category not in (
    'reference_unclear', 'proof_unclear', 'details_mismatch', 'payment_date_unclear', 'other'
  ) or public_message is null
    or char_length(pg_catalog.btrim(public_message)) not between 10 and 2000
    or action_reason is null
    or char_length(pg_catalog.btrim(action_reason)) not between 10 and 500 then
    raise exception 'information request details are invalid' using errcode = '22023';
  end if;
  select * into payment
  from public.payment_submissions
  where id = target_submission_id
  for update;
  if not found then
    raise exception 'payment submission was not found' using errcode = 'P0002';
  end if;
  perform app_private.require_review_lock(payment, actor_user_id, expected_version);

  perform pg_catalog.set_config('app.payment_lifecycle_context', 'allowed', true);
  update public.payment_submissions
  set status = 'needs_information',
      public_review_message = pg_catalog.btrim(public_message),
      internal_review_note = nullif(pg_catalog.btrim(internal_note), ''),
      review_lock_expires_at = null,
      version = version + 1
  where id = payment.id;
  perform app_private.release_review_assignment(payment.id, 'information_requested');

  perform app_private.append_payment_event(
    payment.id,
    actor_user_id,
    'admin',
    'payment_submission.information_requested',
    'under_review',
    'needs_information',
    pg_catalog.btrim(public_message),
    nullif(pg_catalog.btrim(internal_note), ''),
    reason_category,
    pg_catalog.jsonb_build_object(
      'reference', payment.original_reference,
      'proofFileId', payment.proof_file_id
    ),
    action_request_id
  );
  insert into public.audit_events (
    actor_user_id, actor_type, action, target_type, target_id, request_id,
    before_state, after_state, metadata
  ) values (
    actor_user_id,
    'admin',
    'payment_submission.information_requested',
    'payment_submission',
    payment.id,
    action_request_id,
    pg_catalog.jsonb_build_object('status', 'under_review'),
    pg_catalog.jsonb_build_object('status', 'needs_information'),
    pg_catalog.jsonb_build_object(
      'reasonCategory', reason_category,
      'reason', pg_catalog.btrim(action_reason)
    )
  );
  perform app_private.queue_payment_notification(
    payment.user_id,
    payment.id,
    null,
    'payment-more-information-required',
    'payment:' || payment.id::text || ':needs-information:' || (payment.version + 1)::text,
    pg_catalog.jsonb_build_object('publicMessage', pg_catalog.btrim(public_message))
  );
  return payment.version + 1;
end;
$$;

create or replace function public.reject_payment_submission(
  actor_user_id uuid,
  target_submission_id uuid,
  expected_version integer,
  requested_rejection_reason_code text,
  public_message text,
  internal_note text default null,
  action_reason text default null,
  action_request_id uuid default null
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  payment public.payment_submissions%rowtype;
begin
  perform app_private.require_admin_actor(actor_user_id, 'payments.review');
  if requested_rejection_reason_code not in (
    'payment_not_found', 'amount_mismatch', 'reference_invalid', 'proof_invalid',
    'proof_reused', 'details_incomplete', 'other'
  ) or public_message is null
    or char_length(pg_catalog.btrim(public_message)) not between 10 and 2000
    or action_reason is null
    or char_length(pg_catalog.btrim(action_reason)) not between 10 and 500 then
    raise exception 'rejection details are invalid' using errcode = '22023';
  end if;
  select * into payment
  from public.payment_submissions
  where id = target_submission_id
  for update;
  if not found then
    raise exception 'payment submission was not found' using errcode = 'P0002';
  end if;
  perform app_private.require_review_lock(payment, actor_user_id, expected_version);

  perform pg_catalog.set_config('app.payment_lifecycle_context', 'allowed', true);
  update public.payment_submissions
  set status = 'rejected',
      reviewed_at = now(),
      public_review_message = pg_catalog.btrim(public_message),
      internal_review_note = nullif(pg_catalog.btrim(internal_note), ''),
      rejection_reason_code = requested_rejection_reason_code,
      review_lock_expires_at = null,
      version = version + 1
  where id = payment.id;
  perform app_private.release_review_assignment(payment.id, 'rejected');

  perform app_private.append_payment_event(
    payment.id,
    actor_user_id,
    'admin',
    'payment_submission.rejected',
    'under_review',
    'rejected',
    pg_catalog.btrim(public_message),
    nullif(pg_catalog.btrim(internal_note), ''),
    requested_rejection_reason_code,
    '{}'::jsonb,
    action_request_id
  );
  insert into public.audit_events (
    actor_user_id, actor_type, action, target_type, target_id, request_id,
    before_state, after_state, metadata
  ) values (
    actor_user_id,
    'admin',
    'payment_submission.rejected',
    'payment_submission',
    payment.id,
    action_request_id,
    pg_catalog.jsonb_build_object('status', 'under_review'),
    pg_catalog.jsonb_build_object('status', 'rejected'),
    pg_catalog.jsonb_build_object(
      'reasonCode', requested_rejection_reason_code,
      'reason', pg_catalog.btrim(action_reason)
    )
  );
  perform app_private.queue_payment_notification(
    payment.user_id,
    payment.id,
    null,
    'payment-rejected',
    'payment:' || payment.id::text || ':rejected:' || (payment.version + 1)::text,
    pg_catalog.jsonb_build_object('publicMessage', pg_catalog.btrim(public_message))
  );
  return payment.version + 1;
end;
$$;

create or replace function public.approve_payment_submission(
  actor_user_id uuid,
  target_submission_id uuid,
  expected_version integer,
  action_reason text,
  internal_note text default null,
  action_request_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  payment public.payment_submissions%rowtype;
  selected_plan public.plans%rowtype;
  proof public.payment_submission_files%rowtype;
  current_subscription public.subscriptions%rowtype;
  stale_subscription public.subscriptions%rowtype;
  resulting_subscription public.subscriptions%rowtype;
  current_plan_code text;
  current_tier public.plan_tier;
  approval_at timestamptz := now();
  new_approval_transaction_id uuid := gen_random_uuid();
  previous_subscription_state jsonb := '{}'::jsonb;
  new_subscription_state jsonb;
  subscription_action text;
  term_end timestamptz;
begin
  perform app_private.require_admin_actor(actor_user_id, 'payments.review');
  if action_reason is null or char_length(pg_catalog.btrim(action_reason)) not between 10 and 500 then
    raise exception 'an approval reason between 10 and 500 characters is required' using errcode = '22023';
  end if;
  select * into payment
  from public.payment_submissions
  where id = target_submission_id
  for update;
  if not found then
    raise exception 'payment submission was not found' using errcode = 'P0002';
  end if;
  perform app_private.require_review_lock(payment, actor_user_id, expected_version);
  if not exists (
    select 1 from public.profiles profile
    where profile.id = payment.user_id
      and profile.account_status = 'active'::public.account_status
  ) then
    raise exception 'target account must remain active' using errcode = '42501';
  end if;

  select * into selected_plan
  from public.plans
  where id = payment.plan_id
  for share;
  if not found or not selected_plan.active
    or selected_plan.billing_period <> payment.billing_period
    or selected_plan.price_minor <> payment.quoted_amount_minor
    or selected_plan.currency <> payment.currency then
    raise exception 'canonical plan or price validation failed' using errcode = '22023';
  end if;
  select * into proof
  from public.payment_submission_files
  where id = payment.proof_file_id
  for share;
  if not found or proof.submission_id <> payment.id or not proof.active
    or proof.scan_status = 'rejected' then
    raise exception 'approved payment proof is unavailable' using errcode = '22023';
  end if;
  if payment.normalized_reference is null
    or exists (
      select 1
      from public.payment_submissions approved_payment
      where approved_payment.id <> payment.id
        and approved_payment.payment_method_id = payment.payment_method_id
        and approved_payment.normalized_reference = payment.normalized_reference
        and approved_payment.status in ('approved', 'refunded', 'reversed')
    ) then
    raise exception 'payment reference has already activated a subscription' using errcode = '23505';
  end if;

  perform pg_catalog.set_config('app.subscription_lifecycle_context', 'allowed', true);
  perform pg_catalog.set_config('app.payment_lifecycle_context', 'allowed', true);

  select subscription.* into stale_subscription
  from public.subscriptions subscription
  where subscription.user_id = payment.user_id
    and subscription.status = 'active'::public.subscription_status
    and subscription.ends_at <= approval_at
  order by subscription.ends_at desc
  limit 1
  for update;
  if stale_subscription.id is not null then
    select code into current_plan_code from public.plans where id = stale_subscription.plan_id;
    previous_subscription_state := app_private.subscription_state(stale_subscription, current_plan_code);
    update public.subscriptions
    set status = 'expired', version = version + 1
    where id = stale_subscription.id
    returning * into stale_subscription;
    perform app_private.append_subscription_event(
      stale_subscription,
      current_plan_code,
      null,
      'system',
      'subscription.expired',
      previous_subscription_state,
      app_private.subscription_state(stale_subscription, current_plan_code),
      approval_at,
      null,
      'Authoritative end timestamp elapsed before renewal approval.',
      action_request_id
    );
    perform app_private.append_entitlement_event(
      stale_subscription,
      null,
      'entitlement.expired',
      pg_catalog.jsonb_build_object('planCode', current_plan_code, 'active', true),
      pg_catalog.jsonb_build_object('planCode', null, 'active', false),
      approval_at,
      null,
      action_request_id
    );
  end if;

  select subscription.* into current_subscription
  from public.subscriptions subscription
  where subscription.user_id = payment.user_id
    and subscription.status = 'active'::public.subscription_status
    and subscription.starts_at <= approval_at
    and subscription.ends_at > approval_at
  order by subscription.ends_at desc
  limit 1
  for update;

  if current_subscription.id is null then
    term_end := approval_at + case
      when payment.billing_period = 'monthly'::public.billing_period then interval '1 month'
      else interval '1 year'
    end;
    insert into public.subscriptions (
      user_id,
      plan_id,
      status,
      starts_at,
      ends_at,
      source,
      activation_metadata
    ) values (
      payment.user_id,
      selected_plan.id,
      'active',
      approval_at,
      term_end,
      'manual_payment',
      pg_catalog.jsonb_build_object('paymentSubmissionId', payment.id)
    ) returning * into resulting_subscription;
    subscription_action := 'activated';
    new_subscription_state := app_private.subscription_state(
      resulting_subscription,
      selected_plan.code
    );
    perform app_private.append_subscription_event(
      resulting_subscription,
      selected_plan.code,
      actor_user_id,
      'admin',
      'subscription.created',
      '{}'::jsonb,
      new_subscription_state,
      approval_at,
      payment.id,
      pg_catalog.btrim(action_reason),
      action_request_id
    );
    perform app_private.append_subscription_event(
      resulting_subscription,
      selected_plan.code,
      actor_user_id,
      'admin',
      'subscription.activated',
      '{}'::jsonb,
      new_subscription_state,
      approval_at,
      payment.id,
      pg_catalog.btrim(action_reason),
      action_request_id
    );
  else
    select plan.code, plan.tier_code into current_plan_code, current_tier
    from public.plans plan
    where plan.id = current_subscription.plan_id;
    if current_tier <> selected_plan.tier_code then
      raise exception 'automatic mid-cycle plan changes are not supported' using errcode = '22023';
    end if;
    if current_subscription.ends_at is null then
      raise exception 'active subscription end timestamp is unavailable' using errcode = '22023';
    end if;
    previous_subscription_state := app_private.subscription_state(
      current_subscription,
      current_plan_code
    );
    term_end := current_subscription.ends_at + case
      when payment.billing_period = 'monthly'::public.billing_period then interval '1 month'
      else interval '1 year'
    end;
    update public.subscriptions
    set plan_id = selected_plan.id,
        ends_at = term_end,
        source = 'manual_payment',
        activation_metadata = pg_catalog.jsonb_build_object(
          'latestPaymentSubmissionId', payment.id
        ),
        version = version + 1
    where id = current_subscription.id
    returning * into resulting_subscription;
    subscription_action := 'renewed';
    new_subscription_state := app_private.subscription_state(
      resulting_subscription,
      selected_plan.code
    );
    perform app_private.append_subscription_event(
      resulting_subscription,
      selected_plan.code,
      actor_user_id,
      'admin',
      'subscription.renewed',
      previous_subscription_state,
      new_subscription_state,
      approval_at,
      payment.id,
      pg_catalog.btrim(action_reason),
      action_request_id
    );
  end if;

  update public.payment_submissions
  set status = 'approved',
      reviewed_at = approval_at,
      internal_review_note = nullif(pg_catalog.btrim(internal_note), ''),
      public_review_message = 'Payment approved. Your subscription is active.',
      approval_transaction_id = new_approval_transaction_id,
      subscription_id = resulting_subscription.id,
      review_lock_expires_at = null,
      version = version + 1
  where id = payment.id;
  perform app_private.release_review_assignment(payment.id, 'approved');

  perform app_private.append_payment_event(
    payment.id,
    actor_user_id,
    'admin',
    'payment_submission.approved',
    'under_review',
    'approved',
    'Payment approved. Your subscription is active.',
    nullif(pg_catalog.btrim(internal_note), ''),
    null,
    pg_catalog.jsonb_build_object(
      'approvalTransactionId', new_approval_transaction_id,
      'subscriptionId', resulting_subscription.id,
      'subscriptionAction', subscription_action
    ),
    action_request_id
  );
  perform app_private.append_entitlement_event(
    resulting_subscription,
    actor_user_id,
    case
      when subscription_action = 'renewed' then 'entitlement.renewed'
      else 'entitlement.activated'
    end,
    case
      when subscription_action = 'renewed' then
        pg_catalog.jsonb_build_object('planCode', current_plan_code, 'active', true)
      else pg_catalog.jsonb_build_object('planCode', null, 'active', false)
    end,
    pg_catalog.jsonb_build_object(
      'planCode', selected_plan.code,
      'active', true,
      'validUntil', resulting_subscription.ends_at
    ),
    approval_at,
    payment.id,
    action_request_id
  );

  insert into public.audit_events (
    actor_user_id, actor_type, action, target_type, target_id, request_id,
    before_state, after_state, metadata
  ) values
  (
    actor_user_id,
    'admin',
    'payment_submission.approved',
    'payment_submission',
    payment.id,
    action_request_id,
    pg_catalog.jsonb_build_object('status', 'under_review'),
    pg_catalog.jsonb_build_object('status', 'approved'),
    pg_catalog.jsonb_build_object(
      'subscriptionAction', subscription_action,
      'reason', pg_catalog.btrim(action_reason)
    )
  ),
  (
    actor_user_id,
    'admin',
    'subscription.' || subscription_action,
    'subscription',
    resulting_subscription.id,
    action_request_id,
    previous_subscription_state,
    new_subscription_state,
    pg_catalog.jsonb_build_object('paymentSubmissionId', payment.id)
  ),
  (
    actor_user_id,
    'admin',
    'entitlement.changed',
    'subscription',
    resulting_subscription.id,
    action_request_id,
    pg_catalog.jsonb_build_object('active', subscription_action = 'renewed'),
    pg_catalog.jsonb_build_object('active', true, 'planCode', selected_plan.code),
    pg_catalog.jsonb_build_object('paymentSubmissionId', payment.id)
  );

  perform app_private.queue_payment_notification(
    payment.user_id,
    payment.id,
    resulting_subscription.id,
    'payment-approved',
    'payment:' || payment.id::text || ':approved:' || (payment.version + 1)::text,
    pg_catalog.jsonb_build_object(
      'planCode', selected_plan.code,
      'amountMinor', payment.quoted_amount_minor,
      'subscriptionEndsAt', resulting_subscription.ends_at
    )
  );
  perform app_private.queue_payment_notification(
    payment.user_id,
    payment.id,
    resulting_subscription.id,
    case when subscription_action = 'renewed' then 'subscription-renewed' else 'subscription-activated' end,
    'subscription:' || resulting_subscription.id::text || ':' || subscription_action || ':' || resulting_subscription.version::text,
    pg_catalog.jsonb_build_object(
      'planCode', selected_plan.code,
      'startsAt', resulting_subscription.starts_at,
      'endsAt', resulting_subscription.ends_at
    )
  );

  return pg_catalog.jsonb_build_object(
    'subscriptionId', resulting_subscription.id,
    'submissionVersion', payment.version + 1,
    'subscriptionVersion', resulting_subscription.version,
    'subscriptionAction', subscription_action
  );
end;
$$;

create or replace function public.record_payment_refund(
  actor_user_id uuid,
  target_submission_id uuid,
  expected_version integer,
  refunded_amount_minor integer,
  external_reference text,
  refunded_at timestamptz,
  requested_subscription_impact public.payment_subscription_impact,
  action_reason text,
  internal_note text default null,
  action_request_id uuid default null
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  payment public.payment_submissions%rowtype;
  subscription public.subscriptions%rowtype;
  updated_subscription public.subscriptions%rowtype;
  plan_code text;
  previous_state jsonb;
begin
  perform app_private.require_admin_actor(actor_user_id, 'payments.review');
  perform app_private.require_admin_actor(actor_user_id, 'subscriptions.manage');
  if refunded_amount_minor <= 0
    or action_reason is null
    or char_length(pg_catalog.btrim(action_reason)) not between 10 and 500
    or refunded_at is null
    or refunded_at > now() + interval '10 minutes' then
    raise exception 'refund record is invalid' using errcode = '22023';
  end if;
  select * into payment
  from public.payment_submissions
  where id = target_submission_id
  for update;
  if not found then
    raise exception 'payment submission was not found' using errcode = 'P0002';
  end if;
  if payment.version <> expected_version then
    raise exception 'payment submission version conflict' using errcode = '40001';
  end if;
  if payment.status <> 'approved' or refunded_amount_minor > payment.quoted_amount_minor then
    raise exception 'only an approved payment can receive a valid refund record' using errcode = '22023';
  end if;
  if requested_subscription_impact = 'end_access_now'
    and exists (
      select 1 from public.payment_submissions later_payment
      where later_payment.subscription_id = payment.subscription_id
        and later_payment.id <> payment.id
        and later_payment.status in ('approved', 'refunded')
        and later_payment.reviewed_at > payment.reviewed_at
    ) then
    raise exception 'later approved renewals require a controlled subscription correction' using errcode = '40001';
  end if;

  perform pg_catalog.set_config('app.payment_lifecycle_context', 'allowed', true);
  perform pg_catalog.set_config('app.subscription_lifecycle_context', 'allowed', true);
  insert into public.payment_refunds (
    submission_id,
    refunded_amount_minor,
    external_reference,
    refunded_at,
    reason,
    subscription_impact,
    recorded_by,
    internal_note,
    request_id
  ) values (
    payment.id,
    refunded_amount_minor,
    nullif(pg_catalog.btrim(external_reference), ''),
    refunded_at,
    pg_catalog.btrim(action_reason),
    requested_subscription_impact,
    actor_user_id,
    nullif(pg_catalog.btrim(internal_note), ''),
    action_request_id
  );
  update public.payment_submissions
  set status = 'refunded',
      public_review_message = 'A refund completed outside Hanaply was recorded.',
      internal_review_note = nullif(pg_catalog.btrim(internal_note), ''),
      version = version + 1
  where id = payment.id;

  if requested_subscription_impact = 'end_access_now' then
    select * into subscription
    from public.subscriptions
    where id = payment.subscription_id
    for update;
    if subscription.id is not null and subscription.status in ('active', 'grace_period') then
      select code into plan_code from public.plans where id = subscription.plan_id;
      previous_state := app_private.subscription_state(subscription, plan_code);
      update public.subscriptions
      set status = 'refunded', version = version + 1
      where id = subscription.id
      returning * into updated_subscription;
      perform app_private.append_subscription_event(
        updated_subscription,
        plan_code,
        actor_user_id,
        'admin',
        'subscription.refunded',
        previous_state,
        app_private.subscription_state(updated_subscription, plan_code),
        refunded_at,
        payment.id,
        pg_catalog.btrim(action_reason),
        action_request_id
      );
      perform app_private.append_entitlement_event(
        updated_subscription,
        actor_user_id,
        'entitlement.refunded',
        pg_catalog.jsonb_build_object('active', true, 'planCode', plan_code),
        pg_catalog.jsonb_build_object('active', false, 'planCode', null),
        refunded_at,
        payment.id,
        action_request_id
      );
    end if;
  end if;

  perform app_private.append_payment_event(
    payment.id,
    actor_user_id,
    'admin',
    'payment_submission.refund_recorded',
    'approved',
    'refunded',
    'A refund completed outside Hanaply was recorded.',
    nullif(pg_catalog.btrim(internal_note), ''),
    null,
    pg_catalog.jsonb_build_object(
      'refundedAmountMinor', refunded_amount_minor,
      'subscriptionImpact', requested_subscription_impact
    ),
    action_request_id
  );
  insert into public.audit_events (
    actor_user_id, actor_type, action, target_type, target_id, request_id,
    before_state, after_state, metadata
  ) values (
    actor_user_id,
    'admin',
    'payment_submission.refund_recorded',
    'payment_submission',
    payment.id,
    action_request_id,
    pg_catalog.jsonb_build_object('status', 'approved'),
    pg_catalog.jsonb_build_object('status', 'refunded'),
    pg_catalog.jsonb_build_object(
      'refundedAmountMinor', refunded_amount_minor,
      'subscriptionImpact', requested_subscription_impact,
      'reason', pg_catalog.btrim(action_reason)
    )
  );
  perform app_private.queue_payment_notification(
    payment.user_id,
    payment.id,
    payment.subscription_id,
    'payment-refund-recorded',
    'payment:' || payment.id::text || ':refunded:' || (payment.version + 1)::text,
    pg_catalog.jsonb_build_object(
      'refundedAmountMinor', refunded_amount_minor,
      'subscriptionImpact', requested_subscription_impact
    )
  );
  return payment.version + 1;
end;
$$;

create or replace function public.reverse_payment_approval(
  actor_user_id uuid,
  target_submission_id uuid,
  expected_version integer,
  action_reason text,
  internal_note text default null,
  action_request_id uuid default null
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  payment public.payment_submissions%rowtype;
  subscription public.subscriptions%rowtype;
  updated_subscription public.subscriptions%rowtype;
  plan_code text;
  previous_state jsonb;
begin
  perform app_private.require_admin_actor(actor_user_id, 'payments.review');
  perform app_private.require_admin_actor(actor_user_id, 'subscriptions.manage');
  if action_reason is null or char_length(pg_catalog.btrim(action_reason)) not between 10 and 500 then
    raise exception 'a reversal reason between 10 and 500 characters is required' using errcode = '22023';
  end if;
  select * into payment
  from public.payment_submissions
  where id = target_submission_id
  for update;
  if not found then
    raise exception 'payment submission was not found' using errcode = 'P0002';
  end if;
  if payment.version <> expected_version then
    raise exception 'payment submission version conflict' using errcode = '40001';
  end if;
  if payment.status <> 'approved' then
    raise exception 'only an approved payment can be reversed' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.payment_submissions later_payment
    where later_payment.subscription_id = payment.subscription_id
      and later_payment.id <> payment.id
      and later_payment.status in ('approved', 'refunded')
      and later_payment.reviewed_at > payment.reviewed_at
  ) then
    raise exception 'later approved renewals require a controlled subscription correction' using errcode = '40001';
  end if;

  perform pg_catalog.set_config('app.payment_lifecycle_context', 'allowed', true);
  perform pg_catalog.set_config('app.subscription_lifecycle_context', 'allowed', true);
  update public.payment_submissions
  set status = 'reversed',
      public_review_message = 'The payment approval was reversed after an administrative correction.',
      internal_review_note = nullif(pg_catalog.btrim(internal_note), ''),
      version = version + 1
  where id = payment.id;

  select * into subscription
  from public.subscriptions
  where id = payment.subscription_id
  for update;
  if subscription.id is not null and subscription.status in ('active', 'grace_period') then
    select code into plan_code from public.plans where id = subscription.plan_id;
    previous_state := app_private.subscription_state(subscription, plan_code);
    update public.subscriptions
    set status = 'reversed', version = version + 1
    where id = subscription.id
    returning * into updated_subscription;
    perform app_private.append_subscription_event(
      updated_subscription,
      plan_code,
      actor_user_id,
      'admin',
      'subscription.reversed',
      previous_state,
      app_private.subscription_state(updated_subscription, plan_code),
      now(),
      payment.id,
      pg_catalog.btrim(action_reason),
      action_request_id
    );
    perform app_private.append_entitlement_event(
      updated_subscription,
      actor_user_id,
      'entitlement.reversed',
      pg_catalog.jsonb_build_object('active', true, 'planCode', plan_code),
      pg_catalog.jsonb_build_object('active', false, 'planCode', null),
      now(),
      payment.id,
      action_request_id
    );
  end if;

  perform app_private.append_payment_event(
    payment.id,
    actor_user_id,
    'admin',
    'payment_submission.reversed',
    'approved',
    'reversed',
    'The payment approval was reversed after an administrative correction.',
    nullif(pg_catalog.btrim(internal_note), ''),
    null,
    '{}'::jsonb,
    action_request_id
  );
  insert into public.audit_events (
    actor_user_id, actor_type, action, target_type, target_id, request_id,
    before_state, after_state, metadata
  ) values (
    actor_user_id,
    'admin',
    'payment_submission.reversed',
    'payment_submission',
    payment.id,
    action_request_id,
    pg_catalog.jsonb_build_object('status', 'approved'),
    pg_catalog.jsonb_build_object('status', 'reversed'),
    pg_catalog.jsonb_build_object('reason', pg_catalog.btrim(action_reason))
  );
  perform app_private.queue_payment_notification(
    payment.user_id,
    payment.id,
    payment.subscription_id,
    'payment-approval-reversed',
    'payment:' || payment.id::text || ':reversed:' || (payment.version + 1)::text,
    '{}'::jsonb
  );
  return payment.version + 1;
end;
$$;

create or replace function public.correct_subscription(
  actor_user_id uuid,
  target_subscription_id uuid,
  expected_version integer,
  requested_starts_at timestamptz,
  requested_ends_at timestamptz,
  action_reason text,
  internal_note text default null,
  restore_reversed boolean default false,
  action_request_id uuid default null
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  subscription public.subscriptions%rowtype;
  updated_subscription public.subscriptions%rowtype;
  plan_code text;
  previous_state jsonb;
  next_status public.subscription_status;
begin
  perform app_private.require_admin_actor(actor_user_id, 'subscriptions.manage');
  if restore_reversed then
    perform app_private.require_admin_actor(actor_user_id, 'security.manage');
  end if;
  if requested_starts_at is null
    or requested_ends_at is null
    or requested_ends_at <= requested_starts_at
    or action_reason is null
    or char_length(pg_catalog.btrim(action_reason)) not between 10 and 500 then
    raise exception 'subscription correction is invalid' using errcode = '22023';
  end if;
  select * into subscription
  from public.subscriptions
  where id = target_subscription_id
  for update;
  if not found then
    raise exception 'subscription was not found' using errcode = 'P0002';
  end if;
  if subscription.version <> expected_version then
    raise exception 'subscription version conflict' using errcode = '40001';
  end if;
  if restore_reversed and subscription.status <> 'reversed' then
    raise exception 'only a reversed subscription can be restored' using errcode = '22023';
  end if;
  next_status := case
    when restore_reversed and requested_ends_at > now() then 'active'::public.subscription_status
    when restore_reversed then 'expired'::public.subscription_status
    else subscription.status
  end;
  if next_status = 'active'
    and exists (
      select 1 from public.subscriptions other_subscription
      where other_subscription.user_id = subscription.user_id
        and other_subscription.id <> subscription.id
        and other_subscription.status = 'active'
    ) then
    raise exception 'another active subscription already exists' using errcode = '23505';
  end if;
  select code into plan_code from public.plans where id = subscription.plan_id;
  previous_state := app_private.subscription_state(subscription, plan_code);

  perform pg_catalog.set_config('app.subscription_lifecycle_context', 'allowed', true);
  update public.subscriptions
  set starts_at = requested_starts_at,
      ends_at = requested_ends_at,
      status = next_status,
      version = version + 1
  where id = subscription.id
  returning * into updated_subscription;

  insert into public.subscription_corrections (
    subscription_id,
    corrected_by,
    reason,
    internal_note,
    before_state,
    after_state,
    request_id
  ) values (
    subscription.id,
    actor_user_id,
    pg_catalog.btrim(action_reason),
    nullif(pg_catalog.btrim(internal_note), ''),
    previous_state,
    app_private.subscription_state(updated_subscription, plan_code),
    action_request_id
  );
  perform app_private.append_subscription_event(
    updated_subscription,
    plan_code,
    actor_user_id,
    'admin',
    'subscription.corrected',
    previous_state,
    app_private.subscription_state(updated_subscription, plan_code),
    now(),
    null,
    pg_catalog.btrim(action_reason),
    action_request_id
  );
  perform app_private.append_entitlement_event(
    updated_subscription,
    actor_user_id,
    'entitlement.corrected',
    pg_catalog.jsonb_build_object(
      'active', subscription.status = 'active' and subscription.ends_at > now(),
      'validUntil', subscription.ends_at
    ),
    pg_catalog.jsonb_build_object(
      'active', next_status = 'active' and requested_ends_at > now(),
      'validUntil', requested_ends_at
    ),
    now(),
    null,
    action_request_id
  );
  insert into public.audit_events (
    actor_user_id, actor_type, action, target_type, target_id, request_id,
    before_state, after_state, metadata
  ) values (
    actor_user_id,
    'admin',
    'subscription.corrected',
    'subscription',
    subscription.id,
    action_request_id,
    previous_state,
    app_private.subscription_state(updated_subscription, plan_code),
    pg_catalog.jsonb_build_object(
      'reason', pg_catalog.btrim(action_reason),
      'restoredReversal', restore_reversed
    )
  );
  perform app_private.queue_payment_notification(
    subscription.user_id,
    null,
    subscription.id,
    'subscription-corrected',
    'subscription:' || subscription.id::text || ':corrected:' || updated_subscription.version::text,
    pg_catalog.jsonb_build_object(
      'planCode', plan_code,
      'startsAt', updated_subscription.starts_at,
      'endsAt', updated_subscription.ends_at
    )
  );
  return updated_subscription.version;
end;
$$;

create or replace function public.expire_subscriptions(
  evaluated_at timestamptz default now(),
  action_request_id uuid default null
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  subscription public.subscriptions%rowtype;
  expired_subscription public.subscriptions%rowtype;
  plan_code text;
  previous_state jsonb;
  expired_count integer := 0;
begin
  perform app_private.require_service_role();
  perform pg_catalog.set_config('app.subscription_lifecycle_context', 'allowed', true);
  for subscription in
    select * from public.subscriptions
    where status = 'active'::public.subscription_status
      and ends_at <= evaluated_at
    order by ends_at
    for update
  loop
    select code into plan_code from public.plans where id = subscription.plan_id;
    previous_state := app_private.subscription_state(subscription, plan_code);
    update public.subscriptions
    set status = 'expired', version = version + 1
    where id = subscription.id
    returning * into expired_subscription;
    perform app_private.append_subscription_event(
      expired_subscription,
      plan_code,
      null,
      'system',
      'subscription.expired',
      previous_state,
      app_private.subscription_state(expired_subscription, plan_code),
      evaluated_at,
      null,
      'Authoritative subscription end timestamp elapsed.',
      action_request_id
    );
    perform app_private.append_entitlement_event(
      expired_subscription,
      null,
      'entitlement.expired',
      pg_catalog.jsonb_build_object('active', true, 'planCode', plan_code),
      pg_catalog.jsonb_build_object('active', false, 'planCode', null),
      evaluated_at,
      null,
      action_request_id
    );
    insert into public.audit_events (
      actor_type, action, target_type, target_id, request_id, before_state, after_state
    ) values (
      'system',
      'subscription.expired',
      'subscription',
      expired_subscription.id,
      action_request_id,
      previous_state,
      app_private.subscription_state(expired_subscription, plan_code)
    );
    perform app_private.queue_payment_notification(
      expired_subscription.user_id,
      null,
      expired_subscription.id,
      'subscription-expired',
      'subscription:' || expired_subscription.id::text || ':expired:' || expired_subscription.version::text,
      pg_catalog.jsonb_build_object('planCode', plan_code, 'endsAt', expired_subscription.ends_at)
    );
    expired_count := expired_count + 1;
  end loop;
  return expired_count;
end;
$$;

revoke all on function public.start_payment_review(uuid, uuid, integer, uuid)
  from public, anon, authenticated;
revoke all on function public.request_payment_information(uuid, uuid, integer, text, text, text, text, uuid)
  from public, anon, authenticated;
revoke all on function public.reject_payment_submission(uuid, uuid, integer, text, text, text, text, uuid)
  from public, anon, authenticated;
revoke all on function public.approve_payment_submission(uuid, uuid, integer, text, text, uuid)
  from public, anon, authenticated;
revoke all on function public.record_payment_refund(uuid, uuid, integer, integer, text, timestamptz, public.payment_subscription_impact, text, text, uuid)
  from public, anon, authenticated;
revoke all on function public.reverse_payment_approval(uuid, uuid, integer, text, text, uuid)
  from public, anon, authenticated;
revoke all on function public.correct_subscription(uuid, uuid, integer, timestamptz, timestamptz, text, text, boolean, uuid)
  from public, anon, authenticated;
revoke all on function public.expire_subscriptions(timestamptz, uuid)
  from public, anon, authenticated;

grant execute on function public.start_payment_review(uuid, uuid, integer, uuid) to service_role;
grant execute on function public.request_payment_information(uuid, uuid, integer, text, text, text, text, uuid) to service_role;
grant execute on function public.reject_payment_submission(uuid, uuid, integer, text, text, text, text, uuid) to service_role;
grant execute on function public.approve_payment_submission(uuid, uuid, integer, text, text, uuid) to service_role;
grant execute on function public.record_payment_refund(uuid, uuid, integer, integer, text, timestamptz, public.payment_subscription_impact, text, text, uuid) to service_role;
grant execute on function public.reverse_payment_approval(uuid, uuid, integer, text, text, uuid) to service_role;
grant execute on function public.correct_subscription(uuid, uuid, integer, timestamptz, timestamptz, text, text, boolean, uuid) to service_role;
grant execute on function public.expire_subscriptions(timestamptz, uuid) to service_role;

comment on function public.approve_payment_submission(uuid, uuid, integer, text, text, uuid) is
  'Atomic permissioned approval. It validates the review lock, canonical price, proof, reference, account, term dates, subscription, entitlement event, audit, and notification in one transaction.';
