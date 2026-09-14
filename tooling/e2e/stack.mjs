#!/usr/bin/env node
/**
 * Dockerless end-to-end stack for the browser suite.
 *
 * `pnpm e2e` needs the same moving parts `supabase start` provides — a database,
 * an Auth (GoTrue) server, PostgREST, and a mail catcher — but Docker is not
 * available in every environment this repository is validated in. This module
 * assembles equivalents from what is already here:
 *
 *   PostgreSQL   the throwaway cluster from tooling/db/local-cluster.mjs
 *   Auth         tooling/e2e/auth-server.mjs (documented test double)
 *   PostgREST    the real PostgREST server, downloaded into the git-ignored
 *                `.localdb/` exactly like the pgTAP extension is
 *   Mail         tooling/e2e/mailbox.mjs (Mailpit-compatible capture)
 *   Edge         tooling/e2e/gateway.mjs, the single published origin
 *
 * Everything is recorded in `.localdb/e2e-stack.json`, which
 * `tests/e2e/local-supabase.ts` reads to build the environment the Playwright
 * configuration already consumes.
 *
 * Commands
 *   serve    run the stack in the foreground until terminated. This is the mode
 *            `pnpm e2e` uses, because the supervisor stays alive for the whole
 *            Playwright run.
 *   start    run `serve` in the background and return once it is healthy.
 *   stop     terminate a background stack.
 *   status   report what is running.
 *   env      print the environment the tests consume.
 *
 * The Supabase CLI workflow (`pnpm db:start`, `pnpm e2e` against Docker) is
 * still the canonical one for anything that needs Storage, Realtime, or hosted
 * Auth behaviour. Nothing here is used outside local validation.
 */

import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createConnection, createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { withPostgresBinOnPath } from '../db/pg-bin.mjs';
import { readZipDirectory, readZipEntry } from '../db/zip.mjs';
import { buildApiKeys, createAuthServer } from './auth-server.mjs';
import { createGatewayServer } from './gateway.mjs';
import { clearMailbox, createMailboxServer } from './mailbox.mjs';
import { clearStorage, createStorageServer } from './storage-server.mjs';

const root = resolve(import.meta.dirname, '..', '..');
const stateDir = join(root, '.localdb');
const logDir = join(stateDir, 'logs');
const stackFile = join(stateDir, 'e2e-stack.json');
const mailboxFile = join(stateDir, 'mailbox.jsonl');
const postgrestConfigFile = join(stateDir, 'postgrest.conf');
const jwtSecretFile = join(stateDir, 'e2e-jwt-secret');
const postgrestDir = join(stateDir, 'bin');
const storageDir = join(stateDir, 'storage');
const localCluster = resolve(import.meta.dirname, '..', 'db', 'local-cluster.mjs');
const stackScript = resolve(import.meta.dirname, 'stack.mjs');

const postgrestVersion = process.env.HANAPLY_POSTGREST_VERSION ?? '16.3';
const appUrl = process.env.HANAPLY_E2E_APP_URL ?? 'http://localhost:3100';
/**
 * The end-to-end suite runs against its own database.
 *
 * It shares the cluster with the pgTAP harness but not the database, because an
 * end-to-end run leaves users, sessions, audit events, and subscriptions behind.
 * Those rows are right for the application and wrong for a suite that asserts on
 * global counts, so sharing one database made `pnpm db:harness:test` fail after
 * `pnpm e2e` and pass after a reset. A launch gate that depends on the order two
 * commands were run in is not a gate.
 */
const databaseName = process.env.HANAPLY_E2E_DB_NAME ?? 'hanaply_e2e';
const isWindows = process.platform === 'win32';

function note(message) {
  process.stdout.write(`${message}\n`);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function readJsonFile(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function recordedDatabasePort() {
  let recorded;
  try {
    recorded = readFileSync(join(stateDir, 'port'), 'utf8').trim();
  } catch {
    fail(
      `The local PostgreSQL harness has not been initialised (${join(stateDir, 'port')} is missing).`,
    );
  }
  const port = Number(recorded);
  if (!Number.isInteger(port) || port <= 0)
    fail(`Invalid port recorded in ${join(stateDir, 'port')}.`);
  return port;
}

async function findFreePort(preferred) {
  for (let candidate = preferred; candidate < preferred + 200; candidate += 1) {
    const free = await new Promise((settle) => {
      const probe = createServer();
      probe.unref();
      probe.on('error', () => settle(false));
      probe.listen({ host: '127.0.0.1', port: candidate }, () => {
        probe.close(() => settle(true));
      });
    });
    if (free) return candidate;
  }
  fail(`No free port found starting at ${preferred}.`);
  return preferred;
}

/** PostgREST serves no health route, so readiness is the listening socket. */
async function waitForPort(port, { timeoutMs = 30_000, label = `port ${port}` } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const open = await new Promise((settle) => {
      const socket = createConnection({ host: '127.0.0.1', port });
      socket.once('connect', () => {
        socket.destroy();
        settle(true);
      });
      socket.once('error', () => {
        socket.destroy();
        settle(false);
      });
    });
    if (open) return;
    await delay(200);
  }
  fail(`Timed out waiting for ${label}.`);
}

function ensureDatabase() {
  note(`Ensuring the ${databaseName} database is migrated ...`);
  const result = spawnSync(process.execPath, [localCluster, 'reset'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, HANAPLY_LOCAL_DB_NAME: databaseName },
  });
  if (result.status !== 0) {
    fail(
      `The local PostgreSQL cluster could not be started.\n${result.stdout ?? ''}${result.stderr ?? ''}`,
    );
  }
  process.stdout.write(result.stdout ?? '');
  seedDemoPostings();
}

/**
 * The product surfaces the browser suite exercises — the radar, the Application
 * Pack generator, and the tracker — rank and cite real postings. A reset leaves
 * the catalogue tables empty, so every product spec would pass against an empty
 * radar and prove nothing.
 *
 * `pnpm db:demo` is the development seed for exactly this data. It inserts its
 * five synthetic postings through `upsert_ingested_job`, the same
 * service-role-only writer the ingestion worker uses, so the end-to-end radar
 * exercises the real deduplication, provenance, and freshness path rather than
 * a fabricated row. It runs only against this stack's throwaway database, and
 * `HANAPLY_E2E_DEMO_DATA=off` disables it for a run that needs an empty radar.
 */
function seedDemoPostings() {
  if ((process.env.HANAPLY_E2E_DEMO_DATA ?? 'on').toLowerCase() === 'off') return;
  note('Seeding the synthetic radar postings ...');
  const result = spawnSync(process.execPath, [localCluster, 'demo'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, HANAPLY_LOCAL_DB_NAME: databaseName },
  });
  if (result.status !== 0) {
    fail(
      `The synthetic radar postings could not be seeded.\n${result.stdout ?? ''}${result.stderr ?? ''}`,
    );
  }
  process.stdout.write(result.stdout ?? '');
}

async function ensurePostgrest() {
  if (process.env.HANAPLY_POSTGREST_BIN) {
    return process.env.HANAPLY_POSTGREST_BIN;
  }
  const executable = join(postgrestDir, isWindows ? 'postgrest.exe' : 'postgrest');
  if (existsSync(executable)) return executable;
  if (!isWindows) {
    fail(
      `PostgREST was not found at ${executable}. Download the release archive for this platform from https://github.com/PostgREST/postgrest/releases/tag/v${postgrestVersion}, extract it, and either place the binary there or set HANAPLY_POSTGREST_BIN.`,
    );
  }
  mkdirSync(postgrestDir, { recursive: true });
  const name = `postgrest-v${postgrestVersion}-windows-x86-64.zip`;
  const url = `https://github.com/PostgREST/postgrest/releases/download/v${postgrestVersion}/${name}`;
  note(`Downloading PostgREST ${postgrestVersion} from ${url} ...`);
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(300_000) });
  if (!response.ok) {
    fail(
      `Could not download PostgREST (HTTP ${response.status}). Download it manually and set HANAPLY_POSTGREST_BIN.`,
    );
  }
  const archive = Buffer.from(await response.arrayBuffer());
  const entry = readZipDirectory(archive).find((candidate) =>
    candidate.name.toLowerCase().endsWith('.exe'),
  );
  if (!entry) fail('The PostgREST release archive did not contain an executable.');
  writeFileSync(executable, readZipEntry(archive, entry));
  note(`Installed PostgREST into ${executable}.`);
  return executable;
}

function writePostgrestConfig({ port, databasePort, jwtSecret }) {
  const lines = [
    `db-uri = "postgres://postgres@127.0.0.1:${databasePort}/${databaseName}"`,
    'db-schemas = "public"',
    'db-anon-role = "anon"',
    'db-extra-search-path = "public,extensions"',
    'db-max-rows = 1000',
    'db-pool = 10',
    `jwt-secret = "${jwtSecret}"`,
    'server-host = "127.0.0.1"',
    `server-port = ${port}`,
    'log-level = "error"',
  ];
  writeFileSync(postgrestConfigFile, `${lines.join('\n')}\n`, 'utf8');
}

function listen(server, port) {
  return new Promise((settle, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => settle(server.address().port));
  });
}

function close(server) {
  return new Promise((settle) => {
    if (!server) {
      settle();
      return;
    }
    server.close(() => settle());
  });
}

/**
 * The stack's JWT secret, kept stable across restarts so a development server
 * that is already running keeps accepting the published keys. It lives in the
 * git-ignored `.localdb/` and is regenerated only when `.localdb/` is removed.
 */
function resolveJwtSecret() {
  try {
    const recorded = readFileSync(jwtSecretFile, 'utf8').trim();
    if (recorded.length >= 32) return recorded;
  } catch {
    // Generated below.
  }
  const secret = randomBytes(32).toString('hex');
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(jwtSecretFile, `${secret}\n`, { encoding: 'utf8', mode: 0o600 });
  return secret;
}

function processAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function terminate(pid) {
  if (!processAlive(pid)) return;
  if (isWindows) {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // Already gone.
  }
}

/**
 * Runs the whole stack in this process and blocks until terminated.
 *
 * PostgREST is the only external binary, so it is a child process. Auth,
 * mailbox, and gateway are HTTP servers hosted here: several tool runtimes reap
 * every descendant of a command once that command exits, and a background stack
 * that silently disappears is worse than one that is owned by the command
 * running the suite.
 */
async function commandServe() {
  ensureDatabase();
  const databasePort = recordedDatabasePort();
  const postgrestBinary = await ensurePostgrest();
  mkdirSync(logDir, { recursive: true });

  const jwtSecret = resolveJwtSecret();
  const { publishableKey, serviceRoleKey } = buildApiKeys(jwtSecret);
  const postgrestPort = await findFreePort(55440);
  const authPort = await findFreePort(postgrestPort + 1);
  const mailboxPort = await findFreePort(authPort + 1);
  const storagePort = await findFreePort(mailboxPort + 1);
  const gatewayPort = await findFreePort(storagePort + 1);

  writePostgrestConfig({ port: postgrestPort, databasePort, jwtSecret });
  clearMailbox(mailboxFile);
  clearStorage(storageDir);

  const postgrestLog = openSync(join(logDir, 'postgrest.log'), 'a');
  // The PostgREST Windows build links against LIBPQ.dll from the PostgreSQL
  // installation instead of bundling it, so the cluster's bin directory has to
  // be on the child process PATH. `detached` matches how the supervisor itself
  // is started, so tool runtimes that reap a finished command's descendants do
  // not take down the database API while the stack is still serving.
  const postgrest = spawn(postgrestBinary, [postgrestConfigFile], {
    cwd: root,
    detached: true,
    stdio: ['ignore', postgrestLog, postgrestLog],
    env: withPostgresBinOnPath(process.env),
  });
  postgrest.unref();

  const auth = await createAuthServer({
    port: authPort,
    database: { host: '127.0.0.1', port: databasePort, user: 'postgres', database: databaseName },
    jwtSecret,
    siteUrl: appUrl,
    mailboxFile,
    logger: (message) => note(`[auth] ${message}`),
  });
  await auth.listen();
  const mailbox = createMailboxServer({ file: mailboxFile });
  await listen(mailbox, mailboxPort);
  const storage = createStorageServer({ root: storageDir });
  await listen(storage, storagePort);
  const gateway = createGatewayServer({
    authUrl: `http://127.0.0.1:${authPort}`,
    restUrl: `http://127.0.0.1:${postgrestPort}`,
    storageUrl: `http://127.0.0.1:${storagePort}`,
  });
  await listen(gateway, gatewayPort);

  const record = {
    version: 1,
    startedAt: new Date().toISOString(),
    supervisorPid: process.pid,
    appUrl,
    apiUrl: `http://127.0.0.1:${gatewayPort}`,
    databaseUrl: `postgresql://postgres@127.0.0.1:${databasePort}/${databaseName}`,
    mailpitUrl: `http://127.0.0.1:${mailboxPort}`,
    publishableKey,
    serviceRoleKey,
    jwtSecret,
    mailboxFile,
    postgrestConfigFile,
    ports: {
      postgrest: postgrestPort,
      auth: authPort,
      mailbox: mailboxPort,
      storage: storagePort,
      gateway: gatewayPort,
      database: databasePort,
    },
    postgrestPid: postgrest.pid,
    logs: { postgrest: join(logDir, 'postgrest.log') },
  };

  const shutdown = async (code) => {
    await close(gateway);
    await close(storage);
    await close(mailbox);
    await auth.close();
    terminate(postgrest.pid);
    if (readJsonFile(stackFile)?.supervisorPid === process.pid) rmSync(stackFile, { force: true });
    process.exit(code);
  };
  process.on('SIGINT', () => void shutdown(0));
  process.on('SIGTERM', () => void shutdown(0));
  process.on('SIGHUP', () => void shutdown(0));

  try {
    await waitForPort(postgrestPort, { label: 'PostgREST' });
    const readiness = await fetch(
      `http://127.0.0.1:${gatewayPort}/rest/v1/plans?select=id&limit=1`,
      {
        headers: { apikey: publishableKey, Authorization: `Bearer ${publishableKey}` },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (readiness.status >= 500) {
      fail(`PostgREST could not serve the public schema (HTTP ${readiness.status}).`);
    }
  } catch (error) {
    await shutdown(1);
    throw error;
  }

  writeFileSync(stackFile, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  note('Hanaply e2e stack ready.');
  note(`  Supabase-compatible API : ${record.apiUrl}`);
  note(`  Mailbox (Mailpit API)   : ${record.mailpitUrl}`);
  note(`  PostgreSQL              : ${record.databaseUrl}`);
  note(`  State                   : ${stackFile}`);
  note(`  Logs                    : ${join(logDir, 'postgrest.log')}`);

  // Stay alive: the stack lives exactly as long as this supervisor, which is
  // stopped by a signal rather than by finishing.
  await new Promise(() => {
    /* intentionally empty: the promise is settled by process termination */
  });
}

async function commandStart() {
  const existing = readJsonFile(stackFile);
  if (existing) {
    try {
      const response = await fetch(`http://127.0.0.1:${existing.ports?.gateway}/health`, {
        signal: AbortSignal.timeout(1_500),
      });
      if (response.ok) {
        note(`The e2e stack is already running (${existing.apiUrl}).`);
        return;
      }
    } catch {
      rmSync(stackFile, { force: true });
    }
  }
  const log = openSync(join(logDir, 'stack.log'), 'a');
  const supervisor = spawn(process.execPath, [stackScript, 'serve'], {
    cwd: root,
    detached: true,
    stdio: ['ignore', log, log],
  });
  supervisor.unref();
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    await delay(300);
    const record = readJsonFile(stackFile);
    if (record?.supervisorPid === supervisor.pid) {
      note(`Hanaply e2e stack running (supervisor ${supervisor.pid}).`);
      note(`  Supabase-compatible API : ${record.apiUrl}`);
      note(`  Mailbox (Mailpit API)   : ${record.mailpitUrl}`);
      note(`  Logs                    : ${join(logDir, 'stack.log')}`);
      return;
    }
    if (!processAlive(supervisor.pid)) break;
  }
  terminate(supervisor.pid);
  fail(`The e2e stack did not become ready. See ${join(logDir, 'stack.log')}.`);
}

async function commandStop() {
  const record = readJsonFile(stackFile);
  if (!record) {
    note('The e2e stack is not running (no state file).');
    return;
  }
  terminate(record.supervisorPid);
  if (record.postgrestPid) terminate(record.postgrestPid);
  await delay(200);
  rmSync(stackFile, { force: true });
  note('Hanaply e2e stack stopped.');
}

async function commandStatus() {
  const record = readJsonFile(stackFile);
  if (!record) {
    note('stopped');
    return;
  }
  let healthy = false;
  try {
    const response = await fetch(`http://127.0.0.1:${record.ports.gateway}/health`, {
      signal: AbortSignal.timeout(1_500),
    });
    healthy = response.ok;
  } catch {
    healthy = false;
  }
  note(
    `${healthy ? 'running' : 'not running'} (supervisor ${record.supervisorPid}, api ${record.apiUrl})`,
  );
  if (!healthy) note('the state file is stale; run "pnpm e2e:stack start" to replace it');
}

async function main() {
  const command = process.argv[2] ?? 'status';
  switch (command) {
    case 'serve':
      await commandServe();
      break;
    case 'start':
      await commandStart();
      break;
    case 'stop':
      await commandStop();
      break;
    case 'restart':
      await commandStop();
      await commandStart();
      break;
    case 'status':
      await commandStatus();
      break;
    case 'env': {
      const record = readJsonFile(stackFile);
      if (!record) fail('The e2e stack is not running.');
      process.stdout.write(
        `${JSON.stringify(
          {
            apiUrl: record.apiUrl,
            databaseUrl: record.databaseUrl,
            mailpitUrl: record.mailpitUrl,
            publishableKey: record.publishableKey,
            serviceRoleKey: record.serviceRoleKey,
          },
          null,
          2,
        )}\n`,
      );
      break;
    }
    default:
      fail(`Unknown command "${command}". Use serve, start, stop, restart, status, or env.`);
  }
}

await main();
