# Job ingestion

Hanaply treats job postings as untrusted external data. The ingestion pipeline is deliberately split into three pieces so that a bug or a change in one provider cannot corrupt a canonical record or another provider's scan:

1. An **adapter** turns one provider's raw feed into `NormalizedJobInput`. Adapters own transport and field mapping. They never touch the database and never decide whether two postings are the same job.
2. The **normalizer** in `packages/jobs/src/normalize.ts` owns every deterministic text decision: remote state, employment type, seniority, salary, location, skills, requirements, and the content fingerprint.
3. The **runner** in `packages/jobs/src/runner.ts` walks raw postings through an adapter and hands accepted values to an injected sink. In production the sink calls the `public.upsert_ingested_job` RPC.

The engine writes into `public.jobs` (one row per opportunity), `public.job_source_records` (one row per posting as seen from one source), and `public.companies` (deduplicated employers). Every raw payload is retained in `job_source_records.raw_payload` so a normalization bug can be replayed.

## The adapter contract

`packages/jobs/src/types.ts` defines `JobSourceAdapter`:

| Member                    | Meaning                                                                                                                                                          |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `code`                    | Adapter key. Matches `public.job_sources.code`, which is checked against `^[a-z][a-z0-9_]{2,63}$`, so a source row resolves to an adapter without a lookup table |
| `displayName`             | Human-readable provider name                                                                                                                                     |
| `attribution`             | The credit line the provider requires                                                                                                                            |
| `requiresCredentials`     | Whether the adapter needs a secret                                                                                                                               |
| `credentialEnvVars`       | Environment variable **names** only; secret values never reach the database                                                                                      |
| `fetchPostings(context)`  | Fetches raw postings. Rate-limit aware and bounded by `context.limit`                                                                                            |
| `normalize(raw, context)` | Maps one raw posting to `NormalizedJobInput`, or returns `null` rather than inventing a value                                                                    |

`AdapterContext` carries `fetch`, `credentials`, `limit`, `now`, `userAgent`, `timeoutMs`, and the optional per-source `config` copied from `public.job_sources.config` (board tokens, thread ids, search scope).

Two rules are encoded in the types rather than in prose:

- `normalize` returns `null` instead of guessing. A posting with no title, no company, no description, or a non-HTTP source URL cannot be represented truthfully, so it is refused. A refusal is counted as `rejected` and is not an error.
- Every provider payload crosses the boundary as `unknown` and is validated with Zod before a single field is read.

Transport is centralized in `packages/jobs/src/http.ts`. Nothing that came off the wire may appear in an error message: `fetchJson` replaces raw transport failures with a fixed code (`timeout` or `network_error`) and non-2xx responses report only the status, because several providers carry an API key in the query string. `requireCredentials` throws `MissingCredentialError` without echoing the value.

The runner's counters always satisfy `fetched === created + updated + merged + skipped + rejected`. A sink failure counts as `skipped` and is reported in `errors`; a failure that belongs to the source itself (transport, HTTP status, missing credentials) is not caught by the runner — the caller must mark the ingestion run failed and open the source's circuit breaker.

## The nine shipped adapters

`packages/jobs/src/adapters/index.ts` exports `jobSourceAdapters` in registry order and `getJobSourceAdapter(code)` for lookup.

Credential-free:

| Code         | Display name                 | Endpoint                                            |
| ------------ | ---------------------------- | --------------------------------------------------- |
| `remotive`   | Remotive                     | `https://remotive.com/api/remote-jobs`              |
| `arbeitnow`  | Arbeitnow                    | `https://www.arbeitnow.com/api/job-board-api`       |
| `hn_algolia` | Hacker News "Who is hiring?" | `https://hn.algolia.com/api/v1/search_by_date`      |
| `greenhouse` | Greenhouse Job Boards        | `https://boards-api.greenhouse.io/v1/boards`        |
| `lever`      | Lever Postings               | `https://api.lever.co/v0/postings`                  |
| `ashby`      | Ashby Job Boards             | `https://api.ashbyhq.com/posting-api/job-board`     |
| `workable`   | Workable Job Widgets         | `https://apply.workable.com/api/v1/widget/accounts` |

Credential-backed:

| Code     | Display name | Endpoint                             | Environment variables             |
| -------- | ------------ | ------------------------------------ | --------------------------------- |
| `adzuna` | Adzuna       | `https://api.adzuna.com/v1/api/jobs` | `ADZUNA_APP_ID`, `ADZUNA_APP_KEY` |
| `jooble` | Jooble       | `https://jooble.org/api`             | `JOOBLE_API_KEY`                  |

The four board-scoped adapters (Greenhouse, Lever, Ashby, Workable) share `packages/jobs/src/adapters/boards.ts`, which reads board tokens from `config.boardTokens` or the singular `config.boardToken` alias, validates each as a safe path token (`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`), and isolates per-board failures: one board changing shape, rate-limiting, or disappearing never stops the others, and `context.limit` bounds the **total** number of postings returned across all boards.

Per-source configuration keys read from `public.job_sources.config`:

| Adapter                                    | Keys                                                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `greenhouse`, `lever`, `ashby`, `workable` | `boardTokens` (array) or `boardToken` (single)                                                         |
| `hn_algolia`                               | `threadId`                                                                                             |
| `adzuna`                                   | `countries` (two-letter markets; defaults to `ph`), `what`, `where`, `page`, `maxPages` (capped at 10) |
| `jooble`                                   | `keywords`, `location`, `page`                                                                         |
| `remotive`, `arbeitnow`                    | none                                                                                                   |

Adzuna returns salary as an annualised model estimate in the local currency of the searched market and never states the currency. The adapter therefore records a currency only for markets it knows (for example `ph` → `PHP`, `gb` → `GBP`, `us` → `USD`); otherwise every salary field stays `null` and `salaryIsEstimate` is `false`. When a currency is known, `salaryIsEstimate` is `true`.

## How a source is activated

A source is a row in `public.job_sources`. The table requires `attribution` (`text not null`), accepts nullable `terms_url`, and defaults `status` to `'paused'`. The migration comment states the intent: a source is disabled until an operator records its attribution, terms, and cadence limits.

The seed block in `20260915090000_job_ingestion_foundation.sql` inserts the five providers that had a shipped adapter at that time, and does **not** set `status`, so every one of them is `paused`. The `on conflict (code) do update` clause refreshes display name, kind, base URL, attribution, terms URL, credential requirement, credential variable, minimum scan interval, and requests-per-minute — it deliberately does **not** touch `status`, so re-running the migration can never silently enable a provider.

Activation is therefore an explicit operator action, and it has four prerequisites:

1. **Attribution.** `job_sources.attribution` must state where the data comes from. Adapters also carry their own `attribution` string, which the review is expected to check against the provider's current terms.
2. **Terms.** `job_sources.terms_url` records the terms the operator reviewed. `job_sources_credentials_check` requires `credential_env_var` whenever `requires_credentials` is true, so a credential-backed provider cannot be represented without naming its variable.
3. **Cadence limits.** `min_scan_interval_minutes` (5–1440, default 15), `requests_per_minute` (1–600, default 30), and `batch_size` (1–1000, default 100) are recorded per source.
4. **Credential.** For Adzuna and Jooble the secret value is set in the worker's environment under the variable name stored in `credential_env_var`. The worker reads it with `process.env[source.credential_env_var]` and passes only the value into the adapter context; the value is never persisted or logged.

Setting `status = 'active'` is what makes a source eligible. `public.job_ingestion_schedule()` filters on `status = 'active'`, so a `paused` or `disabled` source is never scheduled, and `public.upsert_ingested_job` raises `job source is disabled` for a source whose status is `disabled`.

> **Accuracy note.** `public.job_sources.requests_per_minute` is recorded and surfaced by `app_private.job_source_snapshot`, but no TypeScript in `packages/jobs` or `services/worker` reads it. Per-scan request volume is bounded in practice by `batch_size` (passed as `context.limit`), by each adapter's own page-count caps, and by the worker's sequential, one-source-at-a-time design. Treat the column as recorded policy rather than an enforced throttle.

## Normalization fields

`NormalizedJobInput` in `packages/jobs/src/types.ts` is the canonical shape accepted by `public.upsert_ingested_job`. Its keys match the JSON keys that function reads, so a sink can pass the object through unchanged.

| Group          | Fields                                                                                                               |
| -------------- | -------------------------------------------------------------------------------------------------------------------- |
| Identity       | `sourceJobId`, `sourceUrl`, `applyUrl`, `title`, `companyName`, `companyDomain`, `companyCountryCode`, `description` |
| Classification | `employmentType`, `seniority`, `remoteState`, `language`                                                             |
| Location       | `locationRaw`, `city`, `region`, `countryCode`, `isInternational`                                                    |
| Compensation   | `salaryMinMinor`, `salaryMaxMinor`, `salaryCurrency`, `salaryPeriod`, `salaryIsEstimate`                             |
| Content        | `requirements`, `preferredQualifications`, `skills`, `experienceYearsMin`, `experienceYearsMax`                      |
| Time           | `postedAt`, `expiresAt`                                                                                              |
| Integrity      | `contentFingerprint`, `payloadChecksum`, `rawPayload`                                                                |

The database turns these into typed columns: `public.jobs` stores `title`, `normalized_title`, `description` (20–40000 characters), `description_excerpt` (at most 600 characters, HTML stripped), typed `employment_type`, `seniority`, and `remote_state` enums, location fields including `is_philippines` and `is_international`, salary minors with currency and period, `requirements`/`preferred_qualifications`/`skills` as `text[]`, experience bounds, `language`, `apply_url`, `canonical_url`, `content_fingerprint` (checked against `^[a-f0-9]{64}$`), `dedup_key`, `source_count`, `status`, and the timestamp columns `posted_at`, `expires_at`, `first_seen_at`, `last_seen_at`, `last_verified_at`, `freshness_checked_at`.

Normalizer helpers worth naming: `detectRemoteState`, `detectEmploymentType`, `detectSeniority`, `deriveSeniorityFromExperience`, `parseSalary`, `parseLocation`, `deriveIsInternational`, `extractSkills` (over the `SKILL_LEXICON`), `splitRequirementBullets`, `normalizeCompanyName`, `normalizeTitle`, `jobDedupKey`, `stableFingerprint`, and `payloadChecksum`. Database-side parity helpers are `app_private.normalize_company_name`, `app_private.normalize_job_title`, `app_private.job_dedup_key`, and `app_private.job_description_excerpt`.

## Deduplication

Deduplication is multi-signal and lives in two places: the SQL merge rules in `public.upsert_ingested_job`, and the explainable scoring in `packages/jobs/src/dedupe.ts`.

### The three SQL signals, evaluated in order

1. **Source identity (fast path).** If a `job_source_records` row already exists for `(source_id, source_job_id)`, the existing job is refreshed: `last_seen_at`, `last_verified_at`, `status = 'active'`, title, description, excerpt, apply URL, canonical URL, and `expires_at`. The result reports `matchedBy: 'source_identity'`, `created: false`, `merged: false`. This is an update, not a merge, so `source_count` is not incremented.
2. **Content fingerprint.** A job with the same `content_fingerprint` and `company_id` and `status in ('active','stale')` is a confident merge. The result reports `matchedBy: 'content_fingerprint'`.
3. **Composite key within a date window.** A job with the same `dedup_key` and `company_id` and `status in ('active','stale')` merges when `poster is null or posted_at is null or abs(extract(epoch from (posted_at - poster))) <= 1814400` — a window of exactly 21 days. The result reports `matchedBy: 'composite_key'` and writes a `job.deduplicated` audit event. The nearest posting date wins.

When signal 3 matches on the composite key but the posting dates are **outside** the 21-day window, the records stay separate: a new `jobs` row is inserted and a `public.job_dedup_candidates` row is written with `score = 0.6` and `signals = {"matchedBy":"composite_key_distant_date","dedupKey":<key>}`. That table is the diagnostic surface an operator reviews; it has a `resolution` column constrained to `merged` or `kept_separate`.

`app_private.job_dedup_key(title, company, location)` is `normalize_job_title(title) || '@' || normalize_company_name(company) || '@' || left(regexp_replace(lower(btrim(location)), '[^a-z0-9]+', '-', 'g'), 80)`. `normalize_company_name` lowercases, strips non-alphanumerics, then repeatedly removes trailing legal forms (`inc`, `incorporated`, `corp`, `corporation`, `company`, `co`, `llc`, `ltd`, `limited`, `plc`, `gmbh`, `bv`, `nv`, `pte`, `pvt`, `sdn bhd`, `bhd`, `philippines`, `ph`) up to five times, falling back to the pre-strip value if the name would collapse to nothing.

Provenance is always retained. Merging never deletes a source record: a `job_source_records` row is inserted for every observation, with `is_primary = true` only for the first one (enforced by the partial unique index `job_source_records_one_primary_idx`), and the identity constraint is `(source_id, source_job_id)`.

### The softer scoring layer

`dedupeSignals(candidate, existing)` scores a pair across eight weighted signals and returns each contribution so a reviewer can see why a pair was proposed. The weights sum to 1:

| Signal               | Weight |
| -------------------- | -----: |
| `contentFingerprint` |   0.10 |
| `canonicalUrl`       |   0.02 |
| `sourceJobId`        |   0.01 |
| `company`            |   0.30 |
| `title`              |   0.30 |
| `location`           |   0.10 |
| `description`        |   0.15 |
| `postedAt`           |   0.02 |

Company and title carry the most weight because they are the two facts a provider always states. An identical `contentFingerprint` is decisive by construction — the SQL already treats that as the same opportunity, so it scores 1 regardless of the weighted mean. `company` and `title` use token-set Jaccard similarity over normalized words; `canonicalUrl` compares host plus path with the query string deliberately discarded, because query strings carry the tracking parameters that made two copies of the same posting look different. `postedAt` is a linear proximity score that reaches 0 at the 21-day window, matching `RECENCY_WINDOW_DAYS = 21` and the `1814400`-second bound in SQL. A missing or unparsable date contributes nothing rather than a default.

`classifyDedupe(score)` then returns:

| Score                    | Classification |
| ------------------------ | -------------- |
| `>= 0.92`                | `merge`        |
| `>= 0.6`                 | `review`       |
| otherwise, or non-finite | `distinct`     |

`MERGE_THRESHOLD = 0.92` and `REVIEW_THRESHOLD = 0.6` are exported from `packages/jobs/src/dedupe.ts`.

## Freshness

`public.refresh_job_freshness(evaluated_at timestamptz default now(), stale_after_hours integer default 168, expire_after_hours integer default 720)` is the only freshness writer. It rejects `stale_after_hours < 1` and `expire_after_hours <= stale_after_hours` with `22023`, then:

1. Sets `job_source_records.status = 'stale'` where the record is `active` and `last_seen_at` is older than the stale threshold.
2. Sets `jobs.status = 'stale'` where the job is `active`, `last_seen_at` is older than the stale threshold, and `expires_at` has not already passed.
3. Sets `jobs.status = 'expired'` where the job is `active` or `stale` and either `expires_at <= evaluated_at` or `last_seen_at` is older than the expire threshold.
4. Touches `freshness_checked_at` on rows where it is null or older than one hour.

It returns `{staleCount, expiredCount, evaluatedAt}`.

The worker calls it with `JOB_STALE_AFTER_HOURS` (default 168, seven days) and `JOB_EXPIRE_AFTER_HOURS` (default 720, thirty days). `jobs.status` is the enum `('active', 'stale', 'expired', 'closed', 'duplicate', 'rejected')`; ingestion only ever writes `active`, and freshness transitions `active → stale → expired`. A posting re-observed by any source returns to `active`, and merging takes `posted_at = least(existing, incoming)` because the earliest posting time is the truest freshness signal.

## Scheduling, cadence, and locking

Ingestion is shared infrastructure, not per-subscriber work. One scan per source serves every subscriber; a plan's cadence decides only how often that shared scan runs.

`public.job_ingestion_schedule()` returns, per eligible source: `source_id`, `source_code`, `effective_interval_minutes`, `fastest_subscriber_interval_minutes`, and `due`. It:

- Requires the service role through `app_private.require_service_role()`.
- Computes `fastest_subscriber_interval_minutes` as `min(plan_entitlements.value)` over `scanIntervalMinutes` for subscriptions whose `status = 'active'`, `starts_at <= now()`, and `ends_at is null or ends_at > now()`.
- Computes `effective_interval_minutes = greatest(source.min_scan_interval_minutes, coalesce(fastest_subscriber_interval, source.min_scan_interval_minutes))`.
- Marks a source `due` when `last_success_at is null` or `last_success_at <= now() - effective_interval_minutes`.
- Filters to `source.status = 'active'` and `(circuit_open_until is null or circuit_open_until <= now())`.
- Orders by `source.code`.

`min_scan_interval_minutes` is therefore a hard floor: plan cadence can slow a shared scan down but can never make Hanaply poll a provider faster than the interval the operator recorded. With no active subscriber, the effective interval falls back to the source minimum, which is never an error and never a faster scan.

`packages/jobs/src/runner.ts` bounds each scan with `context.limit` (the source's `batch_size`), deduplicates repeated `sourceJobId` values inside one batch as `skipped`, and never lets a per-posting failure stop the batch.

### Locking

Two independent mechanisms prevent overlapping work:

1. **One running run per source.** `create unique index job_ingestion_runs_one_running_idx on public.job_ingestion_runs (source_id) where status = 'running';` — a partial unique index, so overlapping scans are impossible even across processes. `public.start_ingestion_run(target_source_id, requested_trigger, requested_by, action_request_id)` inserts `on conflict (source_id) where status = 'running' do nothing` and, when nothing was returned, selects and returns the existing running run. Concurrent schedulers are therefore idempotent instead of erroring.
2. **Cooperative per-source lock.** `app_private.job_ingestion_locks` (`lock_key` primary key, `holder`, `acquired_at`, `expires_at`) backs `public.acquire_ingestion_lock(requested_lock_key, requested_holder, ttl_seconds default 600)` and `public.release_ingestion_lock(requested_lock_key, requested_holder)`, both service-role only. The TTL must be between 30 and 7200 seconds. A lock is granted when the existing row has expired or when the same holder already owns it; release deletes only when both `lock_key` and `holder` match. The worker uses lock key `ingest.<source.code>`, holder `worker-<uuid>`, and a 900-second TTL. A worker that fails to acquire the lock returns silently, because skipping is the correct outcome rather than a failure.

The worker's session variable is `requested_lock_key`; the table's column is `lock_key`. Both are correct — the function argument is prefixed and the table column is not.

## Circuit breaking and provider health

`public.job_sources` carries the health state: `last_success_at`, `last_failure_at`, `last_error_code`, `consecutive_failures`, `circuit_open_until`, and `total_jobs_ingested`.

On a run whose final status is `failed`, `public.complete_ingestion_run(target_run_id, outcome)`:

- Sets `last_failure_at = now()` and records `last_error_code` from the outcome payload.
- Increments `consecutive_failures`.
- Sets `circuit_open_until = now() + make_interval(secs => least(3600, 60 * power(2, least(consecutive_failures + 1, 6))::integer))` — exponential backoff starting at two minutes and capped at one hour.
- Sets `status = 'paused'` once `consecutive_failures + 1 >= 8`, so a permanently broken provider stops being retried until an operator intervenes.
- Writes a `job_source.ingestion_failed` audit event with `{runId, errorCode, consecutiveFailures}`.

On any non-failed outcome it clears the breaker: `last_success_at = now()`, `last_error_code = null`, `consecutive_failures = 0`, `circuit_open_until = null`, and `total_jobs_ingested += createdCount`.

`job_ingestion_schedule()` skips a source whose breaker is open, so a provider outage cannot become a request storm and the source recovers without operator action once the backoff expires.

The worker reports a run as `partial` rather than `succeeded` when any posting was rejected or any write failed: `status: result.errors.length > 0 || result.rejected > 0 ? 'partial' : 'succeeded'`. A partial run is still treated as a success by the breaker, because the source itself worked; the operator sees the counts.

Run bookkeeping lives in `public.job_ingestion_runs`: `trigger` (`schedule`, `manual`, `backfill`, `retry`), `status` (`running`, `succeeded`, `partial`, `failed`), `requested_by`, `started_at`, `finished_at`, `duration_ms`, `fetched_count`, `created_count`, `updated_count`, `merged_count`, `skipped_count`, `rejected_count`, `error_code`, `error_message`, and `request_id`.

## How to add a new source

1. **Review the provider first.** Confirm the terms permit Hanaply to store and display the postings, record the required attribution wording, and decide the minimum scan interval. This is an owner action; see [Owner actions](owner-actions.md).
2. **Write the adapter** in `packages/jobs/src/adapters/<code>.ts`. Validate the payload with a Zod schema built on `z.object({...}).catchall(z.unknown())`, use `fetchJson` for transport, and read config through `readConfigString`, `readConfigStringArray`, and `readConfigNumber`. Use `requireCredentials` if the provider needs a secret, and declare the environment variable **names** in `credentialEnvVars`. Bound the batch with `clampLimit(context.limit)`. Return `null` from `normalize` rather than inventing a value. Board-style providers should reuse `packages/jobs/src/adapters/boards.ts`.
3. **Register it** in `packages/jobs/src/adapters/index.ts` by adding it to `jobSourceAdapters` and re-exporting it. `code` must satisfy `^[a-z][a-z0-9_]{2,63}$` because it must match `public.job_sources.code`.
4. **Add a source row** in a new forward-only migration: `code`, `display_name`, `source_kind`, `base_url`, `attribution`, `terms_url`, `requires_credentials`, `credential_env_var`, `min_scan_interval_minutes`, and `requests_per_minute`. Insert it `paused`, and add a value to the `public.job_source_kind` enum if the provider does not fit an existing kind. Do not set `status` in the insert.
5. **Cover it with tests** in `tests/unit/jobs-adapters.test.ts`, following the existing per-adapter normalization cases, injected `createFetchStub`, and a `MissingCredentialError` case for credential-backed adapters.
6. **Document the activation** in this file and add any new environment variable to `.env.example`.
7. **Enable the source** by setting `status = 'active'` only after the attribution, terms, cadence, and credential prerequisites are satisfied and the provider has been reviewed.

## Configuration variables

Read by the worker from the environment; defaults are from `packages/config/src/index.ts`.

| Variable                         | Default                                     | Purpose                                                                                                                |
| -------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `JOB_INGESTION_USER_AGENT`       | `HanaplyBot/1.0 (+https://hanaply.com/bot)` | Sent as `user-agent` on every provider request                                                                         |
| `JOB_INGESTION_TIMEOUT_MS`       | `15000`                                     | Per-request timeout, bounded 1000–60000                                                                                |
| `JOB_STALE_AFTER_HOURS`          | `168`                                       | Passed to `refresh_job_freshness` as `stale_after_hours`                                                               |
| `JOB_EXPIRE_AFTER_HOURS`         | `720`                                       | Passed to `refresh_job_freshness` as `expire_after_hours`                                                              |
| `MATCHING_BATCH_SIZE`            | `25`                                        | Profiles per matching cycle                                                                                            |
| `MATCHING_CANDIDATE_LIMIT`       | `60`                                        | Job candidates scored per profile                                                                                      |
| `MATCHING_STALE_AFTER_HOURS`     | `12`                                        | How old a cached match may be before it is recomputed                                                                  |
| `WORKER_POLL_INTERVAL_MS`        | `5000`                                      | Timer interval for the ingestion, matching, and payment cycles                                                         |
| `WORKER_MAINTENANCE_INTERVAL_MS` | `300000`                                    | Interval for the freshness cycle and subscription maintenance                                                          |
| `JOB_ALERT_WINDOW_MINUTES`       | `30`                                        | Alert window; the window start is part of the queueing idempotency key, so a repeated pass queues nothing new (5–1440) |
| `JOB_ALERT_MINIMUM_SCORE`        | `75`                                        | Minimum match score for an opportunity to be included in an alert (0–100)                                              |
| `DIGEST_MINIMUM_SCORE`           | `55`                                        | Minimum match score for an opportunity to be included in a digest (0–100)                                              |
| `NOTIFICATION_BATCH_SIZE`        | `25`                                        | Rows queued and claimed per notification cycle (1–200)                                                                 |
| `ADZUNA_APP_ID`                  | unset                                       | Adzuna credential, named by `job_sources.credential_env_var`                                                           |
| `ADZUNA_APP_KEY`                 | unset                                       | Adzuna credential                                                                                                      |
| `JOOBLE_API_KEY`                 | unset                                       | Jooble credential                                                                                                      |

`.env.example` ships the three credential variables commented out, with the note that leaving them unset keeps those providers unavailable, which is the default because every catalogued provider starts paused.

The four notification variables narrow what an already-consented subscriber receives; they can never start a new send. Consent and the matching plan entitlement are both required before a row is queued, and delivery additionally needs a configured email provider, which defaults to `disabled`. See [Database and RLS](database.md) for the outbox.

## Related reading

- [Architecture](architecture.md) — where ingestion sits in the system boundary
- [AI and truth gating](ai-and-truth-gating.md) — how an ingested posting becomes a scored match
- [Entitlements](entitlements.md) — how `scanIntervalMinutes` is resolved
- [Testing](testing.md) — the pgTAP and Vitest suites that cover ingestion
