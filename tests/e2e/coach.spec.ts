import { testAccounts } from './accounts.js';
import { ensureCareerProfile, ensureConfirmedFact, expect, signIn, test } from './product.js';
import { getAuthUserByEmail, getServiceRows } from './test-data.js';

/**
 * The coach is the one surface where a model may write prose, and the product's
 * promise is that it may not originate a fact.
 *
 * All three behaviours below run against the real stack: `AI_PROVIDER=fake` is
 * selected, `AI_FAKE_RESPONSES` scripts one coaching reply whose fact cites
 * `@fact:0` — the first admissible confirmed fact the request carries — and the
 * Pro fixture account has the `advancedAiAnalysis` entitlement the meter reads.
 * The Plus fixture deliberately does not, which is what the refusal proves.
 *
 * The evidence is created here rather than assumed. The coach may only answer
 * from the confirmed ledger, and this file owns its own account, so the career
 * profile and the confirmed claim are part of this fixture rather than a
 * dependency on another spec having run first.
 */
test.describe.configure({ mode: 'serial' });

/** The claim every assertion about cited evidence is written against. */
const confirmedClaim = 'Led the migration of the billing platform to the new queue';

/** The exact wording every inference is labelled with, as the component renders it. */
const suggestionLabel = 'Suggestion — Hanaply’s inference, not a fact about you';

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

test('answers from the confirmed ledger and keeps facts apart from suggestions', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(page, testAccounts.coach);
  await ensureCareerProfile(page);
  await ensureConfirmedFact(page, confirmedClaim);

  await page.goto('/dashboard/coach');
  await page.getByLabel('Topic').selectOption('career_strategy');
  await page.getByRole('button', { name: 'Open the thread' }).click();
  // Opening a thread navigates into the thread the API created. It did not
  // before: the detail read rejected its own row and the surface answered 503
  // "the coach service is not answering right now" while the row existed.
  await expect(page).toHaveURL(/\/dashboard\/coach\/[0-9a-f-]{36}$/u);

  await page.getByLabel('Your message').fill('What should every application lead with?');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText(/^Reply written by/u)).toBeVisible();

  const thread = page.getByRole('list', { name: 'Coach thread messages' });
  // A model reply that passed the truth gate — not a stored notice standing in
  // for one, which is the failure this assertion exists to catch.
  await expect(thread.getByText('Model-written, truth-gated')).toBeVisible();
  await expect(thread.getByText('Notice, not a model reply')).toHaveCount(0);

  /*
   * The distinction is asserted on the rendered page, not on the payload.
   *
   * A fact has to show the confirmed evidence behind it: the statement the model
   * asserted, and the member's own confirmed wording read back from the truth
   * ledger under the identifier the reply cited. A suggestion has to sit inside
   * the region that says it is an inference rather than a fact about the member.
   */
  const facts = page.getByRole('region', { name: 'Confirmed facts behind this reply' });
  await expect(facts).toBeVisible();
  await expect(
    facts.getByText('Stated as fact, with the confirmed evidence behind it'),
  ).toBeVisible();
  await expect(facts.getByText('Confirmed fact cited (1)')).toBeVisible();
  await expect(facts).toContainText(
    'your own confirmed claim, recorded in your truth ledger, is the evidence this statement rests on',
  );
  // The member's own words, read back from the ledger — not the model's.
  await expect(facts).toContainText(confirmedClaim);
  const citedFactId = (await facts.locator('code').first().innerText()).trim();
  expect(citedFactId).toMatch(/^[0-9a-f-]{36}$/u);
  // The identifier on the page is the confirmed fact this spec created, so the
  // evidence shown is real evidence and not a placeholder that renders for any
  // citation.
  const ledger = await getServiceRows<{ id: string }[]>(
    `/rest/v1/career_facts?select=id&id=eq.${citedFactId}&statement=eq.${encodeURIComponent(confirmedClaim)}`,
  );
  expect(ledger).toHaveLength(1);
  // A cited fact is never left unresolved when the ledger read succeeded.
  await expect(facts.locator('.coach-fact-unresolved')).toHaveCount(0);

  const suggestions = page.getByRole('region', { name: suggestionLabel });
  await expect(suggestions).toBeVisible();
  await expect(
    suggestions.getByText(
      'consider leading every application with the confirmed claim that carries the clearest outcome',
    ),
  ).toBeVisible();
  await expect(suggestions.getByText(/Why Hanaply suggests it:/u)).toBeVisible();
  // An inference is not evidence: it must sit outside the facts region.
  await expect(
    facts.getByText(
      'consider leading every application with the confirmed claim that carries the clearest outcome',
    ),
  ).toHaveCount(0);
});

test('refuses the coach on a plan that does not include it without generating anything', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(page, testAccounts.customer);
  /*
   * The profile is what makes this a refusal rather than a notice.
   *
   * A thread with no profile linked never reaches the meter: the send path
   * answers "this thread is not linked to a career profile" first, and the
   * entitlement is never consulted. Giving the customer a profile puts the
   * request on the path a plan without the coach is actually refused on.
   */
  await ensureCareerProfile(page);
  await page.goto('/dashboard/coach');
  await page.getByRole('button', { name: 'Open the thread' }).click();
  await expect(page).toHaveURL(/\/dashboard\/coach\/[0-9a-f-]{36}$/u);
  const conversationId = page.url().split('/').pop() ?? '';

  await page.getByLabel('Your message').fill('Which role should I target next?');
  await page.getByRole('button', { name: 'Send message' }).click();
  // The API's own wording, not a paraphrase: the plan is the only place the real
  // rule is stated, so the browser has to show what the API actually said.
  await expect(
    page.getByText(/Your current plan does not include coach messages\. Upgrade to use it/u),
  ).toBeVisible();

  /*
   * Nothing was generated. Entitlement is checked before the provider is asked,
   * so the absence of an assistant row and of any invocation record is the
   * durable proof that the model was never reached — the interface could claim
   * anything, and an invocation row is written on every provider call whether it
   * succeeds or is refused.
   */
  const assistantMessages = await getServiceRows<{ id: string }[]>(
    `/rest/v1/coach_messages?select=id&conversation_id=eq.${conversationId}&role=eq.assistant`,
  );
  expect(assistantMessages).toHaveLength(0);

  const member = await getAuthUserByEmail(testAccounts.customer.email);
  expect(member?.id, 'the customer fixture account exists').toBeTruthy();
  const invocations = await getServiceRows<{ id: string }[]>(
    `/rest/v1/ai_invocations?select=id&operation=eq.coach_message&user_id=eq.${member?.id ?? ''}`,
  );
  expect(invocations).toHaveLength(0);
});
