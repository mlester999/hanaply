import { apiContract, type Platform } from '@hanaply/contracts';
import type { NotificationPreferencesInput } from '@hanaply/auth';
import {
  EntitlementConfigurationError,
  evaluateEntitlements,
  type EntitlementKey,
} from '@hanaply/entitlements';
import {
  evaluateClientFeatureFlags,
  evaluatePlatform,
  PlatformConfigurationError,
} from '@hanaply/platform';
import { Inject, Injectable } from '@nestjs/common';
import type { ApiEnvironment } from '@hanaply/config';

import { AppError } from './app-error.js';
import type { AuthenticatedRequest } from './http.js';
import { HanaplyRepository } from './repository.js';
import { API_ENVIRONMENT } from './tokens.js';

@Injectable()
export class HanaplyService {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(HanaplyRepository) private readonly repository: HanaplyRepository,
  ) {}

  health() {
    return {
      status: 'ok' as const,
      service: 'api' as const,
      version: '0.0.0',
      timestamp: new Date().toISOString(),
    };
  }

  version() {
    return {
      apiVersion: 'v1' as const,
      serviceVersion: '0.0.0',
      buildSha: this.environment.BUILD_SHA,
    };
  }

  async readiness() {
    if (!(await this.repository.isReady())) {
      throw new AppError({
        code: 'SERVICE_UNAVAILABLE',
        status: 503,
        message: 'Required services are not ready',
      });
    }
    return {
      status: 'ready' as const,
      checks: { supabase: 'up' as const },
      timestamp: new Date().toISOString(),
    };
  }

  async plans() {
    const plans = await this.repository.listPlans();
    return apiContract.plans.response.shape.data.parse(plans);
  }

  async meta(input: { platform: Platform; clientVersion?: string }) {
    try {
      const [setting, flags] = await Promise.all([
        this.repository.getPlatformSetting(input.platform),
        this.repository.getFeatureFlagConfiguration(),
      ]);
      return {
        defaultLocale: 'en-PH' as const,
        defaultCurrency: 'PHP' as const,
        defaultTimezone: 'Asia/Manila' as const,
        platform: evaluatePlatform(setting, input.clientVersion),
        featureFlags: evaluateClientFeatureFlags(flags.definitions, flags.rules, {
          environment: this.environment.HANAPLY_ENV,
          planCode: null,
          platform: input.platform,
        }),
      };
    } catch (error) {
      if (error instanceof PlatformConfigurationError) {
        const clientInputError = error.message.startsWith('Client version');
        throw new AppError({
          code: clientInputError ? 'VALIDATION_ERROR' : 'SERVICE_UNAVAILABLE',
          status: clientInputError ? 400 : 503,
          message: clientInputError ? error.message : 'Platform configuration is unavailable',
          ...(clientInputError
            ? {
                details: [
                  {
                    path: ['clientVersion'],
                    code: 'invalid_semver',
                    message: error.message,
                  },
                ],
              }
            : {}),
        });
      }
      throw error;
    }
  }

  async me(request: AuthenticatedRequest) {
    const auth = this.requireAuthentication(request);
    const profile = await this.repository.getProfile(auth.accessToken, auth.userId);
    if (!profile) {
      throw new AppError({
        code: 'INTERNAL_ERROR',
        status: 500,
        message: 'Account profile could not be resolved',
      });
    }
    const subscription = await this.repository.getSubscription(auth.accessToken, auth.userId);
    return {
      profile,
      subscription: subscription?.summary ?? {
        planCode: null,
        status: 'inactive' as const,
        startsAt: null,
        endsAt: null,
      },
    };
  }

  async updateMe(request: AuthenticatedRequest, body: unknown) {
    const auth = this.requireAuthentication(request);
    const parsed = apiContract.updateMe.body.parse(body);
    return this.repository.updateProfile(auth.accessToken, auth.userId, parsed);
  }

  async preferences(request: AuthenticatedRequest) {
    const auth = this.requireAuthentication(request);
    return this.repository.getNotificationPreferences(auth.accessToken, auth.userId);
  }

  async updatePreferences(request: AuthenticatedRequest, body: unknown) {
    const auth = this.requireAuthentication(request);
    const parsed = apiContract.updatePreferences.body.parse(body);
    await this.assertNotificationEntitlements(auth, parsed);
    return this.repository.updateNotificationPreferences(auth.accessToken, parsed, request.id);
  }

  /**
   * Consent alone is not enough: the queueing functions only create a message
   * when the plan entitlement is also present. Refusing the write here means a
   * subscriber learns that immediately, in the API's own words, instead of
   * silently saving a preference that can never deliver anything.
   *
   * Turning a category off is always allowed.
   */
  private async assertNotificationEntitlements(
    auth: { accessToken: string; userId: string },
    requested: NotificationPreferencesInput,
  ): Promise<void> {
    const requirements: readonly { enabled: boolean; key: EntitlementKey; message: string }[] = [
      {
        enabled: requested.jobAlerts,
        key: 'emailAlerts',
        message:
          'Job alerts are not included in your current plan. Upgrade your plan to turn them on.',
      },
      {
        enabled: requested.dailyDigest,
        key: 'dailyDigest',
        message:
          'The daily digest is not included in your current plan. Upgrade your plan to turn it on.',
      },
      {
        enabled: requested.instantAlerts,
        key: 'instantAlerts',
        message:
          'Instant alerts are not included in your current plan. Upgrade to the Pro plan to turn them on.',
      },
      {
        enabled: requested.weeklyStrategy,
        key: 'weeklyAiCareerStrategy',
        message:
          'The weekly strategy summary is not included in your current plan. Upgrade to the Pro plan to turn it on.',
      },
    ];
    if (!requirements.some((requirement) => requirement.enabled)) return;

    const snapshot = await this.entitlementSnapshot(auth);
    const missing = requirements.find(
      (requirement) => requirement.enabled && snapshot.entitlements[requirement.key] !== true,
    );
    if (!missing) return;

    throw new AppError({
      code: 'ENTITLEMENT_REQUIRED',
      status: 403,
      message: missing.message,
    });
  }

  async sessions(request: AuthenticatedRequest) {
    const auth = this.requireAuthentication(request);
    return this.repository.listSessions(auth.accessToken);
  }

  async revokeOtherSessions(request: AuthenticatedRequest) {
    const auth = this.requireAuthentication(request);
    await this.repository.revokeOtherSessions(auth.accessToken, request.id);
    return { revoked: true as const };
  }

  async entitlements(request: AuthenticatedRequest) {
    return this.entitlementSnapshot(this.requireAuthentication(request));
  }

  private async entitlementSnapshot(auth: { accessToken: string; userId: string }) {
    const subscription = await this.repository.getSubscription(auth.accessToken, auth.userId);
    if (!subscription) return evaluateEntitlements({ subscription: null, plan: null });
    const planCode = subscription.summary.planCode;
    if (!planCode) {
      throw new AppError({
        code: 'SERVICE_UNAVAILABLE',
        status: 503,
        message: 'Subscription plan configuration is unavailable',
      });
    }
    const plan = await this.repository.getPlanEntitlementSnapshot(subscription.row.plan_id);
    try {
      return evaluateEntitlements({
        subscription: this.repository.toEntitlementSubscription(subscription.row, planCode),
        plan,
      });
    } catch (error) {
      if (error instanceof EntitlementConfigurationError) {
        throw new AppError({
          code: 'SERVICE_UNAVAILABLE',
          status: 503,
          message: 'Entitlement configuration is unavailable',
        });
      }
      throw error;
    }
  }

  adminMe(request: AuthenticatedRequest) {
    const auth = this.requireAdministrator(request);
    return {
      userId: auth.userId,
      roles: [...auth.roles].sort(),
      permissions: [...auth.permissions].sort(),
    };
  }

  async adminOverview(request: AuthenticatedRequest) {
    const auth = this.requireAdministrator(request);
    return this.repository.getAdminOverview(auth.userId);
  }

  async adminUsers(request: AuthenticatedRequest, query: unknown) {
    const auth = this.requireAdministrator(request);
    const parsed = apiContract.adminUsers.query.parse(query);
    return this.repository.listAdminUsers(auth.userId, parsed);
  }

  async adminUser(request: AuthenticatedRequest, params: unknown) {
    const auth = this.requireAdministrator(request);
    const parsed = apiContract.adminUser.params.parse(params);
    const user = await this.repository.getAdminUser(auth.userId, parsed.userId);
    if (!user) {
      throw new AppError({ code: 'NOT_FOUND', status: 404, message: 'User account was not found' });
    }
    const auditVisible = auth.permissions.has('audit.read');
    const audit = auditVisible
      ? await this.repository.listAdminAuditEvents(auth.userId, {
          targetId: parsed.userId,
          page: 1,
          pageSize: 10,
        })
      : { items: [] };
    return { ...user, recentAuditEvents: audit.items, auditVisible };
  }

  async suspendAdminUser(request: AuthenticatedRequest, params: unknown, body: unknown) {
    const auth = this.requireAdministrator(request);
    const parsedParams = apiContract.adminSuspendUser.params.parse(params);
    const parsedBody = apiContract.adminSuspendUser.body.parse(body);
    const changed = await this.repository.setAdminUserStatus(
      auth.userId,
      parsedParams.userId,
      'suspended',
      parsedBody.reason,
      request.id,
    );
    return { changed };
  }

  async restoreAdminUser(request: AuthenticatedRequest, params: unknown, body: unknown) {
    const auth = this.requireAdministrator(request);
    const parsedParams = apiContract.adminRestoreUser.params.parse(params);
    const parsedBody = apiContract.adminRestoreUser.body.parse(body);
    const changed = await this.repository.setAdminUserStatus(
      auth.userId,
      parsedParams.userId,
      'active',
      parsedBody.reason,
      request.id,
    );
    return { changed };
  }

  async revokeAdminUserSessions(request: AuthenticatedRequest, params: unknown, body: unknown) {
    const auth = this.requireAdministrator(request);
    const parsedParams = apiContract.adminRevokeUserSessions.params.parse(params);
    const parsedBody = apiContract.adminRevokeUserSessions.body.parse(body);
    const revokedSessionCount = await this.repository.revokeAdminUserSessions(
      auth.userId,
      parsedParams.userId,
      parsedBody.reason,
      request.id,
    );
    return { revokedSessionCount };
  }

  async adminAudit(request: AuthenticatedRequest, query: unknown) {
    const auth = this.requireAdministrator(request);
    const parsed = apiContract.adminAudit.query.parse(query);
    return this.repository.listAdminAuditEvents(auth.userId, parsed);
  }

  adminSecurity(request: AuthenticatedRequest) {
    this.requireAdministrator(request);
    return {
      authentication: { provider: 'supabase' as const, configured: true as const },
      email: {
        provider: this.environment.EMAIL_PROVIDER,
        liveDeliveryEnabled: this.environment.EMAIL_ALLOW_LIVE_SENDS,
      },
      bootstrap: { enabled: this.environment.ADMIN_BOOTSTRAP_ENABLED },
      rowLevelSecurity: { enforcement: 'database' as const, validation: 'ci' as const },
      sessions: { bearerOnlyApi: true as const, databaseRevocationCheck: true as const },
      passwordRecovery: { enabled: true as const, tokenLogging: false as const },
    };
  }

  openApiEnabled(): boolean {
    return this.environment.OPENAPI_ENABLED && this.environment.HANAPLY_ENV !== 'production';
  }

  private requireAuthentication(request: AuthenticatedRequest) {
    if (!request.auth) {
      throw new AppError({
        code: 'AUTHENTICATION_REQUIRED',
        status: 401,
        message: 'Authentication is required',
      });
    }
    return request.auth;
  }

  private requireAdministrator(request: AuthenticatedRequest) {
    const auth = this.requireAuthentication(request);
    if (!auth.roles || !auth.permissions) {
      throw new AppError({
        code: 'FORBIDDEN',
        status: 403,
        message: 'Administrator access is required',
      });
    }
    return { ...auth, roles: auth.roles, permissions: auth.permissions };
  }
}
