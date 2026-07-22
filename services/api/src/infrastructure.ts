import { randomUUID } from 'node:crypto';

import { createLogger, runWithCorrelationContext } from '@hanaply/observability';
import {
  type ArgumentsHost,
  Catch,
  type CallHandler,
  type ExceptionFilter,
  HttpException,
  type ExecutionContext,
  Injectable,
  type LoggerService,
  type NestInterceptor,
} from '@nestjs/common';
import type { ApiEnvironment } from '@hanaply/config';
import type { ErrorCode } from '@hanaply/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { defer, type Observable } from 'rxjs';
import { ZodError } from 'zod';

import { AppError } from './app-error.js';
import { errorEnvelope } from './http.js';

export function createApiLogger(environment: ApiEnvironment): ReturnType<typeof createLogger> {
  return createLogger({
    service: 'api',
    environment: environment.HANAPLY_ENV,
    level: environment.LOG_LEVEL,
    pretty: environment.HANAPLY_ENV === 'local',
  });
}

type ApiLogger = ReturnType<typeof createApiLogger>;

export class NestLoggerAdapter implements LoggerService {
  constructor(private readonly logger: ApiLogger) {}

  log(message: unknown, context?: string): void {
    this.logger.info({ context }, String(message));
  }

  error(message: unknown, trace?: string, context?: string): void {
    this.logger.error({ context, trace }, String(message));
  }

  warn(message: unknown, context?: string): void {
    this.logger.warn({ context }, String(message));
  }

  debug(message: unknown, context?: string): void {
    this.logger.debug({ context }, String(message));
  }

  verbose(message: unknown, context?: string): void {
    this.logger.trace({ context }, String(message));
  }
}

@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const reply = context.switchToHttp().getResponse<FastifyReply>();
    reply.header('x-request-id', request.id);
    return defer(() => runWithCorrelationContext({ requestId: request.id }, () => next.handle()));
  }
}

function httpError(status: number): { code: ErrorCode; message: string } {
  if (status === 400) return { code: 'VALIDATION_ERROR', message: 'Request validation failed' };
  if (status === 401)
    return { code: 'AUTHENTICATION_REQUIRED', message: 'Authentication is required' };
  if (status === 403) return { code: 'FORBIDDEN', message: 'Access is forbidden' };
  if (status === 404) return { code: 'NOT_FOUND', message: 'Resource not found' };
  if (status === 409) return { code: 'CONFLICT', message: 'Request conflicts with current state' };
  if (status === 429) return { code: 'RATE_LIMITED', message: 'Too many requests' };
  if (status === 503) return { code: 'SERVICE_UNAVAILABLE', message: 'Service is unavailable' };
  return { code: 'INTERNAL_ERROR', message: 'An internal error occurred' };
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: ApiLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const request = host.switchToHttp().getRequest<FastifyRequest>();
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const requestId = request.id || randomUUID();

    if (exception instanceof ZodError) {
      const details = exception.issues.map((issue) => ({
        path: issue.path.map((segment) =>
          typeof segment === 'symbol' ? (segment.description ?? '') : segment,
        ),
        code: issue.code,
        message: issue.message,
      }));
      void reply
        .status(400)
        .send(errorEnvelope(requestId, 'VALIDATION_ERROR', 'Request validation failed', details));
      return;
    }

    if (exception instanceof AppError) {
      void reply
        .status(exception.status)
        .send(errorEnvelope(requestId, exception.code, exception.message, exception.details));
      return;
    }

    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const mapped = httpError(status);
    if (status >= 500) {
      this.logger.error(
        {
          requestId,
          error:
            exception instanceof Error
              ? { name: exception.name, message: exception.message, stack: exception.stack }
              : { name: 'UnknownError' },
        },
        'Unhandled API exception',
      );
    }
    void reply.status(status).send(errorEnvelope(requestId, mapped.code, mapped.message));
  }
}
