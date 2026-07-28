-- Hanaply Phase 2: controlled payment-method administration and customer submission lifecycle.

create or replace function app_private.require_service_role()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role is required' using errcode = '42501';
  end if;
end;
$$;

create or replace function app_private.require_active_actor(actor_user_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app_private.require_service_role();
  if actor_user_id is null or not exists (
    select 1
    from public.profiles profile
    where profile.id = actor_user_id
      and profile.account_status = 'active'::public.account_status
  ) then
    raise exception 'an active account is required' using errcode = '42501';
  end if;
end;
$$;

create or replace function app_private.require_admin_actor(
  actor_user_id uuid,
  required_permission text
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app_private.require_active_actor(actor_user_id);
  if not app_private.admin_has_permission(actor_user_id, required_permission) then
    raise exception '% permission is required', required_permission using errcode = '42501';
  end if;
end;
$$;

revoke all on function app_private.require_service_role() from public, anon, authenticated;
revoke all on function app_private.require_active_actor(uuid) from public, anon, authenticated;
revoke all on function app_private.require_admin_actor(uuid, text) from public, anon, authenticated;

create or replace function app_private.payment_method_public_snapshot(
  payment_method public.payment_methods
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'displayName', payment_method.display_name,
    'methodType', payment_method.method_type,
    'currency', payment_method.currency,
    'accountHolderName', payment_method.account_holder_name,
    'accountIdentifier', payment_method.account_identifier,
    'bankName', payment_method.bank_name,
    'branchDetails', payment_method.branch_details,
    'publicInstructions', payment_method.public_instructions,
    'publicNotes', payment_method.public_notes,
    'version', payment_method.version
  );
$$;

create or replace function app_private.payment_method_admin_snapshot(
  payment_method public.payment_methods
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.payment_method_public_snapshot(payment_method) ||
    pg_catalog.jsonb_build_object(
      'enabled', payment_method.enabled,
      'displayOrder', payment_method.display_order,
      'privateNotes', payment_method.private_notes,
      'effectiveStartAt', payment_method.effective_start_at,
      'effectiveEndAt', payment_method.effective_end_at,
      'archivedAt', payment_method.archived_at,
      'minimumAmountMinor', payment_method.minimum_amount_minor,
      'maximumAmountMinor', payment_method.maximum_amount_minor,
      'hasQrCode', payment_method.qr_object_path is not null,
      'qrCodeVersion', payment_method.qr_version,
      'createdAt', payment_method.created_at,
      'updatedAt', payment_method.updated_at
    );
$$;

revoke all on function app_private.payment_method_public_snapshot(public.payment_methods)
  from public, anon, authenticated;
revoke all on function app_private.payment_method_admin_snapshot(public.payment_methods)
  from public, anon, authenticated;

create or replace function app_private.normalize_payment_reference(reference text)
returns text
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  trimmed_reference text;
  normalized_reference text;
begin
  if reference is null then
    return null;
  end if;
  trimmed_reference := pg_catalog.btrim(reference);
  if char_length(trimmed_reference) < 6 or char_length(trimmed_reference) > 100
    or trimmed_reference ~ '[[:cntrl:]]'
    or trimmed_reference !~ '^[A-Za-z0-9][A-Za-z0-9 ._:/#-]*$' then
    raise exception 'payment reference is invalid' using errcode = '22023';
  end if;
  normalized_reference := pg_catalog.upper(
    pg_catalog.regexp_replace(trimmed_reference, '[^A-Za-z0-9]', '', 'g')
  );
  if char_length(normalized_reference) < 6 or char_length(normalized_reference) > 100 then
    raise exception 'payment reference comparison value is invalid' using errcode = '22023';
  end if;
  return normalized_reference;
end;
$$;

revoke all on function app_private.normalize_payment_reference(text)
  from public, anon, authenticated;

create or replace function app_private.payment_method_is_available(
  payment_method public.payment_methods,
  amount_minor integer,
  evaluated_at timestamptz default now()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select payment_method.enabled
    and payment_method.archived_at is null
    and (payment_method.effective_start_at is null or payment_method.effective_start_at <= evaluated_at)
    and (payment_method.effective_end_at is null or payment_method.effective_end_at > evaluated_at)
    and (
      payment_method.minimum_amount_minor is null
      or amount_minor >= payment_method.minimum_amount_minor
    )
    and (
      payment_method.maximum_amount_minor is null
      or amount_minor <= payment_method.maximum_amount_minor
    );
$$;

revoke all on function app_private.payment_method_is_available(public.payment_methods, integer, timestamptz)
  from public, anon, authenticated;

create or replace function app_private.append_payment_event(
  target_submission_id uuid,
  event_actor_user_id uuid,
  event_actor_type public.audit_actor_type,
  requested_event_type text,
  old_status public.payment_submission_status,
  next_status public.payment_submission_status,
  requested_public_message text,
  requested_internal_note text,
  requested_reason_code text,
  requested_snapshot jsonb,
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
  insert into public.payment_submission_events (
    submission_id,
    actor_user_id,
    actor_type,
    event_type,
    previous_status,
    new_status,
    public_message,
    internal_note,
    reason_code,
    snapshot,
    request_id
  ) values (
    target_submission_id,
    event_actor_user_id,
    event_actor_type,
    requested_event_type,
    old_status,
    next_status,
    requested_public_message,
    requested_internal_note,
    requested_reason_code,
    coalesce(requested_snapshot, '{}'::jsonb),
    requested_request_id
  ) returning id into event_id;
  return event_id;
end;
$$;

revoke all on function app_private.append_payment_event(uuid, uuid, public.audit_actor_type, text, public.payment_submission_status, public.payment_submission_status, text, text, text, jsonb, uuid)
  from public, anon, authenticated;

create or replace function app_private.queue_payment_notification(
  target_user_id uuid,
  target_submission_id uuid,
  target_subscription_id uuid,
  requested_template_id text,
  requested_idempotency_key text,
  requested_variables jsonb
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  notification_id uuid;
begin
  insert into public.payment_notifications (
    user_id,
    payment_submission_id,
    subscription_id,
    template_id,
    idempotency_key,
    variables
  ) values (
    target_user_id,
    target_submission_id,
    target_subscription_id,
    requested_template_id,
    requested_idempotency_key,
    coalesce(requested_variables, '{}'::jsonb)
  )
  on conflict (idempotency_key) do update set
    idempotency_key = excluded.idempotency_key
  returning id into notification_id;
  return notification_id;
end;
$$;

revoke all on function app_private.queue_payment_notification(uuid, uuid, uuid, text, text, jsonb)
  from public, anon, authenticated;

create or replace function public.admin_create_payment_method(
  actor_user_id uuid,
  requested_method jsonb,
  action_request_id uuid default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  payment_method public.payment_methods%rowtype;
begin
  perform app_private.require_admin_actor(actor_user_id, 'payment_methods.manage');
  if requested_method is null or jsonb_typeof(requested_method) <> 'object' then
    raise exception 'payment method input is invalid' using errcode = '22023';
  end if;
  perform pg_catalog.set_config('app.payment_lifecycle_context', 'allowed', true);

  insert into public.payment_methods (
    display_name,
    method_type,
    enabled,
    display_order,
    currency,
    account_holder_name,
    account_identifier,
    bank_name,
    branch_details,
    public_instructions,
    public_notes,
    private_notes,
    effective_start_at,
    effective_end_at,
    minimum_amount_minor,
    maximum_amount_minor,
    created_by,
    updated_by
  ) values (
    pg_catalog.btrim(requested_method ->> 'displayName'),
    (requested_method ->> 'methodType')::public.payment_method_type,
    coalesce((requested_method ->> 'enabled')::boolean, false),
    coalesce((requested_method ->> 'displayOrder')::integer, 0),
    coalesce(requested_method ->> 'currency', 'PHP'),
    nullif(pg_catalog.btrim(requested_method ->> 'accountHolderName'), ''),
    nullif(pg_catalog.btrim(requested_method ->> 'accountIdentifier'), ''),
    nullif(pg_catalog.btrim(requested_method ->> 'bankName'), ''),
    nullif(pg_catalog.btrim(requested_method ->> 'branchDetails'), ''),
    pg_catalog.btrim(requested_method ->> 'publicInstructions'),
    nullif(pg_catalog.btrim(requested_method ->> 'publicNotes'), ''),
    nullif(pg_catalog.btrim(requested_method ->> 'privateNotes'), ''),
    nullif(requested_method ->> 'effectiveStartAt', '')::timestamptz,
    nullif(requested_method ->> 'effectiveEndAt', '')::timestamptz,
    nullif(requested_method ->> 'minimumAmountMinor', '')::integer,
    nullif(requested_method ->> 'maximumAmountMinor', '')::integer,
    actor_user_id,
    actor_user_id
  ) returning * into payment_method;

  insert into public.payment_method_versions (
    payment_method_id, version, change_type, snapshot, changed_by, request_id
  ) values (
    payment_method.id,
    payment_method.version,
    'created',
    app_private.payment_method_admin_snapshot(payment_method),
    actor_user_id,
    action_request_id
  );

  insert into public.audit_events (
    actor_user_id, actor_type, action, target_type, target_id, request_id, after_state
  ) values (
    actor_user_id,
    'admin',
    'payment_method.created',
    'payment_method',
    payment_method.id,
    action_request_id,
    pg_catalog.jsonb_build_object(
      'displayName', payment_method.display_name,
      'methodType', payment_method.method_type,
      'enabled', payment_method.enabled,
      'version', payment_method.version
    )
  );

  return payment_method.id;
end;
$$;

create or replace function public.admin_update_payment_method(
  actor_user_id uuid,
  target_payment_method_id uuid,
  expected_version integer,
  requested_method jsonb,
  action_request_id uuid default null
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  previous_method public.payment_methods%rowtype;
  updated_method public.payment_methods%rowtype;
begin
  perform app_private.require_admin_actor(actor_user_id, 'payment_methods.manage');
  select * into previous_method
  from public.payment_methods
  where id = target_payment_method_id
  for update;
  if not found then
    raise exception 'payment method was not found' using errcode = 'P0002';
  end if;
  if previous_method.version <> expected_version then
    raise exception 'payment method version conflict' using errcode = '40001';
  end if;
  if previous_method.archived_at is not null then
    raise exception 'archived payment methods cannot be edited' using errcode = '22023';
  end if;
  perform pg_catalog.set_config('app.payment_lifecycle_context', 'allowed', true);

  update public.payment_methods
  set display_name = pg_catalog.btrim(requested_method ->> 'displayName'),
      method_type = (requested_method ->> 'methodType')::public.payment_method_type,
      enabled = coalesce((requested_method ->> 'enabled')::boolean, false),
      display_order = coalesce((requested_method ->> 'displayOrder')::integer, 0),
      currency = coalesce(requested_method ->> 'currency', 'PHP'),
      account_holder_name = nullif(pg_catalog.btrim(requested_method ->> 'accountHolderName'), ''),
      account_identifier = nullif(pg_catalog.btrim(requested_method ->> 'accountIdentifier'), ''),
      bank_name = nullif(pg_catalog.btrim(requested_method ->> 'bankName'), ''),
      branch_details = nullif(pg_catalog.btrim(requested_method ->> 'branchDetails'), ''),
      public_instructions = pg_catalog.btrim(requested_method ->> 'publicInstructions'),
      public_notes = nullif(pg_catalog.btrim(requested_method ->> 'publicNotes'), ''),
      private_notes = nullif(pg_catalog.btrim(requested_method ->> 'privateNotes'), ''),
      effective_start_at = nullif(requested_method ->> 'effectiveStartAt', '')::timestamptz,
      effective_end_at = nullif(requested_method ->> 'effectiveEndAt', '')::timestamptz,
      minimum_amount_minor = nullif(requested_method ->> 'minimumAmountMinor', '')::integer,
      maximum_amount_minor = nullif(requested_method ->> 'maximumAmountMinor', '')::integer,
      updated_by = actor_user_id,
      version = version + 1
  where id = target_payment_method_id
  returning * into updated_method;

  insert into public.payment_method_versions (
    payment_method_id, version, change_type, snapshot, changed_by, request_id
  ) values (
    updated_method.id,
    updated_method.version,
    'updated',
    app_private.payment_method_admin_snapshot(updated_method),
    actor_user_id,
    action_request_id
  );

  insert into public.audit_events (
    actor_user_id, actor_type, action, target_type, target_id, request_id, before_state, after_state
  ) values (
    actor_user_id,
    'admin',
    'payment_method.updated',
    'payment_method',
    updated_method.id,
    action_request_id,
    pg_catalog.jsonb_build_object(
      'displayName', previous_method.display_name,
      'methodType', previous_method.method_type,
      'enabled', previous_method.enabled,
      'version', previous_method.version
    ),
    pg_catalog.jsonb_build_object(
      'displayName', updated_method.display_name,
      'methodType', updated_method.method_type,
      'enabled', updated_method.enabled,
      'version', updated_method.version
    )
  );
  return updated_method.version;
end;
$$;

create or replace function public.admin_set_payment_method_state(
  actor_user_id uuid,
  target_payment_method_id uuid,
  expected_version integer,
  requested_action text,
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
  previous_method public.payment_methods%rowtype;
  updated_method public.payment_methods%rowtype;
begin
  perform app_private.require_admin_actor(actor_user_id, 'payment_methods.manage');
  if requested_action not in ('enable', 'disable', 'archive') then
    raise exception 'payment method action is invalid' using errcode = '22023';
  end if;
  if action_reason is null or char_length(pg_catalog.btrim(action_reason)) not between 10 and 500 then
    raise exception 'a reason between 10 and 500 characters is required' using errcode = '22023';
  end if;
  select * into previous_method
  from public.payment_methods
  where id = target_payment_method_id
  for update;
  if not found then
    raise exception 'payment method was not found' using errcode = 'P0002';
  end if;
  if previous_method.version <> expected_version then
    raise exception 'payment method version conflict' using errcode = '40001';
  end if;
  if previous_method.archived_at is not null then
    raise exception 'payment method is already archived' using errcode = '22023';
  end if;
  perform pg_catalog.set_config('app.payment_lifecycle_context', 'allowed', true);

  update public.payment_methods
  set enabled = case
        when requested_action = 'enable' then true
        else false
      end,
      archived_at = case
        when requested_action = 'archive' then now()
        else archived_at
      end,
      updated_by = actor_user_id,
      version = version + 1
  where id = target_payment_method_id
  returning * into updated_method;

  insert into public.payment_method_versions (
    payment_method_id, version, change_type, snapshot, changed_by, request_id
  ) values (
    updated_method.id,
    updated_method.version,
    requested_action,
    app_private.payment_method_admin_snapshot(updated_method),
    actor_user_id,
    action_request_id
  );

  insert into public.audit_events (
    actor_user_id, actor_type, action, target_type, target_id, request_id,
    before_state, after_state, metadata
  ) values (
    actor_user_id,
    'admin',
    'payment_method.' || case when requested_action = 'enable' then 'enabled' when requested_action = 'disable' then 'disabled' else 'archived' end,
    'payment_method',
    updated_method.id,
    action_request_id,
    pg_catalog.jsonb_build_object(
      'enabled', previous_method.enabled,
      'archived', previous_method.archived_at is not null,
      'version', previous_method.version
    ),
    pg_catalog.jsonb_build_object(
      'enabled', updated_method.enabled,
      'archived', updated_method.archived_at is not null,
      'version', updated_method.version
    ),
    pg_catalog.jsonb_build_object('reason', pg_catalog.btrim(action_reason))
  );
  return updated_method.version;
end;
$$;

create or replace function public.admin_attach_payment_method_qr(
  actor_user_id uuid,
  target_payment_method_id uuid,
  requested_object_path text,
  requested_mime_type text,
  requested_checksum_sha256 text,
  requested_size_bytes integer,
  requested_width integer,
  requested_height integer,
  action_request_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  previous_method public.payment_methods%rowtype;
  updated_method public.payment_methods%rowtype;
begin
  perform app_private.require_admin_actor(actor_user_id, 'payment_methods.manage');
  select * into previous_method
  from public.payment_methods
  where id = target_payment_method_id
  for update;
  if not found then
    raise exception 'payment method was not found' using errcode = 'P0002';
  end if;
  if previous_method.archived_at is not null then
    raise exception 'archived payment methods cannot receive a QR code' using errcode = '22023';
  end if;
  if requested_object_path is null
    or char_length(requested_object_path) not between 10 and 300
    or requested_object_path ~ '(^|/)\.\.(/|$)'
    or requested_mime_type not in ('image/jpeg', 'image/png', 'image/webp')
    or requested_checksum_sha256 !~ '^[a-f0-9]{64}$'
    or requested_size_bytes not between 1 and 5242880
    or requested_width not between 1 and 12000
    or requested_height not between 1 and 12000 then
    raise exception 'QR image metadata is invalid' using errcode = '22023';
  end if;
  perform pg_catalog.set_config('app.payment_lifecycle_context', 'allowed', true);

  update public.payment_methods
  set qr_object_path = requested_object_path,
      qr_mime_type = requested_mime_type,
      qr_checksum_sha256 = requested_checksum_sha256,
      qr_size_bytes = requested_size_bytes,
      qr_width = requested_width,
      qr_height = requested_height,
      qr_version = qr_version + 1,
      version = version + 1,
      updated_by = actor_user_id
  where id = target_payment_method_id
  returning * into updated_method;

  insert into public.payment_method_versions (
    payment_method_id, version, change_type, snapshot, changed_by, request_id
  ) values (
    updated_method.id,
    updated_method.version,
    'qr_replaced',
    app_private.payment_method_admin_snapshot(updated_method),
    actor_user_id,
    action_request_id
  );

  insert into public.audit_events (
    actor_user_id, actor_type, action, target_type, target_id, request_id,
    before_state, after_state
  ) values (
    actor_user_id,
    'admin',
    'payment_method.updated',
    'payment_method',
    updated_method.id,
    action_request_id,
    pg_catalog.jsonb_build_object(
      'hasQrCode', previous_method.qr_object_path is not null,
      'qrCodeVersion', previous_method.qr_version,
      'version', previous_method.version
    ),
    pg_catalog.jsonb_build_object(
      'hasQrCode', true,
      'qrCodeVersion', updated_method.qr_version,
      'version', updated_method.version
    )
  );

  return pg_catalog.jsonb_build_object(
    'paymentMethodId', updated_method.id,
    'version', updated_method.version,
    'replacedObjectPath', previous_method.qr_object_path
  );
end;
$$;

create or replace function public.queue_storage_cleanup(
  requested_bucket_id text,
  requested_object_path text,
  requested_reason text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  job_id uuid;
begin
  perform app_private.require_service_role();
  insert into app_private.storage_cleanup_jobs (bucket_id, object_path, reason)
  values (requested_bucket_id, requested_object_path, requested_reason)
  on conflict (bucket_id, object_path, status) do update set reason = excluded.reason
  returning id into job_id;
  return job_id;
end;
$$;

create or replace function public.create_payment_draft(
  actor_user_id uuid,
  draft_input jsonb,
  action_request_id uuid default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  selected_plan public.plans%rowtype;
  selected_method public.payment_methods%rowtype;
  draft_id uuid;
  original_reference text;
  normalized_reference text;
begin
  perform app_private.require_active_actor(actor_user_id);
  if draft_input is null or jsonb_typeof(draft_input) <> 'object' then
    raise exception 'payment draft input is invalid' using errcode = '22023';
  end if;

  select * into selected_plan
  from public.plans
  where code = draft_input ->> 'planCode'
    and active
  for share;
  if not found then
    raise exception 'selected plan is unavailable' using errcode = '22023';
  end if;
  select * into selected_method
  from public.payment_methods
  where id = (draft_input ->> 'paymentMethodId')::uuid
  for share;
  if not found or not app_private.payment_method_is_available(selected_method, selected_plan.price_minor) then
    raise exception 'selected payment method is unavailable' using errcode = '22023';
  end if;

  original_reference := nullif(pg_catalog.btrim(draft_input ->> 'referenceNumber'), '');
  normalized_reference := app_private.normalize_payment_reference(original_reference);
  perform pg_catalog.set_config('app.payment_lifecycle_context', 'allowed', true);

  insert into public.payment_submissions (
    user_id,
    plan_id,
    billing_period,
    quoted_amount_minor,
    currency,
    payment_method_id,
    payment_method_snapshot,
    payment_method_version,
    original_reference,
    normalized_reference,
    paid_at,
    user_note
  ) values (
    actor_user_id,
    selected_plan.id,
    selected_plan.billing_period,
    selected_plan.price_minor,
    selected_plan.currency,
    selected_method.id,
    app_private.payment_method_public_snapshot(selected_method),
    selected_method.version,
    original_reference,
    normalized_reference,
    nullif(draft_input ->> 'paidAt', '')::timestamptz,
    nullif(pg_catalog.btrim(draft_input ->> 'userNote'), '')
  ) returning id into draft_id;

  perform app_private.append_payment_event(
    draft_id,
    actor_user_id,
    'user',
    'payment_submission.draft_created',
    null,
    'draft',
    null,
    null,
    null,
    pg_catalog.jsonb_build_object(
      'planCode', selected_plan.code,
      'billingPeriod', selected_plan.billing_period,
      'quotedAmountMinor', selected_plan.price_minor,
      'paymentMethodVersion', selected_method.version
    ),
    action_request_id
  );

  insert into public.audit_events (
    actor_user_id, actor_type, action, target_type, target_id, request_id, after_state
  ) values (
    actor_user_id,
    'user',
    'payment_submission.draft_created',
    'payment_submission',
    draft_id,
    action_request_id,
    pg_catalog.jsonb_build_object('status', 'draft')
  );
  return draft_id;
end;
$$;

create or replace function public.update_payment_draft(
  actor_user_id uuid,
  target_submission_id uuid,
  expected_version integer,
  draft_input jsonb,
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
  selected_plan public.plans%rowtype;
  selected_method public.payment_methods%rowtype;
  next_plan_code text;
  next_method_id uuid;
  next_original_reference text;
  next_normalized_reference text;
  next_paid_at timestamptz;
  next_user_note text;
  next_information_response text;
begin
  perform app_private.require_active_actor(actor_user_id);
  select * into payment
  from public.payment_submissions
  where id = target_submission_id
  for update;
  if not found or payment.user_id <> actor_user_id then
    raise exception 'payment submission was not found' using errcode = 'P0002';
  end if;
  if payment.version <> expected_version then
    raise exception 'payment submission version conflict' using errcode = '40001';
  end if;
  if payment.status not in ('draft', 'needs_information') then
    raise exception 'payment submission cannot be edited in its current state' using errcode = '22023';
  end if;
  if payment.status = 'needs_information'
    and (draft_input ? 'planCode' or draft_input ? 'paymentMethodId') then
    raise exception 'plan and payment method are immutable after review starts' using errcode = '22023';
  end if;

  select code into next_plan_code from public.plans where id = payment.plan_id;
  next_plan_code := coalesce(nullif(draft_input ->> 'planCode', ''), next_plan_code);
  next_method_id := coalesce(
    nullif(draft_input ->> 'paymentMethodId', '')::uuid,
    payment.payment_method_id
  );
  select * into selected_plan
  from public.plans
  where code = next_plan_code and active
  for share;
  if not found then
    raise exception 'selected plan is unavailable' using errcode = '22023';
  end if;
  select * into selected_method
  from public.payment_methods
  where id = next_method_id
  for share;
  if not found or not app_private.payment_method_is_available(selected_method, selected_plan.price_minor) then
    raise exception 'selected payment method is unavailable' using errcode = '22023';
  end if;

  next_original_reference := case
    when draft_input ? 'referenceNumber' then nullif(pg_catalog.btrim(draft_input ->> 'referenceNumber'), '')
    else payment.original_reference
  end;
  next_normalized_reference := app_private.normalize_payment_reference(next_original_reference);
  next_paid_at := case
    when draft_input ? 'paidAt' then nullif(draft_input ->> 'paidAt', '')::timestamptz
    else payment.paid_at
  end;
  next_user_note := case
    when draft_input ? 'userNote' then nullif(pg_catalog.btrim(draft_input ->> 'userNote'), '')
    else payment.user_note
  end;
  next_information_response := case
    when draft_input ? 'informationResponse' then nullif(pg_catalog.btrim(draft_input ->> 'informationResponse'), '')
    else payment.information_response
  end;
  perform pg_catalog.set_config('app.payment_lifecycle_context', 'allowed', true);

  update public.payment_submissions
  set plan_id = selected_plan.id,
      billing_period = selected_plan.billing_period,
      quoted_amount_minor = selected_plan.price_minor,
      currency = selected_plan.currency,
      payment_method_id = selected_method.id,
      payment_method_snapshot = case
        when status = 'draft' then app_private.payment_method_public_snapshot(selected_method)
        else payment_method_snapshot
      end,
      payment_method_version = case
        when status = 'draft' then selected_method.version
        else payment_method_version
      end,
      original_reference = next_original_reference,
      normalized_reference = next_normalized_reference,
      paid_at = next_paid_at,
      user_note = next_user_note,
      information_response = next_information_response,
      version = version + 1
  where id = target_submission_id
  returning version into expected_version;

  return expected_version;
end;
$$;

create or replace function public.attach_payment_proof(
  actor_user_id uuid,
  target_submission_id uuid,
  requested_object_path text,
  requested_checksum_sha256 text,
  requested_mime_type text,
  requested_size_bytes integer,
  requested_original_filename text,
  requested_width integer,
  requested_height integer,
  requested_scan_status text default 'not_configured',
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
  previous_file public.payment_submission_files%rowtype;
  new_file public.payment_submission_files%rowtype;
  matched_file public.payment_submission_files%rowtype;
  event_type text;
begin
  perform app_private.require_active_actor(actor_user_id);
  select * into payment
  from public.payment_submissions
  where id = target_submission_id
  for update;
  if not found or payment.user_id <> actor_user_id then
    raise exception 'payment submission was not found' using errcode = 'P0002';
  end if;
  if payment.status not in ('draft', 'needs_information') then
    raise exception 'proof cannot be replaced in the current state' using errcode = '22023';
  end if;
  if requested_object_path is null
    or char_length(requested_object_path) not between 10 and 300
    or requested_object_path ~ '(^|/)\.\.(/|$)'
    or requested_checksum_sha256 !~ '^[a-f0-9]{64}$'
    or requested_mime_type not in ('image/jpeg', 'image/png', 'image/webp')
    or requested_size_bytes not between 1 and 8388608
    or char_length(requested_original_filename) not between 1 and 120
    or requested_width not between 1 and 12000
    or requested_height not between 1 and 12000
    or requested_scan_status not in ('not_configured', 'pending', 'clean') then
    raise exception 'payment proof metadata is invalid' using errcode = '22023';
  end if;

  if payment.proof_file_id is not null then
    select * into previous_file
    from public.payment_submission_files
    where id = payment.proof_file_id
    for update;
  end if;
  perform pg_catalog.set_config('app.payment_lifecycle_context', 'allowed', true);

  if previous_file.id is not null then
    update public.payment_submission_files
    set active = false, replaced_at = now()
    where id = previous_file.id;
  end if;

  insert into public.payment_submission_files (
    submission_id,
    uploaded_by,
    object_path,
    checksum_sha256,
    mime_type,
    size_bytes,
    original_filename,
    width,
    height,
    scan_status
  ) values (
    payment.id,
    actor_user_id,
    requested_object_path,
    requested_checksum_sha256,
    requested_mime_type,
    requested_size_bytes,
    requested_original_filename,
    requested_width,
    requested_height,
    requested_scan_status
  ) returning * into new_file;

  select * into matched_file
  from public.payment_submission_files candidate
  where candidate.id <> new_file.id
    and candidate.checksum_sha256 = new_file.checksum_sha256
  order by candidate.created_at desc
  limit 1;

  if matched_file.id is not null then
    insert into public.payment_review_flags (
      submission_id, flag_type, matched_submission_id, warning, details
    ) values (
      payment.id,
      'duplicate_proof',
      matched_file.submission_id,
      'This proof matches another submission. Review it carefully before approving.',
      pg_catalog.jsonb_build_object(
        'matchedSubmissionStatus', (
          select status from public.payment_submissions where id = matched_file.submission_id
        ),
        'sameSubmission', matched_file.submission_id = payment.id
      )
    );
  end if;

  update public.payment_submissions
  set proof_file_id = new_file.id,
      duplicate_proof = matched_file.id is not null,
      version = version + 1
  where id = payment.id;

  event_type := case
    when previous_file.id is null then 'payment_submission.proof_uploaded'
    else 'payment_submission.proof_replaced'
  end;
  perform app_private.append_payment_event(
    payment.id,
    actor_user_id,
    'user',
    event_type,
    payment.status,
    payment.status,
    null,
    null,
    null,
    pg_catalog.jsonb_build_object(
      'proofFileId', new_file.id,
      'previousProofFileId', previous_file.id,
      'previousChecksum', previous_file.checksum_sha256,
      'mimeType', new_file.mime_type,
      'sizeBytes', new_file.size_bytes
    ),
    action_request_id
  );

  insert into public.audit_events (
    actor_user_id, actor_type, action, target_type, target_id, request_id, metadata
  ) values (
    actor_user_id,
    'user',
    event_type,
    'payment_submission',
    payment.id,
    action_request_id,
    pg_catalog.jsonb_build_object(
      'proofFileId', new_file.id,
      'mimeType', new_file.mime_type,
      'sizeBytes', new_file.size_bytes,
      'duplicateFlag', matched_file.id is not null
    )
  );

  return pg_catalog.jsonb_build_object(
    'fileId', new_file.id,
    'version', payment.version + 1,
    'replacedObjectPath', previous_file.object_path
  );
end;
$$;

create or replace function app_private.refresh_reference_duplicate_flag(
  target_submission_id uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  payment public.payment_submissions%rowtype;
  matched_payment public.payment_submissions%rowtype;
begin
  select * into payment from public.payment_submissions where id = target_submission_id;
  if payment.normalized_reference is null then
    return false;
  end if;
  select * into matched_payment
  from public.payment_submissions candidate
  where candidate.id <> payment.id
    and candidate.payment_method_id = payment.payment_method_id
    and candidate.normalized_reference = payment.normalized_reference
    and candidate.status not in ('cancelled', 'expired')
  order by
    case when candidate.status in ('approved', 'refunded', 'reversed') then 0 else 1 end,
    candidate.created_at desc
  limit 1;
  if matched_payment.id is not null then
    insert into public.payment_review_flags (
      submission_id, flag_type, matched_submission_id, warning, details
    ) values (
      payment.id,
      'duplicate_reference',
      matched_payment.id,
      'This reference matches another submission. Review it carefully before approving.',
      pg_catalog.jsonb_build_object(
        'matchedSubmissionStatus', matched_payment.status,
        'sameUser', matched_payment.user_id = payment.user_id,
        'sameAmount', matched_payment.quoted_amount_minor = payment.quoted_amount_minor,
        'samePaymentDate', matched_payment.paid_at::date = payment.paid_at::date
      )
    );
  end if;
  update public.payment_submissions
  set duplicate_reference = matched_payment.id is not null
  where id = payment.id;
  return matched_payment.id is not null;
end;
$$;

revoke all on function app_private.refresh_reference_duplicate_flag(uuid)
  from public, anon, authenticated;

create or replace function public.submit_payment_submission(
  actor_user_id uuid,
  target_submission_id uuid,
  expected_version integer,
  declaration_accepted boolean,
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
  selected_plan public.plans%rowtype;
  selected_method public.payment_methods%rowtype;
  duplicate_reference_found boolean;
begin
  perform app_private.require_active_actor(actor_user_id);
  select * into payment
  from public.payment_submissions
  where id = target_submission_id
  for update;
  if not found or payment.user_id <> actor_user_id then
    raise exception 'payment submission was not found' using errcode = 'P0002';
  end if;
  if payment.version <> expected_version then
    raise exception 'payment submission version conflict' using errcode = '40001';
  end if;
  if payment.status <> 'draft' then
    raise exception 'only a draft can be submitted' using errcode = '22023';
  end if;
  if not declaration_accepted then
    raise exception 'payment declaration is required' using errcode = '22023';
  end if;
  if payment.original_reference is null or payment.normalized_reference is null
    or payment.paid_at is null or payment.proof_file_id is null then
    raise exception 'reference, payment time, and proof are required' using errcode = '22023';
  end if;
  if payment.paid_at > now() + interval '10 minutes' then
    raise exception 'payment time cannot be in the future' using errcode = '22023';
  end if;
  select * into selected_plan from public.plans where id = payment.plan_id for share;
  select * into selected_method from public.payment_methods where id = payment.payment_method_id for share;
  if not selected_plan.active
    or selected_plan.price_minor <> payment.quoted_amount_minor
    or selected_plan.currency <> payment.currency
    or selected_plan.billing_period <> payment.billing_period then
    raise exception 'canonical plan price changed; review the draft again' using errcode = '40001';
  end if;
  if selected_method.version <> payment.payment_method_version
    or not app_private.payment_method_is_available(selected_method, selected_plan.price_minor) then
    raise exception 'payment method instructions changed or are unavailable' using errcode = '40001';
  end if;
  if not exists (
    select 1 from public.payment_submission_files proof
    where proof.id = payment.proof_file_id
      and proof.submission_id = payment.id
      and proof.active
      and proof.scan_status <> 'rejected'
  ) then
    raise exception 'payment proof is unavailable' using errcode = '22023';
  end if;
  perform pg_catalog.set_config('app.payment_lifecycle_context', 'allowed', true);
  duplicate_reference_found := app_private.refresh_reference_duplicate_flag(payment.id);

  update public.payment_submissions
  set status = 'submitted',
      submitted_at = now(),
      declaration_accepted_at = now(),
      duplicate_reference = duplicate_reference_found,
      version = version + 1
  where id = payment.id;

  perform app_private.append_payment_event(
    payment.id,
    actor_user_id,
    'user',
    'payment_submission.submitted',
    'draft',
    'submitted',
    null,
    null,
    null,
    pg_catalog.jsonb_build_object(
      'quotedAmountMinor', payment.quoted_amount_minor,
      'currency', payment.currency,
      'duplicateReferenceFlag', duplicate_reference_found,
      'duplicateProofFlag', payment.duplicate_proof
    ),
    action_request_id
  );

  insert into public.audit_events (
    actor_user_id, actor_type, action, target_type, target_id, request_id,
    before_state, after_state, metadata
  ) values (
    actor_user_id,
    'user',
    'payment_submission.submitted',
    'payment_submission',
    payment.id,
    action_request_id,
    pg_catalog.jsonb_build_object('status', 'draft'),
    pg_catalog.jsonb_build_object('status', 'submitted'),
    pg_catalog.jsonb_build_object(
      'duplicateReferenceFlag', duplicate_reference_found,
      'duplicateProofFlag', payment.duplicate_proof
    )
  );

  perform app_private.queue_payment_notification(
    payment.user_id,
    payment.id,
    null,
    'payment-submission-received',
    'payment:' || payment.id::text || ':submitted:' || (payment.version + 1)::text,
    pg_catalog.jsonb_build_object(
      'planCode', selected_plan.code,
      'amountMinor', payment.quoted_amount_minor,
      'currency', payment.currency
    )
  );
  return payment.version + 1;
end;
$$;

create or replace function public.cancel_payment_submission(
  actor_user_id uuid,
  target_submission_id uuid,
  expected_version integer,
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
  proof public.payment_submission_files%rowtype;
  cleanup_path text;
begin
  perform app_private.require_active_actor(actor_user_id);
  select * into payment
  from public.payment_submissions
  where id = target_submission_id
  for update;
  if not found or payment.user_id <> actor_user_id then
    raise exception 'payment submission was not found' using errcode = 'P0002';
  end if;
  if payment.version <> expected_version then
    raise exception 'payment submission version conflict' using errcode = '40001';
  end if;
  if payment.status not in ('draft', 'submitted', 'needs_information') then
    raise exception 'payment submission cannot be cancelled in its current state' using errcode = '22023';
  end if;
  perform pg_catalog.set_config('app.payment_lifecycle_context', 'allowed', true);
  if payment.status = 'draft' and payment.proof_file_id is not null then
    select * into proof
    from public.payment_submission_files
    where id = payment.proof_file_id
    for update;
    if proof.id is not null then
      update public.payment_submission_files
      set active = false, replaced_at = now()
      where id = proof.id;
      cleanup_path := proof.object_path;
    end if;
  end if;
  update public.payment_submissions
  set status = 'cancelled',
      proof_file_id = case when status = 'draft' then null else proof_file_id end,
      review_lock_expires_at = null,
      version = version + 1
  where id = payment.id;

  perform app_private.append_payment_event(
    payment.id,
    actor_user_id,
    'user',
    'payment_submission.cancelled',
    payment.status,
    'cancelled',
    null,
    null,
    null,
    '{}'::jsonb,
    action_request_id
  );
  insert into public.audit_events (
    actor_user_id, actor_type, action, target_type, target_id, request_id,
    before_state, after_state
  ) values (
    actor_user_id,
    'user',
    'payment_submission.cancelled',
    'payment_submission',
    payment.id,
    action_request_id,
    pg_catalog.jsonb_build_object('status', payment.status),
    pg_catalog.jsonb_build_object('status', 'cancelled')
  );
  return pg_catalog.jsonb_build_object(
    'version', payment.version + 1,
    'cleanupObjectPath', cleanup_path
  );
end;
$$;

create or replace function public.resubmit_payment_submission(
  actor_user_id uuid,
  target_submission_id uuid,
  expected_version integer,
  requested_response text,
  declaration_accepted boolean,
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
  duplicate_reference_found boolean;
begin
  perform app_private.require_active_actor(actor_user_id);
  select * into payment
  from public.payment_submissions
  where id = target_submission_id
  for update;
  if not found or payment.user_id <> actor_user_id then
    raise exception 'payment submission was not found' using errcode = 'P0002';
  end if;
  if payment.version <> expected_version then
    raise exception 'payment submission version conflict' using errcode = '40001';
  end if;
  if payment.status <> 'needs_information' then
    raise exception 'payment is not waiting for more information' using errcode = '22023';
  end if;
  if not declaration_accepted
    or requested_response is null
    or char_length(pg_catalog.btrim(requested_response)) not between 1 and 2000 then
    raise exception 'a declared response is required' using errcode = '22023';
  end if;
  if payment.original_reference is null or payment.paid_at is null or payment.proof_file_id is null then
    raise exception 'reference, payment time, and proof are required' using errcode = '22023';
  end if;
  perform pg_catalog.set_config('app.payment_lifecycle_context', 'allowed', true);
  duplicate_reference_found := app_private.refresh_reference_duplicate_flag(payment.id);

  update public.payment_submissions
  set status = 'resubmitted',
      information_response = pg_catalog.btrim(requested_response),
      declaration_accepted_at = now(),
      public_review_message = null,
      duplicate_reference = duplicate_reference_found,
      version = version + 1
  where id = payment.id;

  perform app_private.append_payment_event(
    payment.id,
    actor_user_id,
    'user',
    'payment_submission.resubmitted',
    'needs_information',
    'resubmitted',
    pg_catalog.btrim(requested_response),
    null,
    null,
    pg_catalog.jsonb_build_object(
      'previousReference', payment.original_reference,
      'previousProofFileId', payment.proof_file_id,
      'duplicateReferenceFlag', duplicate_reference_found,
      'duplicateProofFlag', payment.duplicate_proof
    ),
    action_request_id
  );
  insert into public.audit_events (
    actor_user_id, actor_type, action, target_type, target_id, request_id,
    before_state, after_state
  ) values (
    actor_user_id,
    'user',
    'payment_submission.resubmitted',
    'payment_submission',
    payment.id,
    action_request_id,
    pg_catalog.jsonb_build_object('status', 'needs_information'),
    pg_catalog.jsonb_build_object('status', 'resubmitted')
  );
  perform app_private.queue_payment_notification(
    payment.user_id,
    payment.id,
    null,
    'payment-resubmitted',
    'payment:' || payment.id::text || ':resubmitted:' || (payment.version + 1)::text,
    '{}'::jsonb
  );
  return payment.version + 1;
end;
$$;

revoke all on function public.admin_create_payment_method(uuid, jsonb, uuid)
  from public, anon, authenticated;
revoke all on function public.admin_update_payment_method(uuid, uuid, integer, jsonb, uuid)
  from public, anon, authenticated;
revoke all on function public.admin_set_payment_method_state(uuid, uuid, integer, text, text, uuid)
  from public, anon, authenticated;
revoke all on function public.admin_attach_payment_method_qr(uuid, uuid, text, text, text, integer, integer, integer, uuid)
  from public, anon, authenticated;
revoke all on function public.queue_storage_cleanup(text, text, text)
  from public, anon, authenticated;
revoke all on function public.create_payment_draft(uuid, jsonb, uuid)
  from public, anon, authenticated;
revoke all on function public.update_payment_draft(uuid, uuid, integer, jsonb, uuid)
  from public, anon, authenticated;
revoke all on function public.attach_payment_proof(uuid, uuid, text, text, text, integer, text, integer, integer, text, uuid)
  from public, anon, authenticated;
revoke all on function public.submit_payment_submission(uuid, uuid, integer, boolean, uuid)
  from public, anon, authenticated;
revoke all on function public.cancel_payment_submission(uuid, uuid, integer, uuid)
  from public, anon, authenticated;
revoke all on function public.resubmit_payment_submission(uuid, uuid, integer, text, boolean, uuid)
  from public, anon, authenticated;

grant execute on function public.admin_create_payment_method(uuid, jsonb, uuid) to service_role;
grant execute on function public.admin_update_payment_method(uuid, uuid, integer, jsonb, uuid) to service_role;
grant execute on function public.admin_set_payment_method_state(uuid, uuid, integer, text, text, uuid) to service_role;
grant execute on function public.admin_attach_payment_method_qr(uuid, uuid, text, text, text, integer, integer, integer, uuid) to service_role;
grant execute on function public.queue_storage_cleanup(text, text, text) to service_role;
grant execute on function public.create_payment_draft(uuid, jsonb, uuid) to service_role;
grant execute on function public.update_payment_draft(uuid, uuid, integer, jsonb, uuid) to service_role;
grant execute on function public.attach_payment_proof(uuid, uuid, text, text, text, integer, text, integer, integer, text, uuid) to service_role;
grant execute on function public.submit_payment_submission(uuid, uuid, integer, boolean, uuid) to service_role;
grant execute on function public.cancel_payment_submission(uuid, uuid, integer, uuid) to service_role;
grant execute on function public.resubmit_payment_submission(uuid, uuid, integer, text, boolean, uuid) to service_role;

comment on function public.submit_payment_submission(uuid, uuid, integer, boolean, uuid) is
  'Submits a complete proof-backed payment for review. It never creates a subscription or grants an entitlement.';
