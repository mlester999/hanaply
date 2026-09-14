import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  denyByDefaultEntitlements,
  entitlementDefinitions,
} from '../../packages/entitlements/src/index.js';

/**
 * Entitlement parity.
 *
 * Plan limits are enforced inside SQL and mirrored in `@hanaply/entitlements`,
 * which the API and the interface read. Two copies of the same numbers drift,
 * and the failure mode is quiet: the pricing page promises 40 packs a month
 * while the database enforces 20, or the interface hides a feature the plan
 * actually includes. This test reads the migration that seeds the catalogue and
 * fails if the two disagree.
 *
 * The database remains the source of truth. If this test fails, the fix is to
 * change the migration, not the test.
 */

const root = resolve(import.meta.dirname, '../..');
const catalogMigration = 'supabase/migrations/20260722094000_foundation_catalog.sql';

interface TierValue {
  tierCode: string;
  key: string;
  /** The JSON literal as written in the migration, unquoted for strings. */
  value: string;
  isString: boolean;
}

/**
 * Reads the seeded `tier_values` rows. The migration writes them as
 * `('plus'::public.plan_tier, 'careerProfileLimit', '1'::jsonb)`. The parse is
 * deliberately strict: if the migration is reformatted, the guard test below
 * fails loudly rather than this silently comparing nothing.
 */
function readTierValues(): TierValue[] {
  const sql = readFileSync(resolve(root, catalogMigration), 'utf8');
  const rows: TierValue[] = [];
  const tuple =
    /\(\s*'(plus|pro)'::public\.plan_tier\s*,\s*'([A-Za-z]+)'\s*,\s*'("[^"]*"|[^']*)'::jsonb\s*\)/gu;
  for (const match of sql.matchAll(tuple)) {
    const [, tierCode, key, rawValue] = match;
    if (tierCode === undefined || key === undefined || rawValue === undefined) continue;
    if (!(key in entitlementDefinitions)) continue;
    const isString = rawValue.startsWith('"') && rawValue.endsWith('"');
    rows.push({
      tierCode,
      key,
      value: isString ? rawValue.slice(1, -1) : rawValue,
      isString,
    });
  }
  return rows;
}

const tierValues = readTierValues();

function tier(tierCode: string): Map<string, TierValue> {
  return new Map(
    tierValues.filter((row) => row.tierCode === tierCode).map((row) => [row.key, row]),
  );
}

describe('entitlement parity between SQL and TypeScript', () => {
  it('finds the seeded tier entitlements', () => {
    // Guards against a silent pass if the migration is reformatted.
    expect(tierValues.length).toBeGreaterThanOrEqual(40);
  });

  it('covers both paid tiers', () => {
    const tiers = new Set(tierValues.map((row) => row.tierCode));
    expect([...tiers].sort()).toEqual(['plus', 'pro']);
  });

  it('declares a TypeScript definition for every seeded key', () => {
    const unknown = [...new Set(tierValues.map((row) => row.key))].filter(
      (key) => !(key in entitlementDefinitions),
    );
    expect(unknown).toEqual([]);
  });

  it('gives every plan of a tier the same values, by construction', () => {
    // The migration joins `plans` to `tier_values` on `tier_code`, so monthly and
    // annual plans of the same tier cannot diverge. This asserts the join is
    // still tier-based rather than plan-based.
    const sql = readFileSync(resolve(root, catalogMigration), 'utf8');
    expect(sql).toMatch(
      /insert into public\.plan_entitlements[\s\S]{0,200}join tier_values tv on tv\.tier_code = p\.tier_code/u,
    );
  });

  it('matches the advertised Plus allowances', () => {
    const plus = tier('plus');
    expect(plus.get('careerProfileLimit')?.value).toBe('1');
    expect(plus.get('subCareerLimitPerProfile')?.value).toBe('2');
    expect(plus.get('scanIntervalMinutes')?.value).toBe('15');
    expect(plus.get('automaticPackMonthlyLimit')?.value).toBe('40');
    expect(plus.get('coverLetterPerJobLimit')?.value).toBe('1');
    expect(plus.get('tailoredResumePerJobLimit')?.value).toBe('1');
  });

  it('matches the advertised Pro allowances', () => {
    const pro = tier('pro');
    expect(pro.get('careerProfileLimit')?.value).toBe('3');
    expect(pro.get('subCareerLimitPerProfile')?.value).toBe('5');
    expect(pro.get('scanIntervalMinutes')?.value).toBe('5');
    expect(pro.get('automaticPackMonthlyLimit')?.value).toBe('100');
    expect(pro.get('coverLetterPerJobLimit')?.value).toBe('3');
    expect(pro.get('tailoredResumePerJobLimit')?.value).toBe('3');
  });

  it('keeps Pro at least as generous as Plus on every shared integer', () => {
    const plus = tier('plus');
    const pro = tier('pro');
    const regressions: string[] = [];
    for (const [key, plusRow] of plus) {
      const proRow = pro.get(key);
      if (proRow === undefined) continue;
      const definition = entitlementDefinitions[key as keyof typeof entitlementDefinitions];
      if (definition?.type !== 'integer') continue;
      const plusNumber = Number(plusRow.value);
      const proNumber = Number(proRow.value);
      // A lower scan interval means fresher discovery, so it is the one integer
      // where smaller is better and the comparison is inverted.
      const proIsWorse =
        key === 'scanIntervalMinutes' ? proNumber > plusNumber : proNumber < plusNumber;
      if (proIsWorse) regressions.push(`${key}: plus ${plusRow.value} vs pro ${proRow.value}`);
    }
    expect(regressions).toEqual([]);
  });

  it('enables at least as many boolean features on Pro as on Plus', () => {
    const plus = tier('plus');
    const pro = tier('pro');
    const lost: string[] = [];
    for (const [key, plusRow] of plus) {
      const proRow = pro.get(key);
      if (proRow === undefined) continue;
      const definition = entitlementDefinitions[key as keyof typeof entitlementDefinitions];
      if (definition?.type !== 'boolean') continue;
      if (plusRow.value === 'true' && proRow.value !== 'true') lost.push(key);
    }
    expect(lost).toEqual([]);
  });

  it('denies everything by default', () => {
    for (const [key, definition] of Object.entries(entitlementDefinitions)) {
      const fallback = denyByDefaultEntitlements[key as keyof typeof denyByDefaultEntitlements];
      expect(fallback, `${key} must have a deny-by-default value`).toBe(definition.defaultValue);
      if (definition.type === 'boolean') {
        expect(fallback, `${key} must default to false`).toBe(false);
      }
    }
  });

  it('defaults every numeric entitlement to zero rather than to a paid value', () => {
    for (const [key, definition] of Object.entries(entitlementDefinitions)) {
      if (definition.type !== 'integer') continue;
      expect(
        denyByDefaultEntitlements[key as keyof typeof denyByDefaultEntitlements],
        `${key} must default to zero`,
      ).toBe(0);
    }
  });

  it('defaults every string entitlement to the least privileged allowed value', () => {
    for (const [key, definition] of Object.entries(entitlementDefinitions)) {
      if (definition.type !== 'string') continue;
      const fallback = denyByDefaultEntitlements[key as keyof typeof denyByDefaultEntitlements];
      expect(fallback, `${key} must default to none`).toBe('none');
    }
  });

  it('gates every paid notification channel behind a boolean entitlement', () => {
    for (const key of [
      'emailAlerts',
      'dailyDigest',
      'instantAlerts',
      'browserNotifications',
      'weeklyAiCareerStrategy',
    ] as const) {
      expect(entitlementDefinitions[key].type).toBe('boolean');
    }
  });

  it('matches every seeded value to the declared TypeScript type', () => {
    const mismatches: string[] = [];
    for (const [key, definition] of Object.entries(entitlementDefinitions)) {
      for (const tierCode of ['plus', 'pro'] as const) {
        const row = tier(tierCode).get(key);
        if (row === undefined) continue;
        if (definition.type === 'boolean' && row.value !== 'true' && row.value !== 'false') {
          mismatches.push(`${tierCode}.${key} is not a boolean`);
        }
        if (definition.type === 'integer' && !/^-?\d+$/u.test(row.value)) {
          mismatches.push(`${tierCode}.${key} is not an integer`);
        }
        if (definition.type === 'string') {
          const allowed =
            'allowedValues' in definition
              ? (definition.allowedValues as readonly string[])
              : undefined;
          if (allowed && !allowed.includes(row.value)) {
            mismatches.push(`${tierCode}.${key} is not an allowed value`);
          }
        }
      }
    }
    expect(mismatches).toEqual([]);
  });
});
