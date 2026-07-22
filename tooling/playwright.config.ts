import { resolve } from 'node:path';

import { defineConfig, devices } from '@playwright/test';

import { readLocalSupabaseEnvironment } from '../tests/e2e/local-supabase.js';

const root = resolve(import.meta.dirname, '..');
const supabase = readLocalSupabaseEnvironment();
const appUrl = 'http://localhost:3100';
const apiUrl = 'http://localhost:3101';
const serviceEnvironment = {
  ...process.env,
  NODE_ENV: 'development',
  HANAPLY_ENV: 'local',
  LOG_LEVEL: 'info',
  APP_BASE_URL: appUrl,
  API_BASE_URL: apiUrl,
  NEXT_PUBLIC_APP_URL: appUrl,
  NEXT_PUBLIC_API_URL: apiUrl,
  NEXT_PUBLIC_SUPABASE_URL: supabase.apiUrl,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: supabase.publishableKey,
  SUPABASE_URL: supabase.apiUrl,
  SUPABASE_PUBLISHABLE_KEY: supabase.publishableKey,
  SUPABASE_SERVICE_ROLE_KEY: supabase.serviceRoleKey,
  SUPABASE_DB_URL: supabase.databaseUrl,
  SUPABASE_PROJECT_REF: 'local',
  API_PORT: '3101',
  CORS_ALLOWED_ORIGINS: appUrl,
  RATE_LIMIT_STORE: 'memory',
  OPENAPI_ENABLED: 'true',
  BUILD_SHA: 'e2e',
};

export default defineConfig({
  testDir: resolve(root, 'tests/e2e'),
  testIgnore: ['**/local-supabase.ts', '**/global-*.ts'],
  outputDir: resolve(root, 'test-results'),
  globalSetup: resolve(root, 'tests/e2e/global-setup.ts'),
  globalTeardown: resolve(root, 'tests/e2e/global-teardown.ts'),
  fullyParallel: false,
  workers: process.env.CI ? 1 : 2,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [['line'], ['html', { outputFolder: resolve(root, 'playwright-report'), open: 'never' }]]
    : [['list'], ['html', { outputFolder: resolve(root, 'playwright-report'), open: 'never' }]],
  expect: { timeout: 10_000 },
  timeout: 45_000,
  use: {
    ...devices['Desktop Chrome'],
    baseURL: appUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'pnpm --filter @hanaply/api dev',
      cwd: root,
      env: serviceEnvironment,
      url: `${apiUrl}/v1/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'pnpm --filter @hanaply/web dev',
      cwd: root,
      env: serviceEnvironment,
      url: appUrl,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
