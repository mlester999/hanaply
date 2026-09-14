/**
 * Provider transport helpers.
 *
 * One rule drives this module: nothing that came off the wire may end up in an
 * error message. Several of the providers supported here carry an API key in
 * the query string, so a raw `fetch` failure message (which can quote the URL)
 * is replaced with a fixed code, and non-2xx responses report only the status.
 */

import { JobSourceRequestError, MissingCredentialError } from './errors.js';
import type { AdapterContext, JobSourceAdapter } from './types.js';

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 120_000;

export interface JsonRequestOptions {
  readonly method?: 'GET' | 'POST';
  readonly body?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly accept?: string;
}

function resolveTimeout(timeoutMs: number): number {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(Math.trunc(timeoutMs), MAX_TIMEOUT_MS);
}

function transportCode(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const name: unknown = (error as { name?: unknown }).name;
    if (name === 'TimeoutError' || name === 'AbortError') return 'timeout';
  }
  return 'network_error';
}

async function readBody(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    throw new JobSourceRequestError('unreadable_body', 'response body could not be read');
  }
}

/**
 * Performs a JSON request and returns the parsed body as `unknown`. Transport
 * failures, non-2xx statuses, and unparsable bodies throw `JobSourceRequestError`
 * with a code that is safe to persist.
 */
export async function fetchJson(
  adapterCode: string,
  context: AdapterContext,
  url: string,
  options: JsonRequestOptions = {},
): Promise<unknown> {
  const headers: Record<string, string> = {
    accept: options.accept ?? 'application/json',
    'user-agent': context.userAgent,
    ...options.headers,
  };
  const init: RequestInit = {
    method: options.method ?? 'GET',
    headers,
    signal: AbortSignal.timeout(resolveTimeout(context.timeoutMs)),
  };
  if (options.body !== undefined) init.body = options.body;

  let response: Response;
  try {
    response = await context.fetch(url, init);
  } catch (error) {
    const code = transportCode(error);
    throw new JobSourceRequestError(code, `${adapterCode} request failed (${code})`);
  }

  if (!response.ok) {
    const code = `http_${String(response.status)}`;
    throw new JobSourceRequestError(code, `${adapterCode} returned HTTP status ${response.status}`);
  }

  const text = await readBody(response);
  if (text.trim() === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new JobSourceRequestError(
      'invalid_json',
      `${adapterCode} returned a body that is not JSON`,
    );
  }
}

/**
 * Resolves the credential values an adapter declared, or throws
 * `MissingCredentialError` naming the missing environment variables. Values are
 * never included in the message.
 */
export function requireCredentials(
  adapter: Pick<JobSourceAdapter, 'code' | 'credentialEnvVars'>,
  context: AdapterContext,
): Readonly<Record<string, string>> {
  const missing: string[] = [];
  const resolved: Record<string, string> = {};
  for (const name of adapter.credentialEnvVars) {
    const value = context.credentials[name];
    if (typeof value !== 'string' || value.trim() === '') {
      missing.push(name);
      continue;
    }
    resolved[name] = value;
  }
  if (missing.length > 0) throw new MissingCredentialError(adapter.code, missing);
  return resolved;
}

/** Bounds a requested batch size to what the caller and provider allow. */
export function clampLimit(limit: number, maximum = 1_000): number {
  if (!Number.isFinite(limit) || limit <= 0) return 0;
  return Math.max(0, Math.min(Math.trunc(limit), maximum));
}

/** Board slugs, thread ids, and similar configuration keys, safe for a path. */
const SAFE_CONFIG_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;

export function isSafeConfigToken(value: string): boolean {
  return SAFE_CONFIG_TOKEN.test(value);
}

function asUnknownArray(value: unknown): unknown[] {
  return Array.isArray(value) ? (value as unknown[]) : [];
}

/** Reads a non-empty string from `context.config`, or `null`. */
export function readConfigString(context: AdapterContext, key: string): string | null {
  const value = context.config?.[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** Reads a list of non-empty strings from `context.config`. */
export function readConfigStringArray(context: AdapterContext, key: string): string[] {
  const value = context.config?.[key];
  const result: string[] = [];
  for (const item of asUnknownArray(value)) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (trimmed === '') continue;
    result.push(trimmed);
  }
  return result;
}

/** Reads a finite number from `context.config`, or `null`. */
export function readConfigNumber(context: AdapterContext, key: string): number | null {
  const value = context.config?.[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Reads a boolean from `context.config`, or `null` when it is not set. */
export function readConfigBoolean(context: AdapterContext, key: string): boolean | null {
  const value = context.config?.[key];
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}
