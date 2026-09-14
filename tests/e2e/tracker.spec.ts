import { testAccounts } from './accounts.js';
import { expect, ensureCareerProfile, ensureConfirmedFact, signIn, test } from './product.js';

/**
 * The tracker records what happened to an application, in order, and refuses a
 * write that was made against a version it no longer holds.
 */
test.describe.configure({ mode: 'serial' });

test('records an application and every stage it moves through', async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page, testAccounts.packs);
  await ensureCareerProfile(page);
  await ensureConfirmedFact(
    page,
    'Reduced manual handling time by 40 percent through an automated order intake process.',
  );

  // A different opportunity from the one the pack was built from.
  await page.goto('/dashboard/radar');
  await page.locator('.radar-card-title a').nth(1).click();
  await expect(page).toHaveURL(/\/dashboard\/radar\/[0-9a-f-]{36}$/u);
  await page.getByLabel('Stage to start from').selectOption('applied');
  await page.getByRole('button', { name: 'Add to the tracker' }).click();
  await expect(
    page.getByText(
      'Added to your tracker as Applied. Every stage change from here is recorded in its timeline.',
    ),
  ).toBeVisible();

  await page.goto('/dashboard/applications');
  await expect(page.getByRole('heading', { name: 'Your pipeline', level: 1 })).toBeVisible();
  const card = page.locator('.application-tracker-card').first();
  await expect(card.getByText('Applied', { exact: true }).first()).toBeVisible();

  await card.getByRole('button', { name: 'Move to Interviewing' }).click();
  await expect(page.getByText('Moved to Interviewing.')).toBeVisible();
  await expect(card.getByText('Interviewing', { exact: true }).first()).toBeVisible();

  await card.getByRole('link', { name: 'Timeline' }).click();
  await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();
  await expect(page.getByText('Tracking started: Applied')).toBeVisible();
  await expect(page.getByText('Stage changed: Applied → Interviewing')).toBeVisible();
  await expect(page.getByText(/1 recorded event|2 recorded events/u)).toBeVisible();
});

test('refuses a stage change made against a version that has moved on', async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  await signIn(page, testAccounts.packs);
  await page.goto('/dashboard/applications');
  const card = page.locator('.application-tracker-card').first();
  await expect(card.getByText('Interviewing', { exact: true }).first()).toBeVisible();

  // A second browser moves the same application while this page still holds the
  // version it was rendered with.
  const otherContext = await browser.newContext({ baseURL: 'http://localhost:3100' });
  const otherPage = await otherContext.newPage();
  await signIn(otherPage, testAccounts.packs);
  await otherPage.goto('/dashboard/applications');
  const otherCard = otherPage.locator('.application-tracker-card').first();
  await otherCard.getByRole('button', { name: 'Move to Offer' }).click();
  await expect(otherPage.getByText('Moved to Offer.')).toBeVisible();

  // The stale page is refused rather than silently overwriting the newer stage.
  await card.getByRole('button', { name: 'Move to Offer' }).click();
  await expect(page.getByText('This application changed elsewhere')).toBeVisible();
  await expect(
    page.getByText(
      'This application changed in another session, so your change was not saved. Nothing was overwritten. Reload to see the latest version, then make the change again.',
    ),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Refresh the latest' }).click();
  await expect(card.getByText('Offer', { exact: true }).first()).toBeVisible();
  await expect(
    page.getByText('Offer is a closing stage; there is no automatic next step.'),
  ).toBeVisible();
  await otherContext.close();
});

test('records a note and a scheduled next action on the timeline', async ({ page }) => {
  await signIn(page, testAccounts.packs);
  await page.goto('/dashboard/applications');
  const card = page.locator('.application-tracker-card').first();

  await card.locator('summary', { hasText: 'Notes and next action' }).click();
  await card.getByLabel('Notes').fill('Recruiter confirmed the panel interview schedule.');
  await card.getByLabel('Next action note').fill('Send the take-home exercise.');
  await card.getByRole('button', { name: 'Save notes and next action' }).click();
  await expect(page.getByText('Notes and next action saved.')).toBeVisible();

  await card.getByRole('link', { name: 'Timeline' }).click();
  await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();
  await expect(page.getByText('Stage changed: Interviewing → Offer')).toBeVisible();
});
