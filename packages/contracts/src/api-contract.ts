import { z } from 'zod';
import { notificationPreferencesSchema, profileUpdateSchema } from '@hanaply/auth';

import {
  careerDocumentApplySchema,
  careerDocumentExtractionSchema,
  careerDocumentParamsSchema,
  careerDocumentUploadQuerySchema,
  careerDocumentUploadSchema,
  careerDocumentDirectorySchema,
  careerDocumentSchema,
  careerFactCategorySchema,
  careerFactDecisionSchema,
  careerFactDirectorySchema,
  careerFactEvidenceSchema,
  careerFactStatusFilterSchema,
  careerProfileDirectorySchema,
  careerProfileDetailSchema,
  careerProfileInputSchema,
  careerProfileParamsSchema,
  careerProfileStatusSchema,
  careerProfileUpdateSchema,
  careerRecordInputSchema,
  careerRecordParamsSchema,
  confirmedCareerEvidenceSchema,
  onboardingStatusRequestSchema,
} from './career.js';
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
  adminDedupCandidatesSchema,
  adminDedupParamsSchema,
  adminDedupQuerySchema,
  adminDedupResolutionSchema,
  adminIngestionHealthSchema,
  adminJobDetailSchema,
  adminJobDirectoryQuerySchema,
  adminJobDirectorySchema,
  adminJobParamsSchema,
  adminJobSourceConfigSchema,
  adminJobSourceDirectorySchema,
  adminJobSourceParamsSchema,
  adminJobSourceStateSchema,
  adminJobStatusSchema,
} from './admin-jobs.js';
import {
  applicationPackDetailSchema,
  applicationPackDirectorySchema,
  applicationPackParamsSchema,
  applicationPackSchema,
  applicationParamsSchema,
  applicationSnapshotSchema,
  applicationTimelineSchema,
  applicationTrackerSchema,
  createApplicationPackSchema,
  setApplicationStageSchema,
  trackApplicationSchema,
  usageSummarySchema,
} from './applications.js';
import {
  jobDetailSchema,
  jobFeedbackSchema,
  jobParamsSchema,
  jobRadarQuerySchema,
  jobRadarSchema,
  saveJobSchema,
} from './jobs.js';
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

  // -------------------------------------------------------------------------
  // Career Intelligence Profile
  // -------------------------------------------------------------------------

  careerProfiles: defineRoute({
    method: 'GET',
    path: '/v1/me/career/profiles',
    operationId: 'listCareerProfiles',
    summary: 'Owner-scoped career profile directory with live plan limits',
    auth: 'user',
    successStatus: 200,
    response: successEnvelopeSchema(careerProfileDirectorySchema),
  }),
  createCareerProfile: defineRoute({
    method: 'POST',
    path: '/v1/me/career/profiles',
    operationId: 'createCareerProfile',
    summary: 'Create a career profile within the current plan limit',
    auth: 'user',
    successStatus: 200,
    body: careerProfileInputSchema,
    response: successEnvelopeSchema(z.object({ profileId: z.uuid() })),
  }),
  careerProfile: defineRoute({
    method: 'GET',
    path: '/v1/me/career/profiles/{profileId}',
    operationId: 'getCareerProfile',
    summary: 'Complete structured career profile with completeness detail',
    auth: 'user',
    successStatus: 200,
    params: careerProfileParamsSchema,
    response: successEnvelopeSchema(careerProfileDetailSchema),
  }),
  updateCareerProfile: defineRoute({
    method: 'PATCH',
    path: '/v1/me/career/profiles/{profileId}',
    operationId: 'updateCareerProfile',
    summary: 'Update allowlisted career profile fields under optimistic concurrency',
    auth: 'user',
    successStatus: 200,
    params: careerProfileParamsSchema,
    body: careerProfileUpdateSchema,
    response: successEnvelopeSchema(z.object({ version: z.number().int().nonnegative() })),
  }),
  deleteCareerProfile: defineRoute({
    method: 'DELETE',
    path: '/v1/me/career/profiles/{profileId}',
    operationId: 'deleteCareerProfile',
    summary: 'Delete a career profile and every structured record beneath it',
    auth: 'user',
    successStatus: 200,
    params: careerProfileParamsSchema,
    response: successEnvelopeSchema(z.object({ deleted: z.literal(true) })),
  }),
  setPrimaryCareerProfile: defineRoute({
    method: 'POST',
    path: '/v1/me/career/profiles/{profileId}/primary',
    operationId: 'setPrimaryCareerProfile',
    summary: 'Promote one career profile to the single primary profile',
    auth: 'user',
    successStatus: 200,
    params: careerProfileParamsSchema,
    response: successEnvelopeSchema(z.object({ changed: z.boolean() })),
  }),
  setCareerProfileStatus: defineRoute({
    method: 'POST',
    path: '/v1/me/career/profiles/{profileId}/status',
    operationId: 'setCareerProfileStatus',
    summary: 'Activate, draft, or archive a career profile',
    auth: 'user',
    successStatus: 200,
    params: careerProfileParamsSchema,
    body: z.object({ status: careerProfileStatusSchema }).strict(),
    response: successEnvelopeSchema(z.object({ version: z.number().int().nonnegative() })),
  }),
  upsertCareerRecord: defineRoute({
    method: 'POST',
    path: '/v1/me/career/profiles/{profileId}/records',
    operationId: 'upsertCareerRecord',
    summary: 'Create or update a structured career record such as employment or skills',
    auth: 'user',
    successStatus: 200,
    params: careerProfileParamsSchema,
    body: careerRecordInputSchema,
    response: successEnvelopeSchema(z.object({ recordId: z.uuid() })),
  }),
  deleteCareerRecord: defineRoute({
    method: 'DELETE',
    path: '/v1/me/career/profiles/{profileId}/records/{recordKind}/{recordId}',
    operationId: 'deleteCareerRecord',
    summary: 'Delete one structured career record from a profile',
    auth: 'user',
    successStatus: 200,
    params: careerRecordParamsSchema,
    response: successEnvelopeSchema(z.object({ deleted: z.boolean() })),
  }),
  careerFacts: defineRoute({
    method: 'GET',
    path: '/v1/me/career/profiles/{profileId}/facts',
    operationId: 'listCareerFacts',
    summary: 'Truth ledger for a career profile, optionally filtered by status',
    auth: 'user',
    successStatus: 200,
    params: careerProfileParamsSchema,
    query: z.object({ status: careerFactStatusFilterSchema.optional() }).strict(),
    response: successEnvelopeSchema(careerFactDirectorySchema),
  }),
  recordCareerFacts: defineRoute({
    method: 'POST',
    path: '/v1/me/career/profiles/{profileId}/facts',
    operationId: 'recordCareerFacts',
    summary: 'Record user-entered career claims as confirmed evidence',
    auth: 'user',
    successStatus: 200,
    params: careerProfileParamsSchema,
    body: z
      .object({
        facts: z
          .array(
            z
              .object({
                statement: z.string().trim().min(3).max(500),
                category: careerFactCategorySchema.optional(),
                metricValue: z.number().nullable().optional(),
                metricUnit: z.string().trim().min(1).max(40).nullable().optional(),
                metricContext: z.string().trim().max(240).nullable().optional(),
                evidence: careerFactEvidenceSchema.optional(),
              })
              .strict(),
          )
          .min(1)
          .max(50),
      })
      .strict(),
    response: successEnvelopeSchema(careerFactDirectorySchema),
  }),
  decideCareerFact: defineRoute({
    method: 'POST',
    path: '/v1/me/career/facts/{factId}/decision',
    operationId: 'decideCareerFact',
    summary: 'Confirm, reject, or correct one claim in the truth ledger',
    auth: 'user',
    successStatus: 200,
    params: z.object({ factId: z.uuid() }),
    body: careerFactDecisionSchema,
    response: successEnvelopeSchema(careerFactDirectorySchema),
  }),
  confirmedCareerEvidence: defineRoute({
    method: 'GET',
    path: '/v1/me/career/profiles/{profileId}/evidence',
    operationId: 'getConfirmedCareerEvidence',
    summary: 'Confirmed-only evidence set that generation features may cite',
    auth: 'user',
    successStatus: 200,
    params: careerProfileParamsSchema,
    response: successEnvelopeSchema(confirmedCareerEvidenceSchema),
  }),
  careerDocuments: defineRoute({
    method: 'GET',
    path: '/v1/me/career/documents',
    operationId: 'listCareerDocuments',
    summary: 'Owner-scoped career document metadata',
    auth: 'user',
    successStatus: 200,
    response: successEnvelopeSchema(careerDocumentDirectorySchema),
  }),
  uploadCareerDocument: defineRoute({
    method: 'POST',
    path: '/v1/me/career/documents',
    operationId: 'uploadCareerDocument',
    summary: 'Validate, checksum, privately store, and queue parsing for a resume',
    auth: 'user',
    successStatus: 200,
    query: careerDocumentUploadQuerySchema,
    multipartBody: careerDocumentUploadSchema,
    response: successEnvelopeSchema(careerDocumentSchema),
  }),
  careerDocument: defineRoute({
    method: 'GET',
    path: '/v1/me/career/documents/{documentId}',
    operationId: 'getCareerDocument',
    summary: 'Career document metadata and parse state',
    auth: 'user',
    successStatus: 200,
    params: careerDocumentParamsSchema,
    response: successEnvelopeSchema(careerDocumentSchema),
  }),
  deleteCareerDocument: defineRoute({
    method: 'DELETE',
    path: '/v1/me/career/documents/{documentId}',
    operationId: 'deleteCareerDocument',
    summary: 'Remove a career document and schedule its private object for cleanup',
    auth: 'user',
    successStatus: 200,
    params: careerDocumentParamsSchema,
    response: successEnvelopeSchema(z.object({ deleted: z.literal(true) })),
  }),
  careerDocumentPreview: defineRoute({
    method: 'GET',
    path: '/v1/me/career/documents/{documentId}/access',
    operationId: 'getCareerDocumentAccess',
    summary: 'Short-lived signed access to the owner private document object',
    auth: 'user',
    successStatus: 200,
    params: careerDocumentParamsSchema,
    response: successEnvelopeSchema(signedAccessSchema),
  }),
  careerDocumentExtraction: defineRoute({
    method: 'GET',
    path: '/v1/me/career/documents/{documentId}/extraction',
    operationId: 'getCareerDocumentExtraction',
    summary: 'Structured extraction draft awaiting owner confirmation',
    auth: 'user',
    successStatus: 200,
    params: careerDocumentParamsSchema,
    response: successEnvelopeSchema(careerDocumentExtractionSchema),
  }),
  applyCareerDocumentExtraction: defineRoute({
    method: 'POST',
    path: '/v1/me/career/documents/{documentId}/apply',
    operationId: 'applyCareerDocumentExtraction',
    summary: 'Turn a reviewed extraction draft into profile records and candidate facts',
    auth: 'user',
    successStatus: 200,
    params: careerDocumentParamsSchema,
    body: careerDocumentApplySchema,
    response: successEnvelopeSchema(
      z.object({
        createdRecordIds: z.array(z.uuid()),
        createdFactIds: z.array(z.uuid()),
      }),
    ),
  }),
  setOnboardingStatus: defineRoute({
    method: 'POST',
    path: '/v1/me/onboarding',
    operationId: 'setOnboardingStatus',
    summary: 'Advance the caller onboarding state machine',
    auth: 'user',
    successStatus: 200,
    body: z.object({ status: onboardingStatusRequestSchema }).strict(),
    response: successEnvelopeSchema(z.object({ changed: z.boolean() })),
  }),

  // -------------------------------------------------------------------------
  // Career Radar
  // -------------------------------------------------------------------------

  jobRadar: defineRoute({
    method: 'GET',
    path: '/v1/me/jobs',
    operationId: 'getJobRadar',
    summary: 'Ranked, filtered, paginated opportunity feed for the caller',
    auth: 'user',
    successStatus: 200,
    query: jobRadarQuerySchema,
    response: successEnvelopeSchema(jobRadarSchema),
  }),
  jobDetail: defineRoute({
    method: 'GET',
    path: '/v1/me/jobs/{jobId}',
    operationId: 'getJobDetail',
    summary: 'Opportunity detail with provenance and the explainable match result',
    auth: 'user',
    successStatus: 200,
    params: jobParamsSchema,
    query: z.object({ careerProfileId: z.uuid().optional() }).strict(),
    response: successEnvelopeSchema(jobDetailSchema),
  }),
  saveJob: defineRoute({
    method: 'POST',
    path: '/v1/me/jobs/{jobId}/save',
    operationId: 'saveJob',
    summary: 'Save an opportunity to the caller tracker',
    auth: 'user',
    successStatus: 200,
    params: jobParamsSchema,
    body: saveJobSchema,
    response: successEnvelopeSchema(z.object({ saved: z.literal(true) })),
  }),
  unsaveJob: defineRoute({
    method: 'DELETE',
    path: '/v1/me/jobs/{jobId}/save',
    operationId: 'unsaveJob',
    summary: 'Remove an opportunity from the caller saved list',
    auth: 'user',
    successStatus: 200,
    params: jobParamsSchema,
    response: successEnvelopeSchema(z.object({ removed: z.boolean() })),
  }),
  recordJobFeedback: defineRoute({
    method: 'POST',
    path: '/v1/me/jobs/{jobId}/feedback',
    operationId: 'recordJobFeedback',
    summary: 'Record ranking feedback so future results improve',
    auth: 'user',
    successStatus: 200,
    params: jobParamsSchema,
    body: jobFeedbackSchema,
    response: successEnvelopeSchema(z.object({ recorded: z.literal(true) })),
  }),

  // -------------------------------------------------------------------------
  // Application Packs, usage, and tracker
  // -------------------------------------------------------------------------

  applicationPacks: defineRoute({
    method: 'GET',
    path: '/v1/me/application-packs',
    operationId: 'listApplicationPacks',
    summary: 'Caller Application Packs with current plan usage',
    auth: 'user',
    successStatus: 200,
    response: successEnvelopeSchema(applicationPackDirectorySchema),
  }),
  createApplicationPack: defineRoute({
    method: 'POST',
    path: '/v1/me/application-packs',
    operationId: 'createApplicationPack',
    summary: 'Create an Application Pack, consuming plan quota exactly once',
    auth: 'user',
    successStatus: 200,
    body: createApplicationPackSchema,
    response: successEnvelopeSchema(
      z.object({
        pack: applicationPackSchema,
        created: z.boolean(),
        usage: z.record(z.string(), z.unknown()).nullable(),
      }),
    ),
  }),
  applicationPack: defineRoute({
    method: 'GET',
    path: '/v1/me/application-packs/{packId}',
    operationId: 'getApplicationPack',
    summary: 'Application Pack detail with its Truth-gated artifacts',
    auth: 'user',
    successStatus: 200,
    params: applicationPackParamsSchema,
    response: successEnvelopeSchema(applicationPackDetailSchema),
  }),
  usageSummary: defineRoute({
    method: 'GET',
    path: '/v1/me/usage',
    operationId: 'getUsageSummary',
    summary: 'Current plan usage per metered feature',
    auth: 'user',
    successStatus: 200,
    response: successEnvelopeSchema(usageSummarySchema),
  }),
  applicationTracker: defineRoute({
    method: 'GET',
    path: '/v1/me/applications',
    operationId: 'getApplicationTracker',
    summary: 'Pipeline board of tracked applications with per-stage counts',
    auth: 'user',
    successStatus: 200,
    response: successEnvelopeSchema(applicationTrackerSchema),
  }),
  trackApplication: defineRoute({
    method: 'POST',
    path: '/v1/me/applications',
    operationId: 'trackApplication',
    summary: 'Start or update tracking for an opportunity',
    auth: 'user',
    successStatus: 200,
    body: trackApplicationSchema,
    response: successEnvelopeSchema(applicationSnapshotSchema),
  }),
  applicationTimeline: defineRoute({
    method: 'GET',
    path: '/v1/me/applications/{applicationId}',
    operationId: 'getApplicationTimeline',
    summary: 'One tracked application with its append-only stage history',
    auth: 'user',
    successStatus: 200,
    params: applicationParamsSchema,
    response: successEnvelopeSchema(applicationTimelineSchema),
  }),
  setApplicationStage: defineRoute({
    method: 'POST',
    path: '/v1/me/applications/{applicationId}/stage',
    operationId: 'setApplicationStage',
    summary: 'Advance a tracked application under optimistic concurrency',
    auth: 'user',
    successStatus: 200,
    params: applicationParamsSchema,
    body: setApplicationStageSchema,
    response: successEnvelopeSchema(applicationSnapshotSchema),
  }),

  // -------------------------------------------------------------------------
  // Administrative job operations
  // -------------------------------------------------------------------------

  adminJobSources: defineRoute({
    method: 'GET',
    path: '/v1/admin/job-sources',
    operationId: 'listAdminJobSources',
    summary: 'Provider catalogue with health and due state',
    auth: 'admin',
    successStatus: 200,
    response: successEnvelopeSchema(adminJobSourceDirectorySchema),
  }),
  adminSetJobSourceState: defineRoute({
    method: 'POST',
    path: '/v1/admin/job-sources/{sourceId}/state',
    operationId: 'setAdminJobSourceState',
    summary: 'Enable, pause, or disable a provider with an audited reason',
    auth: 'admin',
    successStatus: 200,
    params: adminJobSourceParamsSchema,
    body: adminJobSourceStateSchema,
    response: successEnvelopeSchema(z.object({ changed: z.boolean() })),
  }),
  adminUpdateJobSourceConfig: defineRoute({
    method: 'PATCH',
    path: '/v1/admin/job-sources/{sourceId}/config',
    operationId: 'updateAdminJobSourceConfig',
    summary: 'Replace a provider configuration, refusing credential-shaped keys',
    auth: 'admin',
    successStatus: 200,
    params: adminJobSourceParamsSchema,
    body: adminJobSourceConfigSchema,
    response: successEnvelopeSchema(z.object({ updated: z.literal(true) })),
  }),
  adminRequestJobSourceScan: defineRoute({
    method: 'POST',
    path: '/v1/admin/job-sources/{sourceId}/scan',
    operationId: 'requestAdminJobSourceScan',
    summary: 'Make an enabled provider due on the next worker tick',
    auth: 'admin',
    successStatus: 200,
    params: adminJobSourceParamsSchema,
    response: successEnvelopeSchema(z.object({ requested: z.literal(true) })),
  }),
  adminIngestionHealth: defineRoute({
    method: 'GET',
    path: '/v1/admin/ingestion',
    operationId: 'getAdminIngestionHealth',
    summary: 'Provider health, recent ingestion runs, and job totals',
    auth: 'admin',
    successStatus: 200,
    query: z.object({ runLimit: z.coerce.number().int().min(1).max(200).default(25) }).strict(),
    response: successEnvelopeSchema(adminIngestionHealthSchema),
  }),
  adminJobs: defineRoute({
    method: 'GET',
    path: '/v1/admin/jobs',
    operationId: 'listAdminJobs',
    summary: 'Internal canonical job directory',
    auth: 'admin',
    successStatus: 200,
    query: adminJobDirectoryQuerySchema,
    response: successEnvelopeSchema(adminJobDirectorySchema),
  }),
  adminJob: defineRoute({
    method: 'GET',
    path: '/v1/admin/jobs/{jobId}',
    operationId: 'getAdminJob',
    summary: 'Canonical job record with provenance and duplication candidates',
    auth: 'admin',
    successStatus: 200,
    params: adminJobParamsSchema,
    response: successEnvelopeSchema(adminJobDetailSchema),
  }),
  adminSetJobStatus: defineRoute({
    method: 'POST',
    path: '/v1/admin/jobs/{jobId}/status',
    operationId: 'setAdminJobStatus',
    summary: 'Remove a posting from the feed with an audited reason',
    auth: 'admin',
    successStatus: 200,
    params: adminJobParamsSchema,
    body: adminJobStatusSchema,
    response: successEnvelopeSchema(z.object({ changed: z.literal(true) })),
  }),
  adminDedupCandidates: defineRoute({
    method: 'GET',
    path: '/v1/admin/deduplication',
    operationId: 'listAdminDedupCandidates',
    summary: 'Near-duplicate pairs awaiting an operator decision',
    auth: 'admin',
    successStatus: 200,
    query: adminDedupQuerySchema,
    response: successEnvelopeSchema(adminDedupCandidatesSchema),
  }),
  adminResolveDedupCandidate: defineRoute({
    method: 'POST',
    path: '/v1/admin/deduplication/{candidateId}/resolve',
    operationId: 'resolveAdminDedupCandidate',
    summary: 'Merge or keep separate a reviewed duplicate pair',
    auth: 'admin',
    successStatus: 200,
    params: adminDedupParamsSchema,
    body: adminDedupResolutionSchema,
    response: successEnvelopeSchema(z.object({ resolved: z.boolean() })),
  }),
});

export type ApiContract = typeof apiContract;
export type ApiContractRoute = ApiRoute;
export type ApiContractEntry = ApiContract[keyof ApiContract];
