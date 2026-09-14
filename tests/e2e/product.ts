import { expect, test, type Page } from './browser-health.js';
import { testAccounts } from './accounts.js';
import { getServiceRows } from './test-data.js';

export { expect, test };
export type { Page };

let clientAddressSequence = 100;

/**
 * Signs one of the fixture accounts in.
 *
 * The `x-forwarded-for` header is varied per sign-in for the same reason the
 * existing suite varies it: the auth rate limiter counts attempts per address,
 * and the product specs are independent browsers rather than one brute-force
 * burst.
 */
export async function signIn(
  page: Page,
  account: { email: string; password: string },
  options: { admin?: boolean; expected?: string | RegExp | false } = {},
): Promise<void> {
  await page.context().setExtraHTTPHeaders({
    'x-forwarded-for': `198.51.100.${clientAddressSequence++}`,
  });
  await page.goto(options.admin ? '/admin/login' : '/login');
  await page.getByLabel('Email address').fill(account.email);
  await page.locator('input[name="password"]').fill(account.password);
  await page.getByRole('button', { name: options.admin ? 'Continue to Admin' : 'Sign in' }).click();
  const expected = options.expected ?? (options.admin ? '/admin' : '/dashboard');
  if (expected !== false) await expect(page).toHaveURL(expected);
}

export async function signOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Sign Out' }).first().click();
  await expect(page).toHaveURL(/\/login\?loggedOut=1$/u);
}

export interface UsageItem {
  feature: string;
  used: number;
  limit: number;
  remaining: number;
}

/**
 * The authoritative usage counters, read with the service-role key.
 *
 * A quota assertion that only reads the page cannot tell "the page says 1" from
 * "the server counted 1", and the whole point of the double-charge requirement
 * is the server's own ledger.
 */
export async function readUsageCounters(userId: string): Promise<UsageItem[]> {
  const rows = await getServiceRows<{ feature: string; used: number; limit_snapshot: number }[]>(
    `/rest/v1/usage_counters?select=feature,used,limit_snapshot&user_id=eq.${userId}`,
  );
  return rows.map((row) => ({
    feature: row.feature,
    used: row.used,
    limit: row.limit_snapshot,
    remaining: row.limit_snapshot - row.used,
  }));
}

export async function readUsageEvents(
  userId: string,
  feature: string,
): Promise<{ idempotency_key: string; units: number }[]> {
  return getServiceRows<{ idempotency_key: string; units: number }[]>(
    `/rest/v1/usage_events?select=idempotency_key,units&user_id=eq.${userId}&feature=eq.${feature}&order=created_at.asc`,
  );
}

/**
 * A minimal, real PNG.
 *
 * The payment proof endpoint validates magic bytes rather than the declared
 * content type, so the upload fixture has to be a genuine image; a text file
 * renamed `.png` is refused by design.
 */
export const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

export const fixtureAccounts = testAccounts;

/**
 * Signs in and lands on a customer route, which is the shape every product spec
 * starts with.
 */
export async function openAs(
  page: Page,
  account: { email: string; password: string },
  path: string,
): Promise<void> {
  await signIn(page, account);
  await page.goto(path);
}

/**
 * Gives the signed-in account a career profile, if it does not have one.
 *
 * Several product surfaces refuse to do anything meaningful without one — the
 * Application Pack generator needs confirmed evidence, and the coach may only
 * answer from a confirmed ledger — so a spec that owns its own account has to
 * create it rather than depending on another file having run first.
 */
export async function ensureCareerProfile(page: Page): Promise<void> {
  await page.goto('/dashboard/career');
  // Waiting for the heading first is what makes the `count()` below meaningful:
  // an immediate count on a page that has not painted yet is zero whether or not
  // the link exists, and that silently skipped profile creation.
  await expect(page.getByRole('heading', { name: 'Career profile', level: 1 })).toBeVisible();
  const start = page.getByRole('link', { name: 'Start onboarding' });
  if ((await start.count()) === 0) {
    await expect(page.locator('.career-profile-card').first()).toBeVisible();
    return;
  }
  await start.click();
  await expect(
    page.getByRole('heading', { name: 'Career profile onboarding', level: 1 }),
  ).toBeVisible();
  await expect(page.getByText('No career profile exists yet')).toHaveCount(0);
  await page.locator('#onboardingCurrentRole').fill('Automation Engineer');
  await page.locator('#onboardingCareerLevel').selectOption('Mid level');
  await page.locator('#onboardingYears').fill('6');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page.getByRole('heading', { name: 'Target roles' })).toBeVisible();
  await page.locator('#onboardingTargetRoles').fill('Automation Engineer');
  await page.locator('#onboardingTargetRoles').press('Enter');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page.getByRole('heading', { name: 'Skills' })).toBeVisible();
}

/**
 * Records one claim the member writes themselves.
 *
 * A claim entered here is confirmed on record — the member is the source — so
 * this is the shortest honest route to admissible evidence for specs that need
 * the generator or the coach to have something to cite.
 */
export async function ensureConfirmedFact(page: Page, statement: string): Promise<void> {
  await page.goto('/dashboard/career');
  await page.getByRole('link', { name: 'Truth ledger' }).first().click();
  await expect(page.getByRole('heading', { name: 'Truth ledger', level: 1 })).toBeVisible();
  if ((await page.getByText(statement, { exact: false }).count()) > 0) return;
  await page.locator('#careerFactStatement').fill(statement);
  await page.getByRole('button', { name: 'Record claim' }).click();
  await expect(page.getByText('The claim was recorded as confirmed evidence.')).toBeVisible();
}

/** The first ranked opportunity in the radar feed, opened. */
export async function openFirstOpportunity(page: Page): Promise<string> {
  await page.goto('/dashboard/radar');
  await expect(page.getByRole('heading', { name: 'Job radar', level: 1 })).toBeVisible();
  const title = page.locator('.radar-card-title a').first();
  await expect(title).toBeVisible();
  const href = await title.getAttribute('href');
  await title.click();
  await expect(page).toHaveURL(/\/dashboard\/radar\/[0-9a-f-]{36}$/u);
  if (!href) throw new Error('The first opportunity card had no link');
  return href;
}
