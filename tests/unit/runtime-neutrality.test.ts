import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Runtime-neutrality guard.
 *
 * Hanaply is web-first with a deliberately mobile-ready core: contracts, auth
 * primitives, entitlements, platform evaluation, the job adapters, and the
 * matching engine are all supposed to be reusable by a future React Native
 * client. That claim is only true while those packages stay free of browser and
 * Node-only globals, so this test fails the build if one creeps in.
 *
 * `services/*` and `apps/web` are deliberately excluded: they are allowed to be
 * platform-specific.
 */

const root = resolve(import.meta.dirname, '../..');

const neutralPackages = [
  'packages/contracts/src',
  'packages/auth/src',
  'packages/entitlements/src',
  'packages/platform/src',
  'packages/jobs/src',
  'packages/matching/src',
  'packages/mobile-client/src',
] as const;

/**
 * Browser-only globals, matched as qualified references so that a MIME type such
 * as `...wordprocessingml.document` and prose in a comment do not trip the guard.
 */
const browserGlobals = [
  /(?<![\w-])window\./u,
  /(?<![\w-])document\./u,
  /(?<![\w-])localStorage\./u,
  /(?<![\w-])sessionStorage\./u,
  /(?<![\w-])navigator\./u,
  /(?<![\w-])HTMLElement\b/u,
  /(?<![\w-])ReactDOM\b/u,
] as const;

/** Node-only globals that a React Native runtime does not provide. */
const nodeGlobals = [
  /(?<![\w-])process\.env\./u,
  /(?<![\w-])Buffer\./u,
  /(?<![\w-])__dirname\b/u,
  /(?<![\w-])__filename\b/u,
] as const;

function sourceFiles(directory: string): string[] {
  return readdirSync(resolve(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/.*$/gmu, '');
}

describe('mobile readiness', () => {
  it('keeps the shared packages free of browser and Node-only globals', () => {
    const offenders: string[] = [];
    for (const directory of neutralPackages) {
      for (const file of sourceFiles(directory)) {
        const code = stripComments(readFileSync(resolve(root, file), 'utf8'));
        for (const global of [...browserGlobals, ...nodeGlobals]) {
          const match = global.exec(code);
          if (match) {
            offenders.push(`${file}: ${match[0]}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('exposes every shared package listed as mobile-reusable', () => {
    const packages = [
      'packages/contracts/package.json',
      'packages/auth/package.json',
      'packages/entitlements/package.json',
      'packages/platform/package.json',
      'packages/jobs/package.json',
      'packages/matching/package.json',
      'packages/mobile-client/package.json',
    ];
    for (const manifest of packages) {
      const parsed = JSON.parse(readFileSync(resolve(root, manifest), 'utf8')) as {
        name?: string;
        type?: string;
        exports?: unknown;
      };
      expect(parsed.name, `${manifest} must declare a name`).toMatch(/^@hanaply\//u);
      expect(parsed.type, `${manifest} must be an ES module`).toBe('module');
      expect(parsed.exports, `${manifest} must declare its public entry point`).toBeDefined();
    }
  });

  it('keeps the fetch client transport-agnostic', () => {
    const client = stripComments(
      readFileSync(resolve(root, 'packages/contracts/src/client.ts'), 'utf8'),
    );
    // The client must accept an injected fetch implementation and an async token
    // callback so a React Native caller can supply its own secure storage.
    expect(client).toContain('FetchLike');
    expect(client).toContain('getAccessToken');
    expect(client).toContain('options.fetch ??');
  });
});
