import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { parseWorkerEnvironment } from '@hanaply/config';

import { createWorkerServer } from './server.js';

const rootEnvironmentFile = resolve(import.meta.dirname, '../../../.env.local');
if (existsSync(rootEnvironmentFile)) process.loadEnvFile(rootEnvironmentFile);

async function bootstrap(): Promise<void> {
  const environment = parseWorkerEnvironment(process.env);
  const server = createWorkerServer(environment);

  const shutdown = async (signal: string): Promise<void> => {
    server.log.info({ signal }, 'Worker health server shutting down');
    await server.close();
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  await server.listen({ host: '0.0.0.0', port: environment.WORKER_HEALTH_PORT });
}

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown startup error';
  process.stderr.write(`Hanaply worker failed to start: ${message}\n`);
  process.exitCode = 1;
});

export * from './queue.js';
export * from './server.js';
