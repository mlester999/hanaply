import { testAccounts } from './accounts.js';
import { ensureAnalysedRadar } from './analysis-fixture.js';
import { expect, openFirstOpportunity, signIn, test } from './product.js';

/**
 * The Career Radar, walked as a member walks it: the ranked feed, a filter, an
 * opportunity, and the two decisions the product records about one — saving it
 * and telling Hanaply it is not wanted.
 *
 * The demo postings the stack seeds through the real ingestion writer are the
 * fixture, so the feed exercises deduplication, provenance, and freshness
 * rather than a fabricated row.
 *
 * The matching worker now participates in this suite, so this file asserts the
 * analysed radar rather than the unanalysed one it used to. `beforeAll` gives
 * this account the career profile the worker scores and then runs the worker
 * through its real entry point (`tests/e2e/worker-cycle.ts`, the same
 * `WORKER_MODE=once` run of `services/worker/dist/main.js` a deployment starts),
 * waiting on the stored rows rather than on a sleep. The analysis therefore does
 * not depend on another spec file having run first: whichever order Playwright
 * picks, the state every assertion below describes has been produced before it
 * is read.
 */
test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await ensureAnalysedRadar(testAccounts.radar);
});

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
  // The worker analysed every seeded posting in one cycle, so the count the
  // third card promises is a real zero — the number the assertion this file used
  // to make about the unanalysed card implied was five.
  await expect(stats.locator('strong').nth(2)).toHaveText('0');

  for (const title of opportunityTitles) {
    await expect(page.getByRole('link', { name: title, exact: true })).toBeVisible();
  }

  const firstCard = page.locator('.radar-card').first();
  await expect(firstCard.locator('.radar-absolute-date')).toContainText('Posted or last seen');
  /*
   * The stronger assertion that replaced the honest "not analysed yet" one.
   *
   * Every card in this feed carries a stored result now, so a card states the
   * verdict and the score the ranking stored — with the confidence it derived
   * from the evidence behind it — and no card in the feed says it has not been
   * analysed. Nothing here is a placeholder: `matching.spec.ts` asserts the
   * stored row these render from.
   */
  await expect(page.locator('.radar-card')).toHaveCount(5);
  await expect(page.locator('.radar-card-verdict .h-badge')).toHaveCount(5);
  await expect(page.locator('.radar-card', { hasText: 'Not analysed yet' })).toHaveCount(0);
  await expect(page.getByText('No score exists for this opportunity yet.')).toHaveCount(0);
  await expect(firstCard.locator('.radar-card-verdict .h-badge')).toHaveText(
    /^(Strong match|Good match|Stretch opportunity|Weak match|Not recommended) · \d{1,3}\/100$/u,
  );
  await expect(firstCard.locator('.radar-confidence')).toHaveText(
    /^(High|Medium|Low) confidence$/u,
  );
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
   * requirement mapping) is rendered from a stored match result. This file used
   * to assert the opposite — an explicit, honest unanalysed state — because the
   * matching engine lives in the worker, which `pnpm e2e` did not start, and no
   * API route recorded a match. The worker now runs before this file's first
   * assertion (see `beforeAll`), so the coverage is replaced with the stronger
   * claim rather than deleted: this opportunity carries the analysis the worker
   * stored, and the unanalysed panel is gone.
   */
  await expect(
    page.getByRole('heading', { name: 'This opportunity has not been analysed yet' }),
  ).toHaveCount(0);
  await expect(page.getByText('No score exists for this opportunity yet.')).toHaveCount(0);
  await expect(page.locator('.radar-detail-verdict .h-badge')).toHaveText(
    /^(Strong match|Good match|Stretch opportunity|Weak match|Not recommended) · \d{1,3}\/100$/u,
  );
  await expect(page.locator('.radar-detail-verdict')).toContainText(
    /(High|Medium|Low) confidence/u,
  );
  await expect(page.getByRole('heading', { name: 'Why this fits' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Match breakdown' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Requirements mapping' })).toBeVisible();
  await expect(page.locator('.radar-dimension-table tbody tr')).toHaveCount(9);

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
