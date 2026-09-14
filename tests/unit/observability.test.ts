import { Writable } from 'node:stream';

import {
  createLogger,
  getCorrelationContext,
  redactedLogPaths,
  runWithCorrelationContext,
} from '@hanaply/observability';
import { describe, expect, it } from 'vitest';

describe('structured logging', () => {
  it('redacts credentials, URLs, documents, payment content, and private records', () => {
    let output = '';
    const destination = new Writable({
      write(
        chunk: string | Buffer,
        _encoding: BufferEncoding,
        callback: (error?: Error | null) => void,
      ) {
        output += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        callback();
      },
    });
    const logger = createLogger(
      { service: 'test', environment: 'test', level: 'info' },
      destination,
    );
    logger.info({
      accessToken: 'access-secret',
      apiKey: 'key-secret',
      url: 'https://private.example/signed?token=secret',
      document: 'private document',
      paymentContent: 'private payment',
      privateRecord: { email: 'private@example.test' },
    });
    const record = JSON.parse(output) as Record<string, unknown>;
    for (const field of [
      'accessToken',
      'apiKey',
      'url',
      'document',
      'paymentContent',
      'privateRecord',
    ]) {
      expect(record[field]).toBe('[REDACTED]');
    }
    expect(output).not.toContain('access-secret');
    expect(redactedLogPaths()).toContain('*.signedUrl');
  });

  it('propagates correlation context through AsyncLocalStorage', () => {
    const value = runWithCorrelationContext(
      { requestId: '11111111-1111-4111-8111-111111111111' },
      () => getCorrelationContext()?.requestId,
    );
    expect(value).toBe('11111111-1111-4111-8111-111111111111');
    expect(getCorrelationContext()).toBeUndefined();
  });

  /**
   * A logging call must never be the thing that fails a request.
   *
   * `runWithCorrelationContext` freezes the object it stores, and pino's fast
   * path merges its bindings into whatever `mixin` returns with `Object.assign`.
   * Returning the frozen object therefore threw
   * "Cannot add property context, object is not extensible" from inside
   * `logger.info({ context }, …)` — which is exactly how Nest's logger adapter
   * calls it — and a successful coach message was reported to the member as a
   * 503 because the meter's own log line blew up.
   */
  it('logs an object argument while a correlation context is active', () => {
    let output = '';
    const destination = new Writable({
      write(
        chunk: string | Buffer,
        _encoding: BufferEncoding,
        callback: (error?: Error | null) => void,
      ) {
        output += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        callback();
      },
    });
    const logger = createLogger(
      { service: 'test', environment: 'test', level: 'info' },
      destination,
    );
    const logged = runWithCorrelationContext(
      { requestId: '22222222-2222-4222-8222-222222222222' },
      () => {
        logger.info({ context: 'AiMeter' }, 'ai.meter outcome=consumed');
        return true;
      },
    );
    expect(logged).toBe(true);
    const record = JSON.parse(output) as Record<string, unknown>;
    expect(record.context).toBe('AiMeter');
    expect(record.requestId).toBe('22222222-2222-4222-8222-222222222222');
    expect(record.msg).toBe('ai.meter outcome=consumed');
  });
});
