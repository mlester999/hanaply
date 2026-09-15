import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { readLocalSupabaseEnvironment } from './local-supabase.js';

const root = resolve(import.meta.dirname, '..', '..');
/**
 * The production entry point, built by `pnpm e2e` before Playwright starts
 * (`tooling/e2e/run.mjs`). The spec runs the worker exactly as a deployment
 * does — `node dist/main.js` with `WORKER_MODE=once` — rather than importing
 * `jobs.ts` and calling a method, because the thing that was never tested is
 * the orchestration around match computation: which cycles run, in what order,
 * what they read, and what they write. An in-process call would bypass the
 * environment parsing, the mode switch, and the exit status that a deployment
 * depends on.
 */
const workerEntry = resolve(root, 'services', 'worker', 'dist', 'main.js');
const appUrl = 'http://localhost:3100';
const apiUrl = 'http://localhost:3101';
const cycleTimeoutMs = 120_000;

/** The worker's own report of one cycle, as `services/worker/src/main.ts` prints it. */
export interface WorkerCycleState {
  readonly running: boolean;
  readonly cycleActive: boolean;
  readonly lastCycleAt: string | null;
  readonly lastIngestionAt: string | null;
  readonly lastMatchingAt: string | null;
  readonly lastFreshnessAt: string | null;
  readonly lastNotificationAt: string | null;
  readonly lastErrorCode: string | null;
  readonly sourcesAttempted: number;
  readonly jobsCreated: number;
  readonly profilesScored: number;
  readonly notificationsQueued: number;
  readonly notificationsDelivered: number;
  readonly notificationsFailed: number;
}

export interface WorkerCycleRun {
  readonly state: WorkerCycleState;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * The environment the worker is started with.
 *
 * It mirrors the service environment the Playwright configuration gives the API
 * and the web server: the Dockerless stack's Supabase-compatible origin and
 * service-role key, the local app URLs, and the capture email provider. The
 * database is the one the browser suite is using, so what the worker scores is
 * what the specs read back.
 *
 * `EMAIL_PROVIDER=capture` is not incidental: the process reads `.env.local`
 * when it starts, and the developer's copy of that file configures the live
 * Resend provider. The worker honours the process environment over the file, so
 * stating the capture provider here is what keeps an end-to-end run from
 * sending mail.
 */
export function workerEnvironment(): NodeJS.ProcessEnv {
  const environment = readLocalSupabaseEnvironment();
  return {
    ...process.env,
    NODE_ENV: 'development',
    HANAPLY_ENV: 'local',
    LOG_LEVEL: 'info',
    APP_BASE_URL: appUrl,
    API_BASE_URL: apiUrl,
    SUPABASE_URL: environment.apiUrl,
    SUPABASE_PUBLISHABLE_KEY: environment.publishableKey,
    SUPABASE_SERVICE_ROLE_KEY: environment.serviceRoleKey,
    SUPABASE_DB_URL: environment.databaseUrl,
    SUPABASE_PROJECT_REF: 'local',
    BUILD_SHA: 'e2e',
    WORKER_MODE: 'once',
    EMAIL_PROVIDER: 'capture',
    EMAIL_CAPTURE_FILE: environment.mailboxFile,
  };
}

/**
 * Runs every job-intelligence cycle once, through the worker's real entry point,
 * and returns what the worker reported about the run.
 *
 * The cycles are the four `JobIntelligenceWorker` owns — ingestion, match
 * computation, freshness, and opportunity notification delivery — driven by the
 * same `runOnce` the polling worker calls, so a problem in how work is selected
 * (rather than in how a match is scored) fails here. Nothing waits on a timer:
 * the process exits when the cycles are done, and the exit status is the
 * worker's own verdict.
 */
export async function runJobWorkerCycle(): Promise<WorkerCycleRun> {
  if (!existsSync(workerEntry)) {
    throw new Error(
      `The worker has not been built (${workerEntry} is missing). Run "pnpm e2e", which builds it before Playwright starts, or "pnpm --filter @hanaply/worker build".`,
    );
  }

  const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (settle, reject) => {
      const child = spawn(process.execPath, [workerEntry], {
        cwd: root,
        env: workerEnvironment(),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
      });
      const timeout = setTimeout(() => {
        child.kill();
        reject(
          new Error(
            `The worker did not finish a cycle within ${cycleTimeoutMs}ms.\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`,
          ),
        );
      }, cycleTimeoutMs);
      timeout.unref();
      child.once('error', (error: unknown) => {
        clearTimeout(timeout);
        reject(error instanceof Error ? error : new Error('The worker could not be started'));
      });
      child.once('close', (code: number | null) => {
        clearTimeout(timeout);
        settle({ code, stdout, stderr });
      });
    },
  );

  if (result.code !== 0) {
    throw new Error(
      `The worker cycle exited with ${String(result.code)}. A cycle reported an error, so nothing the run produced can be trusted.\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`,
    );
  }

  const state = workerCycleState(result.stdout);
  if (state === null) {
    throw new Error(
      `The worker printed no cycle report, so the run cannot be verified.\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`,
    );
  }
  return { state, stdout: result.stdout, stderr: result.stderr };
}

/** The last `worker_cycle_once` line the worker printed. */
function workerCycleState(stdout: string): WorkerCycleState | null {
  const lines = stdout.split(/\r?\n/u).filter((line) => line.trim() !== '');
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index] ?? '';
    if (!line.startsWith('{')) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as { event?: unknown }).event === 'worker_cycle_once'
    ) {
      return parsed as WorkerCycleState;
    }
  }
  return null;
}

export interface PollOptions<TValue> {
  /** What is being waited for, named in the failure so an empty radar explains itself. */
  readonly description: string;
  readonly read: () => Promise<TValue | null>;
  readonly timeoutMs?: number;
  readonly intervalMs?: number;
}

/**
 * Waits for a piece of state to appear, by asking again rather than by sleeping.
 *
 * Every wait in the matching specs is expressed as a condition on the database
 * or the API, so a fast machine and a slow one take the same path and a failure
 * names the thing that never arrived.
 */
export async function pollUntil<TValue>(options: PollOptions<TValue>): Promise<TValue> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const intervalMs = options.intervalMs ?? 250;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await options.read();
    if (value !== null) return value;
    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out after ${timeoutMs}ms waiting for ${options.description}. The worker ran, so this is a defect in the path between the database and the surface under test, not a slow machine.`,
      );
    }
    await new Promise((settle) => setTimeout(settle, intervalMs));
  }
}
