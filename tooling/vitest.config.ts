import { resolve } from 'node:path';

import { defineConfig } from 'vitest/config';

const root = resolve(import.meta.dirname, '..');
const source = (path: string) => resolve(root, path);

export default defineConfig({
  resolve: {
    alias: [
      {
        find: '@hanaply/contracts/openapi',
        replacement: source('packages/contracts/src/openapi.ts'),
      },
      { find: '@hanaply/ai', replacement: source('packages/ai/src/index.ts') },
      { find: /^@hanaply\/ai\/(.*)$/, replacement: `${source('packages/ai/src')}/$1.ts` },
      { find: '@hanaply/auth', replacement: source('packages/auth/src/index.ts') },
      { find: '@hanaply/config', replacement: source('packages/config/src/index.ts') },
      { find: '@hanaply/contracts', replacement: source('packages/contracts/src/index.ts') },
      { find: '@hanaply/database', replacement: source('packages/database/src/index.ts') },
      { find: '@hanaply/email', replacement: source('packages/email/src/index.ts') },
      { find: '@hanaply/entitlements', replacement: source('packages/entitlements/src/index.ts') },
      { find: '@hanaply/jobs', replacement: source('packages/jobs/src/index.ts') },
      { find: '@hanaply/matching', replacement: source('packages/matching/src/index.ts') },
      {
        find: '@hanaply/observability',
        replacement: source('packages/observability/src/index.ts'),
      },
      { find: '@hanaply/platform', replacement: source('packages/platform/src/index.ts') },
      { find: '@hanaply/testing', replacement: source('packages/testing/src/index.ts') },
      { find: '@hanaply/ui', replacement: source('packages/ui/src/index.ts') },
      { find: /^@\/(.*)$/, replacement: `${source('apps/web/src')}/$1` },
    ],
  },
  test: {
    environment: 'node',
    include: [
      'tests/unit/**/*.test.{ts,tsx}',
      'tests/integration/**/*.test.{ts,tsx}',
      'tests/component/**/*.test.{ts,tsx}',
    ],
    passWithNoTests: false,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: resolve(root, 'coverage'),
      include: ['packages/*/src/**/*.{ts,tsx}', 'services/*/src/**/*.ts'],
      exclude: ['**/generated.types.ts', '**/main.ts'],
    },
  },
});
