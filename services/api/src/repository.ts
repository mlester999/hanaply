import { Inject, Injectable } from '@nestjs/common';
import type { NotificationPreferencesInput, ProfileUpdateInput } from '@hanaply/auth';
import type { ApiEnvironment } from '@hanaply/config';
import type { Plan, Platform, PublicProfile, SubscriptionSummary } from '@hanaply/contracts';
import {
  createPublicDatabaseClient,
  createServiceDatabaseClient,
  createUserDatabaseClient,
  type Database,
  type Json,
} from '@hanaply/database';
import type { PlanEntitlementSnapshot, SubscriptionSnapshot } from '@hanaply/entitlements';
import type { FeatureFlagDefinition, FeatureFlagRule, PlatformSetting } from '@hanaply/platform';

import { AppError } from './app-error.js';
import { API_ENVIRONMENT } from './tokens.js';

type ProfileRow = Database['public']['Tables']['profiles']['Row'];
type PlanRow = Database['public']['Tables']['plans']['Row'];
type SubscriptionRow = Database['public']['Tables']['subscriptions']['Row'];
type PreferenceRow = Database['public']['Tables']['user_notification_preferences']['Row'];

function configurationError(message: string): AppError {
  return new AppError({ code: 'SERVICE_UNAVAILABLE', status: 503, message });
}

function requireData<TData>(
  data: TData | null,
  error: { message: string } | null,
  safeMessage: string,
): TData {
  if (error || data === null) throw configurationError(safeMessage);
  return data;
}

function entitlementValue(value: Json): boolean | number | string {
  if (typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
  throw configurationError('Plan entitlement configuration is invalid');
}

function mapProfile(row: ProfileRow): PublicProfile {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    displayName: row.display_name,
    locale: row.locale,
    timezone: row.timezone,
    countryCode: row.country_code,
    onboardingStatus: row.onboarding_status,
    accountStatus: row.account_status,
    emailVerifiedAt: row.email_verified_at,
    lastPasswordChangedAt: row.last_password_changed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSubscription(row: SubscriptionRow, planCode: string | null): SubscriptionSummary {
  return {
    planCode,
    status: row.status,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
  };
}

function mapPreferences(row: PreferenceRow) {
  return {
    productUpdates: row.product_updates,
    marketingEmails: row.marketing_emails,
    securityEmails: true as const,
    futureJobAlerts: false as const,
    futureDailyDigest: false as const,
    updatedAt: row.updated_at,
  };
}

@Injectable()
export class HanaplyRepository {
  private readonly publicClient;
  private readonly serviceClient;

  constructor(@Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment) {
    this.publicClient = createPublicDatabaseClient(
      environment.SUPABASE_URL,
      environment.SUPABASE_PUBLISHABLE_KEY,
    );
    this.serviceClient = createServiceDatabaseClient(
      environment.SUPABASE_URL,
      environment.SUPABASE_SERVICE_ROLE_KEY,
    );
  }

  async isReady(): Promise<boolean> {
    const result = await this.publicClient.from('plans').select('id').limit(1);
    return result.error === null;
  }

  async listPlans(): Promise<readonly Plan[]> {
    const planResult = await this.publicClient
      .from('plans')
      .select('id, code, tier_code, name, billing_period, currency, price_minor, display_order')
      .eq('active', true)
      .order('display_order');
    const plans = requireData(planResult.data, planResult.error, 'Plan catalog is unavailable');
    const entitlementResult = await this.publicClient
      .from('plan_entitlements')
      .select('plan_id, entitlement_key, value');
    const entitlements = requireData(
      entitlementResult.data,
      entitlementResult.error,
      'Plan entitlement catalog is unavailable',
    );

    return plans.map((plan) => ({
      code: plan.code,
      tierCode: plan.tier_code,
      name: plan.name,
      billingPeriod: plan.billing_period,
      currency: plan.currency,
      priceMinor: plan.price_minor,
      displayOrder: plan.display_order,
      entitlements: Object.fromEntries(
        entitlements
          .filter((entry) => entry.plan_id === plan.id)
          .map((entry) => [entry.entitlement_key, entitlementValue(entry.value)]),
      ),
    }));
  }

  async getPlatformSetting(platform: Platform): Promise<PlatformSetting> {
    const result = await this.serviceClient
      .from('platform_settings')
      .select(
        'platform, status, minimum_version, latest_version, force_update, maintenance_mode, api_compatibility_version, announcement',
      )
      .eq('environment', this.environment.HANAPLY_ENV)
      .eq('platform', platform)
      .maybeSingle();
    const setting = requireData(result.data, result.error, 'Platform configuration is unavailable');
    return {
      platform: setting.platform,
      status: setting.status,
      minimumVersion: setting.minimum_version,
      latestVersion: setting.latest_version,
      forceUpdate: setting.force_update,
      maintenanceMode: setting.maintenance_mode,
      apiCompatibilityVersion: setting.api_compatibility_version,
      announcement: setting.announcement,
    };
  }

  async getFeatureFlagConfiguration(): Promise<{
    definitions: readonly FeatureFlagDefinition[];
    rules: readonly FeatureFlagRule[];
  }> {
    const [definitionResult, ruleResult] = await Promise.all([
      this.serviceClient.from('feature_flags').select('id, key, default_enabled, client_exposed'),
      this.serviceClient
        .from('feature_flag_rules')
        .select('feature_id, enabled, priority, environment, plan_code, platform'),
    ]);
    const definitions = requireData(
      definitionResult.data,
      definitionResult.error,
      'Feature flag configuration is unavailable',
    );
    const rules = requireData(
      ruleResult.data,
      ruleResult.error,
      'Feature flag rules are unavailable',
    );
    const keysById = new Map(definitions.map((definition) => [definition.id, definition.key]));
    return {
      definitions: definitions.map((definition) => ({
        key: definition.key,
        defaultEnabled: definition.default_enabled,
        clientExposed: definition.client_exposed,
      })),
      rules: rules.map((rule) => {
        const featureKey = keysById.get(rule.feature_id);
        if (!featureKey) throw configurationError('Feature rule refers to an unknown flag');
        return {
          featureKey,
          enabled: rule.enabled,
          priority: rule.priority,
          environment: rule.environment,
          planCode: rule.plan_code,
          platform: rule.platform,
        };
      }),
    };
  }

  async getProfile(accessToken: string, userId: string): Promise<PublicProfile | null> {
    const client = createUserDatabaseClient(
      this.environment.SUPABASE_URL,
      this.environment.SUPABASE_PUBLISHABLE_KEY,
      accessToken,
    );
    const result = await client.from('profiles').select('*').eq('id', userId).maybeSingle();
    if (result.error) throw configurationError('Profile service is unavailable');
    return result.data ? mapProfile(result.data) : null;
  }

  async isAuthSessionActive(userId: string, sessionId: string): Promise<boolean> {
    const result = await this.serviceClient.rpc('is_auth_session_active', {
      target_user_id: userId,
      target_session_id: sessionId,
    });
    if (result.error) throw configurationError('Session service is unavailable');
    return result.data;
  }

  async updateProfile(
    accessToken: string,
    userId: string,
    input: ProfileUpdateInput,
  ): Promise<PublicProfile> {
    const client = createUserDatabaseClient(
      this.environment.SUPABASE_URL,
      this.environment.SUPABASE_PUBLISHABLE_KEY,
      accessToken,
    );
    const result = await client
      .from('profiles')
      .update({
        first_name: input.firstName,
        last_name: input.lastName,
        display_name: input.displayName,
        country_code: input.countryCode,
        locale: input.locale,
        timezone: input.timezone,
      })
      .eq('id', userId)
      .select('*')
      .single();
    if (result.error || !result.data) throw configurationError('Profile update is unavailable');
    return mapProfile(result.data);
  }

  async getNotificationPreferences(
    accessToken: string,
    userId: string,
  ): Promise<ReturnType<typeof mapPreferences>> {
    const client = createUserDatabaseClient(
      this.environment.SUPABASE_URL,
      this.environment.SUPABASE_PUBLISHABLE_KEY,
      accessToken,
    );
    const result = await client
      .from('user_notification_preferences')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (result.error || !result.data)
      throw configurationError('Notification preferences are unavailable');
    return mapPreferences(result.data);
  }

  async updateNotificationPreferences(
    accessToken: string,
    input: NotificationPreferencesInput,
    requestId: string,
  ): Promise<ReturnType<typeof mapPreferences>> {
    const client = createUserDatabaseClient(
      this.environment.SUPABASE_URL,
      this.environment.SUPABASE_PUBLISHABLE_KEY,
      accessToken,
    );
    const result = await client.rpc('update_my_notification_preferences', {
      requested_product_updates: input.productUpdates,
      requested_marketing_emails: input.marketingEmails,
      requested_request_id: requestId,
    });
    if (result.error || !result.data)
      throw configurationError('Notification preference update is unavailable');
    return mapPreferences(result.data);
  }

  async listSessions(accessToken: string) {
    const client = createUserDatabaseClient(
      this.environment.SUPABASE_URL,
      this.environment.SUPABASE_PUBLISHABLE_KEY,
      accessToken,
    );
    const result = await client.rpc('list_my_sessions');
    if (result.error) throw configurationError('Session service is unavailable');
    return (result.data ?? []).map((session) => ({
      id: session.session_id,
      createdAt: session.created_at,
      lastSeenAt: session.last_seen_at,
      userAgent: session.user_agent || null,
      current: session.current_session,
    }));
  }

  async revokeOtherSessions(accessToken: string, requestId: string): Promise<void> {
    const revocation = await this.serviceClient.auth.admin.signOut(accessToken, 'others');
    if (revocation.error) throw configurationError('Session revocation is unavailable');
    const client = createUserDatabaseClient(
      this.environment.SUPABASE_URL,
      this.environment.SUPABASE_PUBLISHABLE_KEY,
      accessToken,
    );
    const audit = await client.rpc('record_my_auth_event', {
      requested_event_type: 'user.sessions_revoked',
      requested_request_id: requestId,
    });
    if (audit.error) throw configurationError('Session revocation could not be audited');
  }

  async getSubscription(
    accessToken: string,
    userId: string,
  ): Promise<{ row: SubscriptionRow; summary: SubscriptionSummary } | null> {
    const client = createUserDatabaseClient(
      this.environment.SUPABASE_URL,
      this.environment.SUPABASE_PUBLISHABLE_KEY,
      accessToken,
    );
    const result = await client
      .from('subscriptions')
      .select('id, user_id, plan_id, status, starts_at, ends_at, source, created_at, updated_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (result.error) throw configurationError('Subscription service is unavailable');
    if (!result.data) return null;
    const planResult = await this.publicClient
      .from('plans')
      .select('code')
      .eq('id', result.data.plan_id)
      .maybeSingle();
    if (planResult.error) throw configurationError('Plan lookup is unavailable');
    const row: SubscriptionRow = { ...result.data, activation_metadata: {} };
    return { row, summary: mapSubscription(row, planResult.data?.code ?? null) };
  }

  async getPlanEntitlementSnapshot(planId: string): Promise<PlanEntitlementSnapshot | null> {
    const [planResult, entitlementResult] = await Promise.all([
      this.publicClient.from('plans').select('*').eq('id', planId).maybeSingle(),
      this.publicClient
        .from('plan_entitlements')
        .select('entitlement_key, value')
        .eq('plan_id', planId),
    ]);
    if (planResult.error || entitlementResult.error) {
      throw configurationError('Plan entitlement configuration is unavailable');
    }
    if (!planResult.data) return null;
    return {
      code: planResult.data.code,
      entitlements: Object.fromEntries(
        (entitlementResult.data ?? []).map((entry) => [
          entry.entitlement_key,
          entitlementValue(entry.value),
        ]),
      ),
    };
  }

  toEntitlementSubscription(row: SubscriptionRow, planCode: string): SubscriptionSnapshot {
    return {
      planCode,
      status: row.status,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
    };
  }

  async getAdminAccess(
    accessToken: string,
  ): Promise<{ roles: readonly string[]; permissions: readonly string[] } | null> {
    const client = createUserDatabaseClient(
      this.environment.SUPABASE_URL,
      this.environment.SUPABASE_PUBLISHABLE_KEY,
      accessToken,
    );
    const result = await client.rpc('get_my_admin_access');
    if (result.error) throw configurationError('Administrator authorization is unavailable');
    const access = result.data?.[0];
    return access ? { roles: access.roles, permissions: access.permissions } : null;
  }
}

export type { PlanRow };
