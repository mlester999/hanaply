import { z } from 'zod';

import { billingPeriodSchema, entitlementSnapshotSchema } from './domain.js';

export const paymentMethodTypeSchema = z.enum(['gcash', 'maya', 'bank_transfer', 'other']);

export const paymentSubmissionStatusSchema = z.enum([
  'draft',
  'submitted',
  'under_review',
  'needs_information',
  'resubmitted',
  'approved',
  'rejected',
  'cancelled',
  'expired',
  'refunded',
  'reversed',
]);

export const paymentReviewFlagTypeSchema = z.enum(['duplicate_reference', 'duplicate_proof']);

export const paymentInformationReasonSchema = z.enum([
  'reference_unclear',
  'proof_unclear',
  'details_mismatch',
  'payment_date_unclear',
  'other',
]);

export const paymentRejectionReasonSchema = z.enum([
  'payment_not_found',
  'amount_mismatch',
  'reference_invalid',
  'proof_invalid',
  'proof_reused',
  'details_incomplete',
  'other',
]);

export const subscriptionImpactSchema = z.enum(['none', 'end_access_now']);

const nullableBoundedText = (maximum: number) => z.string().trim().max(maximum).nullable();
const isoTimestamp = z.iso.datetime({ offset: true });

export function normalizePaymentReference(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .toUpperCase()
    .replace(/[\s._:/#-]+/gu, '');
}

export const paymentReferenceSchema = z
  .string()
  .transform((value) => value.normalize('NFKC').trim())
  .pipe(
    z
      .string()
      .min(6, 'Enter at least 6 characters.')
      .max(100, 'Use 100 characters or fewer.')
      .regex(
        /^[A-Za-z0-9][A-Za-z0-9 ._:/#-]*$/u,
        'Use letters, numbers, spaces, and common reference separators only.',
      )
      .refine(
        (value) => !/[\p{Cc}\p{Cf}]/u.test(value),
        'Payment reference cannot contain control characters.',
      )
      .refine(
        (value) => normalizePaymentReference(value).length >= 6,
        'Enter a complete payment reference.',
      ),
  );

export const paymentMethodSnapshotSchema = z.object({
  displayName: z.string().min(1).max(100),
  methodType: paymentMethodTypeSchema,
  currency: z.literal('PHP'),
  accountHolderName: nullableBoundedText(120),
  accountIdentifier: nullableBoundedText(120),
  bankName: nullableBoundedText(120),
  branchDetails: nullableBoundedText(300),
  publicInstructions: z.string().min(1).max(2_000),
  publicNotes: nullableBoundedText(1_000),
  version: z.number().int().positive(),
});

export const paymentMethodSchema = paymentMethodSnapshotSchema.extend({
  id: z.uuid(),
  displayOrder: z.number().int().nonnegative(),
  minimumAmountMinor: z.number().int().positive().nullable(),
  maximumAmountMinor: z.number().int().positive().nullable(),
  effectiveStartAt: isoTimestamp.nullable(),
  effectiveEndAt: isoTimestamp.nullable(),
  qrCodeUrl: z.url().nullable(),
  qrCodeVersion: z.number().int().nonnegative(),
});

export const adminPaymentMethodSchema = paymentMethodSchema.extend({
  enabled: z.boolean(),
  privateNotes: nullableBoundedText(2_000),
  archivedAt: isoTimestamp.nullable(),
  createdBy: z.uuid().nullable(),
  updatedBy: z.uuid().nullable(),
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
});

export const paymentMethodVersionSchema = z.object({
  id: z.uuid(),
  version: z.number().int().positive(),
  changeType: z.string().min(1).max(80),
  changedBy: z.uuid().nullable(),
  snapshot: z.record(z.string(), z.unknown()),
  createdAt: isoTimestamp,
});

export const paymentProofSchema = z.object({
  id: z.uuid(),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  sizeBytes: z.number().int().positive(),
  originalFilename: z.string().min(1).max(120),
  checksumSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  uploadedAt: isoTimestamp,
  previewUrl: z.url().nullable(),
});

export const paymentSubmissionEventSchema = z.object({
  id: z.uuid(),
  eventType: z.string().min(1).max(120),
  previousStatus: paymentSubmissionStatusSchema.nullable(),
  newStatus: paymentSubmissionStatusSchema.nullable(),
  publicMessage: nullableBoundedText(2_000),
  createdAt: isoTimestamp,
});

export const adminPaymentSubmissionEventSchema = paymentSubmissionEventSchema.extend({
  actorUserId: z.uuid().nullable(),
  actorType: z.enum(['user', 'admin', 'service', 'system']),
  internalNote: nullableBoundedText(2_000),
  reasonCode: nullableBoundedText(80),
});

export const paymentSubmissionSchema = z.object({
  id: z.uuid(),
  planCode: z.string().min(1),
  tierCode: z.enum(['plus', 'pro']),
  billingPeriod: billingPeriodSchema,
  quotedAmountMinor: z.number().int().positive(),
  currency: z.literal('PHP'),
  paymentMethodId: z.uuid(),
  paymentMethod: paymentMethodSnapshotSchema,
  referenceNumber: z.string().max(100).nullable(),
  paidAt: isoTimestamp.nullable(),
  userNote: nullableBoundedText(1_000),
  informationResponse: nullableBoundedText(2_000),
  status: paymentSubmissionStatusSchema,
  submittedAt: isoTimestamp.nullable(),
  reviewStartedAt: isoTimestamp.nullable(),
  reviewedAt: isoTimestamp.nullable(),
  publicReviewMessage: nullableBoundedText(2_000),
  rejectionReasonCode: paymentRejectionReasonSchema.nullable(),
  proof: paymentProofSchema.nullable(),
  subscriptionId: z.uuid().nullable(),
  declarationAcceptedAt: isoTimestamp.nullable(),
  version: z.number().int().nonnegative(),
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
  events: z.array(paymentSubmissionEventSchema),
});

export const paymentReviewFlagSchema = z.object({
  id: z.uuid(),
  flagType: paymentReviewFlagTypeSchema,
  warning: z.string().min(1).max(500),
  createdAt: isoTimestamp,
});

export const adminPaymentSubmissionSchema = paymentSubmissionSchema.extend({
  events: z.array(adminPaymentSubmissionEventSchema),
  user: z.object({
    id: z.uuid(),
    email: z.email().nullable(),
    displayName: z.string().max(120).nullable(),
    accountStatus: z.enum(['active', 'suspended', 'disabled', 'pending_deletion']),
  }),
  normalizedReference: z.string().max(100).nullable(),
  reviewerId: z.uuid().nullable(),
  reviewLockExpiresAt: isoTimestamp.nullable(),
  internalReviewNote: nullableBoundedText(2_000),
  approvalTransactionId: z.uuid().nullable(),
  duplicateReference: z.boolean(),
  duplicateProof: z.boolean(),
  flags: z.array(paymentReviewFlagSchema),
  currentSubscription: z
    .object({
      id: z.uuid(),
      planCode: z.string(),
      status: z.string(),
      startsAt: isoTimestamp,
      endsAt: isoTimestamp.nullable(),
      version: z.number().int().nonnegative(),
    })
    .nullable(),
});

export const paymentSubmissionListItemSchema = paymentSubmissionSchema.omit({ events: true });
export const adminPaymentSubmissionListItemSchema = adminPaymentSubmissionSchema.omit({
  events: true,
  flags: true,
});

export const subscriptionEventSchema = z.object({
  id: z.uuid(),
  eventType: z.string().min(1).max(120),
  effectiveAt: isoTimestamp,
  reason: nullableBoundedText(500),
  createdAt: isoTimestamp,
});

export const subscriptionDetailSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  planCode: z.string().min(1),
  tierCode: z.enum(['plus', 'pro']),
  billingPeriod: billingPeriodSchema,
  status: z.enum([
    'pending_activation',
    'active',
    'grace_period',
    'expired',
    'cancelled',
    'suspended',
    'refunded',
    'reversed',
  ]),
  startsAt: isoTimestamp,
  endsAt: isoTimestamp.nullable(),
  source: z.enum(['manual_payment', 'admin_grant', 'migration', 'promotion']),
  version: z.number().int().nonnegative(),
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
  events: z.array(subscriptionEventSchema),
  entitlements: entitlementSnapshotSchema,
});

export const createPaymentDraftSchema = z
  .object({
    planCode: z.enum(['plus_monthly', 'plus_annual', 'pro_monthly', 'pro_annual']),
    paymentMethodId: z.uuid(),
    referenceNumber: paymentReferenceSchema.nullable().optional(),
    paidAt: isoTimestamp.nullable().optional(),
    userNote: nullableBoundedText(1_000).optional(),
  })
  .strict();

export const updatePaymentDraftSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    planCode: z.enum(['plus_monthly', 'plus_annual', 'pro_monthly', 'pro_annual']).optional(),
    paymentMethodId: z.uuid().optional(),
    referenceNumber: paymentReferenceSchema.nullable().optional(),
    paidAt: isoTimestamp.nullable().optional(),
    userNote: nullableBoundedText(1_000).optional(),
    informationResponse: nullableBoundedText(2_000).optional(),
  })
  .strict();

export const versionedPaymentActionSchema = z
  .object({ expectedVersion: z.number().int().nonnegative() })
  .strict();

export const submitPaymentSchema = versionedPaymentActionSchema.extend({
  declarationAccepted: z.literal(true),
});

export const resubmitPaymentSchema = versionedPaymentActionSchema.extend({
  response: z.string().trim().min(1).max(2_000),
  declarationAccepted: z.literal(true),
});

export const paymentMethodMutationSchema = z
  .object({
    displayName: z.string().trim().min(2).max(100),
    methodType: paymentMethodTypeSchema,
    enabled: z.boolean(),
    displayOrder: z.number().int().nonnegative().max(10_000),
    currency: z.literal('PHP').default('PHP'),
    accountHolderName: nullableBoundedText(120),
    accountIdentifier: nullableBoundedText(120),
    bankName: nullableBoundedText(120),
    branchDetails: nullableBoundedText(300),
    publicInstructions: z.string().trim().min(10).max(2_000),
    publicNotes: nullableBoundedText(1_000),
    privateNotes: nullableBoundedText(2_000),
    effectiveStartAt: isoTimestamp.nullable(),
    effectiveEndAt: isoTimestamp.nullable(),
    minimumAmountMinor: z.number().int().positive().nullable(),
    maximumAmountMinor: z.number().int().positive().nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.minimumAmountMinor !== null &&
      value.maximumAmountMinor !== null &&
      value.minimumAmountMinor > value.maximumAmountMinor
    ) {
      context.addIssue({
        code: 'custom',
        path: ['maximumAmountMinor'],
        message: 'Maximum amount must not be lower than the minimum amount.',
      });
    }
    if (
      value.effectiveStartAt &&
      value.effectiveEndAt &&
      Date.parse(value.effectiveStartAt) >= Date.parse(value.effectiveEndAt)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['effectiveEndAt'],
        message: 'Effective end must be later than the effective start.',
      });
    }
  });

export const updatePaymentMethodSchema = paymentMethodMutationSchema.extend({
  expectedVersion: z.number().int().positive(),
});

export const adminVersionedActionSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    reason: z.string().trim().min(10).max(500),
  })
  .strict();

export const requestPaymentInformationSchema = adminVersionedActionSchema.extend({
  reasonCategory: paymentInformationReasonSchema,
  publicMessage: z.string().trim().min(10).max(2_000),
  internalNote: nullableBoundedText(2_000).optional(),
});

export const rejectPaymentSchema = adminVersionedActionSchema.extend({
  rejectionReasonCode: paymentRejectionReasonSchema,
  publicMessage: z.string().trim().min(10).max(2_000),
  internalNote: nullableBoundedText(2_000).optional(),
});

export const approvePaymentSchema = adminVersionedActionSchema.extend({
  internalNote: nullableBoundedText(2_000).optional(),
});

export const recordPaymentRefundSchema = adminVersionedActionSchema.extend({
  refundedAmountMinor: z.number().int().positive(),
  externalReference: nullableBoundedText(120),
  refundedAt: isoTimestamp,
  subscriptionImpact: subscriptionImpactSchema,
  internalNote: nullableBoundedText(2_000),
});

export const reversePaymentSchema = adminVersionedActionSchema.extend({
  subscriptionImpact: z.literal('end_access_now'),
  internalNote: nullableBoundedText(2_000),
});

export const correctSubscriptionSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    startsAt: isoTimestamp,
    endsAt: isoTimestamp,
    reason: z.string().trim().min(10).max(500),
    internalNote: nullableBoundedText(2_000),
    restoreReversed: z.boolean().default(false),
  })
  .strict()
  .refine((value) => Date.parse(value.endsAt) > Date.parse(value.startsAt), {
    path: ['endsAt'],
    message: 'Subscription end must be later than the start.',
  });

const queryBooleanSchema = z.preprocess(
  (value) => (value === 'true' ? true : value === 'false' ? false : value),
  z.boolean(),
);

export const paymentQueueQuerySchema = z
  .object({
    status: paymentSubmissionStatusSchema.optional(),
    planCode: z.string().trim().max(64).optional(),
    billingPeriod: billingPeriodSchema.optional(),
    paymentMethodId: z.uuid().optional(),
    amountMinor: z.coerce.number().int().positive().optional(),
    submittedFrom: isoTimestamp.optional(),
    submittedTo: isoTimestamp.optional(),
    reviewerId: z.uuid().optional(),
    duplicateReference: queryBooleanSchema.optional(),
    duplicateProof: queryBooleanSchema.optional(),
    userSearch: z.string().trim().max(120).optional(),
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

export const paginationDataSchema = z.object({
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
});

export const paymentSubmissionParamsSchema = z.object({ submissionId: z.uuid() }).strict();
export const paymentMethodParamsSchema = z.object({ paymentMethodId: z.uuid() }).strict();
export const subscriptionParamsSchema = z.object({ subscriptionId: z.uuid() }).strict();

type PaymentSubmissionStatus = z.infer<typeof paymentSubmissionStatusSchema>;

export const paymentStatusTransitions: Readonly<
  Record<PaymentSubmissionStatus, readonly PaymentSubmissionStatus[]>
> = Object.freeze({
  draft: ['submitted', 'cancelled'],
  submitted: ['under_review', 'cancelled'],
  under_review: ['needs_information', 'approved', 'rejected'],
  needs_information: ['resubmitted', 'cancelled'],
  resubmitted: ['under_review'],
  approved: ['refunded', 'reversed'],
  rejected: [],
  cancelled: [],
  expired: [],
  refunded: [],
  reversed: [],
});

export function canTransitionPaymentSubmission(
  from: PaymentSubmissionStatus,
  to: PaymentSubmissionStatus,
): boolean {
  return paymentStatusTransitions[from].includes(to);
}

export function calculateAnnualSavings(
  monthlyPriceMinor: number,
  annualPriceMinor: number,
): number {
  if (!Number.isSafeInteger(monthlyPriceMinor) || monthlyPriceMinor <= 0) {
    throw new RangeError('Monthly price must be a positive integer.');
  }
  if (!Number.isSafeInteger(annualPriceMinor) || annualPriceMinor <= 0) {
    throw new RangeError('Annual price must be a positive integer.');
  }
  return monthlyPriceMinor * 12 - annualPriceMinor;
}

function validDate(value: string | Date, label: string): Date {
  const result = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(result.getTime())) throw new RangeError(`${label} must be a valid timestamp.`);
  return result;
}

function addUtcCalendarMonths(source: Date, months: number): Date {
  const result = new Date(source.getTime());
  const originalDay = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(originalDay, lastDay));
  return result;
}

export function calculateSubscriptionTermEnd(
  startsAt: string | Date,
  billingPeriod: z.infer<typeof billingPeriodSchema>,
): string {
  const start = validDate(startsAt, 'Subscription start');
  return addUtcCalendarMonths(start, billingPeriod === 'monthly' ? 1 : 12).toISOString();
}

export function calculateApprovedSubscriptionTerm(input: {
  approvalAt: string | Date;
  billingPeriod: z.infer<typeof billingPeriodSchema>;
  activeCurrentEndAt?: string | Date | null;
}): { startsAt: string; endsAt: string; renewed: boolean } {
  const approvalAt = validDate(input.approvalAt, 'Approval timestamp');
  const currentEnd = input.activeCurrentEndAt
    ? validDate(input.activeCurrentEndAt, 'Current subscription end')
    : null;
  const renewed = currentEnd !== null && currentEnd > approvalAt;
  const termBase = renewed ? currentEnd : approvalAt;
  return {
    startsAt: approvalAt.toISOString(),
    endsAt: calculateSubscriptionTermEnd(termBase, input.billingPeriod),
    renewed,
  };
}

export type PaymentMethod = z.infer<typeof paymentMethodSchema>;
export type AdminPaymentMethod = z.infer<typeof adminPaymentMethodSchema>;
export type PaymentSubmission = z.infer<typeof paymentSubmissionSchema>;
export type AdminPaymentSubmission = z.infer<typeof adminPaymentSubmissionSchema>;
export type SubscriptionDetail = z.infer<typeof subscriptionDetailSchema>;
export type CreatePaymentDraftInput = z.infer<typeof createPaymentDraftSchema>;
export type UpdatePaymentDraftInput = z.infer<typeof updatePaymentDraftSchema>;
export type PaymentMethodMutationInput = z.infer<typeof paymentMethodMutationSchema>;
export type UpdatePaymentMethodInput = z.infer<typeof updatePaymentMethodSchema>;
export type AdminVersionedActionInput = z.infer<typeof adminVersionedActionSchema>;
export type RequestPaymentInformationInput = z.infer<typeof requestPaymentInformationSchema>;
export type ApprovePaymentInput = z.infer<typeof approvePaymentSchema>;
export type RejectPaymentInput = z.infer<typeof rejectPaymentSchema>;
export type RecordPaymentRefundInput = z.infer<typeof recordPaymentRefundSchema>;
export type ReversePaymentInput = z.infer<typeof reversePaymentSchema>;
export type CorrectSubscriptionInput = z.infer<typeof correctSubscriptionSchema>;
export type PaymentQueueQuery = z.infer<typeof paymentQueueQuerySchema>;
