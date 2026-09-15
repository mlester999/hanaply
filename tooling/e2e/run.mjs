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
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(import.meta.dirname, '..', '..');
const stack = resolve(import.meta.dirname, 'stack.mjs');
const localCluster = resolve(import.meta.dirname, '..', 'db', 'local-cluster.mjs');
const stackFile = resolve(root, '.localdb', 'e2e-stack.json');

/**
 * One `pnpm e2e` per machine at a time.
 *
 * The stack binds fixed ports — 3100 for the web server, 3101 for the API — and
 * every run resets the single `hanaply_e2e` database. A second run therefore
 * does not merely queue behind the first: its opening `stack stop` tears the
 * first run's supervisor out from under it, and the reset drops the database the
 * first run's tests are connected to. Both then fail with symptoms that look
 * like real defects — a page answering 404 for a job that exists, tests dying on
 * a missing `.localdb/e2e-stack.json`, an API server that cannot bind a port.
 * That cost several debugging rounds across concurrent workstreams before it was
 * diagnosed, and it is why a red suite could not be attributed to anyone's
 * change.
 *
 * The run therefore takes a lock and refuses to start while another holds it,
 * naming the holder and when it started. A lock whose process is gone is stale
 * and is taken over, so a crashed run cannot wedge the gate. Running two side by
 * side stays possible for someone who has genuinely isolated the resources — a
 * different database *and* different ports — and only then, by setting
 * `HANAPLY_E2E_ALLOW_CONCURRENT=1`.
 */
const lockFile = resolve(root, '.localdb', 'e2e-run.lock');

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readLock() {
  // A byte-order mark is stripped before parsing. The lock lives in a scratch
  // directory a person may hand-edit, and an editor or shell that writes one
  // would otherwise make the file unparseable — which the caller below reads as
  // "stale, take it", silently defeating the lock instead of failing loudly.
  const raw = readFileSync(lockFile, 'utf8').replace(/^\uFEFF/u, '');
  return JSON.parse(raw);
}

function acquireRunLock() {
  if (process.env.HANAPLY_E2E_ALLOW_CONCURRENT === '1') {
    process.stdout.write(
      '\n⚠ HANAPLY_E2E_ALLOW_CONCURRENT=1: the single-run lock is skipped. This is only safe when this run has its own database and its own ports.\n',
    );
    return;
  }
  try {
    const held = readLock();
    if (typeof held.pid === 'number' && processIsAlive(held.pid)) {
      process.stderr.write(
        `\nAnother pnpm e2e is already running (pid ${String(held.pid)}, started ${String(held.startedAt)}).\n` +
          'The web and API servers bind fixed ports and every run resets the same hanaply_e2e database, so a\n' +
          'second run would tear the first one down and both would fail with symptoms that look like real\n' +
          'defects. Wait for it to finish.\n' +
          'To run two at once, give each run an isolated database and ports, then set\n' +
          'HANAPLY_E2E_ALLOW_CONCURRENT=1.\n',
      );
      process.exit(1);
    }
  } catch {
    // No lock file, or one that is not valid JSON at all. Either way it cannot
    // name a live holder, so it is ours to take.
  }
  mkdirSync(dirname(lockFile), { recursive: true });
  writeFileSync(
    lockFile,
    JSON.stringify(
      { pid: process.pid, startedAt: new Date().toISOString(), args: process.argv.slice(2) },
      null,
      2,
    ),
  );
}

function releaseRunLock() {
  try {
    const held = readLock();
    // Only the holder releases it, so nothing else can unlock a run in flight.
    if (held.pid === process.pid) rmSync(lockFile, { force: true });
  } catch {
    // Nothing to release.
  }
}

acquireRunLock();
process.on('exit', releaseRunLock);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    releaseRunLock();
    process.exit(1);
  });
}

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

// The API, web, and worker processes resolve workspace packages through their
// built `dist` entry points, so a clean checkout needs those before Playwright
// starts them. The worker is built here for the same reason the servers are: the
// matching spec starts it through its real production entry point
// (`services/worker/dist/main.js`, `WORKER_MODE=once`), which cannot run from
// source without the transpiler the services do not need.
//
// Turbo caches this, so repeat runs are cheap. A failure here is reported but
// not fatal: an existing `dist` can still serve the suite, and Playwright fails
// loudly if a server genuinely cannot start.
process.stdout.write('\n▶ Building workspace packages the servers import\n');
const buildStatus = run(
  process.execPath,
  [
    resolve(root, 'node_modules', 'turbo', 'bin', 'turbo'),
    'run',
    'build',
    '--filter=@hanaply/api',
    '--filter=@hanaply/web',
    '--filter=@hanaply/worker',
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
