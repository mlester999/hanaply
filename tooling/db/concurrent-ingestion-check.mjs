#!/usr/bin/env node
/**
 * Two concurrent ingestion executions, on one posting, overlapping in time.
 *
 * The canonical content revision is what stops a re-observation from re-queueing
 * work. The interesting case is not "the same payload twice in a row" — the pgTAP
 * suite covers that — it is two ingestion sessions that both see the same changed
 * posting and decide to write it. If the second session judged the posting against
 * the revision it read *before* the first one committed, it would report a content
 * change for content that had already been applied, and one provider edit would
 * produce two recomputations.
 *
 * That is exercised here, not argued: one real `psql` session calls
 * `public.upsert_ingested_job` while another holds the canonical row's write lock
 * inside its own open transaction. The interleaving is forced rather than raced,
 * because a genuine race is not reproducible and a check that only sometimes
 * overlaps proves nothing when it passes.
 *
 * How the overlap is established, and why each step is evidence:
 *
 *   1. Session A opens a transaction, takes the canonical row with
 *      `select ... for update`, records a marker row, and sleeps. The marker is
 *      readable by another session only once A commits — which it has not — so the
 *      check does not read it. Instead the check proves A holds the lock the only
 *      way that is observable from outside: session B does not finish.
 *   2. Session B opens its own transaction and calls the ingestion writer for the
 *      same source record. It blocks on A's lock.
 *   3. The check waits. If B produced a result while A was still inside its
 *      transaction, the two did not overlap and the check fails rather than
 *      passing. If B is still running after the wait, B is blocked on A.
 *   4. A finishes its write and commits; B proceeds and is observed.
 *
 * What the two sessions then report is the assertion: exactly one of them reports
 * `contentChanged = true`, the audit trail records one change and one observation
 * that found nothing new, the canonical row carries the changed content, and the
 * source record still has exactly one provenance row and one canonical posting.
 *
 * Usage: node tooling/db/concurrent-ingestion-check.mjs
 * Exits non-zero on any mismatch, and fails loudly when no harness database is
 * available rather than reporting a pass it did not earn.
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { findPostgresBinDirectory } from './pg-bin.mjs';

const root = resolve(import.meta.dirname, '..', '..');
const portFile = resolve(root, '.localdb', 'port');

const isWindows = process.platform === 'win32';
const sourceCode = 'concurrency_probe';
const sourceJobId = 'concurrency-probe-1';
/** How long session A holds its lock, in seconds. Must exceed the block probe. */
const lockHoldSeconds = 8;
const blockProbeMs = 2_000;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function note(message) {
  process.stdout.write(`${message}\n`);
}

function sleep(milliseconds) {
  return new Promise((settle) => setTimeout(settle, milliseconds));
}

const bin = findPostgresBinDirectory();
if (!bin) {
  fail('PostgreSQL client binaries were not found. Install PostgreSQL 17+ or set HANAPLY_PG_BIN.');
}
if (!existsSync(portFile)) {
  fail(
    'No local harness database is available (.localdb/port is missing). Run `pnpm db:harness:reset` first — this check drives a real database and will not report a pass it did not run.',
  );
}

const port = readFileSync(portFile, 'utf8').trim();
if (!/^\d+$/u.test(port)) {
  fail(`The recorded harness port is not a port number: ${JSON.stringify(port)}`);
}

const database = process.env.HANAPLY_LOCAL_DB_NAME ?? 'hanaply';
const psql = resolve(bin, isWindows ? 'psql.exe' : 'psql');
const connection = ['-h', '127.0.0.1', '-p', port, '-U', 'postgres', '-d', database];

/** The service-role session every ingestion call needs. */
const serviceRolePreamble = [
  'set search_path = extensions, public;',
  'select set_config(\'request.jwt.claims\', \'{"role":"service_role"}\', false);',
].join('\n');

function writeScript(name, contents) {
  const path = join(tmpdir(), `hanaply-concurrency-${String(process.pid)}-${name}.sql`);
  writeFileSync(path, contents, 'utf8');
  return path;
}

/** Runs psql on a script. Resolves with stdout; rejects on a non-zero exit. */
function runPsqlFile(path) {
  return new Promise((settle, reject) => {
    const child = spawn(psql, [...connection, '-v', 'ON_ERROR_STOP=1', '-q', '-tA', '-f', path], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) {
        settle(stdout);
        return;
      }
      reject(new Error(`psql exited ${String(code)}\n${stderr || stdout}`));
    });
  });
}

/** Runs psql with one SQL string. Resolves with stdout; rejects on a non-zero exit. */
function runPsqlCommand(sql) {
  return new Promise((settle, reject) => {
    const child = spawn(psql, [...connection, '-v', 'ON_ERROR_STOP=1', '-q', '-tA', '-c', sql], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) {
        settle(stdout);
        return;
      }
      reject(new Error(`psql exited ${String(code)}\n${stderr || stdout}`));
    });
  });
}

function lastJsonLine(stdout) {
  const lines = stdout.split(/\r?\n/u).filter((line) => line.trim().startsWith('{'));
  return lines.at(-1) ?? null;
}

function payloadSql(title) {
  return `pg_catalog.jsonb_build_object(
  'sourceJobId', '${sourceJobId}',
  'sourceUrl', 'https://example.test/jobs/${sourceJobId}',
  'title', ${title},
  'companyName', 'Concurrency Systems',
  'description', repeat('Automate business workflows between systems. ', 8),
  'locationRaw', 'Remote',
  'countryCode', 'PH',
  'contentFingerprint', repeat('a', 64),
  'payloadChecksum', repeat('b', 64),
  'rawPayload', '{"id":"${sourceJobId}"}'::jsonb
)`;
}

const canonicalJobSql = `
select jobs.id
from public.jobs as jobs
join public.job_source_records as records on records.job_id = jobs.id
where records.source_id = (select id from public.job_sources where code = '${sourceCode}')
  and records.source_job_id = '${sourceJobId}'`;

// ---------------------------------------------------------------------------
// Session scripts
// ---------------------------------------------------------------------------

const fixtureScript = writeScript(
  'fixture',
  `
${serviceRolePreamble}
insert into public.job_sources (
  code, display_name, source_kind, base_url, attribution, min_scan_interval_minutes
)
values (
  '${sourceCode}', 'Concurrency Probe', 'manual', 'https://example.test/concurrency',
  'Synthetic check fixture.', 60
)
on conflict (code) do nothing;
`,
);

/**
 * Removes the previous run's posting before this one starts.
 *
 * Without it the check is not idempotent, and the failure is quiet and
 * misleading: the leftover posting already carries the "changed" title, so the
 * fixture's first write finds identical content and the two sessions end up
 * looking at a posting that was never set up for them.
 *
 * `public.audit_events` is append-only by design and is not touched. The
 * verification handles that by counting only the audit rows this run created,
 * against a clock the check reads before it starts.
 */
const cleanupScript = writeScript(
  'cleanup',
  `
${serviceRolePreamble}
delete from public.job_matches
where job_id in (
  select jobs.id from public.jobs as jobs where jobs.dedup_key like '%@concurrency systems@%'
);
delete from public.job_source_records
where job_id in (
  select jobs.id from public.jobs as jobs where jobs.dedup_key like '%@concurrency systems@%'
);
delete from public.job_source_records
where source_id = (select id from public.job_sources where code = '${sourceCode}');
delete from public.jobs
where dedup_key like '%@concurrency systems@%'
  and id not in (select records.job_id from public.job_source_records as records);
`,
);

/**
 * Session A: takes the row lock, holds it while session B starts, then applies the
 * change. Holding the lock before reading anything is the ordering the check is
 * about — once a session has read the canonical revision, the write it decides on
 * must be applied to that revision and no other.
 */
const sessionAScript = writeScript(
  'session-a',
  `
begin;
${serviceRolePreamble}
select locked.id
from (${canonicalJobSql}) as locked
for update of locked;
select pg_catalog.pg_sleep(${String(lockHoldSeconds)});
select public.upsert_ingested_job(
  (select id from public.job_sources where code = '${sourceCode}'),
  ${payloadSql("'Concurrency Probe Engineer (revised)'")},
  gen_random_uuid()
)::text as result;
commit;
`,
);

/** Session B: the same change, one transaction behind. */
const sessionBScript = writeScript(
  'session-b',
  `
begin;
${serviceRolePreamble}
select public.upsert_ingested_job(
  (select id from public.job_sources where code = '${sourceCode}'),
  ${payloadSql("'Concurrency Probe Engineer (revised)'")},
  gen_random_uuid()
)::text as result;
commit;
`,
);

const verificationScript = writeScript(
  'verify',
  `
${serviceRolePreamble}
select pg_catalog.jsonb_build_object(
  'title', jobs.title,
  'provenanceRows', (
    select pg_catalog.count(*) from public.job_source_records as records where records.job_id = jobs.id
  ),
  'jobsPerDedupKey', (
    select pg_catalog.count(*) from public.jobs as peers
    where peers.dedup_key = jobs.dedup_key and peers.status in ('active', 'stale')
  )
)::text
from public.jobs as jobs
join public.job_source_records as records on records.job_id = jobs.id
where records.source_id = (select id from public.job_sources where code = '${sourceCode}')
  and records.source_job_id = '${sourceJobId}';
`,
);

/**
 * Removes everything this check created, including the probe source itself.
 *
 * The check runs against the same harness database the pgTAP suites use, so a
 * fixture left behind is not untidiness — it is a changed schema for every suite
 * that runs afterwards, and the suites assert on real counts. The posting, its
 * provenance, its matches, the markers, and the probe source all go.
 *
 * `public.audit_events` is append-only by design, so the audit rows this check
 * produced cannot be removed and are not removed. That is why the verification
 * counts only the rows that this run created, against a clock the check reads
 * before it starts: the trail is allowed to remember, and the check is written so
 * that remembering costs nothing.
 */
const teardownScript = writeScript(
  'teardown',
  `
${serviceRolePreamble}
drop table if exists app_private.concurrency_check_markers;
delete from public.job_matches
where job_id in (
  select jobs.id from public.jobs as jobs where jobs.dedup_key like '%@concurrency systems@%'
);
delete from public.job_source_records
where source_id = (select id from public.job_sources where code = '${sourceCode}');
delete from public.job_source_records
where job_id in (
  select jobs.id from public.jobs as jobs where jobs.dedup_key like '%@concurrency systems@%'
);
delete from public.jobs
where dedup_key like '%@concurrency systems@%'
  and id not in (select records.job_id from public.job_source_records as records);
delete from public.job_sources where code = '${sourceCode}';
-- The employer the probe posting created. It has no jobs left to belong to, and
-- a stray company row is exactly the kind of count a suite would trip over.
delete from public.companies
where normalized_name = 'concurrency systems'
  and not exists (select 1 from public.jobs as jobs where jobs.company_id = public.companies.id);
`,
);

async function main() {
  await runPsqlFile(fixtureScript);
  await runPsqlFile(cleanupScript);

  // The fixture posting, in the state both sessions will find it: the original
  // content, so the change they apply is a real one.
  await runPsqlCommand(`${serviceRolePreamble}
select public.upsert_ingested_job(
  (select id from public.job_sources where code = '${sourceCode}'),
  ${payloadSql("'Concurrency Probe Engineer'")},
  gen_random_uuid()
);`);

  // The clock this run's audit rows are judged against. `public.audit_events` is
  // append-only, so rows from earlier runs cannot be removed and must not be
  // counted.
  const startedRaw = await runPsqlCommand('select pg_catalog.clock_timestamp()::text;');
  const startedAt = startedRaw.trim().split(/\r?\n/u).filter(Boolean).at(-1);
  if (startedAt === undefined || !/^\d{4}-\d{2}-\d{2}/u.test(startedAt)) {
    fail(`The clock query returned ${JSON.stringify(startedRaw)}`);
  }

  // Session A takes the lock and holds it. It is not awaited yet: the point is
  // that it is still open while session B runs.
  let sessionAFinished = false;
  const sessionA = runPsqlFile(sessionAScript).then((output) => {
    sessionAFinished = true;
    return output;
  });
  // Wait long enough for A to have reached `pg_sleep` with the lock held. A is
  // not observable while its transaction is open, so this is the only signal
  // available, and it is generous: the alternative is starting B before A holds
  // anything, which is the race this check exists to avoid.
  await sleep(1_500);

  const sessionB = runPsqlFile(sessionBScript);

  /*
   * The overlap, asserted rather than assumed. B has had `blockProbeMs` to
   * finish; if it did, A's lock was not held and the two transactions never
   * overlapped. If it has not finished, the only thing it can be waiting on is
   * A's row lock — nothing else in the ingestion writer takes a conflicting lock.
   */
  let sessionBFinished = false;
  void sessionB.then(() => {
    sessionBFinished = true;
  });
  await sleep(blockProbeMs);
  if (sessionBFinished) {
    await sessionA.catch(() => undefined);
    fail(
      'Session B finished before session A committed, so the two transactions did not overlap and this check would have proved nothing about concurrent ingestion.',
    );
  }
  if (sessionAFinished) {
    fail('Session A finished before the overlap was established; the check could not observe it.');
  }

  const [sessionAOutput, sessionBOutput] = await Promise.all([sessionA, sessionB]);

  const results = [
    { label: 'a', output: sessionAOutput },
    { label: 'b', output: sessionBOutput },
  ].map(({ label, output }) => {
    const line = lastJsonLine(output);
    if (line === null) fail(`Session ${label} printed no JSON result:\n${output}`);
    return { label, outcome: JSON.parse(line) };
  });

  const changed = results.filter((entry) => entry.outcome.contentChanged === true);
  const unchanged = results.filter((entry) => entry.outcome.contentChanged === false);

  const verificationRaw = await runPsqlFile(verificationScript);
  const verificationLine = lastJsonLine(verificationRaw);
  if (verificationLine === null)
    fail(`The verification query printed no JSON:\n${verificationRaw}`);
  const verification = JSON.parse(verificationLine);

  const auditRaw = await runPsqlCommand(`
    select pg_catalog.jsonb_build_object(
      'withChange', (
        select pg_catalog.count(*) from public.audit_events as events
        where events.action = 'job.observed'
          and events.created_at >= '${startedAt}'::timestamptz
          and (events.metadata ->> 'contentChanged') = 'true'
      ),
      'withoutChange', (
        select pg_catalog.count(*) from public.audit_events as events
        where events.action = 'job.observed'
          and events.created_at >= '${startedAt}'::timestamptz
          and (events.metadata ->> 'contentChanged') = 'false'
      )
    )::text;
  `);
  const auditLine = lastJsonLine(auditRaw);
  if (auditLine === null) fail(`The audit query printed no JSON:\n${auditRaw}`);
  const audit = JSON.parse(auditLine);

  const problems = [];
  if (changed.length !== 1 || unchanged.length !== 1) {
    problems.push(
      `expected exactly one session to report a content change and one not to; got ${JSON.stringify(
        results.map((entry) => ({
          session: entry.label,
          contentChanged: entry.outcome.contentChanged,
          matchedBy: entry.outcome.matchedBy,
        })),
      )}`,
    );
  }
  if (audit.withChange !== 1 || audit.withoutChange !== 1) {
    problems.push(
      `expected one observation audit recording a change and one recording none, found ${String(audit.withChange)} and ${String(audit.withoutChange)}`,
    );
  }
  if (verification.provenanceRows !== 1) {
    problems.push(
      `expected one provenance row for the source record, found ${String(verification.provenanceRows)}`,
    );
  }
  if (verification.jobsPerDedupKey !== 1) {
    problems.push(
      `expected one canonical posting for the composite key, found ${String(verification.jobsPerDedupKey)}`,
    );
  }
  if (verification.title !== 'Concurrency Probe Engineer (revised)') {
    problems.push(
      `the canonical title is ${JSON.stringify(verification.title)}, not the changed one`,
    );
  }

  await runPsqlFile(teardownScript);

  if (problems.length > 0) {
    process.stderr.write(`${problems.map((problem) => `- ${problem}`).join('\n')}\n`);
    fail(`Concurrent ingestion check failed (${problems.length} problem(s)).`);
  }

  note(
    `Concurrent ingestion: the transactions overlapped (session B blocked on session A's write lock), 1 of 2 reported the content change, audits ${String(audit.withChange)} change / ${String(audit.withoutChange)} observation, ${String(verification.provenanceRows)} provenance row.`,
  );
  note('Concurrent ingestion check passed.');
}

await main();
