/**
 * The adapter registry.
 *
 * Adapter codes match the `public.job_sources.code` check
 * (`^[a-z][a-z0-9_]{2,63}$`), so a source row can be resolved to its adapter
 * without a lookup table. Credential-free adapters can run as soon as a source
 * row exists; credential-backed adapters declare the environment variable
 * *names* they need and fail loudly (and safely) when those are absent.
 */

import type { JobSourceAdapter } from '../types.js';
import { adzunaAdapter } from './adzuna.js';
import { arbeitnowAdapter } from './arbeitnow.js';
import { ashbyAdapter } from './ashby.js';
import { greenhouseAdapter } from './greenhouse.js';
import { hnAlgoliaAdapter } from './hn_algolia.js';
import { joobleAdapter } from './jooble.js';
import { leverAdapter } from './lever.js';
import { remotiveAdapter } from './remotive.js';
import { workableAdapter } from './workable.js';

export { adzunaAdapter } from './adzuna.js';
export { arbeitnowAdapter } from './arbeitnow.js';
export { ashbyAdapter } from './ashby.js';
export { greenhouseAdapter } from './greenhouse.js';
export { hnAlgoliaAdapter } from './hn_algolia.js';
export { joobleAdapter } from './jooble.js';
export { leverAdapter } from './lever.js';
export { remotiveAdapter } from './remotive.js';
export { workableAdapter } from './workable.js';

/** Every adapter the ingestion engine can run, in registry order. */
export const jobSourceAdapters: readonly JobSourceAdapter[] = [
  remotiveAdapter,
  arbeitnowAdapter,
  hnAlgoliaAdapter,
  greenhouseAdapter,
  leverAdapter,
  ashbyAdapter,
  workableAdapter,
  adzunaAdapter,
  joobleAdapter,
];

/** Looks an adapter up by `public.job_sources.code`; `null` when unknown. */
export function getJobSourceAdapter(code: string): JobSourceAdapter | null {
  const normalized = code.trim().toLowerCase();
  return jobSourceAdapters.find((adapter) => adapter.code === normalized) ?? null;
}
