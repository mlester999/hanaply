import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { testAccounts } from './accounts.js';
import { expect, signIn, test } from './product.js';
import type { Page } from './browser-health.js';

/**
 * Full-page captures of every product surface at the three required widths.
 *
 * Assertions alone cannot see a clipped card, an unreadable label, a control
 * that looks disabled while it is live, or half a page of unexplained blank
 * space, so this file exists to be looked at. It writes PNGs to
 * `test-results/visual/`, and every capture is preceded by the same
 * "the page actually rendered" check so a blank or failed page cannot pass as a
 * screenshot.
 */
test.describe.configure({ mode: 'serial' });

const outputDir = resolve(import.meta.dirname, '..', '..', 'test-results', 'visual');
const viewports = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
] as const;

mkdirSync(outputDir, { recursive: true });

async function capture(page: Page, name: string, heading: string | RegExp): Promise<void> {
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: heading, level: 1 }).first()).toBeVisible();
  // Let fonts, charts, and any late layout settle before the frame is taken.
  await page.waitForLoadState('networkidle');
  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.waitForTimeout(150);
    await page.screenshot({
      path: resolve(outputDir, `${name}-${viewport.name}.png`),
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}

test('captures the radar and an opportunity', async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, testAccounts.radar);
  await page.goto('/dashboard/radar');
  await capture(page, 'radar', 'Job radar');

  await page.locator('.radar-card-title a').first().click();
  await expect(page).toHaveURL(/\/dashboard\/radar\/[0-9a-f-]{36}$/u);
  await capture(page, 'opportunity', /^[A-Z]/u);
});

test('captures the career profile, documents, and truth ledger', async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, testAccounts.career);
  await page.goto('/dashboard/career');
  await page.getByRole('link', { name: 'Open profile' }).first().click();
  await capture(page, 'career-profile', 'Primary search');

  await page.goto('/dashboard/career/documents');
  await capture(page, 'career-documents', 'Documents');

  await page.goto('/dashboard/career');
  await page.getByRole('link', { name: 'Truth ledger' }).first().click();
  await capture(page, 'truth-ledger', 'Truth ledger');
});

test('captures an application pack and the tracker', async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, testAccounts.packs);
  await page.goto('/dashboard/packs');
  const packLink = page.getByRole('link', { name: 'Open this pack' }).first();
  if ((await packLink.count()) > 0) {
    await packLink.click();
    await capture(page, 'application-pack', /^[A-Z]/u);
  } else {
    await capture(page, 'application-pack', 'Your packs');
  }

  await page.goto('/dashboard/applications');
  await capture(page, 'tracker', 'Your pipeline');
});

test('captures the Activation Center', async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, testAccounts.payments);
  await page.goto('/dashboard/activation');
  await capture(page, 'activation', 'Activate Hanaply');
});

test('captures the admin payment review', async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, testAccounts.admin, { admin: true });
  await page.goto('/admin/payments');
  const review = page.getByRole('link', { name: 'Review' }).first();
  if ((await review.count()) > 0) {
    await review.click();
    await capture(page, 'admin-payment-review', /^Payment /u);
  } else {
    await capture(page, 'admin-payment-review', 'Payment Reviews');
  }
});

test('captures the coach', async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, testAccounts.coach);
  await page.goto('/dashboard/coach');
  await capture(page, 'coach', 'Coach');
});
