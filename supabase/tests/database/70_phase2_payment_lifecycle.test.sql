begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

create or replace function pg_temp.operation_fails(statement text)
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

select plan(55);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '70000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'phase2-admin@hanaply.test',
    crypt('Phase2Admin1', gen_salt('bf')), now(), '{}',
    '{"display_name":"Phase 2 Admin"}', now(), now(), false, false
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '70000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'phase2-user-a@hanaply.test',
    crypt('Phase2UserA1', gen_salt('bf')), now(), '{}',
    '{"display_name":"Payment User A"}', now(), now(), false, false
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '70000000-0000-4000-8000-000000000003',
    'authenticated', 'authenticated', 'phase2-user-b@hanaply.test',
    crypt('Phase2UserB1', gen_salt('bf')), now(), '{}',
    '{"display_name":"Payment User B"}', now(), now(), false, false
  );

insert into public.admin_memberships (user_id, status, created_by)
values (
  '70000000-0000-4000-8000-000000000001',
  'active',
  '70000000-0000-4000-8000-000000000001'
);
insert into public.admin_role_assignments (admin_user_id, role_id, assigned_by)
select
  '70000000-0000-4000-8000-000000000001',
  role.id,
  '70000000-0000-4000-8000-000000000001'
from public.admin_roles role
where role.code = 'super_admin';

create temporary table phase2_ids (key text primary key, value uuid not null);
grant all on table phase2_ids to service_role;

select has_table('public', 'payment_methods', 'payment methods table exists');
select has_table('public', 'payment_submissions', 'payment submissions table exists');
select has_table('public', 'payment_submission_files', 'payment proof metadata table exists');
select has_table('public', 'payment_submission_events', 'payment lifecycle event table exists');
select has_table('public', 'subscription_events', 'subscription lifecycle event table exists');
select has_table('public', 'entitlement_events', 'entitlement lifecycle event table exists');
select is(
  (select count(*)::integer from storage.buckets where id in ('payment-proofs', 'payment-qr-codes')),
  2,
  'both Phase 2 private buckets exist'
);
select is(
  (select count(*)::integer from storage.buckets where id in ('payment-proofs', 'payment-qr-codes') and not public),
  2,
  'both payment buckets are private'
);
select is(
  (select file_size_limit::bigint from storage.buckets where id = 'payment-proofs'),
  8388608::bigint,
  'payment proof bucket uses the documented 8 MiB limit'
);

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into phase2_ids (key, value)
select 'method', public.admin_create_payment_method(
  '70000000-0000-4000-8000-000000000001',
  '{
    "displayName":"Local Test GCash",
    "methodType":"gcash",
    "enabled":true,
    "displayOrder":10,
    "currency":"PHP",
    "accountHolderName":"Hanaply Local Test",
    "accountIdentifier":"0917 000 0000 TEST ONLY",
    "bankName":null,
    "branchDetails":null,
    "publicInstructions":"Use only fictional local test payments. No real money is accepted.",
    "publicNotes":"Local automated test method.",
    "privateNotes":"Fictional test configuration.",
    "effectiveStartAt":null,
    "effectiveEndAt":null,
    "minimumAmountMinor":49900,
    "maximumAmountMinor":959900
  }'::jsonb,
  gen_random_uuid()
);

select ok((select value is not null from phase2_ids where key = 'method'), 'authorized admin creates a payment method');
select is((select count(*)::integer from public.payment_method_versions), 1, 'payment method creation writes version history');
select is((select count(*)::integer from public.audit_events where action = 'payment_method.created'), 1, 'payment method creation is audited');
select ok(
  pg_temp.operation_fails(
    $statement$update public.payment_methods set enabled = false where id = (select value from phase2_ids where key = 'method')$statement$
  ),
  'direct payment-method updates cannot bypass controlled functions'
);

insert into phase2_ids (key, value)
select 'payment-a', public.create_payment_draft(
  '70000000-0000-4000-8000-000000000002',
  pg_catalog.jsonb_build_object(
    'planCode', 'plus_monthly',
    'paymentMethodId', (select value from phase2_ids where key = 'method'),
    'referenceNumber', 'GCASH-A-123456',
    'paidAt', (now() - interval '5 minutes'),
    'userNote', 'Fictional local test payment.'
  ),
  gen_random_uuid()
);

select is((select status::text from public.payment_submissions where id = (select value from phase2_ids where key = 'payment-a')), 'draft', 'new payment starts as a draft');
select is((select quoted_amount_minor from public.payment_submissions where id = (select value from phase2_ids where key = 'payment-a')), 49900, 'draft quote comes from the canonical Plus monthly plan');
select is((select normalized_reference from public.payment_submissions where id = (select value from phase2_ids where key = 'payment-a')), 'GCASHA123456', 'reference comparison value is normalized');
select is((select count(*)::integer from public.subscriptions where user_id = '70000000-0000-4000-8000-000000000002'), 0, 'draft creates no subscription');
select ok(
  pg_temp.operation_fails(
    $statement$update public.payment_submissions set status = 'approved' where id = (select value from phase2_ids where key = 'payment-a')$statement$
  ),
  'direct payment status mutation is blocked even for service operations'
);

select lives_ok(
  $statement$
    select public.attach_payment_proof(
      '70000000-0000-4000-8000-000000000002',
      (select value from phase2_ids where key = 'payment-a'),
      '11111111-1111-4111-8111-111111111111/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png',
      repeat('a', 64),
      'image/png',
      1024,
      'proof-a.png',
      800,
      600,
      'clean',
      gen_random_uuid()
    )
  $statement$,
  'validated proof metadata attaches through the controlled function'
);
select is((select version from public.payment_submissions where id = (select value from phase2_ids where key = 'payment-a')), 1, 'proof attachment advances optimistic version');

select lives_ok(
  $statement$
    select public.submit_payment_submission(
      '70000000-0000-4000-8000-000000000002',
      (select value from phase2_ids where key = 'payment-a'),
      1,
      true,
      gen_random_uuid()
    )
  $statement$,
  'complete draft submits for review'
);
select is((select status::text from public.payment_submissions where id = (select value from phase2_ids where key = 'payment-a')), 'submitted', 'submitted payment enters the review queue');
select is((select count(*)::integer from public.subscriptions where user_id = '70000000-0000-4000-8000-000000000002'), 0, 'submitted payment still grants no subscription');

select lives_ok(
  $statement$
    select public.start_payment_review(
      '70000000-0000-4000-8000-000000000001',
      (select value from phase2_ids where key = 'payment-a'),
      2,
      gen_random_uuid()
    )
  $statement$,
  'payment reviewer atomically claims the submission'
);
select is((select status::text from public.payment_submissions where id = (select value from phase2_ids where key = 'payment-a')), 'under_review', 'claimed submission is under review');
select ok((select review_lock_expires_at > now() from public.payment_submissions where id = (select value from phase2_ids where key = 'payment-a')), 'review lock has a future expiration');

select lives_ok(
  $statement$
    select public.request_payment_information(
      '70000000-0000-4000-8000-000000000001',
      (select value from phase2_ids where key = 'payment-a'),
      3,
      'proof_unclear',
      'Please upload a clearer payment proof image.',
      'The first local fixture was intentionally unclear.',
      'Request clearer proof for the payment review.',
      gen_random_uuid()
    )
  $statement$,
  'reviewer can request more information with a public message'
);
select is((select status::text from public.payment_submissions where id = (select value from phase2_ids where key = 'payment-a')), 'needs_information', 'information request pauses review');

select lives_ok(
  $statement$
    select public.update_payment_draft(
      '70000000-0000-4000-8000-000000000002',
      (select value from phase2_ids where key = 'payment-a'),
      4,
      '{"referenceNumber":"GCASH-A-654321","informationResponse":"I checked the reference and replaced the proof."}'::jsonb,
      gen_random_uuid()
    )
  $statement$,
  'user can update allowed fields after an information request'
);
select ok(
  pg_temp.operation_fails(
    $statement$
      select public.update_payment_draft(
        '70000000-0000-4000-8000-000000000002',
        (select value from phase2_ids where key = 'payment-a'),
        5,
        '{"planCode":"pro_monthly"}'::jsonb,
        gen_random_uuid()
      )
    $statement$
  ),
  'plan remains immutable after review starts'
);
select lives_ok(
  $statement$
    select public.attach_payment_proof(
      '70000000-0000-4000-8000-000000000002',
      (select value from phase2_ids where key = 'payment-a'),
      '22222222-2222-4222-8222-222222222222/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.png',
      repeat('b', 64),
      'image/png',
      2048,
      'proof-a-clear.png',
      1200,
      900,
      'clean',
      gen_random_uuid()
    )
  $statement$,
  'user can replace proof after an information request'
);
select is((select count(*)::integer from public.payment_submission_files where submission_id = (select value from phase2_ids where key = 'payment-a')), 2, 'proof replacement preserves both metadata versions');
select is((select count(*)::integer from public.payment_submission_files where submission_id = (select value from phase2_ids where key = 'payment-a') and active), 1, 'only the replacement proof remains active');

select lives_ok(
  $statement$
    select public.resubmit_payment_submission(
      '70000000-0000-4000-8000-000000000002',
      (select value from phase2_ids where key = 'payment-a'),
      6,
      'I checked the reference and uploaded a clearer proof.',
      true,
      gen_random_uuid()
    )
  $statement$,
  'user can resubmit a complete response'
);
select lives_ok(
  $statement$
    select public.start_payment_review(
      '70000000-0000-4000-8000-000000000001',
      (select value from phase2_ids where key = 'payment-a'),
      7,
      gen_random_uuid()
    )
  $statement$,
  'resubmitted payment can be claimed again'
);

select lives_ok(
  $statement$
    select public.approve_payment_submission(
      '70000000-0000-4000-8000-000000000001',
      (select value from phase2_ids where key = 'payment-a'),
      8,
      'Verified the fictional local payment details.',
      'Local test approval only.',
      gen_random_uuid()
    )
  $statement$,
  'atomic approval activates a subscription'
);
select is((select status::text from public.payment_submissions where id = (select value from phase2_ids where key = 'payment-a')), 'approved', 'approved payment records final status');
select is((select count(*)::integer from public.subscriptions where user_id = '70000000-0000-4000-8000-000000000002' and status = 'active'), 1, 'approval creates exactly one active subscription');
select is(
  (
    select ends_at
    from public.subscriptions
    where user_id = '70000000-0000-4000-8000-000000000002' and status = 'active'
  ),
  (
    select starts_at + interval '1 month'
    from public.subscriptions
    where user_id = '70000000-0000-4000-8000-000000000002' and status = 'active'
  ),
  'monthly activation uses one calendar month'
);
select ok((select subscription_id is not null and approval_transaction_id is not null from public.payment_submissions where id = (select value from phase2_ids where key = 'payment-a')), 'approval atomically links transaction and subscription');
select ok((select count(*) >= 2 from public.subscription_events where user_id = '70000000-0000-4000-8000-000000000002'), 'activation writes append-only subscription events');
select is((select count(*)::integer from public.entitlement_events where user_id = '70000000-0000-4000-8000-000000000002' and event_type = 'entitlement.activated'), 1, 'activation writes an entitlement-change event');
select ok(
  pg_temp.operation_fails(
    $statement$
      select public.approve_payment_submission(
        '70000000-0000-4000-8000-000000000001',
        (select value from phase2_ids where key = 'payment-a'),
        8,
        'Attempt a forbidden duplicate approval.',
        null,
        gen_random_uuid()
      )
    $statement$
  ),
  'double approval fails safely'
);

insert into phase2_ids (key, value)
select 'renewal-a', public.create_payment_draft(
  '70000000-0000-4000-8000-000000000002',
  pg_catalog.jsonb_build_object(
    'planCode', 'plus_monthly',
    'paymentMethodId', (select value from phase2_ids where key = 'method'),
    'referenceNumber', 'GCASH-RENEW-123456',
    'paidAt', (now() - interval '3 minutes')
  ),
  gen_random_uuid()
);
select public.attach_payment_proof(
  '70000000-0000-4000-8000-000000000002',
  (select value from phase2_ids where key = 'renewal-a'),
  '33333333-3333-4333-8333-333333333333/cccccccc-cccc-4ccc-8ccc-cccccccccccc.png',
  repeat('c', 64), 'image/png', 1200, 'renewal.png', 800, 600, 'clean', gen_random_uuid()
);
select public.submit_payment_submission('70000000-0000-4000-8000-000000000002', (select value from phase2_ids where key = 'renewal-a'), 1, true, gen_random_uuid());
select public.start_payment_review('70000000-0000-4000-8000-000000000001', (select value from phase2_ids where key = 'renewal-a'), 2, gen_random_uuid());
create temporary table phase2_original_end as
select ends_at from public.subscriptions where user_id = '70000000-0000-4000-8000-000000000002' and status = 'active';
select public.approve_payment_submission(
  '70000000-0000-4000-8000-000000000001',
  (select value from phase2_ids where key = 'renewal-a'),
  3,
  'Verified the fictional renewal payment details.',
  null,
  gen_random_uuid()
);
select is(
  (select ends_at from public.subscriptions where user_id = '70000000-0000-4000-8000-000000000002' and status = 'active'),
  (select ends_at + interval '1 month' from phase2_original_end),
  'active same-plan renewal extends from the existing term end'
);
select is((select count(*)::integer from public.subscriptions where user_id = '70000000-0000-4000-8000-000000000002'), 1, 'active renewal does not create a competing subscription');

insert into phase2_ids (key, value)
select 'duplicate-reference', public.create_payment_draft(
  '70000000-0000-4000-8000-000000000003',
  pg_catalog.jsonb_build_object(
    'planCode', 'plus_monthly',
    'paymentMethodId', (select value from phase2_ids where key = 'method'),
    'referenceNumber', 'GCASH-A-654321',
    'paidAt', (now() - interval '2 minutes')
  ),
  gen_random_uuid()
);
select public.attach_payment_proof(
  '70000000-0000-4000-8000-000000000003',
  (select value from phase2_ids where key = 'duplicate-reference'),
  '44444444-4444-4444-8444-444444444444/dddddddd-dddd-4ddd-8ddd-dddddddddddd.png',
  repeat('d', 64), 'image/png', 1200, 'duplicate-reference.png', 800, 600, 'clean', gen_random_uuid()
);
select public.submit_payment_submission('70000000-0000-4000-8000-000000000003', (select value from phase2_ids where key = 'duplicate-reference'), 1, true, gen_random_uuid());
select ok((select duplicate_reference from public.payment_submissions where id = (select value from phase2_ids where key = 'duplicate-reference')), 'approved reference reuse creates a private warning flag');

insert into phase2_ids (key, value)
select 'duplicate-proof', public.create_payment_draft(
  '70000000-0000-4000-8000-000000000003',
  pg_catalog.jsonb_build_object(
    'planCode', 'plus_monthly',
    'paymentMethodId', (select value from phase2_ids where key = 'method'),
    'referenceNumber', 'GCASH-B-987654',
    'paidAt', (now() - interval '2 minutes')
  ),
  gen_random_uuid()
);
select public.attach_payment_proof(
  '70000000-0000-4000-8000-000000000003',
  (select value from phase2_ids where key = 'duplicate-proof'),
  '55555555-5555-4555-8555-555555555555/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.png',
  repeat('b', 64), 'image/png', 2048, 'duplicate-proof.png', 1200, 900, 'clean', gen_random_uuid()
);
select ok((select duplicate_proof from public.payment_submissions where id = (select value from phase2_ids where key = 'duplicate-proof')), 'proof checksum reuse creates a private warning flag');
select is((select count(*)::integer from public.payment_review_flags where submission_id = (select value from phase2_ids where key = 'duplicate-proof') and flag_type = 'duplicate_proof'), 1, 'duplicate proof flag preserves a private match record');

select lives_ok(
  $statement$
    select public.record_payment_refund(
      '70000000-0000-4000-8000-000000000001',
      (select value from phase2_ids where key = 'renewal-a'),
      4,
      49900,
      'LOCAL-REFUND-TEST',
      now(),
      'none',
      'Recorded a fictional externally completed local refund.',
      'No money moved by Hanaply.',
      gen_random_uuid()
    )
  $statement$,
  'authorized admin records an external refund without automatic transfer'
);
select is((select status::text from public.payment_submissions where id = (select value from phase2_ids where key = 'renewal-a')), 'refunded', 'refund record updates payment status');
select is((select status::text from public.subscriptions where user_id = '70000000-0000-4000-8000-000000000002'), 'active', 'refund with no subscription impact preserves access');

select lives_ok(
  $statement$
    select public.correct_subscription(
      '70000000-0000-4000-8000-000000000001',
      (select id from public.subscriptions where user_id = '70000000-0000-4000-8000-000000000002'),
      1,
      now() - interval '2 months',
      now() - interval '1 day',
      'Correct fictional test dates to exercise expiration.',
      'Local expiration test.',
      false,
      gen_random_uuid()
    )
  $statement$,
  'controlled subscription correction records before and after state'
);
select is(public.expire_subscriptions(now(), gen_random_uuid()), 1, 'expiration worker marks one elapsed active subscription');
select is((select status::text from public.subscriptions where user_id = '70000000-0000-4000-8000-000000000002'), 'expired', 'elapsed subscription loses active status');
select ok(pg_temp.operation_fails($statement$update public.subscription_events set reason = 'tampered'$statement$), 'subscription events remain append-only');

select * from finish();
rollback;
