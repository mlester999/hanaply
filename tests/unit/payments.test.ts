import {
  calculateAnnualSavings,
  calculateApprovedSubscriptionTerm,
  calculateSubscriptionTermEnd,
  canTransitionPaymentSubmission,
  normalizePaymentReference,
  paymentQueueQuerySchema,
  paymentReferenceSchema,
} from '@hanaply/contracts';
import { describe, expect, it } from 'vitest';

describe('manual payment contracts', () => {
  it('keeps the locked PHP annual savings exact', () => {
    expect(calculateAnnualSavings(49_900, 479_900)).toBe(118_900);
    expect(calculateAnnualSavings(99_900, 959_900)).toBe(238_900);
  });

  it('preserves safe reference input and creates a stable comparison value', () => {
    expect(paymentReferenceSchema.parse('  gcash-AB 12/3456  ')).toBe('gcash-AB 12/3456');
    expect(normalizePaymentReference('  gcash-AB 12/3456  ')).toBe('GCASHAB123456');
    expect(paymentReferenceSchema.safeParse('<img src=x>').success).toBe(false);
    expect(paymentReferenceSchema.safeParse('ABC\u000012345').success).toBe(false);
  });

  it('parses review-queue boolean query values without treating false as true', () => {
    expect(paymentQueueQuerySchema.parse({ duplicateReference: 'false' }).duplicateReference).toBe(
      false,
    );
    expect(paymentQueueQuerySchema.parse({ duplicateProof: 'true' }).duplicateProof).toBe(true);
    expect(paymentQueueQuerySchema.safeParse({ duplicateProof: 'no' }).success).toBe(false);
  });

  it('allows only the centralized lifecycle transitions', () => {
    expect(canTransitionPaymentSubmission('draft', 'submitted')).toBe(true);
    expect(canTransitionPaymentSubmission('under_review', 'approved')).toBe(true);
    expect(canTransitionPaymentSubmission('needs_information', 'resubmitted')).toBe(true);
    expect(canTransitionPaymentSubmission('draft', 'approved')).toBe(false);
    expect(canTransitionPaymentSubmission('cancelled', 'approved')).toBe(false);
    expect(canTransitionPaymentSubmission('approved', 'submitted')).toBe(false);
  });

  it('uses calendar months and years instead of fixed day approximations', () => {
    expect(calculateSubscriptionTermEnd('2026-01-31T08:30:00.000Z', 'monthly')).toBe(
      '2026-02-28T08:30:00.000Z',
    );
    expect(calculateSubscriptionTermEnd('2024-02-29T08:30:00.000Z', 'annual')).toBe(
      '2025-02-28T08:30:00.000Z',
    );
  });

  it('extends an active renewal from the paid term end and restarts an expired term', () => {
    expect(
      calculateApprovedSubscriptionTerm({
        approvalAt: '2026-07-28T02:00:00.000Z',
        billingPeriod: 'monthly',
        activeCurrentEndAt: '2026-08-31T03:00:00.000Z',
      }),
    ).toEqual({
      startsAt: '2026-07-28T02:00:00.000Z',
      endsAt: '2026-09-30T03:00:00.000Z',
      renewed: true,
    });
    expect(
      calculateApprovedSubscriptionTerm({
        approvalAt: '2026-07-28T02:00:00.000Z',
        billingPeriod: 'annual',
        activeCurrentEndAt: '2026-07-01T00:00:00.000Z',
      }),
    ).toEqual({
      startsAt: '2026-07-28T02:00:00.000Z',
      endsAt: '2027-07-28T02:00:00.000Z',
      renewed: false,
    });
  });
});
