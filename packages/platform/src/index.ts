import type { Platform, PlatformEvaluation } from '@hanaply/contracts';
import { lt, valid } from 'semver';

export interface FeatureFlagDefinition {
  key: string;
  defaultEnabled: boolean;
  clientExposed: boolean;
}

export interface FeatureFlagRule {
  featureKey: string;
  enabled: boolean;
  priority: number;
  environment: string | null;
  planCode: string | null;
  platform: Platform | null;
}

export interface FeatureFlagContext {
  environment: string;
  planCode: string | null;
  platform: Platform;
}

function ruleMatches(rule: FeatureFlagRule, context: FeatureFlagContext): boolean {
  return (
    (rule.environment === null || rule.environment === context.environment) &&
    (rule.planCode === null || rule.planCode === context.planCode) &&
    (rule.platform === null || rule.platform === context.platform)
  );
}

export function evaluateFeatureFlag(
  definition: FeatureFlagDefinition,
  rules: readonly FeatureFlagRule[],
  context: FeatureFlagContext,
): boolean {
  const matching = rules
    .filter((rule) => rule.featureKey === definition.key && ruleMatches(rule, context))
    .sort((left, right) => right.priority - left.priority);
  return matching[0]?.enabled ?? definition.defaultEnabled;
}

export function evaluateClientFeatureFlags(
  definitions: readonly FeatureFlagDefinition[],
  rules: readonly FeatureFlagRule[],
  context: FeatureFlagContext,
): Readonly<Record<string, boolean>> {
  return Object.fromEntries(
    definitions
      .filter((definition) => definition.clientExposed)
      .map((definition) => [definition.key, evaluateFeatureFlag(definition, rules, context)]),
  );
}

export interface PlatformSetting {
  platform: Platform;
  status: 'planned' | 'active' | 'maintenance' | 'retired';
  minimumVersion: string | null;
  latestVersion: string | null;
  forceUpdate: boolean;
  maintenanceMode: boolean;
  apiCompatibilityVersion: number;
  announcement: string | null;
}

export class PlatformConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlatformConfigurationError';
  }
}

function validateConfiguredVersion(version: string | null, label: string): void {
  if (version !== null && valid(version) === null) {
    throw new PlatformConfigurationError(`${label} is not valid semantic versioning`);
  }
}

export function evaluatePlatform(
  setting: PlatformSetting,
  clientVersion?: string,
): PlatformEvaluation {
  validateConfiguredVersion(setting.minimumVersion, 'Minimum version');
  validateConfiguredVersion(setting.latestVersion, 'Latest version');
  if (clientVersion !== undefined && valid(clientVersion) === null) {
    throw new PlatformConfigurationError('Client version is not valid semantic versioning');
  }

  let availability: PlatformEvaluation['availability'] = 'available';
  if (setting.maintenanceMode || setting.status === 'maintenance') availability = 'maintenance';
  else if (setting.status === 'planned') availability = 'planned';
  else if (setting.status === 'retired') availability = 'retired';
  else if (
    setting.forceUpdate &&
    clientVersion !== undefined &&
    setting.minimumVersion !== null &&
    lt(clientVersion, setting.minimumVersion)
  ) {
    availability = 'upgrade_required';
  }

  return {
    platform: setting.platform,
    availability,
    minimumVersion: setting.minimumVersion,
    latestVersion: setting.latestVersion,
    forceUpdate: setting.forceUpdate,
    apiCompatibilityVersion: setting.apiCompatibilityVersion,
    announcement: setting.announcement,
  };
}
