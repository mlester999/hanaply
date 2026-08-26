begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

create function pg_temp.operation_fails(statement text)
returns boolean
language plpgsql
as $$
begin
  execute statement;
  return false;
exception when others then
  return true;
end;
$$;

create function pg_temp.affected_rows(statement text)
returns integer
language plpgsql
as $$
declare
  affected integer;
begin
  execute statement;
  get diagnostics affected = row_count;
  return affected;
end;
$$;

select plan(51);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous
)
values
  ('00000000-0000-0000-0000-000000000000', '80000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'payment-owner@hanaply.test', crypt('PaymentOwner1', gen_salt('bf')), now(), '{}', '{}', now(), now(), false, false),
  ('00000000-0000-0000-0000-000000000000', '80000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'payment-other@hanaply.test', crypt('PaymentOther1', gen_salt('bf')), now(), '{}', '{}', now(), now(), false, false),
  ('00000000-0000-0000-0000-000000000000', '80000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'payment-reviewer@hanaply.test', crypt('PaymentReviewer1', gen_salt('bf')), now(), '{}', '{}', now(), now(), false, false),
  ('00000000-0000-0000-0000-000000000000', '80000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'payment-reader@hanaply.test', crypt('PaymentReader1', gen_salt('bf')), now(), '{}', '{}', now(), now(), false, false),
  ('00000000-0000-0000-0000-000000000000', '80000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'payment-suspended@hanaply.test', crypt('PaymentSuspended1', gen_salt('bf')), now(), '{}', '{}', now(), now(), false, false);

update public.profiles
set account_status = 'suspended'
where id = '80000000-0000-4000-8000-000000000005';

insert into public.admin_memberships (user_id, status, created_by)
values
  ('80000000-0000-4000-8000-000000000003', 'active', '80000000-0000-4000-8000-000000000003'),
  ('80000000-0000-4000-8000-000000000004', 'active', '80000000-0000-4000-8000-000000000003');
insert into public.admin_role_assignments (admin_user_id, role_id, assigned_by)
select '80000000-0000-4000-8000-000000000003', id, '80000000-0000-4000-8000-000000000003'
from public.admin_roles where code = 'super_admin';
insert into public.admin_role_assignments (admin_user_id, role_id, assigned_by)
select '80000000-0000-4000-8000-000000000004', id, '80000000-0000-4000-8000-000000000003'
from public.admin_roles where code = 'read_only_analyst';

create temporary table phase2_privacy_ids (key text primary key, value uuid not null);
grant all on table phase2_privacy_ids to service_role;
grant select on table phase2_privacy_ids to authenticated;

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into phase2_privacy_ids (key, value)
select 'method', public.admin_create_payment_method(
  '80000000-0000-4000-8000-000000000003',
  '{
    "displayName":"Private Test GCash",
    "methodType":"gcash",
    "enabled":true,
    "displayOrder":20,
    "currency":"PHP",
    "accountHolderName":"Hanaply Private Test",
    "accountIdentifier":"0917 111 1111 TEST ONLY",
    "bankName":null,
    "branchDetails":null,
    "publicInstructions":"Use fictional local fixtures only.",
    "publicNotes":"Privacy test method.",
    "privateNotes":"Never expose this operations note.",
    "effectiveStartAt":null,
    "effectiveEndAt":null,
    "minimumAmountMinor":49900,
    "maximumAmountMinor":959900
  }'::jsonb,
  gen_random_uuid()
);

select public.admin_attach_payment_method_qr(
  '80000000-0000-4000-8000-000000000003',
  (select value from phase2_privacy_ids where key = 'method'),
  'qr/private-test-gcash.png',
  'image/png',
  repeat('a', 64),
  128,
  24,
  24,
  gen_random_uuid()
);

insert into phase2_privacy_ids (key, value)
select 'owner-payment', public.create_payment_draft(
  '80000000-0000-4000-8000-000000000001',
  jsonb_build_object(
    'planCode', 'plus_monthly',
    'paymentMethodId', (select value from phase2_privacy_ids where key = 'method'),
    'referenceNumber', 'OWNER-REF-123456',
    'paidAt', now() - interval '10 minutes',
    'userNote', 'Fictional owner proof.'
  ),
  gen_random_uuid()
);
select public.attach_payment_proof(
  '80000000-0000-4000-8000-000000000001',
  (select value from phase2_privacy_ids where key = 'owner-payment'),
  '80000000-0000-4000-8000-000000000001/owner-proof.png',
  repeat('b', 64),
  'image/png',
  256,
  'owner-proof.png',
  32,
  32,
  'clean',
  gen_random_uuid()
);
select public.submit_payment_submission(
  '80000000-0000-4000-8000-000000000001',
  (select value from phase2_privacy_ids where key = 'owner-payment'),
  1,
  true,
  gen_random_uuid()
);
select public.start_payment_review(
  '80000000-0000-4000-8000-000000000003',
  (select value from phase2_privacy_ids where key = 'owner-payment'),
  2,
  gen_random_uuid()
);
select public.approve_payment_submission(
  '80000000-0000-4000-8000-000000000003',
  (select value from phase2_privacy_ids where key = 'owner-payment'),
  3,
  'Approved fictional privacy test payment.',
  'Private reviewer note must stay server-side.',
  gen_random_uuid()
);

insert into phase2_privacy_ids (key, value)
select 'other-payment', public.create_payment_draft(
  '80000000-0000-4000-8000-000000000002',
  jsonb_build_object(
    'planCode', 'plus_monthly',
    'paymentMethodId', (select value from phase2_privacy_ids where key = 'method'),
    'referenceNumber', 'OTHER-REF-654321',
    'paidAt', now() - interval '5 minutes'
  ),
  gen_random_uuid()
);
select public.attach_payment_proof(
  '80000000-0000-4000-8000-000000000002',
  (select value from phase2_privacy_ids where key = 'other-payment'),
  '80000000-0000-4000-8000-000000000002/other-proof.png',
  repeat('c', 64),
  'image/png',
  256,
  'other-proof.png',
  32,
  32,
  'clean',
  gen_random_uuid()
);

insert into storage.objects (bucket_id, name, owner_id, metadata)
values
  ('payment-proofs', '80000000-0000-4000-8000-000000000001/owner-proof.png', '80000000-0000-4000-8000-000000000001', '{"mimetype":"image/png","size":256}'),
  ('payment-proofs', '80000000-0000-4000-8000-000000000002/other-proof.png', '80000000-0000-4000-8000-000000000002', '{"mimetype":"image/png","size":256}'),
  ('payment-qr-codes', 'qr/private-test-gcash.png', null, '{"mimetype":"image/png","size":128}');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"80000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '80000000-0000-4000-8000-000000000001', true);

select is((select count(*)::integer from public.payment_methods), 1, 'active customer sees only enabled current payment methods');
select ok(pg_temp.operation_fails($statement$select private_notes from public.payment_methods$statement$), 'customer cannot select private payment-method notes');
select ok(pg_temp.operation_fails($statement$select qr_object_path from public.payment_methods$statement$), 'customer cannot select private QR object paths');
select is((select count(*)::integer from public.payment_submissions), 1, 'customer sees only their payment submission');
select is((select count(*)::integer from public.payment_submissions where id = (select value from phase2_privacy_ids where key = 'other-payment')), 0, 'cross-user submission read is denied');
select ok(pg_temp.operation_fails($statement$select normalized_reference from public.payment_submissions$statement$), 'normalized fraud-comparison references are not customer-readable');
select ok(pg_temp.operation_fails($statement$select internal_review_note from public.payment_submissions$statement$), 'private reviewer notes are not customer-readable');
select ok(pg_temp.operation_fails($statement$select duplicate_proof from public.payment_submissions$statement$), 'private review warnings are not customer-readable');
select is((select count(*)::integer from public.payment_submission_files), 1, 'customer sees metadata for only their proof');
select ok(pg_temp.operation_fails($statement$select object_path from public.payment_submission_files$statement$), 'proof storage paths are not customer-readable');
select ok(pg_temp.operation_fails($statement$select scan_status from public.payment_submission_files$statement$), 'proof scan state remains server-side');
select ok((select count(*) > 0 from public.payment_submission_events), 'customer sees public lifecycle history for their submission');
select ok(pg_temp.operation_fails($statement$select internal_note from public.payment_submission_events$statement$), 'event internal notes are not customer-readable');
select ok(pg_temp.operation_fails($statement$select snapshot from public.payment_submission_events$statement$), 'event private snapshots are not customer-readable');
select is((select count(*)::integer from public.subscriptions), 1, 'customer sees their activated subscription');
select ok(pg_temp.operation_fails($statement$select activation_metadata from public.subscriptions$statement$), 'subscription activation metadata remains private');
select ok((select count(*) >= 2 from public.subscription_events), 'customer sees their public subscription history');
select ok(pg_temp.operation_fails($statement$select previous_state from public.subscription_events$statement$), 'subscription event state snapshots remain private');
select ok(pg_temp.operation_fails($statement$select * from public.payment_review_flags$statement$), 'customer cannot read review flags');
select ok(pg_temp.operation_fails($statement$select * from public.payment_review_assignments$statement$), 'customer cannot read reviewer assignments');
select ok(pg_temp.operation_fails($statement$select * from public.payment_notifications$statement$), 'customer cannot read notification outbox records');
select ok(pg_temp.operation_fails($statement$select public.mark_payment_notification_delivery(gen_random_uuid(), 'delivered', '', '', 1)$statement$), 'legacy unrestricted notification mutation is unavailable');
select ok(pg_temp.operation_fails($statement$select * from public.entitlement_events$statement$), 'customer cannot read private entitlement events');
select ok(pg_temp.operation_fails($statement$update public.payment_submissions set status = 'approved'$statement$), 'customer cannot mutate payment state directly');
select ok(pg_temp.operation_fails($statement$select public.resolve_payment_proof_object(auth.uid(), (select value from phase2_privacy_ids where key = 'owner-payment'), false)$statement$), 'customer cannot call private object resolver directly');
select is((select count(*)::integer from storage.objects where bucket_id = 'payment-proofs'), 0, 'private proof bucket cannot be listed directly');
select is((select count(*)::integer from storage.objects where bucket_id = 'payment-proofs' and name = '80000000-0000-4000-8000-000000000001/owner-proof.png'), 0, 'guessed owner proof path cannot be read directly');
select ok(pg_temp.operation_fails($statement$insert into storage.objects (bucket_id, name) values ('payment-proofs', 'guessed/upload.png')$statement$), 'customer cannot upload directly to private proof storage');

select set_config('request.jwt.claims', '{"sub":"80000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '80000000-0000-4000-8000-000000000002', true);
select is((select count(*)::integer from public.payment_submissions), 1, 'second customer sees only their own draft');
select is((select count(*)::integer from public.payment_submission_files), 1, 'second customer sees only their own proof metadata');
select is((select count(*)::integer from public.subscriptions), 0, 'second customer cannot see the owner subscription');
select is((select count(*)::integer from public.subscription_events), 0, 'second customer cannot see owner subscription events');

select set_config('request.jwt.claims', '{"sub":"80000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '80000000-0000-4000-8000-000000000003', true);
select is((select count(*)::integer from public.payment_submissions), 0, 'administrator JWT receives no direct review-queue table access');
select ok(pg_temp.operation_fails($statement$select * from public.payment_method_versions$statement$), 'administrator JWT cannot directly inspect method history');

select set_config('request.jwt.claims', '{"sub":"80000000-0000-4000-8000-000000000005","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '80000000-0000-4000-8000-000000000005', true);
select is((select count(*)::integer from public.payment_methods), 0, 'suspended account cannot read payment instructions');
select is((select count(*)::integer from public.payment_submissions), 0, 'suspended account cannot read payment submissions');
select is((select count(*)::integer from public.payment_submission_files), 0, 'suspended account cannot read proof metadata');
select is((select count(*)::integer from public.payment_submission_events), 0, 'suspended account cannot read payment events');
select is((select count(*)::integer from public.subscription_events), 0, 'suspended account cannot read subscription events');

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is(
  (select object_path from public.resolve_payment_proof_object('80000000-0000-4000-8000-000000000001', (select value from phase2_privacy_ids where key = 'owner-payment'), false)),
  '80000000-0000-4000-8000-000000000001/owner-proof.png',
  'server resolves an owner proof only after owner authorization'
);
select ok(
  pg_temp.operation_fails($statement$select * from public.resolve_payment_proof_object('80000000-0000-4000-8000-000000000002', (select value from phase2_privacy_ids where key = 'owner-payment'), false)$statement$),
  'server denies cross-user proof resolution'
);
select is(
  (select object_path from public.resolve_payment_proof_object('80000000-0000-4000-8000-000000000003', (select value from phase2_privacy_ids where key = 'owner-payment'), true)),
  '80000000-0000-4000-8000-000000000001/owner-proof.png',
  'payments.review administrator can resolve a proof for review'
);
select ok(
  pg_temp.operation_fails($statement$select * from public.resolve_payment_proof_object('80000000-0000-4000-8000-000000000004', (select value from phase2_privacy_ids where key = 'owner-payment'), true)$statement$),
  'read-only payment administrator cannot resolve review proofs'
);
select is(
  (select object_path from public.resolve_payment_method_qr_object('80000000-0000-4000-8000-000000000001', (select value from phase2_privacy_ids where key = 'method'), false)),
  'qr/private-test-gcash.png',
  'server resolves current QR object for an active customer'
);
select ok(
  pg_temp.operation_fails($statement$select * from public.resolve_payment_method_qr_object('80000000-0000-4000-8000-000000000005', (select value from phase2_privacy_ids where key = 'method'), false)$statement$),
  'server denies QR resolution for a suspended account'
);
select is(public.authorize_admin_payment_access('80000000-0000-4000-8000-000000000004', 'payments.read'), true, 'read-only administrator passes payments.read authorization');
select ok(pg_temp.operation_fails($statement$select public.authorize_admin_payment_access('80000000-0000-4000-8000-000000000004', 'payments.review')$statement$), 'read-only administrator fails payments.review authorization');
select ok(pg_temp.operation_fails($statement$select public.authorize_admin_payment_access('80000000-0000-4000-8000-000000000003', 'unknown.permission')$statement$), 'payment authorization rejects unsupported permission names');
select ok(pg_temp.operation_fails($statement$update public.payment_methods set enabled = false where id = (select value from phase2_privacy_ids where key = 'method')$statement$), 'service role cannot bypass controlled writes after lifecycle calls');

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select ok(pg_temp.operation_fails($statement$select * from public.payment_methods$statement$), 'anonymous callers cannot read payment instructions');
select is((select count(*)::integer from storage.objects where bucket_id in ('payment-proofs', 'payment-qr-codes')), 0, 'anonymous callers cannot list private payment storage');

select * from finish();
rollback;
