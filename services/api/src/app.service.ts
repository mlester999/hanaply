import { apiContract, type Platform } from '@hanaply/contracts';
import { EntitlementConfigurationError, evaluateEntitlements } from '@hanaply/entitlements';
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

  async entitlements(request: AuthenticatedRequest) {
    const auth = this.requireAuthentication(request);
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
    const auth = this.requireAuthentication(request);
    if (!auth.roles || !auth.permissions) {
      throw new AppError({
        code: 'FORBIDDEN',
        status: 403,
        message: 'Administrator access is required',
      });
    }
    return {
      userId: auth.userId,
      roles: [...auth.roles].sort(),
      permissions: [...auth.permissions].sort(),
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
}
