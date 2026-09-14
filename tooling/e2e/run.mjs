#!/usr/bin/env node
/**
 * `pnpm e2e` — the complete browser gate from a clean checkout, without Docker.
 *
 *   1. stop any leftover stack and rebuild the throwaway PostgreSQL cluster from
 *      the migration chain
 *   2. start the Dockerless Supabase-compatible stack (auth, PostgREST, mailbox,
 *      gateway) as a child that lives for the whole run
 *   3. run Playwright against a real Chromium, which starts the API and web
 *      servers itself (tooling/playwright.config.ts)
 *   4. stop the stack again, whatever the outcome
 *
 * Playwright arguments are forwarded, so `pnpm e2e -- --headed` and
 * `pnpm e2e -- hanaply.spec.ts -g "registration"` work as usual.
 *
 * Usage: node tooling/e2e/run.mjs [playwright arguments]
 */

import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(import.meta.dirname, '..', '..');
const stack = resolve(import.meta.dirname, 'stack.mjs');
const localCluster = resolve(import.meta.dirname, '..', 'db', 'local-cluster.mjs');
const stackFile = resolve(root, '.localdb', 'e2e-stack.json');

function run(command, args, { allowFailure = false } = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    process.exit(result.status ?? 1);
  }
  return result.status ?? 0;
}

function terminate(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // Already gone.
  }
}

run(process.execPath, [stack, 'stop'], { allowFailure: true });

process.stdout.write('\n▶ Rebuilding the local database from the migration chain\n');
run(process.execPath, [localCluster, 'reset']);

// The API and web dev servers resolve workspace packages through their built
// `dist` entry points, so a clean checkout needs those before Playwright starts
// them. Turbo caches this, so repeat runs are cheap. A failure here is reported
// but not fatal: an existing `dist` can still serve the suite, and Playwright
// fails loudly if a server genuinely cannot start.
process.stdout.write('\n▶ Building workspace packages the servers import\n');
const buildStatus = run(
  process.execPath,
  [
    resolve(root, 'node_modules', 'turbo', 'bin', 'turbo'),
    'run',
    'build',
    '--filter=@hanaply/api',
    '--filter=@hanaply/web',
  ],
  { allowFailure: true },
);
if (buildStatus !== 0) {
  process.stdout.write(
    '\n⚠ The workspace build failed. Continuing with the existing dist output; Playwright will report any server that cannot start.\n',
  );
}

process.stdout.write('\n▶ Starting the Dockerless Supabase-compatible stack\n');
const supervisor = spawn(process.execPath, [stack, 'serve'], {
  cwd: root,
  stdio: ['ignore', 'inherit', 'inherit'],
});

const deadline = Date.now() + 180_000;
let ready = false;
while (Date.now() < deadline && !ready) {
  await delay(300);
  try {
    const record = JSON.parse(readFileSync(stackFile, 'utf8'));
    ready = record.supervisorPid === supervisor.pid;
  } catch {
    ready = false;
  }
  if (supervisor.exitCode !== null) break;
}
if (!ready) {
  terminate(supervisor.pid);
  process.stderr.write('\nThe Dockerless stack did not become ready.\n');
  process.exit(1);
}

process.stdout.write('\n▶ Running Playwright\n');
const playwright = spawn(
  process.execPath,
  [
    resolve(root, 'node_modules', '@playwright', 'test', 'cli.js'),
    'test',
    '--config',
    'tooling/playwright.config.ts',
    ...process.argv.slice(2),
  ],
  { cwd: root, stdio: 'inherit' },
);

const exitCode = await new Promise((settle) => {
  playwright.on('exit', (code) => settle(code ?? 1));
});

process.stdout.write('\n▶ Stopping the Dockerless stack\n');
terminate(supervisor.pid);
rmSync(stackFile, { force: true });

process.exit(exitCode);
