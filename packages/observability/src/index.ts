import { AsyncLocalStorage } from 'node:async_hooks';

import pino, { type Logger, type LoggerOptions } from 'pino';

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
  'headers.authorization',
  'apiKey',
  'serviceRoleKey',
  'SUPABASE_SERVICE_ROLE_KEY',
  'RESEND_API_KEY',
  'paymentProof',
  'profileRecord',
  'resume',
  'coverLetter',
  'privateStorageUrl',
];

export interface LoggerConfiguration {
  service: string;
  environment: string;
  level: string;
  pretty?: boolean;
}

export function createLogger(configuration: LoggerConfiguration): Logger {
  const options: LoggerOptions = {
    level: configuration.level,
    base: {
      service: configuration.service,
      environment: configuration.environment,
    },
    redact: { paths: redactionPaths, censor: '[REDACTED]' },
    mixin: () => contextStorage.getStore() ?? {},
  };
  if (configuration.pretty) {
    return pino(
      options,
      pino.transport({
        target: 'pino-pretty',
        options: { colorize: true, singleLine: true, translateTime: 'SYS:standard' },
      }),
    );
  }
  return pino(options);
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
