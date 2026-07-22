import { AsyncLocalStorage } from 'node:async_hooks';

import pino, { type DestinationStream, type Logger, type LoggerOptions } from 'pino';

export interface CorrelationContext {
  requestId?: string;
  taskId?: string;
  correlationId?: string;
  userId?: string;
}

const contextStorage = new AsyncLocalStorage<Readonly<CorrelationContext>>();

const redactionPaths = [
  'accessToken',
  'refreshToken',
  'authorization',
  'token',
  '*.token',
  'headers.authorization',
  'headers.cookie',
  'cookies',
  'apiKey',
  '*.apiKey',
  'serviceRoleKey',
  'SUPABASE_SERVICE_ROLE_KEY',
  'RESEND_API_KEY',
  'paymentProof',
  'payment',
  'paymentContent',
  'profileRecord',
  'privateRecord',
  'privateRecords',
  'resume',
  'coverLetter',
  'document',
  'documents',
  'url',
  '*.url',
  'signedUrl',
  '*.signedUrl',
  'privateStorageUrl',
];

export interface LoggerConfiguration {
  service: string;
  environment: string;
  level: string;
  pretty?: boolean;
}

export function createLogger(
  configuration: LoggerConfiguration,
  destination?: DestinationStream,
): Logger {
  const options: LoggerOptions = {
    level: configuration.level,
    base: {
      service: configuration.service,
      environment: configuration.environment,
    },
    redact: { paths: redactionPaths, censor: '[REDACTED]' },
    mixin: () => contextStorage.getStore() ?? {},
  };
  if (configuration.pretty && destination === undefined) {
    return pino(
      options,
      pino.transport({
        target: 'pino-pretty',
        options: { colorize: true, singleLine: true, translateTime: 'SYS:standard' },
      }),
    );
  }
  return destination ? pino(options, destination) : pino(options);
}

export function runWithCorrelationContext<TResult>(
  context: CorrelationContext,
  callback: () => TResult,
): TResult {
  return contextStorage.run(Object.freeze({ ...context }), callback);
}

export function getCorrelationContext(): Readonly<CorrelationContext> | undefined {
  return contextStorage.getStore();
}

export function redactedLogPaths(): readonly string[] {
  return [...redactionPaths];
}
