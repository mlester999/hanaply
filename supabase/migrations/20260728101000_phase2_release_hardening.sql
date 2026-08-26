-- Hanaply Phase 2: release hardening for resubmission validation, subscription invariants,
-- notification cleanup, and draft audit evidence.

create or replace function app_private.guard_manual_subscription_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (
    (tg_op = 'INSERT' and new.source = 'manual_payment'::public.subscription_source)
    or
    (tg_op = 'UPDATE' and (
      old.source = 'manual_payment'::public.subscription_source
      or new.source = 'manual_payment'::public.subscription_source
    ))
    or
    (tg_op = 'DELETE' and old.source = 'manual_payment'::public.subscription_source)
  ) and (
    current_user <> 'postgres'
    or pg_catalog.current_setting('app.subscription_lifecycle_context', true) <> 'allowed'
  ) then
    raise exception 'manual subscriptions require a controlled lifecycle function' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE'
    and old.status = 'active'::public.subscription_status
    and new.status = 'active'::public.subscription_status
    and old.plan_id is distinct from new.plan_id
    and (
      old.source = 'manual_payment'::public.subscription_source
      or new.source = 'manual_payment'::public.subscription_source
    ) then
    raise exception 'automatic mid-cycle plan changes are not supported' using errcode = '22023';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function app_private.validate_payment_resubmission()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  selected_plan public.plans%rowtype;
  selected_method public.payment_methods%rowtype;
begin
  if old.status = 'needs_information'::public.payment_submission_status
    and new.status = 'resubmitted'::public.payment_submission_status then
    if new.original_reference is null
      or new.normalized_reference is null
      or new.paid_at is null
      or new.paid_at > now() + interval '10 minutes'
      or new.information_response is null
      or char_length(pg_catalog.btrim(new.information_response)) not between 1 and 2000
      or new.declaration_accepted_at is null then
      raise exception 'resubmitted payment details are incomplete or invalid' using errcode = '22023';
    end if;

    select * into selected_plan
    from public.plans
    where id = new.plan_id
      and active
    for share;
    if not found
      or selected_plan.billing_period <> new.billing_period
      or selected_plan.price_minor <> new.quoted_amount_minor
      or selected_plan.currency <> new.currency then
      raise exception 'canonical plan or price validation failed' using errcode = '40001';
    end if;

    select * into selected_method
    from public.payment_methods
    where id = new.payment_method_id
    for share;
    if not found
      or selected_method.version <> new.payment_method_version
      or not app_private.payment_method_is_available(selected_method, selected_plan.price_minor) then
      raise exception 'payment method instructions changed or are unavailable' using errcode = '40001';
    end if;

    if not exists (
      select 1
      from public.payment_submission_files proof
      where proof.id = new.proof_file_id
        and proof.submission_id = new.id
        and proof.active
        and proof.scan_status <> 'rejected'
    ) then
      raise exception 'payment proof is unavailable' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function app_private.validate_payment_resubmission()
  from public, anon, authenticated;

drop trigger if exists payment_submissions_validate_resubmission on public.payment_submissions;
create trigger payment_submissions_validate_resubmission
before update of status, original_reference, normalized_reference, paid_at, information_response,
  proof_file_id, declaration_accepted_at on public.payment_submissions
for each row execute function app_private.validate_payment_resubmission();

create or replace function app_private.clear_released_payment_reviewer()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status in (
    'needs_information'::public.payment_submission_status,
    'resubmitted'::public.payment_submission_status
  ) then
    new.reviewer_id := null;
    new.review_lock_expires_at := null;
    if new.status = 'resubmitted'::public.payment_submission_status
      and old.status = 'needs_information'::public.payment_submission_status then
      new.submitted_at := now();
    end if;
  end if;
  return new;
end;
$$;

revoke all on function app_private.clear_released_payment_reviewer()
  from public, anon, authenticated;

drop trigger if exists payment_submissions_clear_released_reviewer on public.payment_submissions;
create trigger payment_submissions_clear_released_reviewer
before update of status, reviewer_id, review_lock_expires_at on public.payment_submissions
for each row execute function app_private.clear_released_payment_reviewer();

create or replace function app_private.normalize_payment_proof_duplicate_flag()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.proof_file_id is distinct from old.proof_file_id then
    new.duplicate_proof := new.proof_file_id is not null and exists (
      select 1
      from public.payment_submission_files current_file
      join public.payment_submission_files candidate
        on candidate.checksum_sha256 = current_file.checksum_sha256
       and candidate.id <> current_file.id
       and candidate.submission_id <> new.id
      where current_file.id = new.proof_file_id
    );
  end if;
  return new;
end;
$$;

revoke all on function app_private.normalize_payment_proof_duplicate_flag()
  from public, anon, authenticated;

drop trigger if exists payment_submissions_normalize_proof_duplicate_flag on public.payment_submissions;
create trigger payment_submissions_normalize_proof_duplicate_flag
before update of proof_file_id, duplicate_proof on public.payment_submissions
for each row execute function app_private.normalize_payment_proof_duplicate_flag();

create or replace function app_private.prevent_same_submission_duplicate_proof_flag()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.flag_type = 'duplicate_proof'::public.payment_review_flag_type
    and new.matched_submission_id = new.submission_id then
    return null;
  end if;
  return new;
end;
$$;

revoke all on function app_private.prevent_same_submission_duplicate_proof_flag()
  from public, anon, authenticated;

drop trigger if exists payment_review_flags_skip_same_submission_proof on public.payment_review_flags;
create trigger payment_review_flags_skip_same_submission_proof
before insert on public.payment_review_flags
for each row execute function app_private.prevent_same_submission_duplicate_proof_flag();

create trigger payment_review_flags_append_only
before update or delete on public.payment_review_flags
for each row execute function app_private.prevent_financial_history_mutation();

create trigger payment_refunds_controlled_write
before insert on public.payment_refunds
for each row execute function app_private.guard_controlled_payment_write();

create or replace function app_private.validate_payment_refund()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  payment public.payment_submissions%rowtype;
begin
  select * into payment
  from public.payment_submissions
  where id = new.submission_id;
  if not found or new.refunded_at < coalesce(payment.paid_at, payment.created_at) then
    raise exception 'refund timestamp cannot precede the payment record' using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke all on function app_private.validate_payment_refund()
  from public, anon, authenticated;

drop trigger if exists payment_refunds_validate_timestamp on public.payment_refunds;
create trigger payment_refunds_validate_timestamp
before insert on public.payment_refunds
for each row execute function app_private.validate_payment_refund();

alter table app_private.storage_cleanup_jobs
  add constraint storage_cleanup_jobs_object_path_safe_check check (
    object_path !~ '(^|/)\.\.(/|$)'
    and object_path !~ '[[:cntrl:]]'
  );

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
    update public.payment_submissions
    set duplicate_reference = false
    where id = target_submission_id;
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
  current_plan_code text;
  next_plan_code text;
  next_method_id uuid;
  next_original_reference text;
  next_normalized_reference text;
  next_paid_at timestamptz;
  next_user_note text;
  next_information_response text;
  updated_version integer;
begin
  perform app_private.require_active_actor(actor_user_id);
  if draft_input is null or jsonb_typeof(draft_input) <> 'object' then
    raise exception 'payment draft input is invalid' using errcode = '22023';
  end if;
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

  select code into current_plan_code from public.plans where id = payment.plan_id;
  next_plan_code := coalesce(nullif(draft_input ->> 'planCode', ''), current_plan_code);
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
  returning version into updated_version;

  perform app_private.append_payment_event(
    payment.id,
    actor_user_id,
    'user',
    'payment_submission.draft_updated',
    payment.status,
    payment.status,
    null,
    null,
    null,
    pg_catalog.jsonb_build_object(
      'planChanged', payment.plan_id is distinct from selected_plan.id,
      'paymentMethodChanged', payment.payment_method_id is distinct from selected_method.id,
      'referenceChanged', payment.original_reference is distinct from next_original_reference,
      'paidAtChanged', payment.paid_at is distinct from next_paid_at,
      'userNoteChanged', payment.user_note is distinct from next_user_note,
      'informationResponseChanged', payment.information_response is distinct from next_information_response
    ),
    action_request_id
  );
  insert into public.audit_events (
    actor_user_id, actor_type, action, target_type, target_id, request_id,
    before_state, after_state, metadata
  ) values (
    actor_user_id,
    'user',
    'payment_submission.draft_updated',
    'payment_submission',
    payment.id,
    action_request_id,
    pg_catalog.jsonb_build_object('status', payment.status, 'version', payment.version),
    pg_catalog.jsonb_build_object('status', payment.status, 'version', updated_version),
    pg_catalog.jsonb_build_object(
      'planChanged', payment.plan_id is distinct from selected_plan.id,
      'paymentMethodChanged', payment.payment_method_id is distinct from selected_method.id,
      'referenceChanged', payment.original_reference is distinct from next_original_reference,
      'paidAtChanged', payment.paid_at is distinct from next_paid_at,
      'userNoteChanged', payment.user_note is distinct from next_user_note,
      'informationResponseChanged', payment.information_response is distinct from next_information_response
    )
  );
  return updated_version;
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
  if requested_bucket_id not in ('payment-proofs', 'payment-qr-codes')
    or requested_object_path is null
    or char_length(requested_object_path) not between 10 and 300
    or requested_object_path ~ '(^|/)\.\.(/|$)'
    or requested_object_path ~ '[[:cntrl:]]'
    or requested_reason is null
    or char_length(pg_catalog.btrim(requested_reason)) not between 3 and 120 then
    raise exception 'storage cleanup request is invalid' using errcode = '22023';
  end if;
  insert into app_private.storage_cleanup_jobs (bucket_id, object_path, reason)
  values (requested_bucket_id, requested_object_path, pg_catalog.btrim(requested_reason))
  on conflict (bucket_id, object_path, status) do update set
    reason = excluded.reason
  returning id into job_id;
  return job_id;
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
  if payment.proof_file_id is not null then
    select * into proof
    from public.payment_submission_files
    where id = payment.proof_file_id
    for update;
    if proof.id is not null and proof.active then
      update public.payment_submission_files
      set active = false, replaced_at = now()
      where id = proof.id;
      cleanup_path := proof.object_path;
    end if;
  end if;
  update public.payment_submissions
  set status = 'cancelled',
      proof_file_id = null,
      reviewer_id = null,
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
    pg_catalog.jsonb_build_object('proofRemoved', cleanup_path is not null),
    action_request_id
  );
  insert into public.audit_events (
    actor_user_id, actor_type, action, target_type, target_id, request_id,
    before_state, after_state, metadata
  ) values (
    actor_user_id,
    'user',
    'payment_submission.cancelled',
    'payment_submission',
    payment.id,
    action_request_id,
    pg_catalog.jsonb_build_object('status', payment.status),
    pg_catalog.jsonb_build_object('status', 'cancelled'),
    pg_catalog.jsonb_build_object('proofRemoved', cleanup_path is not null)
  );
  return pg_catalog.jsonb_build_object(
    'version', payment.version + 1,
    'cleanupObjectPath', cleanup_path
  );
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
    or requested_object_path ~ '[[:cntrl:]]'
    or requested_checksum_sha256 !~ '^[a-f0-9]{64}$'
    or requested_mime_type not in ('image/jpeg', 'image/png', 'image/webp')
    or requested_size_bytes not between 1 and 8388608
    or requested_original_filename is null
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
    and candidate.submission_id <> payment.id
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
        'sameSubmission', false
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

-- The claim-token workflow supersedes the older unrestricted delivery mutation.
drop function if exists public.mark_payment_notification_delivery(uuid, text, text, text, integer);

alter table app_private.storage_cleanup_jobs
  add column available_at timestamptz not null default now(),
  add column claimed_at timestamptz null,
  add column claim_token uuid null,
  add column last_attempt_at timestamptz null,
  add column completed_at timestamptz null,
  add constraint storage_cleanup_jobs_claim_pair_check check (
    (claimed_at is null and claim_token is null)
    or (claimed_at is not null and claim_token is not null)
  );

create index storage_cleanup_jobs_delivery_queue_idx
  on app_private.storage_cleanup_jobs (available_at, created_at)
  where status = 'pending'::public.storage_cleanup_status;

create or replace function public.claim_storage_cleanup_jobs(
  requested_claim_token uuid,
  requested_batch_size integer default 25
)
returns table (
  id uuid,
  bucket_id text,
  object_path text,
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
    raise exception 'storage cleanup claim input is invalid' using errcode = '22023';
  end if;
  return query
  with candidates as (
    select job.id
    from app_private.storage_cleanup_jobs job
    where job.status = 'pending'::public.storage_cleanup_status
      and job.available_at <= now()
      and (
        job.claimed_at is null
        or job.claimed_at < now() - interval '5 minutes'
      )
    order by job.created_at
    for update skip locked
    limit requested_batch_size
  ), claimed as (
    update app_private.storage_cleanup_jobs job
    set claimed_at = now(),
        claim_token = requested_claim_token
    from candidates
    where job.id = candidates.id
    returning job.*
  )
  select claimed.id, claimed.bucket_id, claimed.object_path, claimed.attempts
  from claimed
  order by claimed.created_at;
end;
$$;

create or replace function public.complete_storage_cleanup_job(
  target_job_id uuid,
  requested_claim_token uuid,
  requested_status public.storage_cleanup_status,
  requested_error_code text default null
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform app_private.require_service_role();
  if requested_status not in (
      'completed'::public.storage_cleanup_status,
      'failed'::public.storage_cleanup_status
    )
    or requested_error_code is not null and char_length(pg_catalog.btrim(requested_error_code)) > 100 then
    raise exception 'storage cleanup result is invalid' using errcode = '22023';
  end if;
  update app_private.storage_cleanup_jobs
  set status = requested_status,
      last_error_code = nullif(pg_catalog.btrim(requested_error_code), ''),
      attempts = attempts + 1,
      last_attempt_at = now(),
      completed_at = now(),
      claimed_at = null,
      claim_token = null
  where id = target_job_id
    and claim_token = requested_claim_token
    and status = 'pending'::public.storage_cleanup_status;
  return found;
end;
$$;

create or replace function public.release_storage_cleanup_job(
  target_job_id uuid,
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
    raise exception 'storage cleanup retry timestamp is invalid' using errcode = '22023';
  end if;
  update app_private.storage_cleanup_jobs
  set available_at = greatest(retry_at, now()),
      attempts = attempts + 1,
      last_attempt_at = now(),
      claimed_at = null,
      claim_token = null
  where id = target_job_id
    and claim_token = requested_claim_token
    and status = 'pending'::public.storage_cleanup_status;
  return found;
end;
$$;

revoke all on function app_private.guard_manual_subscription_write() from public, anon, authenticated;
revoke all on function public.update_payment_draft(uuid, uuid, integer, jsonb, uuid)
  from public, anon, authenticated;
revoke all on function public.claim_storage_cleanup_jobs(uuid, integer)
  from public, anon, authenticated;
revoke all on function public.complete_storage_cleanup_job(uuid, uuid, public.storage_cleanup_status, text)
  from public, anon, authenticated;
revoke all on function public.release_storage_cleanup_job(uuid, uuid, timestamptz)
  from public, anon, authenticated;

grant execute on function public.update_payment_draft(uuid, uuid, integer, jsonb, uuid) to service_role;
grant execute on function public.claim_storage_cleanup_jobs(uuid, integer) to service_role;
grant execute on function public.complete_storage_cleanup_job(uuid, uuid, public.storage_cleanup_status, text)
  to service_role;
grant execute on function public.release_storage_cleanup_job(uuid, uuid, timestamptz) to service_role;

comment on function public.claim_storage_cleanup_jobs(uuid, integer) is
  'Claims private payment object cleanup jobs with row locking and stale-claim recovery.';
comment on function public.update_payment_draft(uuid, uuid, integer, jsonb, uuid) is
  'Updates an editable payment draft and records privacy-safe lifecycle and audit evidence.';
