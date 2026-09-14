import { testAccounts } from './accounts.js';
import { expect, openFirstOpportunity, signIn, test } from './product.js';

/**
 * The Career Radar, walked as a member walks it: the ranked feed, a filter, an
 * opportunity, and the two decisions the product records about one — saving it
 * and telling Hanaply it is not wanted.
 *
 * The demo postings the stack seeds through the real ingestion writer are the
 * fixture, so the feed exercises deduplication, provenance, and freshness
 * rather than a fabricated row.
 */
test.describe.configure({ mode: 'serial' });

const opportunityTitles = [
  'Workflow Automation Engineer',
  'Solutions Engineer',
  'Data Analyst',
  'Platform Engineer',
  'Night Shift Support Representative',
];

test('lists the seeded opportunities with their counts, freshness, and source', async ({
  page,
}) => {
  await signIn(page, testAccounts.radar);
  await page.goto('/dashboard/radar');
  await expect(page.getByRole('heading', { name: 'Job radar', level: 1 })).toBeVisible();

  // The count strip is read from three separate API calls. It used to render
  // "Radar counts are unavailable" on every load because the client refused the
  // array-valued `verdicts` filter the contract types allow, so this asserts the
  // numbers themselves rather than the failure alert.
  const stats = page.locator('.radar-stat-strip');
  await expect(stats.getByText('Opportunities', { exact: true })).toBeVisible();
  await expect(stats.getByText('Strong matches', { exact: true })).toBeVisible();
  await expect(stats.getByText('Not analysed yet', { exact: true })).toBeVisible();
  await expect(page.getByText('Radar counts are unavailable')).toHaveCount(0);
  await expect(stats.locator('strong').first()).toHaveText('5');

  for (const title of opportunityTitles) {
    await expect(page.getByRole('link', { name: title, exact: true })).toBeVisible();
  }

  const firstCard = page.locator('.radar-card').first();
  await expect(firstCard.locator('.radar-absolute-date')).toContainText('Posted or last seen');
  await expect(firstCard.getByText('Not analysed yet')).toBeVisible();
  await expect(firstCard.getByText('No score exists for this opportunity yet.')).toBeVisible();
});

test('a filter changes the result set and is reflected in the URL', async ({ page }) => {
  await signIn(page, testAccounts.radar);
  await page.goto('/dashboard/radar');
  await expect(page.getByRole('link', { name: 'Data Analyst', exact: true })).toBeVisible();

  await page.getByLabel('Search').fill('Data Analyst');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(page).toHaveURL(/search=Data\+Analyst/u);
  await expect(page.getByRole('link', { name: 'Data Analyst', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Platform Engineer', exact: true })).toHaveCount(0);

  // A second filter narrows further: only Philippines postings remain.
  await page.getByLabel('Philippines only').check();
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(page).toHaveURL(/philippinesOnly=1/u);
  await expect(page.getByRole('link', { name: 'Data Analyst', exact: true })).toBeVisible();

  // A filter no opportunity satisfies shows the empty state rather than a
  // silently unfiltered list.
  await page.getByLabel('Search').fill('No such role exists');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(
    page.getByRole('heading', { name: 'No opportunity matches these filters' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Clear all filters' }).first().click();
  await expect(page).toHaveURL(/\/dashboard\/radar$/u);
  await expect(page.getByRole('link', { name: 'Platform Engineer', exact: true })).toBeVisible();
});

test('an opportunity opens with its freshness and source data', async ({ page }) => {
  await signIn(page, testAccounts.radar);
  await openFirstOpportunity(page);

  /*
   * The scored explanation ("Why this fits", the match breakdown, the
   * requirement mapping) is rendered from a stored match result, and nothing in
   * the Dockerless stack computes one: the matching engine lives in the worker,
   * which `pnpm e2e` does not start, and no API route records a match. So this
   * asserts what the product actually shows for every opportunity here — an
   * explicit, honest unanalysed state — rather than a heading that can never
   * appear. The gap is reported rather than papered over.
   */
  await expect(
    page.getByRole('heading', { name: 'This opportunity has not been analysed yet' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Why this fits' })).toHaveCount(0);
  await expect(page.getByText('No score exists for this opportunity yet.')).toBeVisible();

  const facts = page.locator('.radar-detail-facts');
  await expect(facts.getByText('Freshness', { exact: true })).toBeVisible();
  await expect(facts.getByText('Posting history', { exact: true })).toBeVisible();
  await expect(facts.getByText('Sources', { exact: true })).toBeVisible();
  await expect(facts.getByText('First seen', { exact: false })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Original posting' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Apply on the original source' })).toHaveAttribute(
    'href',
    /localhost\.invalid/u,
  );
  await expect(page.getByText('Local development fixtures').first()).toBeVisible();
});

test('saving an opportunity adds it to the saved view and removing it takes it away', async ({
  page,
}) => {
  await signIn(page, testAccounts.radar);
  const href = await openFirstOpportunity(page);
  const jobPath = new URL(href, 'http://localhost:3100').pathname;
  const title = await page.getByRole('heading', { level: 1 }).first().innerText();

  await page.getByRole('button', { name: 'Save opportunity' }).click();
  await expect(page.getByText('Saved. It now appears under Saved opportunities.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove from saved' })).toBeVisible();

  await page.goto('/dashboard/radar/saved');
  await expect(page.getByRole('heading', { name: 'Saved opportunities', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: title, exact: true })).toBeVisible();
  await expect(page.getByText('Your saved list is empty')).toHaveCount(0);

  await page.goto(jobPath);
  await page.getByRole('button', { name: 'Remove from saved' }).click();
  await expect(page.getByText('Removed from your saved opportunities.')).toBeVisible();

  await page.goto('/dashboard/radar/saved');
  await expect(page.getByRole('heading', { name: 'Your saved list is empty' })).toBeVisible();
});

test('dismissing an opportunity hides it from the radar and keeps it findable', async ({
  page,
}) => {
  await signIn(page, testAccounts.radar);
  await page.goto('/dashboard/radar');
  const card = page.locator('.radar-card', { hasText: 'Night Shift Support Representative' });
  await expect(card).toBeVisible();

  await card.locator('summary').click();
  await card.getByRole('button', { name: /^Not interested/u }).click();
  await expect(page.getByText('Recorded: Not interested.')).toBeVisible();
  await expect(card).toHaveCount(0);

  // Dismissed opportunities are not deleted: the same feed can be asked for
  // them, which is what the copy promises.
  await page.goto('/dashboard/radar?dismissedOnly=true');
  await expect(
    page.getByRole('link', { name: 'Night Shift Support Representative', exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('link', { name: 'Night Shift Support Representative', exact: true }),
  ).toBeVisible();
});
