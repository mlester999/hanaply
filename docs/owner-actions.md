# Owner actions

No hosted project, external provider, DNS record, production infrastructure, deployment, Git tag, remote migration, or remote push exists or was performed. Everything below is pending and is not counted as passed.

## Hosted Supabase

1. Create or select an owner-controlled project and approve its region, data residency, plan, backups, PITR, and access ownership.
2. Review all 30 forward migrations and 18 pgTAP suites from the release commit.
3. Link the Supabase CLI only from an owner-controlled shell. Preview migration changes, back up staging, apply them intentionally, regenerate types, and confirm no drift.
4. Configure exact staging and production Site URLs and redirect allowlists for signup and recovery. Remove localhost entries from production-only configuration.
5. Set Auth confirmation on, secure password change on, one-hour OTP expiry, and the reviewed confirmation, recovery, and password-change templates.
6. Create and apply the three private storage buckets (`payment-proofs`, `payment-qr-codes`, `career-documents`) with their size limits and MIME allowlists.
7. Run hosted signup, verify, resend, invalid/expired/reused link, login, refresh, logout, recovery, password change, revocation, suspended-account, and RLS smoke tests.
8. Verify production HTTPS cookie behavior, CORS, CSP, API connectivity, request IDs, and account-state enforcement.

Do not point `pnpm db:reset` at a hosted project. CI must not apply remote migrations.

## Resend and sender DNS

1. Verify an owner-controlled sender domain and publish the required SPF, DKIM, and DMARC records.
2. Select approved From and Reply-To identities and establish bounce and complaint ownership.
3. Store Resend API and SMTP credentials in server and Supabase secret stores; never use `NEXT_PUBLIC_` fields.
4. Configure Supabase Auth custom SMTP to Resend and review hosted template rendering.
5. Keep `EMAIL_ALLOW_LIVE_SENDS=false` until an owner approves sender DNS and hosted test delivery.
6. Validate idempotency, timeout and failure behavior, bounce, complaint and suppression processing, alerting, and key rotation with test recipients only.

## Production configuration and infrastructure

1. Configure HTTPS application and API URLs, exact CORS origins, a strong random `AUTH_RATE_LIMIT_PEPPER` of at least 32 characters, log level, build SHA, Supabase credentials, and provider secrets.
2. Ensure the ingress strips client-supplied forwarding headers and sets the trusted client IP used by web auth throttling.
3. Implement and validate a distributed API rate-limit store. Production startup intentionally fails while `RATE_LIMIT_STORE=memory`.
4. Choose web, API, and worker targets and configure health probes, redacted log retention, metrics and alerts, backups, restore drills, incident ownership, and migration ownership.
5. Keep OpenAPI and `/docs` production exposure disabled unless separately reviewed.
6. Confirm the worker health endpoints `/health` and `/ready` are probed and that a worker restart does not create duplicate scans, given that overlapping scans are already prevented by `job_ingestion_runs_one_running_idx` and `app_private.job_ingestion_locks`.

## First Super Admin

Choose one verified owner identity and follow [Admin bootstrap](admin-bootstrap.md). In summary:

```text
pnpm admin:bootstrap --user <verified-auth-uuid> --confirm ASSIGN_FIRST_SUPER_ADMIN
```

The private shell must set `ADMIN_BOOTSTRAP_ENABLED=true`, `ADMIN_BOOTSTRAP_EMAIL`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY`. Disable and remove them immediately afterward, verify `/v1/admin/me`, and inspect the `admin.bootstrap_completed` audit event. The hosted bootstrap has not been executed.

## Legal, support, and operations

- Have qualified owner and legal reviewers approve Privacy and Terms. The current versions are explicitly engineering drafts.
- Approve support and security contact channels before security emails direct users to them.
- Define account suspension, restoration, disabled, pending-deletion, data export, data deletion, retention, and incident procedures. Export and deletion are not implemented and need an owner decision on scope before they are built.
- Approve audit access and retention, and administrator access reviews.
- Approve the retention and deletion policy for career documents and parsed extractions, including failed parsing and cleanup jobs.

## Job providers

Ingestion code and schema are complete, but every catalogued provider is `paused`, so no posting has been ingested. Nothing here has been reviewed or enabled.

1. For each provider in `public.job_sources` (`remotive`, `arbeitnow`, `hn_algolia`, `adzuna`, `jooble`), read the provider's current terms and confirm that storing full posting text and displaying it to members is permitted.
2. Approve the attribution wording. Each adapter carries an `attribution` string and each source row has an `attribution` column; both must satisfy the provider's requirement before the source is enabled.
3. Record the reviewed `terms_url` on the source row.
4. Approve the cadence limits: `min_scan_interval_minutes`, `requests_per_minute`, and `batch_size`. `min_scan_interval_minutes` is the hard floor the scheduler enforces; `requests_per_minute` is recorded but is not read by any code, so a limit that must be enforced needs a code change.
5. Approve the `JOB_INGESTION_USER_AGENT` string, which is sent on every provider request, and confirm it identifies Hanaply with a working contact URL.
6. Enable a source by setting `public.job_sources.status = 'active'` only after steps 1 to 5 are complete for that provider.
7. Decide whether the `job_dedup_candidates` review queue needs an operator surface. Rows accumulate there with `resolution` null; no page reads them today.

## Adzuna and Jooble credentials

1. Obtain owner-controlled Adzuna API credentials and Jooble partner API credentials under Hanaply's own accounts, not an individual's.
2. Set `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, and `JOOBLE_API_KEY` in the worker environment only. The database stores the variable **name** in `job_sources.credential_env_var`; the value must never be written to the database, logged, or committed.
3. Confirm the credential rotation and revocation procedure with the provider.
4. Note that the Adzuna adapter defaults to the `ph` market when `config.countries` is empty; approve or change the searched markets before enabling it.
5. Confirm that Adzuna's salary values are understood as annualised model estimates, which is how the adapter records them (`salaryPeriod: 'annual'`, `salaryIsEstimate: true`).

## Production queue and worker monitoring

1. Approve what the active worker is allowed to run in production and confirm that `WORKER_MODE=active` is gated on that approval.
2. Decide whether database-side locking and per-poll RPC cycles are sufficient for the expected volume, or whether a production task queue is required. `services/worker/src/queue.ts` provides `TaskQueue`, `retryDelayMilliseconds`, and `isRetryableTaskError`, but no production adapter is selected and the module is not imported by the worker runtime.
3. Approve monitoring for provider health (`job_sources.consecutive_failures`, `circuit_open_until`, `last_error_code`, `total_jobs_ingested`) and for ingestion runs that finish `partial` or `failed`.
4. Approve alerting and a replay or remediation procedure for failed notification outbox rows and failed storage-cleanup rows.
5. Confirm a provider that trips the circuit breaker eight times consecutively lands in `paused` and that an operator is notified, since recovery then requires manual action.

## AI providers

1. Select AI providers and models only after a data-processing, retention, region, cost, egress, and truth-gate review. No provider is selected.
2. Confirm in writing that generated material may only cite `career_facts` rows with `status = 'confirmed'`, and that the permitted moves are to omit a claim, phrase it as transferable experience, ask the member, or record it as a gap.
3. Approve prompt and model version storage, output schema validation, timeout and retry limits, and per-request cost accounting before any live generation is enabled.
4. Approve the review that `validate_match_evidence` and `validate_artifact_evidence` remain the enforcement point, so a provider change cannot widen admissibility.
5. Note that enabling generation changes what the Plus and Pro `coreAiAnalysis`, `advancedAiAnalysis`, `interviewPreparation`, `recruiterMessages`, and `weeklyAiCareerStrategy` entitlement keys actually deliver. Those keys currently resolve but gate nothing.

## Account export and deletion

Nothing is implemented. Before building it, approve the export format and contents, the deletion grace period, what is retained and for how long (audit events, payment records, legal acceptances), and how deletion interacts with the private storage buckets.

## Production release checklist

- `pnpm validate:dockerless` or `pnpm validate:local`, plus `pnpm audit:prod`, from the exact release commit.
- Hosted migration, RLS, Auth, storage, Resend, and security smoke tests pass and the evidence is retained.
- Backups, a restore drill, distributed rate limiting, forwarding-header trust, monitoring, and incident ownership are approved.
- The first owner is securely bootstrapped and audited, and the bootstrap gate is disabled.
- At least one job provider is reviewed and enabled, or the release explicitly ships with an empty radar and says so.
- Legal text, support contacts, sender domain, production URLs, and the rollback or roll-forward plan are approved.
- The owner explicitly authorizes deployment and any remote Git push or tag.

## Release decision

Local implementation is complete for the areas listed in [Roadmap](roadmap.md). The release decision remains conditional until the hosted, provider, monitoring, legal, and deployment gates above pass. No automatic continuation is authorized.
