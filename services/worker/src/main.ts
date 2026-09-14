import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { parseWorkerEnvironment } from '@hanaply/config';

import { JobIntelligenceWorker } from './jobs.js';
import { PaymentMaintenanceWorker } from './payments.js';
import { createWorkerServer } from './server.js';

const rootEnvironmentFile = resolve(import.meta.dirname, '../../../.env.local');
if (existsSync(rootEnvironmentFile)) process.loadEnvFile(rootEnvironmentFile);

async function bootstrap(): Promise<void> {
  const environment = parseWorkerEnvironment(process.env);
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
