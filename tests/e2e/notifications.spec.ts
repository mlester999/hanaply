import { testAccounts } from './accounts.js';
import { expect, signIn, test } from './product.js';

/**
 * Notification preferences: what renders, what saves, what survives a reload,
 * and what the plan refuses. Security mail is mandatory and shown as such; the
 * optional categories are consent plus entitlement.
 */
test.describe.configure({ mode: 'serial' });

test('renders the preferences, saves them, and keeps the saved values on reload', async ({
  page,
}) => {
  await signIn(page, testAccounts.customer);
  await page.goto('/dashboard/settings/notifications');
  await expect(page.getByRole('heading', { name: 'Notifications', level: 1 })).toBeVisible();
  await expect(page.getByText('Explicit consent')).toBeVisible();

  // Security mail is mandatory and is shown as a locked, already-on control.
  const security = page.getByLabel('Authentication and security emails');
  await expect(security).toBeChecked();
  await expect(security).toBeDisabled();

  const product = page.getByLabel('Product update emails');
  const marketing = page.getByLabel('Marketing emails');
  if (await product.isChecked()) await product.uncheck();
  await marketing.check();
  await page.locator('#quietHoursStart').fill('22');
  await page.locator('#quietHoursEnd').fill('6');
  await page.getByRole('button', { name: 'Save Preferences' }).click();
  await expect(page.getByText('Your optional email preferences were saved.')).toBeVisible();

  await page.reload();
  await expect(page.getByLabel('Product update emails')).not.toBeChecked();
  await expect(page.getByLabel('Marketing emails')).toBeChecked();
  await expect(page.locator('#quietHoursStart')).toHaveValue('22');
  await expect(page.locator('#quietHoursEnd')).toHaveValue('6');
});

test('shows the plan restriction and enforces it when a category is switched on', async ({
  page,
}) => {
  await signIn(page, testAccounts.customer);
  await page.goto('/dashboard/settings/notifications');

  // The restriction is visible before anything is submitted.
  await expect(
    page.getByText(
      'Instant alerts require the Pro plan. Your current plan does not include it yet',
    ),
  ).toBeVisible();
  await expect(page.getByText('Job alerts are included with Plus and Pro.')).toBeVisible();

  const instant = page.getByLabel('Instant alert emails');
  await expect(instant).not.toBeChecked();
  await instant.check();
  await page.getByRole('button', { name: 'Save Preferences' }).click();
  await expect(page.getByText('Preferences not saved')).toBeVisible();
  await expect(
    page.getByText(
      /Instant alerts are not included in your current plan\. Upgrade to the Pro plan to turn them on\./u,
    ),
  ).toBeVisible();

  // Refused means not saved: the value is unchanged on the server.
  await page.reload();
  await expect(page.getByLabel('Instant alert emails')).not.toBeChecked();
});
