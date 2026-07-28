-- Hanaply Phase 2: narrow grants, customer RLS, private storage access resolution, and service checks.

revoke all on table public.payment_methods from public, anon, authenticated;
revoke all on table public.payment_method_versions from public, anon, authenticated;
revoke all on table public.payment_submissions from public, anon, authenticated;
revoke all on table public.payment_submission_files from public, anon, authenticated;
revoke all on table public.payment_submission_events from public, anon, authenticated;
revoke all on table public.payment_review_flags from public, anon, authenticated;
revoke all on table public.payment_review_assignments from public, anon, authenticated;
revoke all on table public.payment_refunds from public, anon, authenticated;
revoke all on table public.subscription_events from public, anon, authenticated;
revoke all on table public.subscription_corrections from public, anon, authenticated;
revoke all on table public.entitlement_events from public, anon, authenticated;
revoke all on table public.payment_notifications from public, anon, authenticated;

grant select (
  id,
  display_name,
  method_type,
  display_order,
  currency,
  account_holder_name,
  account_identifier,
  bank_name,
  branch_details,
  public_instructions,
  public_notes,
  qr_version,
  effective_start_at,
  effective_end_at,
  minimum_amount_minor,
  maximum_amount_minor,
  version
) on table public.payment_methods to authenticated;

grant select (
  id,
  user_id,
  plan_id,
  billing_period,
  quoted_amount_minor,
  currency,
  payment_method_id,
  payment_method_snapshot,
  original_reference,
  paid_at,
  user_note,
  information_response,
  proof_file_id,
  status,
  submitted_at,
  review_started_at,
  reviewed_at,
  public_review_message,
  rejection_reason_code,
  subscription_id,
  declaration_accepted_at,
  version,
  created_at,
  updated_at
) on table public.payment_submissions to authenticated;

grant select (
  id,
  submission_id,
  checksum_sha256,
  mime_type,
  size_bytes,
  original_filename,
  width,
  height,
  created_at
) on table public.payment_submission_files to authenticated;

grant select (
  id,
  submission_id,
  event_type,
  previous_status,
  new_status,
  public_message,
  created_at
) on table public.payment_submission_events to authenticated;

grant select (
  id,
  subscription_id,
  user_id,
  event_type,
  effective_at,
  reason,
  created_at
) on table public.subscription_events to authenticated;

grant select (
  id,
  user_id,
  plan_id,
  status,
  starts_at,
  ends_at,
  source,
  version,
  created_at,
  updated_at
) on table public.subscriptions to authenticated;

grant all privileges on table public.payment_methods to service_role;
grant all privileges on table public.payment_method_versions to service_role;
grant all privileges on table public.payment_submissions to service_role;
grant all privileges on table public.payment_submission_files to service_role;
grant all privileges on table public.payment_submission_events to service_role;
grant all privileges on table public.payment_review_flags to service_role;
grant all privileges on table public.payment_review_assignments to service_role;
grant all privileges on table public.payment_refunds to service_role;
grant all privileges on table public.subscription_events to service_role;
grant all privileges on table public.subscription_corrections to service_role;
grant all privileges on table public.entitlement_events to service_role;
grant all privileges on table public.payment_notifications to service_role;

create policy payment_methods_select_enabled_for_active_accounts
on public.payment_methods
for select
to authenticated
using (
  enabled
  and archived_at is null
  and (effective_start_at is null or effective_start_at <= now())
  and (effective_end_at is null or effective_end_at > now())
  and (select app_private.is_account_active())
);

create policy payment_submissions_select_own_active_account
on public.payment_submissions
for select
to authenticated
using (
  user_id = (select auth.uid())
  and (select app_private.is_account_active())
);

create policy payment_submission_files_select_own_active_account
on public.payment_submission_files
for select
to authenticated
using (
  (select app_private.is_account_active())
  and exists (
    select 1
    from public.payment_submissions payment
    where payment.id = payment_submission_files.submission_id
      and payment.user_id = (select auth.uid())
  )
);

create policy payment_submission_events_select_own_active_account
on public.payment_submission_events
for select
to authenticated
using (
  (select app_private.is_account_active())
  and exists (
    select 1
    from public.payment_submissions payment
    where payment.id = payment_submission_events.submission_id
      and payment.user_id = (select auth.uid())
  )
);

create policy subscription_events_select_own_active_account
on public.subscription_events
for select
to authenticated
using (
  user_id = (select auth.uid())
  and (select app_private.is_account_active())
);

create or replace function public.authorize_admin_payment_access(
  actor_user_id uuid,
  required_permission text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app_private.require_service_role();
  if required_permission not in (
    'payments.read',
    'payments.review',
    'payment_methods.read',
    'payment_methods.manage',
    'subscriptions.read',
    'subscriptions.manage',
    'audit.read'
  ) then
    raise exception 'unsupported payment permission' using errcode = '22023';
  end if;
  if not app_private.admin_has_permission(actor_user_id, required_permission) then
    raise exception '% permission is required', required_permission using errcode = '42501';
  end if;
  return true;
end;
$$;

create or replace function public.resolve_payment_proof_object(
  actor_user_id uuid,
  target_submission_id uuid,
  administrator_access boolean default false
)
returns table (
  bucket_id text,
  object_path text,
  mime_type text,
  original_filename text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app_private.require_service_role();
  if administrator_access then
    perform app_private.require_admin_actor(actor_user_id, 'payments.review');
  else
    perform app_private.require_active_actor(actor_user_id);
    if not exists (
      select 1 from public.payment_submissions payment
      where payment.id = target_submission_id and payment.user_id = actor_user_id
    ) then
      raise exception 'payment proof was not found' using errcode = 'P0002';
    end if;
  end if;

  return query
  select
    'payment-proofs'::text,
    proof.object_path,
    proof.mime_type,
    proof.original_filename
  from public.payment_submissions payment
  join public.payment_submission_files proof on proof.id = payment.proof_file_id
  where payment.id = target_submission_id
    and proof.active;
  if not found then
    raise exception 'payment proof was not found' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.resolve_payment_method_qr_object(
  actor_user_id uuid,
  target_payment_method_id uuid,
  administrator_access boolean default false
)
returns table (
  bucket_id text,
  object_path text,
  mime_type text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app_private.require_service_role();
  if administrator_access then
    perform app_private.require_admin_actor(actor_user_id, 'payment_methods.read');
  else
    perform app_private.require_active_actor(actor_user_id);
  end if;
  return query
  select 'payment-qr-codes'::text, method.qr_object_path, method.qr_mime_type
  from public.payment_methods method
  where method.id = target_payment_method_id
    and method.qr_object_path is not null
    and (
      administrator_access
      or (
        method.enabled
        and method.archived_at is null
        and (method.effective_start_at is null or method.effective_start_at <= now())
        and (method.effective_end_at is null or method.effective_end_at > now())
      )
    );
  if not found then
    raise exception 'payment method QR code was not found' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.mark_payment_notification_delivery(
  target_notification_id uuid,
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
      attempts = requested_attempts
  where id = target_notification_id;
  return found;
end;
$$;

revoke all on function public.authorize_admin_payment_access(uuid, text)
  from public, anon, authenticated;
revoke all on function public.resolve_payment_proof_object(uuid, uuid, boolean)
  from public, anon, authenticated;
revoke all on function public.resolve_payment_method_qr_object(uuid, uuid, boolean)
  from public, anon, authenticated;
revoke all on function public.mark_payment_notification_delivery(uuid, text, text, text, integer)
  from public, anon, authenticated;

grant execute on function public.authorize_admin_payment_access(uuid, text) to service_role;
grant execute on function public.resolve_payment_proof_object(uuid, uuid, boolean) to service_role;
grant execute on function public.resolve_payment_method_qr_object(uuid, uuid, boolean) to service_role;
grant execute on function public.mark_payment_notification_delivery(uuid, text, text, text, integer)
  to service_role;

-- Storage objects are written and signed only by the server-side service client. No anon or
-- authenticated policy is created for either payment bucket, so direct upload, listing, and read
-- requests fail even when a caller guesses a randomized object path.

comment on function public.resolve_payment_proof_object(uuid, uuid, boolean) is
  'Returns a private object path only to the service role after owner or payments.review authorization. The path must never be returned as display data or written to audit events.';
comment on policy payment_submission_events_select_own_active_account on public.payment_submission_events is
  'Customers can read public lifecycle messages for only their own submissions. Internal notes and event snapshots have no authenticated column grant.';
