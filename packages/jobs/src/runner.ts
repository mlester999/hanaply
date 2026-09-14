/**
 * The ingestion runner.
 *
 * The runner owns ordering and failure isolation, nothing else. It fetches one
 * bounded batch from an adapter, normalizes each raw posting, and hands the
 * accepted values to an injected sink. In production the sink wraps the
 * `public.upsert_ingested_job` RPC; in tests it is a plain object, which is why
 * this module imports no database client.
 *
 * Failure policy:
 *
 *   - a posting the adapter refuses (or that makes the adapter throw) is
 *     counted as `rejected` and never stops the batch;
 *   - a sink failure is counted as `skipped` and reported in `errors`;
 *   - a failure that belongs to the *source* (transport, HTTP status, missing
 *     credentials) is not caught here: the caller must mark the ingestion run
 *     failed and open the source's circuit breaker.
 *
 * Counters always satisfy
 * `fetched === created + updated + merged + skipped + rejected`.
 */

import { toSafeErrorCode } from './errors.js';
import type { AdapterContext, JobSourceAdapter, NormalizedJobInput } from './types.js';

export interface IngestionSink {
  upsertJob(input: NormalizedJobInput): Promise<{
    jobId: string;
    created: boolean;
    merged: boolean;
    matchedBy: string;
  }>;
}

export interface SourceIngestionError {
  sourceJobId: string;
  code: string;
}

export interface SourceIngestionResult {
  fetched: number;
  created: number;
  updated: number;
  merged: number;
  skipped: number;
  rejected: number;
  errors: SourceIngestionError[];
}

export interface SourceIngestionOptions {
  readonly adapter: JobSourceAdapter;
  readonly context: AdapterContext;
  readonly sink: IngestionSink;
  /** Overrides `context.limit` for this run. */
  readonly limit?: number;
}

function resolveLimit(options: SourceIngestionOptions): number {
  const requested = options.limit ?? options.context.limit;
  if (!Number.isFinite(requested) || requested <= 0) return 0;
  return Math.trunc(requested);
}

/**
 * Runs one source scan. Never throws for a per-posting failure.
 */
export async function runSourceIngestion(
  options: SourceIngestionOptions,
): Promise<SourceIngestionResult> {
  const limit = resolveLimit(options);
  const context: AdapterContext = { ...options.context, limit };
  const result: SourceIngestionResult = {
    fetched: 0,
    created: 0,
    updated: 0,
    merged: 0,
    skipped: 0,
    rejected: 0,
    errors: [],
  };
  if (limit === 0) return result;

  const fetched = await options.adapter.fetchPostings(context);
  const seenSourceJobIds = new Set<string>();

  for (const posting of fetched) {
    if (result.fetched >= limit) break;
    result.fetched += 1;

    if (seenSourceJobIds.has(posting.sourceJobId)) {
      // The same source id twice in one batch is one posting, not two.
      result.skipped += 1;
      continue;
    }
    seenSourceJobIds.add(posting.sourceJobId);

    let input: NormalizedJobInput | null;
    try {
      input = options.adapter.normalize(posting, context);
    } catch (error) {
      result.rejected += 1;
      result.errors.push({
        sourceJobId: posting.sourceJobId,
        code: toSafeErrorCode(error, 'normalize_failed'),
      });
      continue;
    }

    if (input === null) {
      // The adapter declined to represent this posting; that is a data
      // decision, not an error, so it is not reported in `errors`.
      result.rejected += 1;
      continue;
    }

    try {
      const outcome = await options.sink.upsertJob(input);
      if (outcome.created) {
        result.created += 1;
      } else if (outcome.merged) {
        result.merged += 1;
      } else if (outcome.matchedBy === 'source_identity') {
        result.updated += 1;
      } else {
        result.skipped += 1;
      }
    } catch (error) {
      result.skipped += 1;
      result.errors.push({
        sourceJobId: posting.sourceJobId,
        code: toSafeErrorCode(error, 'sink_failed'),
      });
    }
  }

  return result;
}
