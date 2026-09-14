/**
 * `@hanaply/jobs` — job source adapters, normalization, deduplication, and the
 * ingestion runner.
 *
 * The package is I/O-light by design: adapters receive their `fetch` and their
 * credentials through `AdapterContext`, the runner receives its sink as an
 * argument, and every text decision lives in pure functions. That is what makes
 * the whole ingestion path testable without a network or a database.
 */

export * from './adapters/index.js';
export * from './dedupe.js';
export * from './errors.js';
export * from './http.js';
export * from './normalize.js';
export * from './runner.js';
export * from './sanitize.js';
export * from './types.js';
