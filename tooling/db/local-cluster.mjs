#!/usr/bin/env node
/**
 * Hanaply local database harness.
 *
 * Docker Desktop and the Supabase CLI are not available in every development or
 * review environment. This harness provisions a throwaway PostgreSQL cluster in
 * `.localdb/`, applies a Supabase-compatible platform baseline, runs the
 * forward-only migration chain, seeds development data, and executes the pgTAP
 * suites — with no container runtime required.
 *
 * The Supabase CLI workflow (`pnpm db:start`, `pnpm db:reset`, `pnpm db:test`)
 * remains the canonical local workflow. This harness exists so that the same SQL
 * can be verified in environments where Docker is unavailable, and so CI can gate
 * migrations and RLS without a container daemon.
 *
 * Usage: node tooling/db/local-cluster.mjs <start|stop|status|reset|migrate|seed|test|psql|url|destroy>
 */

import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { inflateRawSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');
const stateDir = resolve(root, '.localdb');
const dataDir = join(stateDir, 'pgdata');
const extensionRoot = join(stateDir, 'pg-extensions');
// PostgreSQL resolves extension control files as <path>/extension/<name>.control,
// mirroring the server's own sharedir layout.
const extensionDir = join(extensionRoot, 'extension');
const logFile = join(stateDir, 'postgres.log');
const portFile = join(stateDir, 'port');
const migrationsDir = resolve(root, 'supabase', 'migrations');
const testsDir = resolve(root, 'supabase', 'tests', 'database');
const baseSqlPath = resolve(import.meta.dirname, 'supabase-base.sql');
const seedSqlPath = resolve(root, 'supabase', 'seed.sql');

const configuredPort = Number(process.env.HANAPLY_LOCAL_DB_PORT ?? 55433);
const database = process.env.HANAPLY_LOCAL_DB_NAME ?? 'hanaply';
const pgUser = 'postgres';
const pgtapVersion = '1.3.4';
const pgtapArchiveName = `pgTAP-${pgtapVersion}.zip`;
const pgtapUrl = `https://github.com/theory/pgtap/releases/download/v${pgtapVersion}/${pgtapArchiveName}`;

const isWindows = process.platform === 'win32';

// Node cannot flush buffered stdout while a synchronous child process runs, so
// progress is mirrored to an unbuffered trace file for diagnosis.
function trace(message) {
  try {
    appendFileSync(
      join(stateDir, 'harness.log'),
      `${new Date().toISOString()} ${message}\n`,
      'utf8',
    );
  } catch {
    // Tracing must never break the harness.
  }
}

function fail(message) {
  trace(`FAIL: ${message.split('\n')[0]}`);
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function note(message) {
  trace(message);
  process.stdout.write(`${message}\n`);
}

function findPgBin() {
  if (process.env.HANAPLY_PG_BIN) {
    return process.env.HANAPLY_PG_BIN;
  }
  const candidates = [];
  if (isWindows) {
    const programFiles = process.env['ProgramFiles'] ?? 'C:\\Program Files';
    const pgRoot = join(programFiles, 'PostgreSQL');
    if (existsSync(pgRoot)) {
      for (const entry of readdirSync(pgRoot).sort().reverse()) {
        candidates.push(join(pgRoot, entry, 'bin'));
      }
    }
  } else {
    candidates.push('/usr/lib/postgresql/18/bin', '/usr/local/pgsql/bin', '/opt/homebrew/bin');
  }
  for (const candidate of candidates) {
    if (existsSync(join(candidate, isWindows ? 'pg_ctl.exe' : 'pg_ctl'))) {
      return candidate;
    }
  }
  const which = spawnSync(isWindows ? 'where' : 'which', ['pg_ctl'], { encoding: 'utf8' });
  if (which.status === 0 && which.stdout.trim()) {
    return dirname(which.stdout.trim().split(/\r?\n/)[0]);
  }
  fail(
    'PostgreSQL server binaries were not found. Install PostgreSQL 17+ or set HANAPLY_PG_BIN to its bin directory.',
  );
  return '';
}

const pgBin = findPgBin();
const exe = (name) => join(pgBin, isWindows ? `${name}.exe` : name);

function isPortFree(candidate) {
  return new Promise((settle) => {
    const probe = createServer();
    probe.unref();
    probe.on('error', () => settle(false));
    probe.listen({ host: '127.0.0.1', port: candidate }, () => {
      probe.close(() => settle(true));
    });
  });
}

let resolvedPort = null;

async function resolvePort() {
  if (resolvedPort !== null) {
    return resolvedPort;
  }
  if (existsSync(portFile)) {
    const recorded = Number(readFileSync(portFile, 'utf8').trim());
    if (Number.isInteger(recorded) && recorded > 0) {
      resolvedPort = recorded;
      return resolvedPort;
    }
  }
  let candidate = configuredPort;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await isPortFree(candidate)) {
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(portFile, `${candidate}\n`, 'utf8');
      resolvedPort = candidate;
      return resolvedPort;
    }
    candidate += 1;
  }
  fail(`No free PostgreSQL port found between ${configuredPort} and ${candidate}.`);
  return configuredPort;
}

function port() {
  if (resolvedPort === null) {
    if (existsSync(portFile)) {
      resolvedPort = Number(readFileSync(portFile, 'utf8').trim());
    } else {
      resolvedPort = configuredPort;
    }
  }
  return resolvedPort;
}

function run(
  binary,
  args,
  { inherit = false, allowFailure = false, env = {}, silent = false } = {},
) {
  // `silent` uses 'ignore' stdio. It is required for `pg_ctl start|stop`:
  // spawnSync otherwise waits for EOF on the captured pipes, which the
  // daemonized postmaster keeps open forever.
  const result = spawnSync(binary, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: silent ? 'ignore' : inherit ? 'inherit' : 'pipe',
    env: { ...process.env, PGPASSWORD: '', ...env },
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0 && !allowFailure) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    fail(`${binary} ${args.join(' ')} failed (exit ${result.status})\n${detail}`);
  }
  return result;
}

const connectionArgs = () => ['-h', '127.0.0.1', '-p', String(port()), '-U', pgUser];

function psql(databaseName, args, options = {}) {
  return run(
    exe('psql'),
    [...connectionArgs(), '-d', databaseName, '-v', 'ON_ERROR_STOP=1', ...args],
    options,
  );
}

function clusterStatus() {
  const result = run(exe('pg_ctl'), ['status', '-D', dataDir], { allowFailure: true });
  return result.status === 0;
}

function ensureExtensionControlPath() {
  if (!existsSync(extensionDir)) {
    mkdirSync(extensionDir, { recursive: true });
  }
}

function writeAutoConf() {
  const overrides = [
    `port = ${port()}`,
    "listen_addresses = '127.0.0.1'",
    // `$system` must be listed explicitly: setting extension_control_path
    // replaces the built-in extension directory instead of appending to it.
    // The list separator is `;` on Windows and `:` elsewhere.
    `extension_control_path = '$system${isWindows ? ';' : ':'}${extensionRoot.replace(/\\/g, '/')}'`,
    'fsync = off',
    'synchronous_commit = off',
    'full_page_writes = off',
    // The Supabase baseline creates platform roles with NOLOGIN; keep the
    // superuser able to impersonate them inside RLS tests.
    'log_min_messages = warning',
  ];
  writeFileSync(join(dataDir, 'postgresql.auto.conf'), `${overrides.join('\n')}\n`, 'utf8');
}

function initCluster() {
  if (existsSync(join(dataDir, 'PG_VERSION'))) {
    return;
  }
  mkdirSync(stateDir, { recursive: true });
  run(exe('initdb'), [
    '-D',
    dataDir,
    '-U',
    pgUser,
    '--encoding=UTF8',
    '--locale=C',
    '--auth-local=trust',
    '--auth-host=trust',
  ]);
  writeAutoConf();
}

async function startCluster() {
  await resolvePort();
  initCluster();
  if (clusterStatus()) {
    note(`Local PostgreSQL cluster already running on port ${port()}.`);
    return;
  }
  // The recorded port may have changed since the cluster was initialised.
  writeAutoConf();
  run(exe('pg_ctl'), ['start', '-D', dataDir, '-l', logFile, '-w', '-t', '60'], { silent: true });
  note(`Local PostgreSQL cluster started on 127.0.0.1:${port()} (data: ${dataDir}).`);
}

function stopCluster() {
  if (!existsSync(join(dataDir, 'PG_VERSION'))) {
    note('No local cluster has been initialised.');
    return;
  }
  if (!clusterStatus()) {
    note('Local cluster is not running.');
    return;
  }
  run(exe('pg_ctl'), ['stop', '-D', dataDir, '-m', 'fast', '-w', '-t', '60'], { silent: true });
  note('Local PostgreSQL cluster stopped.');
}

function databaseExists(name) {
  const result = run(
    exe('psql'),
    [
      ...connectionArgs(),
      '-d',
      'postgres',
      '-tAc',
      `select 1 from pg_database where datname = '${name}'`,
    ],
    { allowFailure: true },
  );
  return result.status === 0 && result.stdout.trim() === '1';
}

function resetDatabase(name) {
  run(exe('dropdb'), [...connectionArgs(), '--if-exists', name], { allowFailure: true });
  run(exe('createdb'), [...connectionArgs(), name]);
}

function applyFile(databaseName, filePath, { singleTransaction = true } = {}) {
  const args = [...connectionArgs(), '-d', databaseName, '-v', 'ON_ERROR_STOP=1', '-q'];
  if (singleTransaction) {
    args.push('--single-transaction');
  }
  args.push('-f', filePath);
  run(exe('psql'), args);
}

function applyBase(databaseName) {
  applyFile(databaseName, baseSqlPath);
}

function migrationFiles() {
  return readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort();
}

function recordMigration(databaseName, file) {
  const version = file.split('_')[0];
  const name = file.replace(/^\d+_/, '').replace(/\.sql$/, '');
  psql(
    databaseName,
    [
      '-tAc',
      `insert into supabase_migrations.schema_migrations (version, name) values ('${version}', '${name.replace(/'/g, "''")}') on conflict (version) do nothing`,
    ],
    { allowFailure: false },
  );
}

function applyMigrations(databaseName, { quiet = false } = {}) {
  const files = migrationFiles();
  for (const file of files) {
    try {
      applyFile(databaseName, join(migrationsDir, file));
    } catch (error) {
      fail(`Migration ${file} failed.\n${error.message}`);
    }
    recordMigration(databaseName, file);
    if (!quiet) {
      note(`  applied ${file}`);
    }
  }
  note(`Applied ${files.length} forward migrations to "${databaseName}".`);
}

function applySeed(databaseName) {
  if (!existsSync(seedSqlPath)) {
    return;
  }
  const contents = readFileSync(seedSqlPath, 'utf8').trim();
  if (!contents) {
    return;
  }
  applyFile(databaseName, seedSqlPath);
  note('Applied supabase/seed.sql.');
}

// ---------------------------------------------------------------------------
// pgTAP provisioning
// ---------------------------------------------------------------------------

function readZipDirectory(buffer) {
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 66_000); i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    throw new Error('zip central directory not found');
  }
  const total = buffer.readUInt16LE(eocd + 10);
  let cursor = buffer.readUInt32LE(eocd + 16);
  const entries = [];
  for (let i = 0; i < total; i += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error('zip central directory entry is malformed');
    }
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    entries.push({ name, method, compressedSize, localOffset });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readZipEntry(buffer, entry) {
  const offset = entry.localOffset;
  if (buffer.readUInt32LE(offset) !== 0x04034b50) {
    throw new Error('zip local header is malformed');
  }
  const nameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const start = offset + 30 + nameLength + extraLength;
  const payload = buffer.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) {
    return Buffer.from(payload);
  }
  if (entry.method === 8) {
    return inflateRawSync(payload);
  }
  throw new Error(`zip compression method ${entry.method} is unsupported`);
}

async function ensurePgtap() {
  const controlPath = join(extensionDir, 'pgtap.control');
  if (existsSync(controlPath)) {
    return;
  }
  ensureExtensionControlPath();
  note(`Downloading pgTAP ${pgtapVersion} from ${pgtapUrl} ...`);
  const response = await fetch(pgtapUrl, {
    redirect: 'follow',
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    fail(
      `Could not download pgTAP (${response.status}). Install it manually into ${extensionDir} or run the Supabase CLI flow instead.`,
    );
  }
  const archive = Buffer.from(await response.arrayBuffer());
  const entries = readZipDirectory(archive);
  const byBasename = new Map();
  for (const entry of entries) {
    byBasename.set(entry.name.split('/').pop(), readZipEntry(archive, entry));
  }
  const control = byBasename.get('pgtap.control');
  const source = byBasename.get('pgtap.sql.in');
  if (!control || !source) {
    fail('The pgTAP release archive did not contain pgtap.control and sql/pgtap.sql.in.');
  }
  const controlText = control.toString('utf8');
  const declaredVersion = /default_version\s*=\s*'([^']+)'/.exec(controlText)?.[1] ?? pgtapVersion;
  if (!/module_pathname\s*=/.test(controlText)) {
    fail('The pgTAP control file is missing module_pathname.');
  }
  // Mirrors the upstream Makefile: copy pgtap.sql.in, then substitute the OS
  // name and the numeric major.minor version. The 9.x compatibility patches are
  // intentionally skipped because this harness targets PostgreSQL 17+.
  const numericVersion = declaredVersion.split('.').slice(0, 2).join('.');
  const osName = isWindows ? 'windows' : 'unix';
  const sql = source
    .toString('utf8')
    .replaceAll('MODULE_PATHNAME', 'pgtap')
    .replaceAll('__OS__', osName)
    .replaceAll('__VERSION__', numericVersion);
  writeFileSync(join(extensionDir, 'pgtap.control'), controlText, 'utf8');
  writeFileSync(join(extensionDir, `pgtap--${declaredVersion}.sql`), sql, 'utf8');
  note(`Installed pgTAP ${declaredVersion} into ${extensionDir}.`);
}

function installPgtap(databaseName) {
  const result = psql(
    databaseName,
    ['-tAc', 'create extension if not exists pgtap with schema extensions'],
    { allowFailure: true },
  );
  if (result.status !== 0) {
    fail(`pgTAP could not be registered through extension_control_path.\n${result.stderr ?? ''}`);
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function ensureClusterReady() {
  await startCluster();
  if (!databaseExists(database)) {
    run(exe('createdb'), [...connectionArgs(), database]);
    applyBase(database);
  }
}

async function commandReset() {
  await startCluster();
  await ensurePgtap();
  resetDatabase(database);
  applyBase(database);
  installPgtap(database);
  applyMigrations(database, { quiet: true });
  applySeed(database);
  note(`Database "${database}" rebuilt from the forward-only migration chain.`);
}

async function commandTest() {
  await startCluster();
  await ensurePgtap();
  if (!databaseExists(database)) {
    fail(`Database "${database}" does not exist. Run the reset command first.`);
  }
  const requested = process.argv.slice(3).filter((value) => !value.startsWith('-'));
  const files = readdirSync(testsDir)
    .filter((name) => name.endsWith('.sql'))
    .filter((name) => requested.length === 0 || requested.some((token) => name.includes(token)))
    .sort();
  if (files.length === 0) {
    fail('No matching pgTAP files were found.');
  }
  let failures = 0;
  let assertions = 0;
  const failureDetails = [];
  for (const file of files) {
    const result = run(
      exe('psql'),
      [
        ...connectionArgs(),
        '-d',
        database,
        '-v',
        'ON_ERROR_STOP=1',
        '-q',
        // Unaligned tuples-only output keeps pgTAP's TAP stream intact; the
        // default aligned table formatting breaks the TAP grammar.
        '-tA',
        '-f',
        join(testsDir, file),
      ],
      { allowFailure: true },
    );
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    const notOk = output.match(/^not ok\b.*$/gm) ?? [];
    const ok = output.match(/^ok\b.*$/gm) ?? [];
    const plan = /^1\.\.(\d+)\s*$/m.exec(output);
    assertions += ok.length + notOk.length;
    if (result.status === 0 && notOk.length === 0 && plan) {
      note(`ok   ${file} (${ok.length}/${plan[1]} assertions)`);
    } else {
      failures += 1;
      const detail = [
        notOk.join('\n'),
        plan ? '' : 'the file did not emit a TAP plan',
        result.status === 0 ? '' : `psql exit status ${result.status}`,
        output
          .split('\n')
          .filter((line) => line.startsWith('ERROR') || line.startsWith('psql:'))
          .join('\n'),
      ]
        .filter(Boolean)
        .join('\n');
      note(`FAIL ${file}`);
      failureDetails.push(`${file}\n${detail || output.trim()}`);
    }
  }
  if (failures > 0) {
    process.stderr.write(`${failureDetails.join('\n\n')}\n`);
    fail(`${failures} of ${files.length} pgTAP files failed (${assertions} assertions executed).`);
  }
  note(`All ${files.length} pgTAP files passed (${assertions} assertions).`);
}

async function commandUrl() {
  await startCluster();
  process.stdout.write(`postgresql://${pgUser}@127.0.0.1:${port()}/${database}\n`);
}

async function main() {
  const command = process.argv[2] ?? 'status';
  switch (command) {
    case 'start':
      await startCluster();
      break;
    case 'stop':
      stopCluster();
      break;
    case 'status':
      if (existsSync(join(dataDir, 'PG_VERSION')) && clusterStatus()) {
        note(`running on 127.0.0.1:${port()}`);
      } else {
        note('stopped');
      }
      break;
    case 'reset':
      await commandReset();
      break;
    case 'migrate':
      await ensureClusterReady();
      applyMigrations(database);
      break;
    case 'seed':
      await ensureClusterReady();
      applySeed(database);
      break;
    case 'test':
      await commandTest();
      break;
    case 'psql':
      await ensureClusterReady();
      run(exe('psql'), [...connectionArgs(), '-d', database], { inherit: true });
      break;
    case 'url':
      await commandUrl();
      break;
    case 'destroy':
      stopCluster();
      rmSync(dataDir, { recursive: true, force: true });
      note('Local cluster data removed.');
      break;
    default:
      fail(`Unknown command "${command}".`);
  }
}

await main();
