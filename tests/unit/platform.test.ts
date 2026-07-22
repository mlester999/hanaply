import {
  evaluateClientFeatureFlags,
  evaluateFeatureFlag,
  evaluatePlatform,
  PlatformConfigurationError,
  type PlatformSetting,
} from '@hanaply/platform';
import { describe, expect, it } from 'vitest';

const activeWeb: PlatformSetting = {
  platform: 'web',
  status: 'active',
  minimumVersion: '2.0.0',
  latestVersion: '2.4.0',
  forceUpdate: true,
  maintenanceMode: false,
  apiCompatibilityVersion: 1,
  announcement: null,
};

describe('feature evaluation', () => {
  it('uses the highest-priority matching rule', () => {
    const definition = { key: 'mobile_access', defaultEnabled: false, clientExposed: true };
    const rules = [
      {
        featureKey: 'mobile_access',
        enabled: false,
        priority: 10,
        environment: 'local',
        planCode: null,
        platform: 'ios' as const,
      },
      {
        featureKey: 'mobile_access',
        enabled: true,
        priority: 50,
        environment: 'local',
        planCode: 'pro_monthly',
        platform: 'ios' as const,
      },
      {
        featureKey: 'mobile_access',
        enabled: false,
        priority: 100,
        environment: 'production',
        planCode: null,
        platform: null,
      },
    ];
    expect(
      evaluateFeatureFlag(definition, rules, {
        environment: 'local',
        planCode: 'pro_monthly',
        platform: 'ios',
      }),
    ).toBe(true);
  });

  it('never returns server-only flags to clients', () => {
    expect(
      evaluateClientFeatureFlags(
        [
          { key: 'public_flag', defaultEnabled: true, clientExposed: true },
          { key: 'private_flag', defaultEnabled: true, clientExposed: false },
        ],
        [],
        { environment: 'local', planCode: null, platform: 'web' },
      ),
    ).toEqual({ public_flag: true });
  });
});

describe('platform evaluation', () => {
  it('requires an upgrade only after maintenance and lifecycle checks', () => {
    expect(evaluatePlatform(activeWeb, '1.9.9').availability).toBe('upgrade_required');
    expect(evaluatePlatform({ ...activeWeb, maintenanceMode: true }, '1.0.0').availability).toBe(
      'maintenance',
    );
    expect(
      evaluatePlatform({ ...activeWeb, status: 'planned', maintenanceMode: false }, '1.0.0')
        .availability,
    ).toBe('planned');
  });

  it('validates configured and supplied semantic versions', () => {
    expect(() => evaluatePlatform(activeWeb, 'not-semver')).toThrow(PlatformConfigurationError);
    expect(() => evaluatePlatform({ ...activeWeb, minimumVersion: '2' }, '2.0.0')).toThrow(
      PlatformConfigurationError,
    );
  });
});
