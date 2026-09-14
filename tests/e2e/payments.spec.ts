import { testAccounts } from './accounts.js';
import { readLocalSupabaseEnvironment } from './local-supabase.js';
import { expect, onePixelPng, signIn, test } from './product.js';
import { getAuthUserByEmail, getServiceRows } from './test-data.js';

/**
 * The manual payment lifecycle, end to end: an administrator configures a
 * payment method, a member submits a reference and a proof, an administrator
 * reviews and approves it, the subscription activates, and the same submission
 * cannot be approved twice.
 *
 * The whole file is serial and it restores the catalogue at the end: another
 * spec asserts that the Activation Center says no payment method is available,
 * so a method left enabled here would break it.
 *
 * Two things this file is careful about, because both were the reason the
 * lifecycle could not be verified before:
 *
 *   - Approval is asserted from the member's side and from the database, not
 *     only from the administrator's own page. The `approve_payment_submission`
 *     function decides whether a payment activates a subscription or renews one,
 *     so the assertions read the subscription row itself — its `version` and
 *     `ends_at` — before and after the decision.
 *   - The member fixture already has an active subscription (every product
 *     fixture does), so approving this payment is a *renewal*. The named
 *     requirement is that a second approval creates no second subscription, no
 *     second subscription event, and no second entitlement grant, which is
 *     exactly what a renewal makes meaningful.
 */
test.describe.configure({ mode: 'serial' });

const methodName = 'E2E Manual Transfer';
let submissionId = '';
let paymentMethodId = '';
let memberId = '';
let subscriptionId = '';

interface SubscriptionSnapshot {
  id: string;
  status: string;
  version: number;
  ends_at: string | null;
}

/**
 * Every subscription the member owns, newest first.
 *
 * Scoped to the member on purpose: the suite's other fixtures have subscriptions
 * of their own, and a global "latest active subscription" query would let this
 * spec pass on somebody else's row.
 */
async function memberSubscriptions(): Promise<SubscriptionSnapshot[]> {
  return getServiceRows<SubscriptionSnapshot[]>(
    `/rest/v1/subscriptions?select=id,status,version,ends_at&user_id=eq.${memberId}&order=created_at.desc`,
  );
}

async function subscriptionEventCount(type: string): Promise<number> {
  const rows = await getServiceRows<{ id: string }[]>(
    `/rest/v1/subscription_events?select=id&subscription_id=eq.${subscriptionId}&event_type=eq.${type}`,
  );
  return rows.length;
}

/**
 * One row of the append-only grant record for this subscription.
 *
 * The table is `entitlement_events`, and the approval writes `entitlement.renewed`
 * when it extends an existing subscription and `entitlement.activated` when it
 * creates one. This spec's member already holds a subscription, so the renewal
 * event is the one an approval must produce — exactly one of them, and no second
 * one for a repeated approval.
 */
async function entitlementEventCount(type: string): Promise<number> {
  const rows = await getServiceRows<{ id: string }[]>(
    `/rest/v1/entitlement_events?select=id&subscription_id=eq.${subscriptionId}&event_type=eq.${type}`,
  );
  return rows.length;
}

test('an administrator configures a manual payment method', async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page, testAccounts.admin, { admin: true });
  await page.goto('/admin/payment-methods/new');
  await expect(page.getByRole('heading', { name: 'New Payment Method', level: 1 })).toBeVisible();

  await page.getByLabel('Public display name').fill(methodName);
  await page.getByLabel('Method type').selectOption('bank_transfer');
  await page.getByLabel('Display order').fill('10');
  await page.getByLabel('Enable for new customer drafts').check();
  await page.getByLabel('Account holder name').fill('Hanaply E2E Holdings');
  await page.getByLabel('Account or mobile number').fill('1234-5678-9012');
  await page.getByLabel('Bank name').fill('Local Test Bank');
  await page
    .getByLabel('Public payment instructions')
    .fill('Transfer the exact amount and submit the reference number with a screenshot.');
  await page.getByRole('button', { name: 'Create Payment Method' }).click();
  await expect(page.getByText('The payment method was created and audited.')).toBeVisible();

  await page.goto('/admin/payment-methods');
  await expect(page.getByRole('heading', { name: 'Payment Methods', level: 1 })).toBeVisible();
  // The identifier is read from the catalogue rather than from a link name, so
  // the spec does not depend on how the directory row happens to be labelled.
  const created = await getServiceRows<{ id: string }[]>(
    `/rest/v1/payment_methods?select=id&display_name=eq.${encodeURIComponent(methodName)}`,
  );
  paymentMethodId = created[0]?.id ?? '';
  expect(paymentMethodId).not.toBe('');
});

test('a member chooses a plan and a method and submits a reference with proof', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const member = await getAuthUserByEmail(testAccounts.payments.email);
  expect(member?.id, 'the payments fixture account exists').toBeTruthy();
  memberId = member?.id ?? '';
  const before = await memberSubscriptions();
  expect(before[0]?.status).toBe('active');
  subscriptionId = before[0]?.id ?? '';

  await signIn(page, testAccounts.payments);
  await page.goto('/dashboard/activation');
  await expect(page.getByRole('heading', { name: 'Activate Hanaply', level: 1 })).toBeVisible();

  // The plan catalogue is rendered from the API, not from marketing copy.
  const plans = page.getByRole('group', { name: 'Choose a Hanaply plan' });
  await expect(plans.getByRole('heading', { name: 'Plus', level: 3 })).toBeVisible();
  await expect(plans.getByRole('heading', { name: 'Pro', level: 3 })).toBeVisible();
  await expect(plans.getByRole('button', { name: /Monthly ₱499/u })).toBeVisible();
  await expect(plans.getByRole('button', { name: /Annual ₱9,599/u })).toBeVisible();

  await plans.getByRole('button', { name: /Monthly ₱499/u }).click();
  await expect(plans.getByRole('button', { name: /Monthly ₱499/u })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const methods = page.getByRole('group', { name: 'Choose a payment method' });
  await methods.getByRole('button', { name: new RegExp(methodName, 'u') }).click();

  // The review box restates what is being paid before anything is stored.
  await expect(page.getByText('Exact amount', { exact: true })).toBeVisible();
  await expect(page.getByText('₱499').first()).toBeVisible();

  await page.locator('#paymentReference-new').fill('E2E-REF-123456');
  await page.locator('input[type="datetime-local"]').first().fill('2026-09-01T10:30');
  await page.locator('input[type="file"]').first().setInputFiles({
    name: 'proof.png',
    mimeType: 'image/png',
    buffer: onePixelPng,
  });
  await page.getByRole('button', { name: 'Save Draft' }).first().click();
  await expect(
    page.getByText('Your payment draft was saved. No paid access has been granted.'),
  ).toBeVisible();

  // Submitting needs the declaration, and says so when it is missing.
  await page.getByRole('button', { name: 'Submit for Review' }).first().click();
  await expect(page.getByText('Accept the payment declaration before submitting.')).toBeVisible();

  await page
    .getByRole('checkbox', { name: /The details are accurate, the proof belongs to this payment/u })
    .first()
    .check();
  await page.getByRole('button', { name: 'Submit for Review' }).first().click();
  // The confirmation is read here because submitting the draft removes the form
  // that submitted it; before the Activation Center held the result itself, the
  // form for the new payment silently replaced it and the member was told
  // nothing at all.
  await expect(
    page.getByText('Your payment was submitted for review. Approval is not guaranteed.'),
  ).toBeVisible();

  // Submission alone changes no access: the same subscription row, unchanged.
  const after = await memberSubscriptions();
  expect(after).toEqual(before);
  await expect(
    page.locator('.activation-history-card').filter({ hasText: 'E2E-REF-123456' }).first(),
  ).toContainText('Submitted');
  await expect(page.getByRole('list', { name: 'Payment review status' }).first()).toBeVisible();
});

test('an administrator reviews the submission, approves it, and the subscription activates', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const before = await memberSubscriptions();
  expect(before[0]?.id).toBe(subscriptionId);
  const beforeEvents = await subscriptionEventCount('subscription.renewed');
  const beforeGrants = await entitlementEventCount('entitlement.renewed');
  const beforeEndsAt = Date.parse(before[0]?.ends_at ?? '');
  expect(Number.isNaN(beforeEndsAt)).toBe(false);

  await signIn(page, testAccounts.admin, { admin: true });
  await page.goto('/admin/payments?status=submitted');
  await expect(page.getByRole('heading', { name: 'Payment Reviews', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Review details' }).first()).toBeVisible();
  await page.getByRole('link', { name: 'Review details' }).first().click();
  await expect(page).toHaveURL(/\/admin\/payments\/[0-9a-f-]{36}$/u);
  submissionId = page.url().split('/').pop() ?? '';

  // The proof is inspectable before the decision is made.
  await expect(page.getByRole('heading', { name: /^Payment [0-9a-f]{8}$/u })).toBeVisible();
  await expect(page.getByText('E2E-REF-123456')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enlarge payment proof preview' })).toBeVisible();

  await page.getByRole('button', { name: 'Start Review' }).click();
  await expect(page.getByText('The review lock is assigned to you for 15 minutes.')).toBeVisible();

  await page
    .getByLabel('Approval reason')
    .fill('Proof and reference verified against the bank record.');
  await page.getByRole('button', { name: 'Approve Payment' }).click();
  await expect(page.getByText(/^Payment approved\./u)).toBeVisible();

  /*
   * The subscription activated, read from the database rather than from the
   * administrator's page.
   *
   * The member already held an active subscription, so the controlled function
   * renews that row: the same subscription identity, a higher `version`, and a
   * later `ends_at`. A second subscription row would be a defect, so the check
   * is on the count as well as on the row.
   */
  const after = await memberSubscriptions();
  expect(after).toHaveLength(before.length);
  expect(after[0]?.id).toBe(subscriptionId);
  expect(after[0]?.status).toBe('active');
  expect(after[0]?.version).toBeGreaterThan(before[0]?.version ?? 0);
  expect(Date.parse(after[0]?.ends_at ?? '')).toBeGreaterThan(beforeEndsAt);
  expect(await subscriptionEventCount('subscription.renewed')).toBe(beforeEvents + 1);
  expect(await entitlementEventCount('entitlement.renewed')).toBe(beforeGrants + 1);

  // And the member can see it.
  await signIn(page, testAccounts.payments);
  await page.goto('/dashboard');
  await expect(page.getByText('Active subscription')).toBeVisible();
  await expect(page.getByText('Subscription active')).toBeVisible();

  await signIn(page, testAccounts.admin, { admin: true });
  await page.goto('/admin/payments/' + submissionId);
  // The decision is visible on the page the reviewer lands back on, and the
  // controls for a second decision are gone. What replaces them is the
  // post-approval surface — a refund or a reversal — not another approval.
  await expect(
    page.getByText('Payment approved. Your subscription is active.').first(),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve Payment' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start Review' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Reverse incorrect approval' })).toBeVisible();
});

test('approving the same submission a second time changes nothing', async ({ page }) => {
  test.setTimeout(90_000);
  const before = await memberSubscriptions();
  const eventsBefore = await subscriptionEventCount('subscription.renewed');
  const grantsBefore = await entitlementEventCount('entitlement.renewed');
  const submissionEventsBefore = await submissionEventCount();
  expect(submissionEventsBefore).toBe(1);

  /*
   * The interface cannot be asked twice — the form is gone once the submission
   * is approved — so the second attempt is the same database function the API
   * calls, replayed with the service-role key. That is the strongest available
   * statement of "the second attempt is safe": the function refuses before any
   * write, so nothing is extended, nothing is appended, and the refusal is
   * explicit rather than silent.
   */
  const environment = readLocalSupabaseEnvironment();
  const replay = await fetch(`${environment.apiUrl}/rest/v1/rpc/approve_payment_submission`, {
    method: 'POST',
    headers: {
      apikey: environment.serviceRoleKey,
      Authorization: `Bearer ${environment.serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      actor_user_id: await adminId(),
      target_submission_id: submissionId,
      expected_version: 99,
      action_reason: 'Replay of an approval that already committed.',
      internal_note: null,
      action_request_id: null,
    }),
  });
  expect(replay.status).toBeGreaterThanOrEqual(400);
  const body = (await replay.json()) as { message?: string };
  expect(body.message ?? '').toContain('not under review');

  // Nothing moved: no second subscription, no second subscription event, no
  // second entitlement grant, and no second approved-payment event.
  const after = await memberSubscriptions();
  expect(after).toEqual(before);
  expect(await subscriptionEventCount('subscription.renewed')).toBe(eventsBefore);
  expect(await entitlementEventCount('entitlement.renewed')).toBe(grantsBefore);
  expect(await submissionEventCount()).toBe(submissionEventsBefore);

  await signIn(page, testAccounts.payments);
  await page.goto('/dashboard');
  await expect(page.getByText('Active subscription')).toBeVisible();
  await expect(page.getByText('Subscription active')).toBeVisible();
});

test('a member can never approve their own payment', async ({ page }) => {
  test.setTimeout(90_000);
  const before = await memberSubscriptions();
  const environment = readLocalSupabaseEnvironment();

  /*
   * The member asks the API to approve their own submission.
   *
   * The administrative surface is what the member would have to reach, so the
   * request is made against the real admin endpoint with the member's own
   * session — the strongest form of "cannot", because it does not depend on a
   * button being absent from a page.
   */
  const token = await memberToken(environment);
  const headers = {
    apikey: environment.publishableKey,
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  // The API under test listens on the port the Playwright configuration gives
  // it; `readLocalSupabaseEnvironment` publishes the Supabase-compatible origin.
  const api = 'http://127.0.0.1:3101';
  const rejected = await fetch(`${api}/v1/admin/payment-submissions/${submissionId}/approve`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      expectedVersion: 99,
      reason: 'The member is attempting to approve their own payment.',
      internalNote: null,
    }),
  });
  expect(rejected.status).toBeGreaterThanOrEqual(400);
  const envelope = (await rejected.json()) as { error?: { code?: string } };
  expect(['FORBIDDEN', 'AUTHENTICATION_REQUIRED', 'NOT_FOUND']).toContain(
    envelope.error?.code ?? '',
  );

  // The approval did not happen, and no access changed.
  expect(await memberSubscriptions()).toEqual(before);

  // The member's own surface offers no approval control either.
  await signIn(page, testAccounts.payments);
  await page.goto('/dashboard/activation');
  await expect(page.getByRole('button', { name: 'Approve Payment' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start Review' })).toHaveCount(0);
});

test('the payment method is archived again so the catalogue is left as it was found', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await signIn(page, testAccounts.admin, { admin: true });
  await page.goto(`/admin/payment-methods/${paymentMethodId}`);
  await page.getByLabel('Archive reason').fill('End-to-end review completed.');
  await page.getByRole('button', { name: 'Archive Payment Method' }).click();
  await expect(page.getByText('The payment method was archived and audited.')).toBeVisible();

  // The catalogue is genuinely back where it started: archiving removes the
  // method from the pool of methods a member may choose, which is the state the
  // Activation Center spec asserts. The confirmation above is the interface's
  // word for it; this is the record's.
  const archived = await getServiceRows<{ archived_at: string | null; enabled: boolean }[]>(
    `/rest/v1/payment_methods?select=archived_at,enabled&id=eq.${paymentMethodId}`,
  );
  expect(archived).toHaveLength(1);
  expect(archived[0]?.archived_at).not.toBeNull();

  // Signing out of the administrative area lands on the customer sign-in page
  // the sign-out itself redirects to, not on `/admin/login`: the session is gone
  // by then, so the protected route is no longer the destination.
  await page.getByRole('button', { name: 'Sign Out' }).first().click();
  await expect(page).toHaveURL(/\/login\?loggedOut=1$/u);
});

async function adminId(): Promise<string> {
  const admin = await getAuthUserByEmail(testAccounts.admin.email);
  if (!admin?.id) throw new Error('The admin fixture account is missing');
  return admin.id;
}

/** A real member session token, so the refusal is the API's own decision. */
async function memberToken(environment: ReturnType<typeof readLocalSupabaseEnvironment>) {
  const response = await fetch(`${environment.apiUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: environment.publishableKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: testAccounts.payments.email,
      password: testAccounts.payments.password,
    }),
  });
  const body = (await response.json()) as { access_token?: string };
  if (!body.access_token) throw new Error('The payments fixture account could not sign in');
  return body.access_token;
}

async function submissionEventCount(): Promise<number> {
  const rows = await getServiceRows<{ id: string }[]>(
    `/rest/v1/payment_submission_events?select=id&submission_id=eq.${submissionId}&event_type=eq.payment_submission.approved`,
  );
  return rows.length;
}
