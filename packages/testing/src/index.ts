import type { Plan, TaskEnvelope } from '@hanaply/contracts';
import {
  denyByDefaultEntitlements,
  type EntitlementKey,
  type EntitlementValue,
} from '@hanaply/entitlements';

export const fixedTestNow = new Date('2026-07-22T00:00:00.000Z');

export function completeEntitlementFixture(
  overrides: Partial<Record<EntitlementKey, EntitlementValue>> = {},
): Record<EntitlementKey, EntitlementValue> {
  return { ...denyByDefaultEntitlements, ...overrides };
}

export function planFixture(overrides: Partial<Plan> = {}): Plan {
  return {
    code: 'plus_monthly',
    tierCode: 'plus',
    name: 'Plus Monthly',
    billingPeriod: 'monthly',
    currency: 'PHP',
    priceMinor: 49_900,
    displayOrder: 10,
    entitlements: completeEntitlementFixture({
      careerProfileLimit: 1,
      sourceDiscoveryPriority: 'standard',
      emailAlerts: true,
    }),
    ...overrides,
  };
}

export function taskFixture(overrides: Partial<TaskEnvelope> = {}): TaskEnvelope {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    type: 'foundation.test',
    version: 1,
    correlationId: '22222222-2222-4222-8222-222222222222',
    idempotencyKey: 'foundation-test-001',
    createdAt: fixedTestNow.toISOString(),
    attempt: 0,
    maxAttempts: 5,
    payload: { source: 'test' },
    ...overrides,
  };
}
