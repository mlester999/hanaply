import AxeBuilder from '@axe-core/playwright';

import { expect, test, type Page } from './browser-health.js';
import { testAccounts } from './accounts.js';
import { clearMailbox, firstActionLink, waitForEmail } from './mailpit.js';
import { getAuthUserByEmail, getServiceRows } from './test-data.js';

const requiredWidths = [1600, 1440, 1280, 1024, 768, 430, 390, 360] as const;
const replacementPassword = 'Hanaply-New-Recovery-2026!';
let clientAddressSequence = 10;

test.describe.configure({ mode: 'serial' });

async function signIn(
  page: Page,
  account: { email: string; password: string },
  options: { admin?: boolean; expected?: string | RegExp | false } = {},
): Promise<void> {
  // The serial suite represents independent browsers, not a brute-force burst from one address.
  await page.context().setExtraHTTPHeaders({
    'x-forwarded-for': `192.0.2.${clientAddressSequence++}`,
  });
  await page.goto(options.admin ? '/admin/login' : '/login');
  await page.getByLabel('Email address').fill(account.email);
  await page.locator('input[name="password"]').fill(account.password);
  await page.getByRole('button', { name: options.admin ? 'Continue to Admin' : 'Sign in' }).click();
  const expected = options.expected ?? (options.admin ? '/admin' : '/dashboard');
  if (expected !== false) await expect(page).toHaveURL(expected);
}

async function signOut(page: Page): Promise<void> {
  const buttons = page.getByRole('button', { name: 'Sign Out' });
  await buttons.first().click();
  await expect(page).toHaveURL(/\/login\?loggedOut=1$/u);
}

async function expectNoHorizontalOverflow(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow, `horizontal overflow at ${width}px on ${page.url()}`).toBe(false);
}

async function expectAxeClean(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
}

test('completes registration, legal consent, verification, safe link reuse, and login', async ({
  page,
}) => {
  await clearMailbox();
  await page.goto('/register?plan=pro&billing=annual');
  await expect(page.getByLabel('Pro plan selected')).toContainText('Selected plan');
  await expect(page.getByLabel('Pro plan selected')).toContainText('₱9,599/year');
  await page.getByLabel('First name').fill('Registration');
  await page.getByLabel('Last name').fill('Member');
  await page.getByLabel('Email address').fill(testAccounts.registration.email);
  await page.getByLabel(/^Password/iu).fill(testAccounts.registration.password);
  await page.getByLabel(/^Confirm password/iu).fill(testAccounts.registration.password);
  await page.getByRole('button', { name: 'Create my account' }).click();
  await expect(
    page.getByText('You must agree to the Terms of Service and Privacy Policy.'),
  ).toBeVisible();

  await page.getByLabel('First name').fill('Registration');
  await page.getByLabel('Last name').fill('Member');
  await page.getByLabel('Email address').fill(testAccounts.registration.email);
  await page.getByLabel(/^Password/iu).fill(testAccounts.registration.password);
  await page.getByLabel(/^Confirm password/iu).fill(testAccounts.registration.password);
  await page.getByLabel(/I agree to the Terms of Service/iu).check();
  await page.getByRole('button', { name: 'Create my account' }).click();
  await expect(page).toHaveURL('/verify-email?registered=1');
  await expect(page.getByRole('heading', { name: 'Check your inbox.' })).toBeVisible();

  const verification = await waitForEmail(
    testAccounts.registration.email,
    'Verify your Hanaply email',
  );
  expect(verification.HTML).toContain('Verify your email address');
  expect(verification.Text).toContain('This link expires in one hour');
  const verificationLink = firstActionLink(verification);
  await page.goto(verificationLink);
  await expect(page).toHaveURL('/dashboard');
  await expect(page.getByRole('heading', { name: 'Welcome, Registration.' })).toBeVisible();

  const registered = await getAuthUserByEmail(testAccounts.registration.email);
  expect(registered?.id).toBeTruthy();
  expect(registered?.user_metadata?.selected_plan_code).toBe('pro_annual');
  const legal = await getServiceRows<{ policy_type: string; policy_version: string }[]>(
    `/rest/v1/user_legal_acceptances?select=policy_type,policy_version&user_id=eq.${registered?.id ?? ''}`,
  );
  expect(legal.map((acceptance) => acceptance.policy_type).sort()).toEqual(['privacy', 'terms']);
  const preferences = await getServiceRows<{ marketing_emails: boolean }[]>(
    `/rest/v1/user_notification_preferences?select=marketing_emails&user_id=eq.${registered?.id ?? ''}`,
  );
  expect(preferences).toEqual([{ marketing_emails: false }]);

  await signOut(page);
  await page.goto(verificationLink);
  await expect(page).toHaveURL('/verify-email?status=invalid');
  await expect(page.getByText('That verification link is no longer valid')).toBeVisible();

  await signIn(page, testAccounts.registration);
  await expect(page).toHaveURL('/dashboard');
  await signOut(page);
});

test('uses generic recovery, changes the password, revokes sessions, and rejects the old password', async ({
  page,
}) => {
  await clearMailbox();
  await page.goto('/forgot-password');
  await page.getByLabel('Email address').fill('unknown-user@hanaply.test');
  await page.getByRole('button', { name: 'Send Reset Instructions' }).click();
  await expect(page.getByText(/If an account exists/iu)).toBeVisible();

  await page.getByLabel('Email address').fill(testAccounts.recovery.email);
  await page.getByRole('button', { name: 'Send Reset Instructions' }).click();
  await expect(page.getByText(/If an account exists/iu)).toBeVisible();
  const recovery = await waitForEmail(testAccounts.recovery.email, 'Reset your Hanaply password');
  expect(recovery.Text).toContain('one-time link');
  await page.goto(firstActionLink(recovery));
  await expect(page).toHaveURL('/reset-password');
  await page.getByLabel(/^New password/iu).fill(replacementPassword);
  await page.getByLabel(/^Confirm new password/iu).fill(replacementPassword);
  await page.getByRole('button', { name: 'Save new password' }).click();
  await expect(page).toHaveURL('/login?password=changed');
  await expect(page.getByText('Password changed')).toBeVisible();

  const passwordChanged = await waitForEmail(
    testAccounts.recovery.email,
    'Your Hanaply password was changed',
  );
  expect(passwordChanged.Text).toContain('If you did not make this change');

  await signIn(page, testAccounts.recovery, { expected: false });
  await expect(page).toHaveURL('/login');
  await expect(page.getByText('We could not sign you in with those details.')).toBeVisible();
  await page.getByLabel('Email address').fill(testAccounts.recovery.email);
  await page.locator('input[name="password"]').fill(replacementPassword);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL('/dashboard');
  await signOut(page);
});

test('protects the dashboard and supports profile, preference, session, and logout workflows', async ({
  page,
}) => {
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/u);
  await signIn(page, testAccounts.customer);
  await expect(page).toHaveURL('/dashboard');
  await expect(page.getByRole('heading', { name: 'Welcome, Customer.' })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Protected account')).toBeVisible();

  await page.goto('/dashboard/settings/profile');
  await page.getByLabel('Display name').fill('Customer Updated');
  await page.getByRole('button', { name: 'Save Profile' }).click();
  await expect(page.getByText('Your profile was updated.')).toBeVisible();

  await page.goto('/dashboard/settings/notifications');
  await page.getByLabel('Product update emails').check();
  await page.getByRole('button', { name: 'Save Preferences' }).click();
  await expect(page.getByText('Your optional email preferences were saved.')).toBeVisible();

  await page.goto('/dashboard/settings/security');
  await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible();
  await expect(page.getByText('This session', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Log Out Other Sessions' })).toBeVisible();
  await expectAxeClean(page);
  await signOut(page);
  await page.goto('/dashboard/settings');
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard%2Fsettings$/u);
});

test('enforces suspended-account and normal-user administrator boundaries', async ({ page }) => {
  await signIn(page, testAccounts.suspended, { expected: '/account-suspended' });
  await expect(page).toHaveURL('/account-suspended');
  await expect(
    page.getByRole('heading', { name: 'Your account is currently suspended.' }),
  ).toBeVisible();

  await page.context().clearCookies();
  await signIn(page, testAccounts.customer);
  await expect(page).toHaveURL('/dashboard');
  await page.goto('/admin');
  await expect(page).toHaveURL('/forbidden');
  await expect(
    page.getByRole('heading', { name: 'This area requires explicit administrator permission.' }),
  ).toBeVisible();
});

test('uses real admin data and audits suspend, restore, and session revocation', async ({
  browser,
  page,
}) => {
  await page.context().clearCookies();
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/login\?next=%2Fadmin$/u);
  await signIn(page, testAccounts.admin, { admin: true });
  await expect(page).toHaveURL('/admin');
  await expect(page.getByText('Live database counts')).toBeVisible();
  await expect(page.getByText('Registered users')).toBeVisible();

  await page.goto('/admin/users');
  await page.getByLabel('Search').fill(testAccounts.managed.email);
  await page.getByRole('button', { name: 'Apply Filters' }).click();
  await expect(page.getByText(testAccounts.managed.email)).toBeVisible();
  await page.getByRole('link', { name: 'View details' }).click();
  await expect(page.getByRole('heading', { name: 'Managed Member' })).toBeVisible();

  await page.getByRole('button', { name: 'Suspend Account' }).click();
  await page
    .getByLabel('Reason')
    .fill('Confirmed account security review for the end-to-end test.');
  await page.getByRole('button', { name: 'Confirm Suspension' }).click();
  await expect(page.getByRole('button', { name: 'Restore Account' })).toBeVisible();
  await expect(page.getByText('user.account_suspended', { exact: true }).first()).toBeVisible();

  const managedContext = await browser.newContext({ baseURL: 'http://localhost:3100' });
  const managedPage = await managedContext.newPage();
  await signIn(managedPage, testAccounts.managed, { expected: '/account-suspended' });
  await expect(managedPage).toHaveURL('/account-suspended');
  await managedContext.close();

  await page.reload();
  await page.getByRole('button', { name: 'Restore Account' }).click();
  await page.getByLabel('Reason').fill('Security review completed and account access is approved.');
  await page.getByRole('button', { name: 'Confirm Restoration' }).click();
  await expect(page.getByRole('button', { name: 'Suspend Account' })).toBeVisible();

  await page.reload();
  await page.getByRole('button', { name: 'Revoke Sessions' }).click();
  await page
    .getByLabel('Reason')
    .fill('Complete session reset requested during the end-to-end test.');
  await page.getByRole('button', { name: 'Revoke All Sessions' }).click();
  await expect(page.getByText(/^\d+ sessions? revoked\.$/iu)).toBeVisible();

  await page.goto('/admin/audit?action=user.account_suspended');
  await expect(page.getByText('user.account_suspended', { exact: true }).first()).toBeVisible();
  await page.goto('/admin/security');
  await expect(page.getByRole('heading', { name: 'Security' })).toBeVisible();
  await expect(page.getByText('Admin bootstrap is disabled')).toBeVisible();
  await expectAxeClean(page);
});

test('keeps pricing on the landing page and an honest Activation Center', async ({ page }) => {
  await page.context().clearCookies();
  await page.goto('/pricing');
  await expect(page).toHaveURL(/\/#pricing$/u);
  for (const name of ['Plus', 'Pro']) {
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  }
  await expect(page.getByRole('link', { name: 'Start with Plus' })).toHaveAttribute(
    'href',
    '/register?plan=plus&billing=annual',
  );
  await expect(page.getByRole('link', { name: 'Start with Pro' })).toHaveAttribute(
    'href',
    '/register?plan=pro&billing=annual',
  );

  await page.getByRole('button', { name: 'Monthly', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Monthly', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('#pricing .billing-summary')).toHaveCount(0);
  await expect(page.getByText('billed monthly', { exact: true })).toHaveCount(0);

  await page.getByRole('link', { name: 'Start with Plus' }).click();
  await expect(page).toHaveURL(/\/register\?plan=plus&billing=monthly$/u);
  await expect(page.getByLabel('Plus plan selected')).toContainText('Selected plan');
  await expect(page.getByLabel('Plus plan selected')).toContainText('₱499/month');

  await signIn(page, testAccounts.customer);
  await expect(page).toHaveURL('/dashboard');
  await page.goto('/dashboard/activation');
  await expect(page.getByText('Manual renewal only')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'No payment methods are available' }),
  ).toBeVisible();
  await expect(page.getByText('Do not send payment yet')).toHaveCount(0);
  await expect(page.getByText('Annual savings')).toHaveCount(0);
  await expectAxeClean(page);
});

test('provides clear auth plan context and accessible password controls', async ({ page }) => {
  await page.goto('/register?plan=pro&billing=annual');
  const selectedPlan = page.getByLabel('Pro plan selected');
  await expect(selectedPlan).toContainText('Selected plan');
  await expect(selectedPlan).toContainText('₱9,599/year');
  await expect(selectedPlan.getByRole('link', { name: 'Change' })).toHaveAttribute(
    'href',
    '/#pricing',
  );

  const password = page.locator('#registrationPassword');
  const confirmation = page.locator('#passwordConfirmation');
  await expect(page.getByText('Password requirements')).toHaveCount(0);
  await password.fill('CareerReady7');
  await expect(page.getByText('Password requirements')).toBeVisible();
  await expect(page.getByText('At least 10 characters')).toBeVisible();
  await expect(page.getByText('Includes a letter')).toBeVisible();
  await expect(page.getByText('Includes a number')).toBeVisible();
  await expect(page.getByText('Passwords match')).toBeVisible();
  await confirmation.fill('CareerReady7');

  const passwordToggle = page.getByRole('button', { name: 'Show password' });
  await passwordToggle.click();
  await expect(password).toHaveAttribute('type', 'text');
  await expect(page.getByRole('button', { name: 'Hide password' })).toHaveAttribute(
    'type',
    'button',
  );

  await page.goto('/login');
  const loginPassword = page.locator('#password');
  await loginPassword.fill('Visible7Test');
  await page.getByRole('button', { name: 'Show password' }).click();
  await expect(loginPassword).toHaveAttribute('type', 'text');
  await expect(page.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute(
    'href',
    '/forgot-password',
  );
  await expect(page.getByRole('link', { name: 'Create an account' })).toHaveAttribute(
    'href',
    '/register',
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/register?plan=pro&billing=annual');
  await expect(page.getByLabel('Pro plan selected')).toBeVisible();
  await expect(page.getByLabel(/I agree to the Terms of Service/iu)).toBeVisible();
  const firstNameBox = await page.getByLabel('First name').boundingBox();
  const lastNameBox = await page.getByLabel('Last name').boundingBox();
  expect(firstNameBox).not.toBeNull();
  expect(lastNameBox).not.toBeNull();
  expect((lastNameBox?.y ?? 0) > (firstNameBox?.y ?? 0)).toBe(true);
});

test('explains release status and provides keyboard previews and an accessible FAQ', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Your career radar never stops searching.' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Create your account' })).toHaveAttribute(
    'href',
    '/register',
  );
  await expect(page.getByRole('link', { name: 'See how Hanaply works' })).toHaveAttribute(
    'href',
    '#how-it-works',
  );
  await expect(page.getByRole('link', { name: 'View build status' })).toHaveAttribute(
    'href',
    '#roadmap',
  );
  await expect(
    page.getByRole('heading', {
      name: 'One trusted profile. One clearer path from discovery to application.',
    }),
  ).toBeVisible();
  // Scoped to the release-status list. A bare text match for "In development"
  // is not specific enough: the how-it-works steps and the roadmap also use the
  // same words, which is correct copy rather than a defect.
  const releaseStatus = page.locator('.product-status-list');
  await expect(releaseStatus.getByText('Account foundation', { exact: true })).toBeVisible();
  await expect(releaseStatus.getByText('Career Radar and job intelligence')).toBeVisible();
  await expect(releaseStatus.getByText('In development').first()).toBeVisible();
  await expect(releaseStatus.getByText('Planned', { exact: true })).toBeVisible();
  await expect(page.locator('.hero-visual > .preview-label')).toHaveText(
    'Product preview · Demonstration data',
  );

  const previewTrigger = page.getByRole('button', { name: 'Enlarge Career Radar preview' });
  await previewTrigger.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Career Radar' })).toBeVisible();
  const previewAxe = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  expect(previewAxe.violations).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Career Radar' })).toHaveCount(0);
  await expect(previewTrigger).toBeFocused();

  const faqQuestion = page.locator('.faq-list details').nth(1).locator('summary');
  await faqQuestion.focus();
  await page.keyboard.press('Enter');
  // The FAQ copy was corrected to describe what ships today, so the assertion
  // tracks the current wording rather than the pre-launch promise.
  await expect(page.getByText(/Hanaply prepares materials for your review/iu)).toBeVisible();
  await expect(
    page.getByRole('heading', {
      name: 'Build the Career Profile your next application can trust.',
    }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Create your Hanaply account' })).toHaveAttribute(
    'href',
    '/register',
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.evaluate(() => {
    document.documentElement.style.scrollBehavior = 'auto';
    document.querySelector('#career-radar')?.scrollIntoView({ block: 'start' });
  });
  await page.getByRole('button', { name: 'Enlarge Career Radar preview' }).click();
  const dialogBox = await page.getByRole('dialog', { name: 'Career Radar' }).boundingBox();
  const closeBox = await page.getByRole('button', { name: 'Close' }).boundingBox();
  expect(dialogBox).not.toBeNull();
  expect(closeBox).not.toBeNull();
  expect((dialogBox?.x ?? -1) >= 0).toBe(true);
  expect((dialogBox?.x ?? 0) + (dialogBox?.width ?? 1000) <= 390).toBe(true);
  expect((closeBox?.x ?? 1000) + (closeBox?.width ?? 1000) <= 390).toBe(true);
  await page.keyboard.press('Escape');
});

test('has no horizontal overflow on every required public and authentication route', async ({
  page,
}) => {
  await page.context().clearCookies();
  for (const path of [
    '/',
    '/register',
    '/login',
    '/verify-email',
    '/forgot-password',
    '/reset-password',
    '/admin/login',
  ]) {
    await page.goto(path);
    for (const width of requiredWidths) await expectNoHorizontalOverflow(page, width);
  }
});

test('has no horizontal overflow on every required customer route', async ({ page }) => {
  await page.context().clearCookies();
  await signIn(page, testAccounts.customer);
  for (const path of [
    '/dashboard',
    '/dashboard/settings/profile',
    '/dashboard/settings/security',
    '/dashboard/activation',
  ]) {
    await page.goto(path);
    for (const width of requiredWidths) await expectNoHorizontalOverflow(page, width);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Open workspace menu' }).click();
  await expect(page.getByRole('navigation', { name: 'Dashboard navigation' })).toBeVisible();
});

test('has no horizontal overflow on every required admin route', async ({ page }) => {
  await page.context().clearCookies();
  await signIn(page, testAccounts.admin, { admin: true });
  const managed = await getAuthUserByEmail(testAccounts.managed.email);
  expect(managed?.id).toBeTruthy();
  for (const path of [
    '/admin',
    '/admin/users',
    `/admin/users/${managed?.id ?? ''}`,
    '/admin/audit',
    '/admin/security',
  ]) {
    await page.goto(path);
    for (const width of requiredWidths) await expectNoHorizontalOverflow(page, width);
  }
});

test('honors reduced motion and keyboard-first navigation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const animationName = await page
    .locator('.radar-sweep')
    .evaluate((element) => getComputedStyle(element).animationName);
  expect(animationName).toBe('none');
  await page.keyboard.press('Tab');
  const skipLink = page.getByRole('link', { name: 'Skip to main content' });
  await expect(skipLink).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();

  await page.goto('/register');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
});

test('passes Axe scans and exposes security headers on core routes', async ({ page }) => {
  await page.context().clearCookies();
  for (const path of ['/', '/login', '/register', '/forgot-password', '/pricing', '/security']) {
    const response = await page.goto(path);
    expect(response?.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(response?.headers()['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(response?.headers()['permissions-policy']).toContain('camera=()');
    await expectAxeClean(page);
  }

  await signIn(page, testAccounts.customer);
  for (const path of ['/dashboard', '/dashboard/settings/profile', '/dashboard/activation']) {
    await page.goto(path);
    await expectAxeClean(page);
  }
});
