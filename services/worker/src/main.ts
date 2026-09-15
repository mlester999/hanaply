import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { parseWorkerEnvironment, type WorkerEnvironment } from '@hanaply/config';

import { JobIntelligenceWorker } from './jobs.js';
import { PaymentMaintenanceWorker } from './payments.js';
import { createWorkerServer } from './server.js';

const rootEnvironmentFile = resolve(import.meta.dirname, '../../../.env.local');
if (existsSync(rootEnvironmentFile)) process.loadEnvFile(rootEnvironmentFile);

/**
 * Every job-intelligence cycle, run once, in the order `active` runs them.
 *
 * `WORKER_MODE=once` is the deterministic counterpart to the polling worker: a
 * caller that needs to observe what match computation did can start this
 * process, wait for it to exit, and then read the rows. It is deliberately the
 * same `JobIntelligenceWorker` and the same `runOnce` the long-running worker
 * uses — the maintenance cycles are forced, and nothing else differs — so a
 * failure here is a failure of the real orchestration rather than of a stand-in
 * that reimplements the order the cycles depend on.
 *
 * The final line of stdout is a JSON report of the worker's own state. A caller
 * learns which cycles ran and what they produced from the worker rather than by
 * inferring it from the database, and the exit status is non-zero when a cycle
 * reported an error, so a silent partial run cannot be mistaken for success.
 */
async function runSingleCycle(environment: WorkerEnvironment): Promise<void> {
  const worker = new JobIntelligenceWorker(environment);
  await worker.runOnce(true);
  const state = worker.state();
  process.stdout.write(`${JSON.stringify({ event: 'worker_cycle_once', ...state })}\n`);
  if (state.lastErrorCode !== null) {
    process.stderr.write(`Hanaply worker cycle failed: ${state.lastErrorCode}\n`);
    process.exitCode = 1;
  }
}

async function bootstrap(): Promise<void> {
  const environment = parseWorkerEnvironment(process.env);
  if (environment.WORKER_MODE === 'once') {
    await runSingleCycle(environment);
    return;
  }
  const active = environment.WORKER_MODE === 'active';
  const paymentWorker = active ? new PaymentMaintenanceWorker(environment) : null;
  const jobWorker = active ? new JobIntelligenceWorker(environment) : null;
  const server = createWorkerServer(environment, () => {
    const paymentState = paymentWorker
      ? paymentWorker.state()
      : {
          running: false,
          cycleActive: false,
          lastCycleAt: null,
          lastMaintenanceAt: null,
          lastErrorCode: null,
        };
    return {
      ...paymentState,
      jobs: jobWorker
        ? jobWorker.state()
        : {
            running: false,
            cycleActive: false,
            lastCycleAt: null,
            lastIngestionAt: null,
            lastMatchingAt: null,
            lastFreshnessAt: null,
            lastNotificationAt: null,
            lastErrorCode: null,
            sourcesAttempted: 0,
            jobsCreated: 0,
            profilesScored: 0,
            notificationsQueued: 0,
            notificationsDelivered: 0,
            notificationsFailed: 0,
          },
    };
  });

  const shutdown = async (signal: string): Promise<void> => {
    server.log.info({ signal }, 'Worker health server shutting down');
    await Promise.all([paymentWorker?.stop(), jobWorker?.stop()]);
    await server.close();
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  await server.listen({ host: '0.0.0.0', port: environment.WORKER_HEALTH_PORT });
  paymentWorker?.start();
  jobWorker?.start();
}

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown startup error';
  process.stderr.write(`Hanaply worker failed to start: ${message}\n`);
  process.exitCode = 1;
});

export * from './jobs.js';
export * from './queue.js';
export * from './payments.js';
export * from './server.js';
