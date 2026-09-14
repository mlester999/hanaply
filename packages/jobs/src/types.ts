/**
 * Job source adapter contract.
 *
 * The job ingestion engine is built from three separable pieces:
 *
 *   1. An **adapter** turns one provider's raw feed into `NormalizedJobInput`
 *      values. Adapters own transport and mapping; they never touch the
 *      database and never decide whether two postings are the same job.
 *   2. The **normalizer** (`normalize.ts`) owns every deterministic text
 *      decision: remote state, employment type, seniority, salary, location,
 *      skills, and the content fingerprint that the SQL contract expects.
 *   3. The **runner** (`runner.ts`) walks raw postings through an adapter and
 *      hands accepted values to an injected sink (in production, the
 *      `public.upsert_ingested_job` RPC).
 *
 * Two rules are encoded in these types rather than in documentation:
 *
 *   - `normalize` returns `null` instead of inventing a value. A posting with
 *     no title, no company, no description, or a non-HTTP source URL cannot be
 *     represented truthfully, so it is refused rather than guessed at.
 *   - Every provider payload crosses the boundary as `unknown`. Adapters
 *     validate with Zod before reading a single field.
 */

export type EmploymentType =
  'full_time' | 'part_time' | 'contract' | 'freelance' | 'internship' | 'temporary' | 'volunteer';

export type JobSeniority =
  | 'internship'
  | 'entry'
  | 'junior'
  | 'mid'
  | 'senior'
  | 'lead'
  | 'principal'
  | 'manager'
  | 'director'
  | 'executive'
  | 'unspecified';

export type JobRemoteState = 'remote' | 'hybrid' | 'onsite' | 'unspecified';

export type SalaryPeriod = 'hourly' | 'daily' | 'monthly' | 'annual';

/**
 * Canonical shape accepted by `public.upsert_ingested_job(target_source_id,
 * job_input, action_request_id)`. Keys match the jsonb keys that function
 * reads, so a sink can pass this object through unchanged.
 */
export interface NormalizedJobInput {
  sourceJobId: string;
  sourceUrl: string;
  applyUrl: string | null;
  title: string;
  companyName: string;
  companyDomain: string | null;
  companyCountryCode: string | null;
  description: string;
  employmentType: EmploymentType;
  seniority: JobSeniority;
  remoteState: JobRemoteState;
  locationRaw: string | null;
  city: string | null;
  region: string | null;
  countryCode: string | null;
  isInternational: boolean;
  salaryMinMinor: number | null;
  salaryMaxMinor: number | null;
  salaryCurrency: string | null;
  salaryPeriod: SalaryPeriod | null;
  salaryIsEstimate: boolean;
  requirements: string[];
  preferredQualifications: string[];
  skills: string[];
  experienceYearsMin: number | null;
  experienceYearsMax: number | null;
  language: string;
  postedAt: string | null;
  expiresAt: string | null;
  contentFingerprint: string;
  payloadChecksum: string;
  rawPayload: Record<string, unknown>;
}

/** One untouched posting as it came off a provider. */
export interface RawPosting {
  readonly sourceJobId: string;
  readonly sourceUrl: string;
  readonly payload: unknown;
}

/**
 * Everything an adapter is allowed to know about its runtime. Credentials are
 * secret *values* only; their environment variable *names* live on the adapter.
 */
export interface AdapterContext {
  readonly fetch: typeof fetch;
  readonly credentials: Readonly<Record<string, string>>;
  readonly limit: number;
  readonly now: Date;
  readonly userAgent: string;
  readonly timeoutMs: number;
  /**
   * Per-source configuration copied from `public.job_sources.config` (board
   * tokens, thread ids, search scope). It is optional so a source can be
   * probed before an operator has recorded any configuration; adapters that
   * need a key return an empty batch rather than inventing one.
   */
  readonly config?: Readonly<Record<string, unknown>>;
}

export interface JobSourceAdapter {
  readonly code: string;
  readonly displayName: string;
  readonly attribution: string;
  readonly requiresCredentials: boolean;
  readonly credentialEnvVars: readonly string[];
  /** Fetches raw postings. Must be rate-limit aware and bounded by `limit`. */
  fetchPostings(context: AdapterContext): Promise<readonly RawPosting[]>;
  /** Maps one raw posting to the canonical input. Never invents a value. */
  normalize(raw: RawPosting, context: AdapterContext): NormalizedJobInput | null;
}
