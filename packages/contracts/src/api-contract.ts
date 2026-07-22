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
