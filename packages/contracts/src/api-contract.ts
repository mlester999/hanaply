import { z } from 'zod';
import { notificationPreferencesSchema, profileUpdateSchema } from '@hanaply/auth';

import {
  accountStatusSchema,
  entitlementSnapshotSchema,
  featureFlagResultSchema,
  planSchema,
  platformEvaluationSchema,
  platformSchema,
  publicProfileSchema,
  subscriptionStatusSchema,
  subscriptionSummarySchema,
} from './domain.js';
import { successEnvelopeSchema } from './errors.js';
import {
  adminPaymentMethodSchema,
  adminPaymentSubmissionListItemSchema,
  adminPaymentSubmissionSchema,
  adminVersionedActionSchema,
  approvePaymentSchema,
  correctSubscriptionSchema,
  createPaymentDraftSchema,
  paginationDataSchema,
  paymentMethodMutationSchema,
  paymentMethodParamsSchema,
  paymentMethodSchema,
  paymentMethodVersionSchema,
  paymentProofSchema,
  paymentQueueQuerySchema,
  paymentSubmissionListItemSchema,
  paymentSubmissionParamsSchema,
  paymentSubmissionSchema,
  paymentSubmissionStatusSchema,
  recordPaymentRefundSchema,
  rejectPaymentSchema,
  requestPaymentInformationSchema,
  resubmitPaymentSchema,
  reversePaymentSchema,
  submitPaymentSchema,
  subscriptionDetailSchema,
  subscriptionParamsSchema,
  updatePaymentDraftSchema,
  updatePaymentMethodSchema,
  versionedPaymentActionSchema,
} from './payments.js';

export type ApiAuthRequirement = 'public' | 'user' | 'admin';

export interface ApiRoute<TResponse extends z.ZodType = z.ZodType> {
  readonly method: 'GET' | 'PATCH' | 'POST' | 'DELETE';
  readonly path: `/v1/${string}`;
  readonly operationId: string;
  readonly summary: string;
  readonly auth: ApiAuthRequirement;
  readonly successStatus: 200;
  readonly query?: z.ZodObject;
  readonly params?: z.ZodObject;
  readonly body?: z.ZodType;
  readonly multipartBody?: z.ZodObject;
  readonly response: TResponse;
}

const healthDataSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('api'),
  version: z.string(),
  timestamp: z.iso.datetime({ offset: true }),
});

const readinessDataSchema = z.object({
  status: z.enum(['ready', 'not_ready']),
  checks: z.object({ supabase: z.enum(['up', 'down']) }),
  timestamp: z.iso.datetime({ offset: true }),
});

const versionDataSchema = z.object({
  apiVersion: z.literal('v1'),
  serviceVersion: z.string(),
  buildSha: z.string(),
});

export const metaQuerySchema = z.object({
  platform: platformSchema.default('web'),
  clientVersion: z.string().trim().min(1).optional(),
});

const metaDataSchema = z.object({
  defaultLocale: z.literal('en-PH'),
  defaultCurrency: z.literal('PHP'),
  defaultTimezone: z.literal('Asia/Manila'),
  platform: platformEvaluationSchema,
  featureFlags: featureFlagResultSchema,
});

const meDataSchema = z.object({
  profile: publicProfileSchema,
  subscription: subscriptionSummarySchema,
});

const notificationPreferencesDataSchema = notificationPreferencesSchema.extend({
  securityEmails: z.literal(true),
  futureJobAlerts: z.literal(false),
  futureDailyDigest: z.literal(false),
  updatedAt: z.iso.datetime({ offset: true }),
});

const sessionDataSchema = z.object({
  id: z.uuid(),
  createdAt: z.iso.datetime({ offset: true }),
  lastSeenAt: z.iso.datetime({ offset: true }),
  userAgent: z.string().max(200).nullable(),
  current: z.boolean(),
});

const adminMeDataSchema = z.object({
  userId: z.uuid(),
  roles: z.array(z.string()),
  permissions: z.array(z.string()),
});

const paginationSchema = z.object({
  page: z.number().int().positive(),
  pageSize: z.number().int().min(1).max(100),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
});

const adminOverviewDataSchema = z.object({
  registeredUsers: z.number().int().nonnegative(),
  verifiedUsers: z.number().int().nonnegative(),
  suspendedUsers: z.number().int().nonnegative(),
  activeAdministrators: z.number().int().nonnegative(),
  authenticationEventsLast24Hours: z.number().int().nonnegative(),
  evaluatedAt: z.iso.datetime({ offset: true }),
});

export const adminUsersQuerySchema = z
  .object({
    search: z.string().trim().max(120).optional(),
    verification: z.enum(['all', 'verified', 'unverified']).default('all'),
    accountStatus: accountStatusSchema.optional(),
    createdFrom: z.iso.datetime({ offset: true }).optional(),
    createdTo: z.iso.datetime({ offset: true }).optional(),
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.createdFrom &&
      value.createdTo &&
      Date.parse(value.createdFrom) > Date.parse(value.createdTo)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['createdTo'],
        message: 'Creation end date must not be earlier than the start date.',
      });
    }
  });

export const adminUserParamsSchema = z.object({ userId: z.uuid() }).strict();

export const adminAccountActionSchema = z
  .object({
    reason: z.string().trim().min(10).max(500),
  })
  .strict();

const adminUserSummarySchema = z.object({
  userId: z.uuid(),
  email: z.email().nullable(),
  emailVerified: z.boolean(),
  emailVerifiedAt: z.iso.datetime({ offset: true }).nullable(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  displayName: z.string().nullable(),
  accountStatus: accountStatusSchema,
  subscriptionPlanCode: z.string().nullable(),
  subscriptionStatus: subscriptionStatusSchema.nullable(),
  adminRoles: z.array(z.string()),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});

const safeAuditValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])),
]);

const safeAuditMapSchema = z.record(z.string(), safeAuditValueSchema);

const adminAuditEventSchema = z.object({
  id: z.uuid(),
  actorUserId: z.uuid().nullable(),
  actorType: z.enum(['system', 'user', 'admin', 'service']),
  action: z.string(),
  targetType: z.string(),
  targetId: z.uuid().nullable(),
  requestId: z.uuid().nullable(),
  before: safeAuditMapSchema,
  after: safeAuditMapSchema,
  metadata: safeAuditMapSchema,
  createdAt: z.iso.datetime({ offset: true }),
});

const adminUserDetailSchema = z.object({
  userId: z.uuid(),
  email: z.email().nullable(),
  emailVerified: z.boolean(),
  emailVerifiedAt: z.iso.datetime({ offset: true }).nullable(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  displayName: z.string().nullable(),
  locale: z.string(),
  timezone: z.string(),
  countryCode: z.string().length(2),
  onboardingStatus: z.enum(['not_started', 'in_progress', 'complete']),
  accountStatus: accountStatusSchema,
  subscriptionPlanCode: z.string().nullable(),
  subscriptionStatus: subscriptionStatusSchema.nullable(),
  subscriptionStartsAt: z.iso.datetime({ offset: true }).nullable(),
  subscriptionEndsAt: z.iso.datetime({ offset: true }).nullable(),
  adminMembershipStatus: z.string().nullable(),
  adminRoles: z.array(z.string()),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  recentAuditEvents: z.array(adminAuditEventSchema),
  auditVisible: z.boolean(),
});

export const adminAuditQuerySchema = z
  .object({
    actorUserId: z.uuid().optional(),
    action: z.string().trim().max(120).optional(),
    targetType: z.string().trim().max(80).optional(),
    targetId: z.uuid().optional(),
    requestId: z.uuid().optional(),
    occurredFrom: z.iso.datetime({ offset: true }).optional(),
    occurredTo: z.iso.datetime({ offset: true }).optional(),
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.occurredFrom &&
      value.occurredTo &&
      Date.parse(value.occurredFrom) > Date.parse(value.occurredTo)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['occurredTo'],
        message: 'Audit end date must not be earlier than the start date.',
      });
    }
  });

const adminSecurityDataSchema = z.object({
  authentication: z.object({ provider: z.literal('supabase'), configured: z.literal(true) }),
  email: z.object({
    provider: z.enum(['disabled', 'capture', 'resend']),
    liveDeliveryEnabled: z.boolean(),
  }),
  bootstrap: z.object({ enabled: z.boolean() }),
  rowLevelSecurity: z.object({ enforcement: z.literal('database'), validation: z.literal('ci') }),
  sessions: z.object({ bearerOnlyApi: z.literal(true), databaseRevocationCheck: z.literal(true) }),
  passwordRecovery: z.object({ enabled: z.literal(true), tokenLogging: z.literal(false) }),
});

const myPaymentSubmissionsQuerySchema = z
  .object({
    status: paymentSubmissionStatusSchema.optional(),
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

const adminPaymentMethodDetailSchema = adminPaymentMethodSchema.extend({
  versions: z.array(paymentMethodVersionSchema),
});

export type AdminPaymentMethodDetail = z.infer<typeof adminPaymentMethodDetailSchema>;

const signedAccessSchema = z.object({
  url: z.url(),
  expiresAt: z.iso.datetime({ offset: true }),
});

const paymentImageUploadSchema = z.object({
  file: z.string().meta({ format: 'binary', description: 'JPEG, PNG, or WebP image bytes' }),
});

const adminSubscriptionsQuerySchema = z
  .object({
    status: subscriptionStatusSchema.optional(),
    planCode: z.string().trim().max(64).optional(),
    userSearch: z.string().trim().max(120).optional(),
    expiringBefore: z.iso.datetime({ offset: true }).optional(),
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

const adminSubscriptionListItemSchema = subscriptionDetailSchema.omit({
  events: true,
  entitlements: true,
});

export type AdminUserSummary = z.infer<typeof adminUserSummarySchema>;
export type AdminUserDetail = z.infer<typeof adminUserDetailSchema>;
export type AdminAuditEvent = z.infer<typeof adminAuditEventSchema>;

function defineRoute<const TRoute extends ApiRoute>(route: TRoute): TRoute {
  return route;
}

export const apiContract = Object.freeze({
  health: defineRoute({
    method: 'GET',
    path: '/v1/health',
    operationId: 'getHealth',
    summary: 'API liveness',
    auth: 'public',
    successStatus: 200,
    response: successEnvelopeSchema(healthDataSchema),
  }),
  ready: defineRoute({
    method: 'GET',
    path: '/v1/ready',
    operationId: 'getReadiness',
    summary: 'API dependency readiness',
    auth: 'public',
    successStatus: 200,
    response: successEnvelopeSchema(readinessDataSchema),
  }),
  version: defineRoute({
    method: 'GET',
    path: '/v1/version',
    operationId: 'getVersion',
    summary: 'API and build version',
    auth: 'public',
    successStatus: 200,
    response: successEnvelopeSchema(versionDataSchema),
  }),
  meta: defineRoute({
    method: 'GET',
    path: '/v1/meta',
    operationId: 'getMeta',
    summary: 'Platform compatibility and public flags',
    auth: 'public',
    successStatus: 200,
    query: metaQuerySchema,
    response: successEnvelopeSchema(metaDataSchema),
  }),
  plans: defineRoute({
    method: 'GET',
    path: '/v1/plans',
    operationId: 'listPlans',
    summary: 'Active public plans',
    auth: 'public',
    successStatus: 200,
    response: successEnvelopeSchema(z.array(planSchema)),
  }),
  paymentMethods: defineRoute({
    method: 'GET',
    path: '/v1/payment-methods',
    operationId: 'listPaymentMethods',
    summary: 'Enabled manual payment methods for an active account',
    auth: 'user',
    successStatus: 200,
    response: successEnvelopeSchema(z.array(paymentMethodSchema)),
  }),
  me: defineRoute({
    method: 'GET',
    path: '/v1/me',
    operationId: 'getMe',
    summary: 'Current user profile',
    auth: 'user',
    successStatus: 200,
    response: successEnvelopeSchema(meDataSchema),
  }),
  updateMe: defineRoute({
    method: 'PATCH',
    path: '/v1/me',
    operationId: 'updateMe',
    summary: 'Update safe current-user profile fields',
    auth: 'user',
    successStatus: 200,
    body: profileUpdateSchema,
    response: successEnvelopeSchema(publicProfileSchema),
  }),
  preferences: defineRoute({
    method: 'GET',
    path: '/v1/me/preferences',
    operationId: 'getMyPreferences',
    summary: 'Current user notification preferences',
    auth: 'user',
    successStatus: 200,
    response: successEnvelopeSchema(notificationPreferencesDataSchema),
  }),
  updatePreferences: defineRoute({
    method: 'PATCH',
    path: '/v1/me/preferences',
    operationId: 'updateMyPreferences',
    summary: 'Update optional current-user notification preferences',
    auth: 'user',
    successStatus: 200,
    body: notificationPreferencesSchema,
    response: successEnvelopeSchema(notificationPreferencesDataSchema),
  }),
  sessions: defineRoute({
    method: 'GET',
    path: '/v1/me/sessions',
    operationId: 'getMySessions',
    summary: 'Safe current-user session summaries',
    auth: 'user',
    successStatus: 200,
    response: successEnvelopeSchema(z.array(sessionDataSchema)),
  }),
  revokeOtherSessions: defineRoute({
    method: 'POST',
    path: '/v1/me/sessions/revoke-others',
    operationId: 'revokeMyOtherSessions',
    summary: 'Revoke every session except the current session',
    auth: 'user',
    successStatus: 200,
    response: successEnvelopeSchema(z.object({ revoked: z.literal(true) })),
  }),
  entitlements: defineRoute({
    method: 'GET',
    path: '/v1/me/entitlements',
    operationId: 'getMyEntitlements',
    summary: 'Current user entitlements',
    auth: 'user',
    successStatus: 200,
    response: successEnvelopeSchema(entitlementSnapshotSchema),
  }),
  mySubscription: defineRoute({
    method: 'GET',
    path: '/v1/me/subscription',
    operationId: 'getMySubscription',
    summary: 'Authoritative current subscription and entitlement detail',
    auth: 'user',
    successStatus: 200,
    response: successEnvelopeSchema(subscriptionDetailSchema.nullable()),
  }),
  myPaymentSubmissions: defineRoute({
    method: 'GET',
    path: '/v1/me/payment-submissions',
    operationId: 'listMyPaymentSubmissions',
    summary: 'Paginated current-user manual payment history',
    auth: 'user',
    successStatus: 200,
    query: myPaymentSubmissionsQuerySchema,
    response: successEnvelopeSchema(
      z.object({
        items: z.array(paymentSubmissionListItemSchema),
        pagination: paginationDataSchema,
      }),
    ),
  }),
  createPaymentSubmission: defineRoute({
    method: 'POST',
    path: '/v1/me/payment-submissions',
    operationId: 'createPaymentSubmission',
    summary: 'Create a canonical manual payment draft',
    auth: 'user',
    successStatus: 200,
    body: createPaymentDraftSchema,
    response: successEnvelopeSchema(paymentSubmissionSchema),
  }),
  myPaymentSubmission: defineRoute({
    method: 'GET',
    path: '/v1/me/payment-submissions/{submissionId}',
    operationId: 'getMyPaymentSubmission',
    summary: 'Current-user manual payment detail and lifecycle history',
    auth: 'user',
    successStatus: 200,
    params: paymentSubmissionParamsSchema,
    response: successEnvelopeSchema(paymentSubmissionSchema),
  }),
  updatePaymentSubmission: defineRoute({
    method: 'PATCH',
    path: '/v1/me/payment-submissions/{submissionId}',
    operationId: 'updatePaymentSubmission',
    summary: 'Update allowed draft or information-requested payment fields',
    auth: 'user',
    successStatus: 200,
    params: paymentSubmissionParamsSchema,
    body: updatePaymentDraftSchema,
    response: successEnvelopeSchema(paymentSubmissionSchema),
  }),
  deletePaymentDraft: defineRoute({
    method: 'DELETE',
    path: '/v1/me/payment-submissions/{submissionId}',
    operationId: 'deletePaymentDraft',
    summary: 'Cancel a draft and clean its private proof',
    auth: 'user',
    successStatus: 200,
    params: paymentSubmissionParamsSchema,
    body: versionedPaymentActionSchema,
    response: successEnvelopeSchema(paymentSubmissionSchema),
  }),
  uploadPaymentProof: defineRoute({
    method: 'POST',
    path: '/v1/me/payment-submissions/{submissionId}/proof',
    operationId: 'uploadPaymentProof',
    summary: 'Validate, sanitize, checksum, and privately store a payment proof image',
    auth: 'user',
    successStatus: 200,
    params: paymentSubmissionParamsSchema,
    multipartBody: paymentImageUploadSchema,
    response: successEnvelopeSchema(paymentProofSchema),
  }),
  myPaymentProofAccess: defineRoute({
    method: 'GET',
    path: '/v1/me/payment-submissions/{submissionId}/proof-access',
    operationId: 'getMyPaymentProofAccess',
    summary: 'Create short-lived access to the current-user payment proof',
    auth: 'user',
    successStatus: 200,
    params: paymentSubmissionParamsSchema,
    response: successEnvelopeSchema(signedAccessSchema),
  }),
  submitPaymentSubmission: defineRoute({
    method: 'POST',
    path: '/v1/me/payment-submissions/{submissionId}/submit',
    operationId: 'submitPaymentSubmission',
    summary: 'Submit a declared payment draft for review without granting access',
    auth: 'user',
    successStatus: 200,
    params: paymentSubmissionParamsSchema,
    body: submitPaymentSchema,
    response: successEnvelopeSchema(paymentSubmissionSchema),
  }),
  cancelPaymentSubmission: defineRoute({
    method: 'POST',
    path: '/v1/me/payment-submissions/{submissionId}/cancel',
    operationId: 'cancelPaymentSubmission',
    summary: 'Cancel a payment submission in an allowed pending state',
    auth: 'user',
    successStatus: 200,
    params: paymentSubmissionParamsSchema,
    body: versionedPaymentActionSchema,
    response: successEnvelopeSchema(paymentSubmissionSchema),
  }),
  resubmitPaymentSubmission: defineRoute({
    method: 'POST',
    path: '/v1/me/payment-submissions/{submissionId}/resubmit',
    operationId: 'resubmitPaymentSubmission',
    summary: 'Respond to an information request and return the payment to review',
    auth: 'user',
    successStatus: 200,
    params: paymentSubmissionParamsSchema,
    body: resubmitPaymentSchema,
    response: successEnvelopeSchema(paymentSubmissionSchema),
  }),
  adminMe: defineRoute({
    method: 'GET',
    path: '/v1/admin/me',
    operationId: 'getAdminMe',
    summary: 'Current administrator roles and permissions',
    auth: 'admin',
    successStatus: 200,
    response: successEnvelopeSchema(adminMeDataSchema),
  }),
  adminOverview: defineRoute({
    method: 'GET',
    path: '/v1/admin/overview',
    operationId: 'getAdminOverview',
    summary: 'Real Phase 1 administrator overview counts',
    auth: 'admin',
    successStatus: 200,
    response: successEnvelopeSchema(adminOverviewDataSchema),
  }),
  adminUsers: defineRoute({
    method: 'GET',
    path: '/v1/admin/users',
    operationId: 'listAdminUsers',
    summary: 'Paginated and filtered user directory',
    auth: 'admin',
    successStatus: 200,
    query: adminUsersQuerySchema,
    response: successEnvelopeSchema(
      z.object({ items: z.array(adminUserSummarySchema), pagination: paginationSchema }),
    ),
  }),
  adminUser: defineRoute({
    method: 'GET',
    path: '/v1/admin/users/{userId}',
    operationId: 'getAdminUser',
    summary: 'Safe administrator user detail',
    auth: 'admin',
    successStatus: 200,
    params: adminUserParamsSchema,
    response: successEnvelopeSchema(adminUserDetailSchema),
  }),
  adminSuspendUser: defineRoute({
    method: 'POST',
    path: '/v1/admin/users/{userId}/suspend',
    operationId: 'suspendAdminUser',
    summary: 'Suspend a user account with an audited reason',
    auth: 'admin',
    successStatus: 200,
    params: adminUserParamsSchema,
    body: adminAccountActionSchema,
    response: successEnvelopeSchema(z.object({ changed: z.boolean() })),
  }),
  adminRestoreUser: defineRoute({
    method: 'POST',
    path: '/v1/admin/users/{userId}/restore',
    operationId: 'restoreAdminUser',
    summary: 'Restore a suspended user account with an audited reason',
    auth: 'admin',
    successStatus: 200,
    params: adminUserParamsSchema,
    body: adminAccountActionSchema,
    response: successEnvelopeSchema(z.object({ changed: z.boolean() })),
  }),
  adminRevokeUserSessions: defineRoute({
    method: 'POST',
    path: '/v1/admin/users/{userId}/revoke-sessions',
    operationId: 'revokeAdminUserSessions',
    summary: 'Revoke all user sessions with an audited reason',
    auth: 'admin',
    successStatus: 200,
    params: adminUserParamsSchema,
    body: adminAccountActionSchema,
    response: successEnvelopeSchema(
      z.object({ revokedSessionCount: z.number().int().nonnegative() }),
    ),
  }),
  adminAudit: defineRoute({
    method: 'GET',
    path: '/v1/admin/audit-events',
    operationId: 'listAdminAuditEvents',
    summary: 'Paginated and filtered safe audit events',
    auth: 'admin',
    successStatus: 200,
    query: adminAuditQuerySchema,
    response: successEnvelopeSchema(
      z.object({ items: z.array(adminAuditEventSchema), pagination: paginationSchema }),
    ),
  }),
  adminPaymentMethods: defineRoute({
    method: 'GET',
    path: '/v1/admin/payment-methods',
    operationId: 'listAdminPaymentMethods',
    summary: 'List configured manual payment methods',
    auth: 'admin',
    successStatus: 200,
    response: successEnvelopeSchema(z.array(adminPaymentMethodSchema)),
  }),
  createAdminPaymentMethod: defineRoute({
    method: 'POST',
    path: '/v1/admin/payment-methods',
    operationId: 'createAdminPaymentMethod',
    summary: 'Create an audited manual payment method',
    auth: 'admin',
    successStatus: 200,
    body: paymentMethodMutationSchema,
    response: successEnvelopeSchema(adminPaymentMethodDetailSchema),
  }),
  adminPaymentMethod: defineRoute({
    method: 'GET',
    path: '/v1/admin/payment-methods/{paymentMethodId}',
    operationId: 'getAdminPaymentMethod',
    summary: 'Get payment method configuration and version history',
    auth: 'admin',
    successStatus: 200,
    params: paymentMethodParamsSchema,
    response: successEnvelopeSchema(adminPaymentMethodDetailSchema),
  }),
  updateAdminPaymentMethod: defineRoute({
    method: 'PATCH',
    path: '/v1/admin/payment-methods/{paymentMethodId}',
    operationId: 'updateAdminPaymentMethod',
    summary: 'Update an audited payment method with optimistic concurrency',
    auth: 'admin',
    successStatus: 200,
    params: paymentMethodParamsSchema,
    body: updatePaymentMethodSchema,
    response: successEnvelopeSchema(adminPaymentMethodDetailSchema),
  }),
  enableAdminPaymentMethod: defineRoute({
    method: 'POST',
    path: '/v1/admin/payment-methods/{paymentMethodId}/enable',
    operationId: 'enableAdminPaymentMethod',
    summary: 'Enable a payment method for new customer drafts',
    auth: 'admin',
    successStatus: 200,
    params: paymentMethodParamsSchema,
    body: adminVersionedActionSchema,
    response: successEnvelopeSchema(adminPaymentMethodDetailSchema),
  }),
  disableAdminPaymentMethod: defineRoute({
    method: 'POST',
    path: '/v1/admin/payment-methods/{paymentMethodId}/disable',
    operationId: 'disableAdminPaymentMethod',
    summary: 'Disable a payment method without changing historical snapshots',
    auth: 'admin',
    successStatus: 200,
    params: paymentMethodParamsSchema,
    body: adminVersionedActionSchema,
    response: successEnvelopeSchema(adminPaymentMethodDetailSchema),
  }),
  archiveAdminPaymentMethod: defineRoute({
    method: 'POST',
    path: '/v1/admin/payment-methods/{paymentMethodId}/archive',
    operationId: 'archiveAdminPaymentMethod',
    summary: 'Archive a payment method without damaging payment history',
    auth: 'admin',
    successStatus: 200,
    params: paymentMethodParamsSchema,
    body: adminVersionedActionSchema,
    response: successEnvelopeSchema(adminPaymentMethodDetailSchema),
  }),
  uploadAdminPaymentMethodQr: defineRoute({
    method: 'POST',
    path: '/v1/admin/payment-methods/{paymentMethodId}/qr',
    operationId: 'uploadAdminPaymentMethodQr',
    summary: 'Validate and privately replace a payment method QR image',
    auth: 'admin',
    successStatus: 200,
    params: paymentMethodParamsSchema,
    multipartBody: paymentImageUploadSchema,
    response: successEnvelopeSchema(adminPaymentMethodDetailSchema),
  }),
  adminPaymentSubmissions: defineRoute({
    method: 'GET',
    path: '/v1/admin/payment-submissions',
    operationId: 'listAdminPaymentSubmissions',
    summary: 'Paginated payment review queue with private duplicate signals',
    auth: 'admin',
    successStatus: 200,
    query: paymentQueueQuerySchema,
    response: successEnvelopeSchema(
      z.object({
        items: z.array(adminPaymentSubmissionListItemSchema),
        pagination: paginationDataSchema,
      }),
    ),
  }),
  adminPaymentSubmission: defineRoute({
    method: 'GET',
    path: '/v1/admin/payment-submissions/{submissionId}',
    operationId: 'getAdminPaymentSubmission',
    summary: 'Permissioned payment review detail',
    auth: 'admin',
    successStatus: 200,
    params: paymentSubmissionParamsSchema,
    response: successEnvelopeSchema(adminPaymentSubmissionSchema),
  }),
  adminPaymentProofAccess: defineRoute({
    method: 'GET',
    path: '/v1/admin/payment-submissions/{submissionId}/proof-access',
    operationId: 'getAdminPaymentProofAccess',
    summary: 'Create short-lived reviewer access to a private payment proof',
    auth: 'admin',
    successStatus: 200,
    params: paymentSubmissionParamsSchema,
    response: successEnvelopeSchema(signedAccessSchema),
  }),
  startPaymentReview: defineRoute({
    method: 'POST',
    path: '/v1/admin/payment-submissions/{submissionId}/start-review',
    operationId: 'startPaymentReview',
    summary: 'Atomically claim a payment review lock',
    auth: 'admin',
    successStatus: 200,
    params: paymentSubmissionParamsSchema,
    body: versionedPaymentActionSchema,
    response: successEnvelopeSchema(adminPaymentSubmissionSchema),
  }),
  requestPaymentInformation: defineRoute({
    method: 'POST',
    path: '/v1/admin/payment-submissions/{submissionId}/request-information',
    operationId: 'requestPaymentInformation',
    summary: 'Request additional payment information with a public message',
    auth: 'admin',
    successStatus: 200,
    params: paymentSubmissionParamsSchema,
    body: requestPaymentInformationSchema,
    response: successEnvelopeSchema(adminPaymentSubmissionSchema),
  }),
  approvePaymentSubmission: defineRoute({
    method: 'POST',
    path: '/v1/admin/payment-submissions/{submissionId}/approve',
    operationId: 'approvePaymentSubmission',
    summary: 'Atomically approve payment and activate or renew subscription access',
    auth: 'admin',
    successStatus: 200,
    params: paymentSubmissionParamsSchema,
    body: approvePaymentSchema,
    response: successEnvelopeSchema(
      z.object({
        submission: adminPaymentSubmissionSchema,
        subscription: subscriptionDetailSchema,
      }),
    ),
  }),
  rejectPaymentSubmission: defineRoute({
    method: 'POST',
    path: '/v1/admin/payment-submissions/{submissionId}/reject',
    operationId: 'rejectPaymentSubmission',
    summary: 'Reject a payment review without changing existing subscription access',
    auth: 'admin',
    successStatus: 200,
    params: paymentSubmissionParamsSchema,
    body: rejectPaymentSchema,
    response: successEnvelopeSchema(adminPaymentSubmissionSchema),
  }),
  recordPaymentRefund: defineRoute({
    method: 'POST',
    path: '/v1/admin/payment-submissions/{submissionId}/record-refund',
    operationId: 'recordPaymentRefund',
    summary: 'Record an externally completed refund and its explicit subscription impact',
    auth: 'admin',
    successStatus: 200,
    params: paymentSubmissionParamsSchema,
    body: recordPaymentRefundSchema,
    response: successEnvelopeSchema(adminPaymentSubmissionSchema),
  }),
  reversePaymentApproval: defineRoute({
    method: 'POST',
    path: '/v1/admin/payment-submissions/{submissionId}/reverse',
    operationId: 'reversePaymentApproval',
    summary: 'Reverse an incorrect approval and revoke its subscription outcome',
    auth: 'admin',
    successStatus: 200,
    params: paymentSubmissionParamsSchema,
    body: reversePaymentSchema,
    response: successEnvelopeSchema(adminPaymentSubmissionSchema),
  }),
  adminSubscriptions: defineRoute({
    method: 'GET',
    path: '/v1/admin/subscriptions',
    operationId: 'listAdminSubscriptions',
    summary: 'Paginated authoritative subscription directory',
    auth: 'admin',
    successStatus: 200,
    query: adminSubscriptionsQuerySchema,
    response: successEnvelopeSchema(
      z.object({
        items: z.array(adminSubscriptionListItemSchema),
        pagination: paginationDataSchema,
      }),
    ),
  }),
  adminSubscription: defineRoute({
    method: 'GET',
    path: '/v1/admin/subscriptions/{subscriptionId}',
    operationId: 'getAdminSubscription',
    summary: 'Authoritative subscription and append-only event detail',
    auth: 'admin',
    successStatus: 200,
    params: subscriptionParamsSchema,
    response: successEnvelopeSchema(subscriptionDetailSchema),
  }),
  correctAdminSubscription: defineRoute({
    method: 'POST',
    path: '/v1/admin/subscriptions/{subscriptionId}/correct',
    operationId: 'correctAdminSubscription',
    summary: 'Correct subscription dates through an audited controlled workflow',
    auth: 'admin',
    successStatus: 200,
    params: subscriptionParamsSchema,
    body: correctSubscriptionSchema,
    response: successEnvelopeSchema(subscriptionDetailSchema),
  }),
  adminSecurity: defineRoute({
    method: 'GET',
    path: '/v1/admin/security',
    operationId: 'getAdminSecurity',
    summary: 'Safe authentication and security configuration status',
    auth: 'admin',
    successStatus: 200,
    response: successEnvelopeSchema(adminSecurityDataSchema),
  }),
});

export type ApiContract = typeof apiContract;
export type ApiContractRoute = ApiRoute;
export type ApiContractEntry = ApiContract[keyof ApiContract];
