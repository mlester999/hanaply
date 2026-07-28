import type { EntitlementSnapshot } from '@hanaply/contracts';

type EntitlementDefinition =
  | { readonly type: 'boolean'; readonly defaultValue: false }
  | { readonly type: 'integer'; readonly defaultValue: 0 }
  | {
      readonly type: 'string';
      readonly defaultValue: 'none';
      readonly allowedValues: readonly ['none', 'standard', 'priority'];
    };

export const entitlementDefinitions = Object.freeze({
  careerProfileLimit: { type: 'integer', defaultValue: 0 },
  subCareerLimitPerProfile: { type: 'integer', defaultValue: 0 },
  scanIntervalMinutes: { type: 'integer', defaultValue: 0 },
  coverLetterPerJobLimit: { type: 'integer', defaultValue: 0 },
  tailoredResumePerJobLimit: { type: 'integer', defaultValue: 0 },
  coverLetterStyleSlotLimit: { type: 'integer', defaultValue: 0 },
  resumeStyleSlotLimit: { type: 'integer', defaultValue: 0 },
  automaticPackMonthlyLimit: { type: 'integer', defaultValue: 0 },
  sourceDiscoveryPriority: {
    type: 'string',
    defaultValue: 'none',
    allowedValues: ['none', 'standard', 'priority'],
  },
  emailAlerts: { type: 'boolean', defaultValue: false },
  dailyDigest: { type: 'boolean', defaultValue: false },
  instantAlerts: { type: 'boolean', defaultValue: false },
  browserNotifications: { type: 'boolean', defaultValue: false },
  basicResumeBuilder: { type: 'boolean', defaultValue: false },
  advancedResumeTemplates: { type: 'boolean', defaultValue: false },
  applicationTracking: { type: 'boolean', defaultValue: false },
  coreAiAnalysis: { type: 'boolean', defaultValue: false },
  advancedAiAnalysis: { type: 'boolean', defaultValue: false },
  interviewPreparation: { type: 'boolean', defaultValue: false },
  recruiterMessages: { type: 'boolean', defaultValue: false },
  weeklyAiCareerStrategy: { type: 'boolean', defaultValue: false },
  priorityProcessing: { type: 'boolean', defaultValue: false },
  futureMobileAccess: { type: 'boolean', defaultValue: false },
  automaticStretchPackOptIn: { type: 'boolean', defaultValue: false },
} satisfies Record<string, EntitlementDefinition>);

export type EntitlementKey = keyof typeof entitlementDefinitions;
export type EntitlementValue = boolean | number | string;

export const denyByDefaultEntitlements: Readonly<Record<EntitlementKey, EntitlementValue>> =
  Object.freeze(
    Object.fromEntries(
      Object.entries(entitlementDefinitions).map(([key, definition]) => [
        key,
        definition.defaultValue,
      ]),
    ) as Record<EntitlementKey, EntitlementValue>,
  );

export interface SubscriptionSnapshot {
  planCode: string;
  status:
    | 'pending_activation'
    | 'active'
    | 'grace_period'
    | 'expired'
    | 'cancelled'
    | 'suspended'
    | 'refunded'
    | 'reversed';
  startsAt: string | Date;
  endsAt: string | Date | null;
}

export interface PlanEntitlementSnapshot {
  code: string;
  entitlements: Readonly<Record<string, unknown>>;
}

export class EntitlementConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EntitlementConfigurationError';
  }
}

function parseDate(value: string | Date, label: string): Date {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new EntitlementConfigurationError(`${label} is not a valid timestamp`);
  }
  return parsed;
}

function validateValue(key: EntitlementKey, value: unknown): EntitlementValue {
  const definition = entitlementDefinitions[key];
  if (definition.type === 'boolean' && typeof value === 'boolean') return value;
  if (
    definition.type === 'integer' &&
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0
  ) {
    return value;
  }
  if (
    definition.type === 'string' &&
    typeof value === 'string' &&
    definition.allowedValues.includes(value as 'none' | 'standard' | 'priority')
  ) {
    return value;
  }
  throw new EntitlementConfigurationError(`Invalid value configured for entitlement ${key}`);
}

function validatePlanEntitlements(values: Readonly<Record<string, unknown>>) {
  const knownKeys = new Set(Object.keys(entitlementDefinitions));
  for (const key of Object.keys(values)) {
    if (!knownKeys.has(key)) {
      throw new EntitlementConfigurationError(`Unknown entitlement configured: ${key}`);
    }
  }

  const result: Record<EntitlementKey, EntitlementValue> = {
    ...denyByDefaultEntitlements,
  };
  for (const key of Object.keys(entitlementDefinitions) as EntitlementKey[]) {
    if (!(key in values)) {
      throw new EntitlementConfigurationError(`Missing entitlement configuration: ${key}`);
    }
    result[key] = validateValue(key, values[key]);
  }
  return result;
}

export function evaluateEntitlements(input: {
  subscription: SubscriptionSnapshot | null;
  plan: PlanEntitlementSnapshot | null;
  now?: Date;
}): EntitlementSnapshot {
  const now = input.now ?? new Date();
  if (input.subscription?.status !== 'active') {
    return {
      planCode: null,
      subscriptionStatus: input.subscription?.status ?? 'inactive',
      validFrom: null,
      validUntil: null,
      entitlements: { ...denyByDefaultEntitlements },
    };
  }

  const startsAt = parseDate(input.subscription.startsAt, 'Subscription start');
  const endsAt = input.subscription.endsAt
    ? parseDate(input.subscription.endsAt, 'Subscription end')
    : null;
  if (startsAt > now || (endsAt && endsAt <= now)) {
    return {
      planCode: null,
      subscriptionStatus: 'inactive',
      validFrom: null,
      validUntil: null,
      entitlements: { ...denyByDefaultEntitlements },
    };
  }
  if (input.plan?.code !== input.subscription.planCode) {
    throw new EntitlementConfigurationError(
      'Active subscription plan configuration is unavailable',
    );
  }

  return {
    planCode: input.plan.code,
    subscriptionStatus: 'active',
    validFrom: startsAt.toISOString(),
    validUntil: endsAt?.toISOString() ?? null,
    entitlements: validatePlanEntitlements(input.plan.entitlements),
  };
}
