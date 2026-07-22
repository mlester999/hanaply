import { deadLetterMetadataSchema, taskEnvelopeSchema } from '@hanaply/contracts';
import { taskFixture } from '@hanaply/testing';
import {
  DisabledQueueAdapter,
  InMemoryTaskQueue,
  isRetryableTaskError,
  retryDelayMilliseconds,
} from '../../services/worker/src/queue.js';
import { describe, expect, it } from 'vitest';

describe('versioned task contracts', () => {
  it('validates the full envelope and defaults to five attempts', () => {
    const { maxAttempts: _maximum, ...withoutMaximum } = taskFixture();
    void _maximum;
    expect(taskEnvelopeSchema.parse(withoutMaximum).maxAttempts).toBe(5);
    expect(() => taskEnvelopeSchema.parse({ ...withoutMaximum, version: 0 })).toThrow();
  });

  it('uses capped exponential backoff with full jitter', () => {
    expect(retryDelayMilliseconds(1, { random: () => 0.5 })).toBe(500);
    expect(retryDelayMilliseconds(20, { random: () => 0.999 })).toBeLessThan(15 * 60 * 1_000);
    expect(() => retryDelayMilliseconds(0)).toThrow(RangeError);
  });

  it('classifies explicit non-retryable errors', () => {
    const validation = new Error('bad payload');
    validation.name = 'VALIDATION_ERROR';
    expect(isRetryableTaskError(validation)).toBe(false);
    expect(isRetryableTaskError(new Error('temporary unavailable'))).toBe(true);
  });

  it('excludes task payloads from dead-letter metadata', async () => {
    const queue = new InMemoryTaskQueue();
    await queue.deadLetter(
      taskFixture({ payload: { accessToken: 'must-not-survive' } }),
      'FAILED',
      'safe',
    );
    const [metadata] = queue.deadLetterMetadata();
    expect(metadata).toBeDefined();
    expect(metadata).not.toHaveProperty('payload');
    expect(deadLetterMetadataSchema.parse(metadata).errorCode).toBe('FAILED');
  });

  it('keeps the production queue honestly disabled', async () => {
    const queue = new DisabledQueueAdapter();
    await expect(queue.enqueue(taskFixture())).rejects.toThrow(/disabled/u);
    await expect(queue.dequeue()).resolves.toBeNull();
  });
});
