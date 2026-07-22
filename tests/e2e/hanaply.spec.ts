import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { testAccounts } from './accounts.js';

const requiredWidths = [1440, 1280, 1024, 768, 430, 390, 360] as const;

async function signIn(
  page: Page,
  account: { email: string; password: string },
  options: { admin?: boolean } = {},
): Promise<void> {
  await page.goto(options.admin ? '/admin/login' : '/login');
  await page.getByLabel('Email address').fill(account.email);
  await page.getByLabel('Password').fill(account.password);
  await page
    .getByRole('button', { name: options.admin ? 'Continue to Admin' : 'Sign In Securely' })
    .click();
}

async function expectNoHorizontalOverflow(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow, `horizontal overflow at ${width}px`).toBe(false);
}

async function expectAxeClean(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
}

test('protects customer routes and supports password login and logout', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/u);

  await signIn(page, testAccounts.customer);
  await expect(page).toHaveURL('/dashboard');
  await expect(page.getByRole('heading', { name: 'Career Radar', exact: true })).toBeVisible();
  await expect(page.getByText('No radar configured')).toBeVisible();
  await expectAxeClean(page);

  await page.getByRole('button', { name: 'Sign Out' }).click();
  await expect(page).toHaveURL('/login');
});

test('enforces suspended-account and administrator boundaries', async ({ page }) => {
  await signIn(page, testAccounts.suspended);
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

test('serves the protected admin shell from database-derived membership', async ({ page }) => {
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/login\?next=%2Fadmin$/u);
  await signIn(page, testAccounts.admin, { admin: true });
  await expect(page).toHaveURL('/admin');
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await expect(page.getByText('No operational metrics')).toBeVisible();
  await expectAxeClean(page);
});

test('loads database-backed pricing without fallback claims', async ({ page }) => {
  await page.goto('/pricing');
  await expect(page.getByRole('heading', { name: 'Plus Monthly' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Plus Annual' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Pro Monthly' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Pro Annual' })).toBeVisible();
  await expect(page.getByText('₱499')).toBeVisible();
  await expect(page.getByText('₱9,599')).toBeVisible();
  await expect(page.getByText('Plan catalog is temporarily unavailable')).not.toBeVisible();
  await expectAxeClean(page);
});

test('has no horizontal overflow at every required marketing width', async ({ page }) => {
  await page.goto('/');
  for (const width of requiredWidths) await expectNoHorizontalOverflow(page, width);
});

test('has no horizontal overflow at every required customer width', async ({ page }) => {
  await signIn(page, testAccounts.customer);
  await expect(page).toHaveURL('/dashboard');
  for (const width of requiredWidths) await expectNoHorizontalOverflow(page, width);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Open workspace menu' }).click();
  await expect(page.getByRole('navigation', { name: 'Dashboard navigation' })).toBeVisible();
});

test('has no horizontal overflow at every required admin width', async ({ page }) => {
  await signIn(page, testAccounts.admin, { admin: true });
  await expect(page).toHaveURL('/admin');
  for (const width of requiredWidths) await expectNoHorizontalOverflow(page, width);
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
});

test('passes public-page Axe scans and exposes security headers', async ({ page }) => {
  for (const path of ['/', '/login', '/pricing', '/security']) {
    const response = await page.goto(path);
    expect(response?.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(response?.headers()['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(response?.headers()['permissions-policy']).toContain('camera=()');
    await expectAxeClean(page);
  }
});
