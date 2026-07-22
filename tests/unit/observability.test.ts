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
});
