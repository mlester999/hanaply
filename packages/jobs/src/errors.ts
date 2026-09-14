/**
 * Errors surfaced by the job ingestion engine.
 *
 * Every message here is safe to log and safe to store on
 * `public.job_sources.last_error_code` / `public.job_ingestion_runs`. Provider
 * response bodies, URLs, and credential values are never echoed, because
 * several providers carry their API key in the query string.
 */

const ERROR_CODE_PATTERN = /^[a-z0-9_]{1,80}$/u;

function normalizeErrorCode(code: string, fallback: string): string {
  const candidate = code.trim().toLowerCase();
  if (ERROR_CODE_PATTERN.test(candidate)) return candidate;
  const sanitized = candidate.replace(/[^a-z0-9_]+/gu, '_').replace(/^_+|_+$/gu, '');
  if (sanitized.length > 0 && sanitized.length <= 80) return sanitized;
  return fallback;
}

export class JobSourceError extends Error {
  /** Stable machine code, for example `http_429` or `invalid_payload`. */
  readonly code: string;

  constructor(code: string, message: string, fallbackCode = 'job_source_error') {
    super(message);
    this.name = 'JobSourceError';
    this.code = normalizeErrorCode(code, fallbackCode);
  }
}

/** The adapter could not run because a required credential was not provided. */
export class MissingCredentialError extends JobSourceError {
  /** Environment variable *names* that were missing. Never their values. */
  readonly envVars: readonly string[];

  constructor(adapterCode: string, envVars: readonly string[]) {
    const list = [...envVars].sort();
    super(
      'missing_credential',
      `${adapterCode} requires credentials that are not configured: ${list.join(', ')}`,
    );
    this.name = 'MissingCredentialError';
    this.envVars = list;
  }
}

/** A provider request failed in transport, timed out, or returned non-2xx. */
export class JobSourceRequestError extends JobSourceError {
  constructor(code: string, message: string) {
    super(code, message, 'job_source_request_error');
    this.name = 'JobSourceRequestError';
  }
}

/**
 * Reduces an unknown thrown value to a short log-safe code. Provider text is
 * never returned, only a fixed vocabulary plus an optional sanitized `code`
 * property that our own error classes set.
 */
export function toSafeErrorCode(error: unknown, fallback: string): string {
  if (error instanceof JobSourceError) return error.code;
  if (typeof error === 'object' && error !== null) {
    const candidate: unknown = (error as { code?: unknown }).code;
    if (typeof candidate === 'string' && candidate.trim() !== '') {
      return normalizeErrorCode(candidate, fallback);
    }
  }
  return normalizeErrorCode(fallback, 'job_source_error');
}
