import {
  denyByDefaultEntitlements,
  EntitlementConfigurationError,
  evaluateEntitlements,
} from '@hanaply/entitlements';
import { completeEntitlementFixture, fixedTestNow, planFixture } from '@hanaply/testing';
import { describe, expect, it } from 'vitest';

const activeSubscription = {
  planCode: 'plus_monthly',
  status: 'active' as const,
  startsAt: '2026-07-01T00:00:00.000Z',
  endsAt: '2026-08-01T00:00:00.000Z',
};

describe('entitlement evaluation', () => {
  it('denies every entitlement when no active subscription exists', () => {
    const result = evaluateEntitlements({ subscription: null, plan: null, now: fixedTestNow });
    expect(result.planCode).toBeNull();
    expect(result.entitlements).toEqual(denyByDefaultEntitlements);
  });

  it('returns a validated database-backed entitlement snapshot', () => {
    const fixture = planFixture();
    const result = evaluateEntitlements({
      subscription: activeSubscription,
      plan: { code: fixture.code, entitlements: fixture.entitlements },
      now: fixedTestNow,
    });
    expect(result.planCode).toBe('plus_monthly');
    expect(result.entitlements.careerProfileLimit).toBe(1);
    expect(result.entitlements.emailAlerts).toBe(true);
  });

  it('fails closed for missing, unknown, malformed, or mismatched plan configuration', () => {
    const complete = completeEntitlementFixture();
    const { emailAlerts: _missing, ...missingValue } = complete;
    void _missing;
    const cases = [
      { code: 'plus_monthly', entitlements: missingValue },
      { code: 'plus_monthly', entitlements: { ...complete, madeUpLimit: 2 } },
      { code: 'plus_monthly', entitlements: { ...complete, careerProfileLimit: -1 } },
      { code: 'pro_monthly', entitlements: complete },
    ];
    for (const plan of cases) {
      expect(() =>
        evaluateEntitlements({ subscription: activeSubscription, plan, now: fixedTestNow }),
      ).toThrow(EntitlementConfigurationError);
    }
  });

  it('denies an expired temporal subscription even if its status says active', () => {
    const fixture = planFixture();
    const result = evaluateEntitlements({
      subscription: { ...activeSubscription, endsAt: '2026-07-20T00:00:00.000Z' },
      plan: { code: fixture.code, entitlements: fixture.entitlements },
      now: fixedTestNow,
    });
    expect(result.planCode).toBeNull();
    expect(result.subscriptionStatus).toBe('inactive');
  });
});
