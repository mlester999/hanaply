import { z } from 'zod';

export const billingPeriodSchema = z.enum(['monthly', 'annual']);
export const subscriptionStatusSchema = z.enum([
  'pending_activation',
  'active',
  'expired',
  'cancelled',
  'suspended',
]);
export const accountStatusSchema = z.enum(['active', 'suspended', 'disabled', 'pending_deletion']);
export const platformSchema = z.enum(['web', 'ios', 'android']);
export const platformLifecycleSchema = z.enum(['planned', 'active', 'maintenance', 'retired']);
export const platformAvailabilitySchema = z.enum([
  'available',
  'planned',
  'maintenance',
  'retired',
  'upgrade_required',
]);

export const entitlementValueSchema = z.union([
  z.boolean(),
  z.number().int().nonnegative(),
  z.string(),
]);

export const planSchema = z.object({
  code: z.string().trim().min(1),
  tierCode: z.enum(['plus', 'pro']),
  name: z.string().trim().min(1),
  billingPeriod: billingPeriodSchema,
  currency: z.string().length(3),
  priceMinor: z.number().int().positive(),
  displayOrder: z.number().int().nonnegative(),
  entitlements: z.record(z.string(), entitlementValueSchema),
});

export const publicProfileSchema = z.object({
  id: z.uuid(),
  firstName: z.string().trim().min(1).max(80).nullable(),
  lastName: z.string().trim().min(1).max(80).nullable(),
  displayName: z.string().nullable(),
  locale: z.string().trim().min(2),
  timezone: z.string().trim().min(1),
  countryCode: z.string().length(2),
  onboardingStatus: z.enum(['not_started', 'in_progress', 'complete']),
  accountStatus: accountStatusSchema,
  emailVerifiedAt: z.iso.datetime({ offset: true }).nullable(),
  lastPasswordChangedAt: z.iso.datetime({ offset: true }).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});

export const subscriptionSummarySchema = z.object({
  planCode: z.string().nullable(),
  status: z.union([subscriptionStatusSchema, z.literal('inactive')]),
  startsAt: z.iso.datetime({ offset: true }).nullable(),
  endsAt: z.iso.datetime({ offset: true }).nullable(),
});

export const entitlementSnapshotSchema = z.object({
  planCode: z.string().nullable(),
  subscriptionStatus: z.union([subscriptionStatusSchema, z.literal('inactive')]),
  validFrom: z.iso.datetime({ offset: true }).nullable(),
  validUntil: z.iso.datetime({ offset: true }).nullable(),
  entitlements: z.record(z.string(), entitlementValueSchema),
});

export const platformEvaluationSchema = z.object({
  platform: platformSchema,
  availability: platformAvailabilitySchema,
  minimumVersion: z.string().nullable(),
  latestVersion: z.string().nullable(),
  forceUpdate: z.boolean(),
  apiCompatibilityVersion: z.number().int().positive(),
  announcement: z.string().nullable(),
});

export const featureFlagResultSchema = z.record(z.string(), z.boolean());

export type Plan = z.infer<typeof planSchema>;
export type PublicProfile = z.infer<typeof publicProfileSchema>;
export type SubscriptionSummary = z.infer<typeof subscriptionSummarySchema>;
export type EntitlementSnapshot = z.infer<typeof entitlementSnapshotSchema>;
export type Platform = z.infer<typeof platformSchema>;
export type PlatformEvaluation = z.infer<typeof platformEvaluationSchema>;
