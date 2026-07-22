import { z } from 'zod';
import { notificationPreferencesSchema, profileUpdateSchema } from '@hanaply/auth';

import {
  entitlementSnapshotSchema,
  featureFlagResultSchema,
  planSchema,
  platformEvaluationSchema,
  platformSchema,
  publicProfileSchema,
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
});

export type ApiContract = typeof apiContract;
export type ApiContractRoute = ApiRoute;
export type ApiContractEntry = ApiContract[keyof ApiContract];
