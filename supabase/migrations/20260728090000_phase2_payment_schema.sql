-- Hanaply Phase 2: manual payment, review, subscription-event, and private-storage schema.

alter type public.subscription_status add value if not exists 'grace_period' after 'active';
alter type public.subscription_status add value if not exists 'refunded' after 'suspended';
alter type public.subscription_status add value if not exists 'reversed' after 'refunded';

create type public.payment_method_type as enum (
  'gcash',
  'maya',
  'bank_transfer',
  'other'
);

create type public.payment_submission_status as enum (
  'draft',
  'submitted',
  'under_review',
  'needs_information',
  'resubmitted',
  'approved',
  'rejected',
  'cancelled',
  'expired',
  'refunded',
  'reversed'
);

create type public.payment_review_flag_type as enum (
  'duplicate_reference',
  'duplicate_proof'
);

create type public.payment_subscription_impact as enum ('none', 'end_access_now');
create type public.storage_cleanup_status as enum ('pending', 'completed', 'failed');

insert into public.admin_permissions (code, description)
values
  ('payment_methods.read', 'Read configured manual payment methods and version history'),
  ('payment_methods.manage', 'Create, update, enable, disable, archive, and version payment methods')
on conflict (code) do update set description = excluded.description;

with mappings (role_code, permission_code) as (
  values
    ('super_admin', 'payment_methods.read'),
    ('super_admin', 'payment_methods.manage'),
    ('operations_administrator', 'payment_methods.read'),
    ('operations_administrator', 'payment_methods.manage'),
    ('payment_reviewer', 'payment_methods.read'),
    ('support_administrator', 'payment_methods.read'),
    ('security_administrator', 'payment_methods.read'),
    ('read_only_analyst', 'payment_methods.read')
)
insert into public.admin_role_permissions (role_id, permission_code)
select role.id, mapping.permission_code
from mappings mapping
join public.admin_roles role on role.code = mapping.role_code
on conflict do nothing;

alter table public.subscriptions
  add column version integer not null default 0 check (version >= 0);

create table public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (char_length(display_name) between 2 and 100),
  method_type public.payment_method_type not null,
  enabled boolean not null default false,
  display_order integer not null default 0 check (display_order between 0 and 10000),
  currency text not null default 'PHP' check (currency = 'PHP'),
  account_holder_name text null check (
    account_holder_name is null or char_length(account_holder_name) between 1 and 120
  ),
  account_identifier text null check (
    account_identifier is null or char_length(account_identifier) between 1 and 120
  ),
  bank_name text null check (bank_name is null or char_length(bank_name) between 1 and 120),
  branch_details text null check (
    branch_details is null or char_length(branch_details) between 1 and 300
  ),
  public_instructions text not null check (char_length(public_instructions) between 10 and 2000),
  public_notes text null check (public_notes is null or char_length(public_notes) <= 1000),
  private_notes text null check (private_notes is null or char_length(private_notes) <= 2000),
  qr_object_path text null check (
    qr_object_path is null
    or (
      char_length(qr_object_path) between 10 and 300
      and qr_object_path !~ '(^|/)\.\.(/|$)'
      and qr_object_path !~ '[[:cntrl:]]'
    )
  ),
  qr_mime_type text null check (
    qr_mime_type is null or qr_mime_type in ('image/jpeg', 'image/png', 'image/webp')
  ),
  qr_checksum_sha256 text null check (
    qr_checksum_sha256 is null or qr_checksum_sha256 ~ '^[a-f0-9]{64}$'
  ),
  qr_size_bytes integer null check (qr_size_bytes is null or qr_size_bytes > 0),
  qr_width integer null check (qr_width is null or qr_width > 0),
  qr_height integer null check (qr_height is null or qr_height > 0),
  qr_version integer not null default 0 check (qr_version >= 0),
  effective_start_at timestamptz null,
  effective_end_at timestamptz null,
  archived_at timestamptz null,
  minimum_amount_minor integer null check (minimum_amount_minor is null or minimum_amount_minor > 0),
  maximum_amount_minor integer null check (maximum_amount_minor is null or maximum_amount_minor > 0),
  version integer not null default 1 check (version > 0),
  created_by uuid null references auth.users (id) on delete set null,
  updated_by uuid null references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_end_at is null or effective_start_at is null or effective_end_at > effective_start_at),
  check (
    maximum_amount_minor is null
    or minimum_amount_minor is null
    or maximum_amount_minor >= minimum_amount_minor
  ),
  check (
    (qr_object_path is null and qr_mime_type is null and qr_checksum_sha256 is null and qr_size_bytes is null)
    or
    (qr_object_path is not null and qr_mime_type is not null and qr_checksum_sha256 is not null and qr_size_bytes is not null)
  )
);

create index payment_methods_customer_order_idx
  on public.payment_methods (display_order, display_name)
  where enabled and archived_at is null;

create table public.payment_method_versions (
  id uuid primary key default gen_random_uuid(),
  payment_method_id uuid not null references public.payment_methods (id) on delete restrict,
  version integer not null check (version > 0),
  change_type text not null check (change_type ~ '^[a-z][a-z0-9_.]{2,79}$'),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  changed_by uuid null references auth.users (id) on delete set null,
  request_id uuid null,
  created_at timestamptz not null default now(),
  unique (payment_method_id, version)
);

create table public.payment_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete restrict,
  plan_id uuid not null references public.plans (id) on delete restrict,
  billing_period public.billing_period not null,
  quoted_amount_minor integer not null check (quoted_amount_minor > 0),
  currency text not null check (currency = 'PHP'),
  payment_method_id uuid not null references public.payment_methods (id) on delete restrict,
  payment_method_snapshot jsonb not null check (jsonb_typeof(payment_method_snapshot) = 'object'),
  payment_method_version integer not null check (payment_method_version > 0),
  original_reference text null check (
    original_reference is null
    or (
      char_length(original_reference) between 6 and 100
      and original_reference !~ '[[:cntrl:]]'
    )
  ),
  normalized_reference text null check (
    normalized_reference is null or normalized_reference ~ '^[A-Z0-9]{6,100}$'
  ),
  paid_at timestamptz null,
  user_note text null check (user_note is null or char_length(user_note) <= 1000),
  information_response text null check (
    information_response is null or char_length(information_response) <= 2000
  ),
  proof_file_id uuid null,
  status public.payment_submission_status not null default 'draft',
  submitted_at timestamptz null,
  review_started_at timestamptz null,
  reviewed_at timestamptz null,
  reviewer_id uuid null references auth.users (id) on delete set null,
  review_lock_expires_at timestamptz null,
  public_review_message text null check (
    public_review_message is null or char_length(public_review_message) <= 2000
  ),
  internal_review_note text null check (
    internal_review_note is null or char_length(internal_review_note) <= 2000
  ),
  rejection_reason_code text null check (
    rejection_reason_code is null
    or rejection_reason_code in (
      'payment_not_found',
      'amount_mismatch',
      'reference_invalid',
      'proof_invalid',
      'proof_reused',
      'details_incomplete',
      'other'
    )
  ),
  approval_transaction_id uuid null unique,
  subscription_id uuid null references public.subscriptions (id) on delete restrict,
  duplicate_reference boolean not null default false,
  duplicate_proof boolean not null default false,
  declaration_accepted_at timestamptz null,
  version integer not null default 0 check (version >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    original_reference is null
    or normalized_reference is not null
  ),
  check (
    status not in ('submitted', 'under_review', 'needs_information', 'resubmitted', 'approved', 'rejected', 'refunded', 'reversed')
    or (submitted_at is not null and declaration_accepted_at is not null)
  ),
  check (
    status not in ('approved', 'refunded', 'reversed')
    or (approval_transaction_id is not null and subscription_id is not null)
  )
);

create index payment_submissions_user_created_idx
  on public.payment_submissions (user_id, created_at desc);
create index payment_submissions_review_queue_idx
  on public.payment_submissions (status, submitted_at, created_at)
  where status in ('submitted', 'resubmitted', 'under_review', 'needs_information');
create index payment_submissions_reference_match_idx
  on public.payment_submissions (payment_method_id, normalized_reference, quoted_amount_minor, paid_at)
  where normalized_reference is not null;
create unique index payment_submissions_approved_reference_idx
  on public.payment_submissions (payment_method_id, normalized_reference)
  where status in ('approved', 'refunded', 'reversed');

create table public.payment_submission_files (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.payment_submissions (id) on delete restrict,
  uploaded_by uuid not null references auth.users (id) on delete restrict,
  object_path text not null unique check (
    char_length(object_path) between 10 and 300
    and object_path !~ '(^|/)\.\.(/|$)'
    and object_path !~ '[[:cntrl:]]'
  ),
  checksum_sha256 text not null check (checksum_sha256 ~ '^[a-f0-9]{64}$'),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes integer not null check (size_bytes between 1 and 8388608),
  original_filename text not null check (char_length(original_filename) between 1 and 120),
  width integer not null check (width between 1 and 12000),
  height integer not null check (height between 1 and 12000),
  scan_status text not null default 'not_configured' check (
    scan_status in ('not_configured', 'pending', 'clean', 'rejected')
  ),
  active boolean not null default true,
  replaced_at timestamptz null,
  created_at timestamptz not null default now(),
  check ((active and replaced_at is null) or (not active and replaced_at is not null))
);

create unique index payment_submission_files_one_active_idx
  on public.payment_submission_files (submission_id)
  where active;
create index payment_submission_files_checksum_idx
  on public.payment_submission_files (checksum_sha256, created_at desc);

alter table public.payment_submissions
  add constraint payment_submissions_proof_file_fk
  foreign key (proof_file_id) references public.payment_submission_files (id) on delete restrict;

create table public.payment_submission_events (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.payment_submissions (id) on delete restrict,
  actor_user_id uuid null references auth.users (id) on delete set null,
  actor_type public.audit_actor_type not null,
  event_type text not null check (event_type ~ '^[a-z][a-z0-9_.]{2,119}$'),
  previous_status public.payment_submission_status null,
  new_status public.payment_submission_status null,
  public_message text null check (public_message is null or char_length(public_message) <= 2000),
  internal_note text null check (internal_note is null or char_length(internal_note) <= 2000),
  reason_code text null check (reason_code is null or char_length(reason_code) <= 80),
  snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(snapshot) = 'object'),
  request_id uuid null,
  created_at timestamptz not null default now()
);

create index payment_submission_events_submission_idx
  on public.payment_submission_events (submission_id, created_at, id);

create table public.payment_review_flags (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.payment_submissions (id) on delete restrict,
  flag_type public.payment_review_flag_type not null,
  matched_submission_id uuid null references public.payment_submissions (id) on delete restrict,
  warning text not null check (char_length(warning) between 10 and 500),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  resolved_at timestamptz null,
  resolved_by uuid null references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index payment_review_flags_submission_idx
  on public.payment_review_flags (submission_id, created_at desc);

create table public.payment_review_assignments (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.payment_submissions (id) on delete restrict,
  reviewer_id uuid not null references auth.users (id) on delete restrict,
  assigned_at timestamptz not null default now(),
  lock_expires_at timestamptz not null,
  released_at timestamptz null,
  release_reason text null check (release_reason is null or char_length(release_reason) <= 120),
  request_id uuid null,
  check (released_at is null or released_at >= assigned_at)
);

create unique index payment_review_assignments_one_active_idx
  on public.payment_review_assignments (submission_id)
  where released_at is null;

create table public.payment_refunds (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null unique references public.payment_submissions (id) on delete restrict,
  refunded_amount_minor integer not null check (refunded_amount_minor > 0),
  external_reference text null check (
    external_reference is null or char_length(external_reference) between 1 and 120
  ),
  refunded_at timestamptz not null,
  reason text not null check (char_length(reason) between 10 and 500),
  subscription_impact public.payment_subscription_impact not null,
  recorded_by uuid null references auth.users (id) on delete set null,
  internal_note text null check (internal_note is null or char_length(internal_note) <= 2000),
  request_id uuid null,
  created_at timestamptz not null default now()
);

create table public.subscription_events (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete restrict,
  actor_user_id uuid null references auth.users (id) on delete set null,
  actor_type public.audit_actor_type not null,
  event_type text not null check (event_type ~ '^subscription\.[a-z][a-z0-9_.]{1,99}$'),
  previous_state jsonb not null default '{}'::jsonb check (jsonb_typeof(previous_state) = 'object'),
  new_state jsonb not null default '{}'::jsonb check (jsonb_typeof(new_state) = 'object'),
  effective_at timestamptz not null,
  payment_submission_id uuid null references public.payment_submissions (id) on delete restrict,
  reason text null check (reason is null or char_length(reason) <= 500),
  request_id uuid null,
  created_at timestamptz not null default now()
);

create index subscription_events_subscription_idx
  on public.subscription_events (subscription_id, created_at, id);
create index subscription_events_user_idx
  on public.subscription_events (user_id, created_at desc);

create table public.subscription_corrections (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions (id) on delete restrict,
  corrected_by uuid null references auth.users (id) on delete set null,
  reason text not null check (char_length(reason) between 10 and 500),
  internal_note text null check (internal_note is null or char_length(internal_note) <= 2000),
  before_state jsonb not null check (jsonb_typeof(before_state) = 'object'),
  after_state jsonb not null check (jsonb_typeof(after_state) = 'object'),
  request_id uuid null,
  created_at timestamptz not null default now()
);

create table public.entitlement_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete restrict,
  subscription_id uuid not null references public.subscriptions (id) on delete restrict,
  plan_id uuid not null references public.plans (id) on delete restrict,
  actor_user_id uuid null references auth.users (id) on delete set null,
  event_type text not null check (event_type ~ '^entitlement\.[a-z][a-z0-9_.]{1,99}$'),
  previous_state jsonb not null default '{}'::jsonb check (jsonb_typeof(previous_state) = 'object'),
  new_state jsonb not null default '{}'::jsonb check (jsonb_typeof(new_state) = 'object'),
  effective_at timestamptz not null,
  payment_submission_id uuid null references public.payment_submissions (id) on delete restrict,
  request_id uuid null,
  created_at timestamptz not null default now()
);

create index entitlement_events_user_idx
  on public.entitlement_events (user_id, created_at desc);

create table public.payment_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete restrict,
  payment_submission_id uuid null references public.payment_submissions (id) on delete restrict,
  subscription_id uuid null references public.subscriptions (id) on delete restrict,
  template_id text not null check (template_id ~ '^[a-z][a-z0-9-]{2,100}$'),
  template_version text not null default 'v1' check (template_version = 'v1'),
  idempotency_key text not null unique check (idempotency_key ~ '^[A-Za-z0-9:_-]{16,255}$'),
  variables jsonb not null default '{}'::jsonb check (jsonb_typeof(variables) = 'object'),
  status text not null default 'pending' check (
    status in ('pending', 'captured', 'queued', 'delivered', 'failed', 'disabled')
  ),
  provider_message_id text null check (
    provider_message_id is null or char_length(provider_message_id) <= 200
  ),
  failure_code text null check (failure_code is null or char_length(failure_code) <= 100),
  attempts integer not null default 0 check (attempts >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table app_private.storage_cleanup_jobs (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null check (bucket_id in ('payment-proofs', 'payment-qr-codes')),
  object_path text not null check (char_length(object_path) between 10 and 300),
  reason text not null check (char_length(reason) between 3 and 120),
  status public.storage_cleanup_status not null default 'pending',
  attempts integer not null default 0 check (attempts >= 0),
  last_error_code text null check (last_error_code is null or char_length(last_error_code) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bucket_id, object_path, status)
);

revoke all on table app_private.storage_cleanup_jobs from public, anon, authenticated;

create trigger payment_methods_set_updated_at
before update on public.payment_methods
for each row execute function app_private.set_updated_at();
create trigger payment_submissions_set_updated_at
before update on public.payment_submissions
for each row execute function app_private.set_updated_at();
create trigger payment_notifications_set_updated_at
before update on public.payment_notifications
for each row execute function app_private.set_updated_at();
create trigger storage_cleanup_jobs_set_updated_at
before update on app_private.storage_cleanup_jobs
for each row execute function app_private.set_updated_at();

create or replace function app_private.prevent_financial_history_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'financial history is append-only' using errcode = '42501';
end;
$$;

revoke all on function app_private.prevent_financial_history_mutation()
  from public, anon, authenticated;

create trigger payment_method_versions_append_only
before update or delete on public.payment_method_versions
for each row execute function app_private.prevent_financial_history_mutation();
create trigger payment_submission_events_append_only
before update or delete on public.payment_submission_events
for each row execute function app_private.prevent_financial_history_mutation();
create trigger payment_review_assignments_append_only
before delete on public.payment_review_assignments
for each row execute function app_private.prevent_financial_history_mutation();
create trigger payment_refunds_append_only
before update or delete on public.payment_refunds
for each row execute function app_private.prevent_financial_history_mutation();
create trigger subscription_events_append_only
before update or delete on public.subscription_events
for each row execute function app_private.prevent_financial_history_mutation();
create trigger subscription_corrections_append_only
before update or delete on public.subscription_corrections
for each row execute function app_private.prevent_financial_history_mutation();
create trigger entitlement_events_append_only
before update or delete on public.entitlement_events
for each row execute function app_private.prevent_financial_history_mutation();

create or replace function app_private.guard_controlled_payment_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user <> 'postgres'
    or pg_catalog.current_setting('app.payment_lifecycle_context', true) <> 'allowed' then
    raise exception 'payment records require a controlled lifecycle function' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function app_private.guard_controlled_payment_write()
  from public, anon, authenticated;

create trigger payment_methods_controlled_write
before insert or update or delete on public.payment_methods
for each row execute function app_private.guard_controlled_payment_write();
create trigger payment_submissions_controlled_write
before insert or update or delete on public.payment_submissions
for each row execute function app_private.guard_controlled_payment_write();
create trigger payment_submission_files_controlled_write
before insert or update or delete on public.payment_submission_files
for each row execute function app_private.guard_controlled_payment_write();
create trigger payment_review_flags_controlled_write
before insert or update or delete on public.payment_review_flags
for each row execute function app_private.guard_controlled_payment_write();

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
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function app_private.guard_manual_subscription_write()
  from public, anon, authenticated;

create trigger subscriptions_controlled_manual_write
before insert or update or delete on public.subscriptions
for each row execute function app_private.guard_manual_subscription_write();

alter table public.payment_methods enable row level security;
alter table public.payment_methods force row level security;
alter table public.payment_method_versions enable row level security;
alter table public.payment_method_versions force row level security;
alter table public.payment_submissions enable row level security;
alter table public.payment_submissions force row level security;
alter table public.payment_submission_files enable row level security;
alter table public.payment_submission_files force row level security;
alter table public.payment_submission_events enable row level security;
alter table public.payment_submission_events force row level security;
alter table public.payment_review_flags enable row level security;
alter table public.payment_review_flags force row level security;
alter table public.payment_review_assignments enable row level security;
alter table public.payment_review_assignments force row level security;
alter table public.payment_refunds enable row level security;
alter table public.payment_refunds force row level security;
alter table public.subscription_events enable row level security;
alter table public.subscription_events force row level security;
alter table public.subscription_corrections enable row level security;
alter table public.subscription_corrections force row level security;
alter table public.entitlement_events enable row level security;
alter table public.entitlement_events force row level security;
alter table public.payment_notifications enable row level security;
alter table public.payment_notifications force row level security;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'payment-proofs',
    'payment-proofs',
    false,
    8388608,
    array['image/jpeg', 'image/png', 'image/webp']::text[]
  ),
  (
    'payment-qr-codes',
    'payment-qr-codes',
    false,
    5242880,
    array['image/jpeg', 'image/png', 'image/webp']::text[]
  )
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public.email_delivery_events drop constraint email_delivery_events_category_check;
alter table public.email_delivery_events add constraint email_delivery_events_category_check
  check (category in ('authentication', 'account', 'administrative', 'payment', 'subscription'));

comment on table public.payment_submissions is
  'A payment submission never grants access. Only the controlled atomic approval function may create or renew a subscription.';
comment on table public.payment_submission_files is
  'Private proof metadata only. Object bytes remain in the private payment-proofs bucket.';
comment on table public.subscription_events is
  'Append-only subscription lifecycle evidence used to detect and prevent entitlement drift.';
