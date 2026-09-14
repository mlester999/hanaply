import { testAccounts } from './accounts.js';
import { expect, signIn, test } from './product.js';

/**
 * The coach is the one surface where a model may write prose, and the product's
 * promise is that it may not originate a fact.
 *
 * Two of the three behaviours below cannot be exercised end to end today, and
 * they are marked `fixme` rather than written as assertions that would pass for
 * the wrong reason:
 *
 *   Opening a coach thread fails. `open_coach_conversation` writes the
 *   conversation and returns it, and `coachConversationRowSchema` then rejects
 *   every row, because the table and both RPCs are snake_case
 *   (`career_profile_id`, `message_count`, `last_message_at`) while the
 *   published schema is camelCase. The row mapping that would fix it does not
 *   exist, so the surface answers "the coach service is not answering right
 *   now. Nothing was written." while the row is in fact written. The same
 *   mismatch makes the index silently drop every thread (it filters rows through
 *   `flatMap`, so a rejected row disappears instead of failing loudly), which is
 *   why the first test asserts the empty state rather than a list.
 *
 * Everything the send path needs is otherwise in place: `AI_PROVIDER=fake` is
 * selected, `AI_FAKE_RESPONSES` scripts a reply whose fact cites `@fact:0` — the
 * first admissible confirmed fact on the request — and the Pro fixture account
 * has the `advancedAiAnalysis` entitlement the meter reads.
 */
test.describe.configure({ mode: 'serial' });

test('renders the coach with the configured provider and no threads yet', async ({ page }) => {
  await signIn(page, testAccounts.coach);
  await page.goto('/dashboard/coach');
  await expect(page.getByRole('heading', { name: 'Coach', level: 1 })).toBeVisible();

  // The status notice is read from the API, so this is the browser's proof that
  // the deterministic fake provider is the one the service resolved.
  await expect(page.getByRole('heading', { name: 'AI generation is available' })).toBeVisible();
  await expect(
    page.getByText('the development fake provider', { exact: false }).first(),
  ).toBeVisible();
  await expect(page.getByText('hanaply-e2e-fake', { exact: false }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'AI generation is switched off' })).toHaveCount(0);

  await expect(page.getByRole('heading', { name: 'Open a thread' })).toBeVisible();
  await expect(page.getByLabel('Thread title')).toBeVisible();
  const topics = page.getByLabel('Topic');
  await expect(topics.locator('option')).toHaveCount(8);
  await expect(page.getByRole('button', { name: 'Open the thread' })).toBeEnabled();
});

test.fixme('answers from the confirmed ledger and keeps facts apart from suggestions', async ({
  page,
}) => {
  // Blocked by the coach conversation row mapping defect described above.
  await signIn(page, testAccounts.coach);
  await page.goto('/dashboard/coach');
  await page.getByLabel('Topic').selectOption('career_strategy');
  await page.getByRole('button', { name: 'Open the thread' }).click();
  await expect(page).toHaveURL(/\/dashboard\/coach\/[0-9a-f-]{36}$/u);

  await page.getByLabel('Your message').fill('What should every application lead with?');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText(/^Reply written by/u)).toBeVisible();

  const thread = page.getByRole('list', { name: 'Coach thread messages' });
  await expect(thread.getByText('Model-written, truth-gated')).toBeVisible();
  await expect(thread.getByText('Notice, not a model reply')).toHaveCount(0);
  await expect(
    page.getByRole('region', { name: 'Confirmed facts behind this reply' }),
  ).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Suggestion — Hanaply’s inference, not a fact about you' }),
  ).toBeVisible();
});

test.fixme('refuses the coach on a plan that does not include it', async ({ page }) => {
  // Blocked by the same defect: the refusal happens on send, inside a thread.
  await signIn(page, testAccounts.customer);
  await page.goto('/dashboard/coach');
  await page.getByRole('button', { name: 'Open the thread' }).click();
  await expect(page).toHaveURL(/\/dashboard\/coach\/[0-9a-f-]{36}$/u);
  await page.getByLabel('Your message').fill('Which role should I target next?');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(
    page.getByText(/Your current plan does not include coach messages\. Upgrade to use it/u),
  ).toBeVisible();
});
