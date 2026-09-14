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
  // The throttle keys on the caller's address, and the whole web server calls
  // the API from one address, so the production default of 100 requests a
  // minute is shared by every page in the suite: a single walk through the
  // Career Profile, the radar, and the documents library exceeds it and the
  // product starts answering 429. Raising the bucket keeps the guard in place
  // (the per-route limits are unchanged) while letting one browser do the work
  // a single member does.
  RATE_LIMIT_GLOBAL_LIMIT: '100000',
  RATE_LIMIT_GLOBAL_TTL_MS: '60000',
  OPENAPI_ENABLED: 'true',
  BUILD_SHA: 'e2e',
  EMAIL_PROVIDER: 'capture',
  EMAIL_ALLOW_LIVE_SENDS: 'false',
  // The capture email provider appends rendered mail to the same JSON-lines
  // store the Dockerless mailbox serves, so `waitForEmail` sees application
  // mail as well as the Supabase-Auth-owned messages from the auth double.
  EMAIL_CAPTURE_FILE: supabase.mailboxFile,
  ADMIN_BOOTSTRAP_ENABLED: 'false',
  // The coach and every model-authored surface must run without a paid key, so
  // the suite selects the deterministic fake provider. `packages/config`
  // refuses `fake` outside local/test and requires a model name, and the
  // Playwright service environment is already `HANAPLY_ENV=local`.
  AI_PROVIDER: 'fake',
  AI_MODEL: 'hanaply-e2e-fake',
  // Selecting the fake provider is not enough on its own: it is constructed
  // with an empty script, so every generation fails with `not_configured` and
  // no model-written reply can reach the browser. This scripts one coaching
  // reply per request; `@fact:0` is resolved by the API to the first admissible
  // confirmed fact the request carries, because a static script cannot know a
  // tenant's identifiers. See `services/api/src/ai-fake-script.ts`.
  AI_FAKE_RESPONSES: JSON.stringify({
    career_coaching: [
      {
        facts: [
          {
            statement:
              'your own confirmed claim, recorded in your truth ledger, is the evidence this statement rests on',
            evidenceFactIds: ['@fact:0'],
          },
        ],
        suggestions: [
          {
            kind: 'inference',
            statement:
              'consider leading every application with the confirmed claim that carries the clearest outcome',
            rationale:
              'a reviewer weighs confirmed evidence first, and the order of the material is the part you control',
          },
        ],
        questionsToConfirm: ['which confirmed claim should every application lead with?'],
        nextSteps: ['open the truth ledger and confirm any claim you want cited'],
      },
    ],
  }),
};

export default defineConfig({
  testDir: resolve(root, 'tests/e2e'),
  testIgnore: ['**/local-supabase.ts', '**/global-*.ts'],
  outputDir: resolve(root, 'test-results'),
  globalSetup: resolve(root, 'tests/e2e/global-setup.ts'),
  globalTeardown: resolve(root, 'tests/e2e/global-teardown.ts'),
  fullyParallel: false,
  /**
   * One worker, deliberately.
   *
   * The product surfaces share mutable, account-scoped state: a Plus plan
   * allows exactly one career profile, an Application Pack and a tracker row
   * belong to the member who created them, and the manual-payment catalogue is
   * global — the Activation Center spec has to enable a payment method, and the
   * existing Activation Center assertion requires that no method is available.
   * Two workers running those files concurrently would make the suite's result
   * depend on which file happened to reach a page first, which is a race, not a
   * gate. Tests inside every file already run serially.
   */
  workers: 1,
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
