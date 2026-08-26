import { randomUUID } from 'node:crypto';

import type { WorkerEnvironment } from '@hanaply/config';
import { createLogger } from '@hanaply/observability';
import Fastify from 'fastify';

import type { PaymentWorkerState } from './payments.js';

export function createWorkerServer(
  environment: WorkerEnvironment,
  workerState: () => Readonly<PaymentWorkerState> = () => ({
    running: false,
    cycleActive: false,
    lastCycleAt: null,
    lastMaintenanceAt: null,
    lastErrorCode: null,
  }),
) {
  const logger = createLogger({
    service: 'worker',
    environment: environment.HANAPLY_ENV,
    level: environment.LOG_LEVEL,
    pretty: environment.HANAPLY_ENV === 'local',
  });
  const server = Fastify({ logger: false, genReqId: () => randomUUID(), bodyLimit: 64 * 1024 });

  server.addHook('onRequest', (request, reply, done) => {
    void reply.header('x-request-id', request.id);
    done();
  });

  server.get('/health', () => ({
    status: 'ok',
    service: 'worker',
    mode: environment.WORKER_MODE,
    timestamp: new Date().toISOString(),
  }));

  server.get('/ready', (_request, reply) => {
    const state = workerState();
    const ready = environment.WORKER_MODE === 'idle' || (state.running && !state.lastErrorCode);
    void reply.status(ready ? 200 : 503);
    return {
      status: ready ? 'ready' : 'not_ready',
      mode: environment.WORKER_MODE,
      queue: environment.WORKER_MODE === 'active' ? 'database_outbox' : 'idle',
      tasksAccepted: environment.WORKER_MODE === 'active',
      worker: state,
      timestamp: new Date().toISOString(),
    };
  });

  server.setErrorHandler((error, request, reply) => {
    const normalizedError =
      error instanceof Error
        ? { name: error.name, message: error.message }
        : { name: 'UnknownError', message: 'Unknown worker error' };
    logger.error({ requestId: request.id, error: normalizedError }, 'Worker health server error');
    void reply.status(500).send({
      error: { code: 'INTERNAL_ERROR', message: 'Worker health service error' },
      requestId: request.id,
    });
  });

  return server;
}
