import { testAccounts } from './accounts.js';
import {
  expect,
  ensureCareerProfile,
  ensureConfirmedFact,
  openFirstOpportunity,
  readUsageCounters,
  readUsageEvents,
  signIn,
  test,
} from './product.js';
import { getAuthUserByEmail } from './test-data.js';

/**
 * The Application Pack, from the opportunity that creates it to the artifact a
 * member reads — including the one thing the product promises loudly: asking
 * twice for the same pack never spends the allowance twice.
 */
test.describe.configure({ mode: 'serial' });

const fact = 'Automated the order intake process and reduced manual handling time by 40 percent.';

async function accountId(): Promise<string> {
  const user = await getAuthUserByEmail(testAccounts.packs.email);
  if (!user?.id) throw new Error('The packs fixture account is missing');
  return user.id;
}

test('creates a pack, spends one allowance, and never spends a second on a resubmit', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  await signIn(page, testAccounts.packs);
  await ensureCareerProfile(page);
  await ensureConfirmedFact(page, fact);

  const userId = await accountId();
  const before = (await readUsageCounters(userId)).find(
    (item) => item.feature === 'application_pack',
  );
  expect(before?.used ?? 0).toBe(0);

  await page.goto('/dashboard/packs');
  await expect(page.getByRole('heading', { name: 'Your packs', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'You have no Application Packs' })).toBeVisible();

  /*
   * A second browser opens the same opportunity while the pack does not exist
   * yet, so its form is still the create form after the first one succeeds. That
   * is the resubmit the idempotency key exists for: one member, one opportunity,
   * one career profile, asked for twice.
   */
  const otherContext = await browser.newContext({ baseURL: 'http://localhost:3100' });
  const otherPage = await otherContext.newPage();
  await signIn(otherPage, testAccounts.packs);
  await openFirstOpportunity(otherPage);
  await expect(otherPage.getByRole('button', { name: 'Create Application Pack' })).toBeVisible();

  await openFirstOpportunity(page);
  await page.getByRole('button', { name: 'Create Application Pack' }).click();
  await expect(page).toHaveURL(/\/dashboard\/packs\/[0-9a-f-]{36}$/u);
  const packUrl = page.url();

  // The create action navigates to the new pack, so the confirmation is the
  // pack itself rather than an alert on the page it left.
  await expect(page.getByText('Pack version 0', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('Queued', { exact: false }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No artifacts are stored yet' })).toBeVisible();

  // The allowance moved by exactly one, on the server as well as on the page.
  expect(
    (await readUsageCounters(userId)).find((item) => item.feature === 'application_pack')?.used,
  ).toBe(1);
  await page.goto('/dashboard/packs');
  await expect(page.getByText('1 of 40 used · 39 left')).toBeVisible();

  // The stale second submit resolves to the pack that already exists — the same
  // pack, not a new one — and the allowance does not move and no second ledger
  // row appears.
  await otherPage.getByRole('button', { name: 'Create Application Pack' }).click();
  await expect(otherPage).toHaveURL(packUrl);
  await expect
    .poll(
      async () =>
        (await readUsageCounters(userId)).find((item) => item.feature === 'application_pack')?.used,
    )
    .toBe(1);
  expect(await readUsageEvents(userId, 'application_pack')).toHaveLength(1);
  await otherContext.close();
});

test('writes the artifacts, shows their text, and regenerates as a new version', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await signIn(page, testAccounts.packs);
  await page.goto('/dashboard/packs');
  await page.getByRole('link', { name: 'Open this pack' }).first().click();

  const versionLine = page.getByText(/Pack version \d+/u).first();
  await expect(versionLine).toBeVisible();
  const readVersion = async (): Promise<number> =>
    Number(/Pack version (\d+)/u.exec(await versionLine.innerText())?.[1] ?? '-1');
  const firstVersion = await readVersion();

  await page.getByRole('button', { name: 'Generate artifacts' }).click();
  await expect(page.getByText(/^Written by the deterministic generator\./u).first()).toBeVisible();
  await expect(page.getByText(/No model wrote this text/u).first()).toBeVisible();

  const artifacts = page.getByRole('region', { name: 'Pack artifacts' });
  await expect(artifacts.getByRole('heading', { name: 'Artifacts' })).toBeVisible();
  const cards = artifacts.locator('.application-artifact');
  const artifactCount = await cards.count();
  expect(artifactCount).toBeGreaterThan(0);

  // An artifact opens and shows its stored text, not a placeholder.
  const first = cards.first();
  await expect(
    first.getByText(/\d+ confirmed facts? from your career profile support this artifact\./u),
  ).toBeVisible();
  await first.getByText('Read the stored plain text exactly as it is saved').click();
  await expect(first.locator('pre')).not.toBeEmpty();

  // Regenerating replaces each artifact with a new version rather than adding a
  // second copy, and the pack's own version moves forward.
  await page.getByRole('button', { name: 'Generate a new version' }).click();
  await expect(page.getByText(/^Written by the deterministic generator\./u).first()).toBeVisible();
  await expect(cards).toHaveCount(artifactCount);
  const secondVersion = await readVersion();
  expect(secondVersion).toBeGreaterThan(firstVersion);

  const userId = await accountId();
  const packs = await readUsageEvents(userId, 'application_pack');
  expect(packs).toHaveLength(1);
});
