import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import type { ApiEnvironment } from '@hanaply/config';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';

import { AppModule, type ApiRuntimeOverrides } from './app.module.js';
import {
  ApiExceptionFilter,
  createApiLogger,
  NestLoggerAdapter,
  RequestContextInterceptor,
} from './infrastructure.js';

export async function createApiApplication(
  environment: ApiEnvironment,
  overrides: ApiRuntimeOverrides = {},
) {
  const adapter = new FastifyAdapter({
    bodyLimit: 256 * 1024,
    genReqId: () => randomUUID(),
    logger: false,
    trustProxy: false,
  });
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.register(environment, overrides),
    adapter,
    {
      bufferLogs: true,
    },
  );
  const logger = createApiLogger(environment);
  app.useLogger(new NestLoggerAdapter(logger));
  app.useGlobalFilters(new ApiExceptionFilter(logger));
  app.useGlobalInterceptors(new RequestContextInterceptor());
  app.enableCors({
    origin: environment.CORS_ALLOWED_ORIGINS,
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-ID'],
    exposedHeaders: ['X-Request-ID'],
    maxAge: 600,
  });
  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'no-referrer' },
  });
  await app.register(multipart, {
    limits: {
      fieldNameSize: 64,
      fieldSize: 1,
      fields: 0,
      files: 1,
      fileSize: Math.max(environment.PAYMENT_PROOF_MAX_BYTES, environment.PAYMENT_QR_MAX_BYTES),
      headerPairs: 64,
      parts: 1,
    },
  });
  app.enableShutdownHooks();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}
