import { describe, expect, it } from 'vitest';

import { apiContract, ResponseContractViolationError } from '../../packages/contracts/src/index.js';

/**
 * Response-versus-request error classification.
 *
 * A response that fails the schema its own route declares is a server defect and
 * belongs in a 5xx. A request that fails validation is the caller's fault and
 * belongs in a 4xx. Both used to arrive as a bare `ZodError`, and the API filter
 * mapped every one of them to `400 Request validation failed` — so a server bug
 * was reported to the caller as their mistake and never reached monitoring.
 *
 * These tests pin the distinction at its source, because the filter can only
 * classify what it is handed. `zod` is not a direct dependency of the test
 * workspace, so the error type is asserted by name rather than by class.
 */

const validHealthResponse = {
  data: { status: 'ok', service: 'api', version: 'test', timestamp: '2026-09-26T00:00:00.000Z' },
  meta: { apiVersion: 'v1', requestId: '00000000-0000-4000-8000-000000000000' },
};

function capture(action: () => unknown): unknown {
  try {
    action();
    return null;
  } catch (error) {
    return error;
  }
}

describe('response contract violations', () => {
  it('throws a distinct error type when a response does not match its route', () => {
    const thrown = capture(() => apiContract.health.response.parse({ data: {}, meta: {} }));

    expect(thrown).toBeInstanceOf(ResponseContractViolationError);
    // The distinction is the whole point: this must not be a `ZodError`, because
    // the filter would then classify it as a 400.
    expect((thrown as Error).name).not.toBe('ZodError');
  });

  it('names the operation so an operator can find the defect', () => {
    const thrown = capture(() => apiContract.health.response.parse({})) as Error;
    expect(thrown).toBeInstanceOf(ResponseContractViolationError);
    expect((thrown as ResponseContractViolationError).operationId).toBe('getHealth');
    expect(thrown.message).toContain('getHealth');
  });

  it('reports failing paths without reporting the values behind them', () => {
    const secret = 'subscriber-supplied-value-that-must-not-be-logged';
    const thrown = capture(() =>
      apiContract.health.response.parse({ data: { status: 'ok', service: secret }, meta: {} }),
    ) as ResponseContractViolationError;

    expect(thrown.issues.length).toBeGreaterThan(0);
    // A response violation is logged, never returned, so the values are not
    // needed. Keeping them out means subscriber data cannot reach a log line by
    // this route.
    expect(JSON.stringify(thrown.issues)).not.toContain(secret);
  });

  it('returns the parsed value when the response is valid', () => {
    const parsed = apiContract.health.response.parse(validHealthResponse);
    expect(parsed.data.status).toBe('ok');
    expect(parsed.data.service).toBe('api');
  });

  it('leaves the wrapped schema otherwise usable', () => {
    // The wrapper is built with Object.create, so the prototype chain is intact
    // and the OpenAPI generator, type inference, and safeParse all still work.
    expect(typeof apiContract.health.response.safeParse).toBe('function');
    expect(typeof apiContract.health.response.shape).toBe('object');
    expect(apiContract.health.response.safeParse({}).success).toBe(false);
    expect(apiContract.health.response.safeParse(validHealthResponse).success).toBe(true);
  });

  it('does not mutate the schema it wraps', () => {
    // Parsing through the wrapper must not change what the schema accepts on a
    // later call, which a shared mutation would.
    expect(apiContract.health.response.safeParse({}).success).toBe(false);
    expect(() => apiContract.health.response.parse({})).toThrow(ResponseContractViolationError);
    expect(apiContract.health.response.safeParse({}).success).toBe(false);
    expect(apiContract.health.response.safeParse(validHealthResponse).success).toBe(true);
  });

  it('keeps request schema failures as bare ZodErrors so they stay 4xx', () => {
    // Request parsing is the other half of the distinction. A request schema
    // that fails must still throw a plain ZodError, because that is what tells
    // the filter the caller is at fault.
    const thrown = capture(() => apiContract.saveJob.body.parse({ jobId: 'not-a-uuid' })) as Error;

    expect(thrown).not.toBeNull();
    expect(thrown.name).toBe('ZodError');
    expect(thrown).not.toBeInstanceOf(ResponseContractViolationError);
  });

  it('wraps every route, not only the one under test', () => {
    // A route that slipped through unwrapped would silently report server
    // defects as client errors again. An empty object fails every response
    // schema, so the type of the thrown error is what distinguishes a wrapped
    // route from an unwrapped one.
    const unwrapped = Object.values(apiContract).filter((route) => {
      const thrown = capture(() => route.response.parse({}));
      return !(thrown instanceof ResponseContractViolationError);
    });

    expect(unwrapped.map((route) => route.operationId)).toEqual([]);
  });

  it('carries the failing issue paths for the operator log', () => {
    const error = new ResponseContractViolationError('getHealth', ['data.status: invalid_literal']);
    expect(error.issues).toEqual(['data.status: invalid_literal']);
    expect(error.operationId).toBe('getHealth');
  });
});
