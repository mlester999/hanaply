# Testing

This document describes every validation command, what it proves, and which gates cannot run without Docker. Everything marked "verified" below was run in this repository with the Dockerless harness; everything marked "not run here" was not.

## Command reference

| Command                    | What it proves                                                                                                                           | Needs Docker                  |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `pnpm validate`            | Formatting, lint, types, unit/integration/component tests, token drift, production build, OpenAPI drift, and secret scanning all pass    | No                            |
| `pnpm validate:dockerless` | `validate`, plus the database is rebuilt from migrations and all pgTAP suites pass against the Dockerless cluster                        | No                            |
| `pnpm validate:local`      | `validate`, plus local Supabase reset, schema lint, pgTAP through the Supabase CLI, generated-type drift, and the browser suite          | Yes                           |
| `pnpm db:harness:reset`    | A throwaway PostgreSQL cluster is rebuilt from the Supabase baseline, every migration, and the seed                                      | No                            |
| `pnpm db:harness:test`     | All 18 pgTAP suites pass against the Dockerless cluster                                                                                  | No                            |
| `pnpm test`                | Unit, component, email, and API integration suites pass                                                                                  | No                            |
| `pnpm e2e`                 | Real browser acceptance, responsive, reduced-motion, keyboard, and Axe checks pass against a live web app, API, Supabase, and local mail | Yes                           |
| `pnpm db:types:check`      | `packages/database/src/generated.types.ts` matches the live schema                                                                       | No, if the harness is running |
| `pnpm openapi:check`       | `packages/contracts/openapi.generated.json` matches the contract registry                                                                | No                            |
| `pnpm secrets:check`       | No committed text file matches a JWT, Supabase service, Resend, or OpenAI credential pattern                                             | No                            |
| `pnpm audit:prod`          | Production dependencies have no known vulnerability at high severity or above                                                            | No                            |
| `pnpm lint`                | Strict flat-config ESLint passes with zero warnings                                                                                      | No                            |
| `pnpm typecheck`           | Every workspace type-checks, then the test tooling project                                                                               | No                            |
| `pnpm build`               | Every workspace builds, including the Next.js standalone production app                                                                  | No                            |

### `pnpm validate`

`package.json` defines it as:

```text
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm tokens:check && pnpm build && pnpm openapi:check && pnpm secrets:check
```

It proves the repository is internally consistent: Prettier formatting, ESLint with `--max-warnings 0`, Turbo type-check tasks plus the separate `tests/tsconfig.json` project, the whole Vitest suite, generated design-token output matching `packages/design-tokens/tokens.json`, a full Turbo build, the checked-in OpenAPI artifact matching `apiContract`, and no credential patterns in tracked text files. It does not touch the database and does not need Docker.

Verified in this repository: yes.

### `pnpm validate:dockerless`

```text
pnpm validate && pnpm db:verify
```

`db:verify` is `db:harness:reset && db:harness:test`. The pair proves everything `validate` proves **and** that the migration chain applies cleanly to an empty database and that all 725 pgTAP assertions pass. This is the complete gate set available without a container runtime.

Verified in this repository: `pnpm validate` components were each run individually and passed; `pnpm db:harness:test` passed with 18 files and 725 assertions.

### `pnpm validate:local`

```text
pnpm validate && pnpm db:reset && pnpm db:lint && pnpm db:test && pnpm db:types:check && pnpm e2e
```

This is the superset. It adds the Supabase CLI database path and the browser suite. It resets the database before pgTAP and the browser tests, so never point the local CLI at a shared or staging project.

Not run here: needs Docker Desktop and local Supabase.

### `pnpm db:harness:reset`

`node tooling/db/local-cluster.mjs reset`. In order, it resolves a port, initializes the cluster if `.localdb/pgdata` has no `PG_VERSION`, starts it, ensures pgTAP is available, drops and recreates the database, applies `tooling/db/supabase-base.sql`, installs the `pgtap` extension, applies every file in `supabase/migrations` in filename order inside a single transaction with `ON_ERROR_STOP=1`, records each in `supabase_migrations.schema_migrations`, and applies `supabase/seed.sql` when it is non-empty.

Verified in this repository: the harness reported `All 18 pgTAP files passed (725 assertions)` after applying the chain, and `db:types:check` passed against it.

### `pnpm db:harness:test`

`node tooling/db/local-cluster.mjs test`. It starts the cluster, ensures pgTAP, requires the database to exist, then runs every `.sql` file in `supabase/tests/database` in sorted order with `psql -v ON_ERROR_STOP=1 -q -tA -f`. Unaligned tuples-only output is used deliberately, because "the default aligned table formatting breaks the TAP grammar". A file passes when `psql` exits zero, no line begins with `not ok`, and the file emitted a TAP plan. You can filter files by passing substrings: `node tooling/db/local-cluster.mjs test 100_job`.

Verified in this repository: yes.

### `pnpm test`

`vitest run --config tooling/vitest.config.ts`. The include list is `tests/unit/**/*.test.{ts,tsx}`, `tests/integration/**/*.test.{ts,tsx}`, and `tests/component/**/*.test.{ts,tsx}`, all in a single `node` environment; `tests/component/ui.test.tsx` opts into jsdom with its own `@vitest-environment jsdom` docblock. There is no Vitest workspace or multi-project configuration. `pnpm test:coverage` runs the same set with the v8 provider, covering `packages/*/src/**` and `services/*/src/**` while excluding `generated.types.ts` and `main.ts`.

Verified in this repository: the whole suite passed when run against the Dockerless harness and a clean checkout. The file count and test count are deliberately not restated here, because the suite grows with the product; run `pnpm test` for the current figure, and treat a reported failure as the accurate signal rather than any number in this document.

Slowest and most relevant suites:

- `tests/unit/jobs-adapters.test.ts` and `tests/unit/job-worker.test.ts` cover the ingestion path end to end with an injected `fetch` stub and a fake RPC client, so they never touch the network.
- `tests/unit/notification-delivery.test.ts` covers the opportunity notification cycle: queueing, consent and entitlement gating, quiet hours, claiming, rendering, completion, and bounded retries.
- `tests/unit/runtime-neutrality.test.ts` asserts that shared packages stay free of browser and Node-only globals, which is what keeps a future mobile client able to reuse them.
- `tests/integration/api.test.ts` and `tests/integration/payments-api.test.ts` build the real Nest application and drive it with `app.inject`, so they exercise guards, validation, envelopes, and rate limiting rather than mocks.

| File                                       | Covers                                                                                                                                                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/unit/auth.test.ts`                  | Redirect sanitization, permission evaluation and role matrix, email normalization and masking, password/registration/profile schemas, account access decisions                                          |
| `tests/unit/config.test.ts`                | Environment parsing for API, worker, email, bootstrap, browser, and web server scopes, including every production rejection                                                                             |
| `tests/unit/email.test.ts`                 | Template rendering for all 19 template ids, action URL rules, disabled/capture/Resend providers, retry classification, live-send gate                                                                   |
| `tests/unit/entitlements.test.ts`          | Deny-by-default evaluation, fail-closed configuration errors, plan/subscription mismatch, expiry                                                                                                        |
| `tests/unit/jobs-adapters.test.ts`         | Per-adapter normalization for all nine adapters, missing-credential handling, transport failures, normalizer helpers, dedupe scoring, and the runner                                                    |
| `tests/unit/job-worker.test.ts`            | The worker cycles over a fake RPC client, lock skipping, partial runs, credential handling, RPC failure reporting                                                                                       |
| `tests/unit/notification-delivery.test.ts` | Opportunity notification queueing, consent and entitlement gating, quiet hours, claiming, rendering, completion, and bounded retries                                                                    |
| `tests/unit/runtime-neutrality.test.ts`    | Shared packages stay free of browser and Node-only globals, which is what keeps mobile reuse possible                                                                                                   |
| `tests/unit/matching.test.ts`              | Tokenization and similarity, score range, verdicts, confidence, weighted dimensions, determinism, unknown dimensions, blockers, requirement mapping                                                     |
| `tests/unit/career-extraction.test.ts`     | Document validation and magic-byte detection, and extraction groundedness — no invented values, verbatim evidence, metrics only with units                                                              |
| `tests/unit/payment-files.test.ts`         | Image validation and sanitization with real `sharp` output, MIME and extension spoof rejection, byte and pixel limits, path generation                                                                  |
| `tests/unit/payment-worker.test.ts`        | Notification claim/deliver/complete, claim release on failure, storage cleanup, dead-letter at the attempt limit                                                                                        |
| `tests/unit/payments.test.ts`              | Annual savings arithmetic, reference normalization, queue query parsing, lifecycle transition matrix, subscription term arithmetic                                                                      |
| `tests/unit/platform.test.ts`              | Feature-flag priority, client-exposure filtering, platform evaluation ordering, semver configuration errors                                                                                             |
| `tests/unit/observability.test.ts`         | Log redaction and correlation-context propagation                                                                                                                                                       |
| `tests/unit/request-integrity.test.ts`     | Same-origin mutation origin acceptance and rejection cases                                                                                                                                              |
| `tests/unit/tasks.test.ts`                 | Task envelope defaults, full-jitter retry delay, retryability classification, in-memory queue dead-lettering, disabled adapter                                                                          |
| `tests/integration/api.test.ts`            | The real Nest app over `app.inject`: health, readiness, version, meta, plans, profile, preferences, sessions, entitlements, admin directory and audit, OpenAPI generation, rate limiting                |
| `tests/integration/payments-api.test.ts`   | Payment methods, subscription, paginated submissions, draft validation and optimistic conflicts, real multipart image upload, proof access, admin permissions, review outcomes, subscription correction |
| `tests/component/ui.test.tsx`              | Accessible `@hanaply/ui` primitives in jsdom: button loading state, dialog keyboard and focus behavior, tabs, switch, dropdown menu                                                                     |

### `pnpm e2e`

`playwright test --config tooling/playwright.config.ts`. One project, Desktop Chrome, `fullyParallel: false`, two workers locally and one in CI, one retry in CI. Two `webServer` entries start the API (`pnpm --filter @hanaply/api dev`, health-checked at `http://localhost:3101/v1/health`) and the web app (`pnpm --filter @hanaply/web dev`, at `http://localhost:3100`), both with `reuseExistingServer: false`. Secrets come from `readLocalSupabaseEnvironment()` in `tests/e2e/local-supabase.ts`, which shells `supabase status -o env`. `globalSetup` clears the mailbox and creates the five deterministic users; `globalTeardown` removes them.

13 scenarios in `tests/e2e/hanaply.spec.ts`:

1. Registration, legal consent, verification, safe link reuse, and login.
2. Generic recovery, password change, session revocation, and rejection of the old password.
3. Dashboard protection plus profile, preference, session, and logout workflows.
4. Suspended-account and normal-user administrator boundaries.
5. Real admin data with audited suspend, restore, and session revocation.
6. Pricing kept on the landing page and an honest Activation Center.
7. Auth plan context and accessible password controls.
8. Release status explanation, keyboard previews, and an accessible FAQ.
9. No horizontal overflow on every required public and authentication route.
10. No horizontal overflow on every required customer route.
11. No horizontal overflow on every required admin route.
12. Reduced motion and keyboard-first navigation.
13. Axe scans and security headers on core routes.

Not run here: needs Docker Desktop, local Supabase, Mailpit, and Chromium.

### `pnpm db:types:check`

`node tooling/db/generate-types.mjs --check` introspects the live catalog directly over `psql` and compares the result with `packages/database/src/generated.types.ts`, normalizing line endings. Drift fails with `Generated database type drift detected. Run pnpm db:types.` The generator resolves its connection from `--db-url`, then `SUPABASE_DB_URL`, then the Dockerless harness's recorded port in `.localdb/port`. It exists because `supabase gen types` needs a container runtime; see the harness section below.

Verified in this repository: yes, against the harness.

### `pnpm openapi:check`

`tsx tooling/openapi-artifact.ts --check` regenerates the OpenAPI 3.1 document from `apiContract` and compares it byte-for-byte, after line-ending normalization, with `packages/contracts/openapi.generated.json`. Drift fails with `OpenAPI artifact drift detected. Run pnpm openapi:generate.` This is what keeps the artifact and the 87-route registry from silently diverging.

Verified in this repository: yes.

### `pnpm secrets:check`

`node tooling/secret-scan.mjs` walks the working tree and scans files with extensions `.css`, `.html`, `.js`, `.json`, `.md`, `.mjs`, `.sql`, `.ts`, `.tsx`, `.yaml`, `.yml`, plus `.env.example`, for three patterns: a Supabase service JWT (`eyJ...` with three dot-separated segments of 20 or more characters), a Resend key (`re_` plus 20 or more alphanumerics), and an OpenAI key (`sk-` plus 20 or more characters). It ignores `.artifacts`, `.git`, `.next`, `.turbo`, `coverage`, `dist`, `node_modules`, `playwright-report`, and `test-results`.

Verified in this repository: yes, `No committed secret patterns detected.`

### `pnpm audit:prod`

`pnpm audit --prod --audit-level high`. It fails on high or critical advisories in production dependencies; moderate advisories are reported without failing the command.

Verified in this repository: exit 0 with three moderate advisories reported.

### `pnpm lint` and `pnpm typecheck`

`pnpm lint` is `eslint . --max-warnings 0`, so a warning is a failure. `pnpm typecheck` is `turbo run typecheck && tsc --noEmit -p tests/tsconfig.json`; the second half is what catches type errors in the test tooling, which Turbo does not own. There is no `lint` task in `turbo.json`, so ESLint runs once over the repository rather than per package.

Verified in this repository: yes, both exit 0.

### `pnpm build`

`turbo run build` builds every workspace, including the Next.js app with `output: 'standalone'`.

Verified in this repository: yes.

## The Dockerless database harness

`tooling/db/local-cluster.mjs` provisions a throwaway PostgreSQL cluster under `.localdb/`, applies a Supabase-compatible platform baseline, runs the forward-only migration chain, seeds development data, and executes the pgTAP suites — with no container runtime. Its header states the reason:

> Docker Desktop and the Supabase CLI are not available in every development or review environment. [...] The Supabase CLI workflow (`pnpm db:start`, `pnpm db:reset`, `pnpm db:test`) remains the canonical local workflow. This harness exists so that the same SQL can be verified in environments where Docker is unavailable, and so CI can gate migrations and RLS without a container daemon.

### Layout and requirements

| Item       | Value                                                                                                                                          |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| State dir  | `.localdb/`                                                                                                                                    |
| Data dir   | `.localdb/pgdata`                                                                                                                              |
| Extensions | `.localdb/pg-extensions/extension`                                                                                                             |
| Log        | `.localdb/postgres.log`, with a harness trace in `.localdb/harness.log`                                                                        |
| Port       | `HANAPLY_LOCAL_DB_PORT`, default `55433`, recorded in `.localdb/port` and incremented if busy                                                  |
| Database   | `HANAPLY_LOCAL_DB_NAME`, default `hanaply`, owned by superuser `postgres`                                                                      |
| Binaries   | `initdb`, `pg_ctl`, `psql`, `createdb`, `dropdb` from `HANAPLY_PG_BIN`, a `PostgreSQL` install directory, a platform candidate path, or `PATH` |

The cluster is initialized with `initdb -D .localdb/pgdata -U postgres --encoding=UTF8 --locale=C --auth-local=trust --auth-host=trust` and listens on `127.0.0.1` only. `postgresql.auto.conf` disables `fsync`, `synchronous_commit`, and `full_page_writes` because the cluster is disposable, and sets `log_min_messages = warning`.

Commands: `start`, `stop`, `status`, `reset`, `migrate`, `test`, `seed`, `demo`, `psql`, `url`, and `destroy`, exposed as `pnpm db:harness`, `db:harness:reset`, `db:harness:test`, `db:harness:stop`, `pnpm db:demo`, and `db:verify`. `pnpm db:demo` applies `tooling/db/demo-data.sql`, which inserts five synthetic Philippines and Singapore postings through the real `upsert_ingested_job` path so the radar has something to rank; it is deliberately not part of `supabase/seed.sql`, because every `db reset` applies that file and the pgTAP suites assert on real counts. `node tooling/db/local-cluster.mjs url` prints a connection string.

### `tooling/db/supabase-base.sql`

This is a test harness baseline and is never applied to a Supabase project; hosted environments already provide these objects. It creates the platform roles (`anon`, `authenticated`, `service_role` with `bypassrls`, `authenticator`, `supabase_auth_admin`, `supabase_storage_admin`, `supabase_admin`, `dashboard_user`, `pgbouncer`), the schemas (`extensions`, `auth`, `storage`, `graphql`, `graphql_public`, `supabase_migrations`), the `pgcrypto`, `pg_trgm`, `unaccent`, `btree_gin`, and `citext` extensions, the `auth` tables (`users`, `identities`, `sessions`, `refresh_tokens`, `instances`, `audit_log_entries`), the `auth` claim helpers `auth.jwt()`, `auth.uid()`, `auth.role()`, and `auth.email()`, the `storage.buckets` and `storage.objects` tables, the `storage.foldername()`, `storage.filename()`, and `storage.extension()` helpers, and the `supabase_migrations.schema_migrations` bookkeeping table the harness writes to.

The claim helpers are what make RLS testable: a pgTAP suite impersonates a caller with `set local role authenticated; set local request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}';`, and `auth.uid()` resolves from there.

### How pgTAP is provisioned through `extension_control_path`

The harness does not install pgTAP into the PostgreSQL share directory, because that directory belongs to the PostgreSQL installation. Instead it writes one line into `postgresql.auto.conf`:

```text
extension_control_path = '$system;<absolute path to .localdb/pg-extensions>'
```

On Windows the separator is `;`; elsewhere it is `:`. The source comment explains why `$system` must be listed explicitly: "setting extension_control_path replaces the built-in extension directory instead of appending to it."

PostgreSQL resolves extension control files as `<path>/extension/<name>.control`, so the harness creates `.localdb/pg-extensions/extension` and populates it with `pgtap.control` and `pgtap--1.3.4.sql`.

Those two files are produced from the upstream release. `ensurePgtap()` downloads `https://github.com/theory/pgtap/releases/download/v1.3.4/pgTAP-1.3.4.zip` (pgTAP 1.3.4), reads the archive with a hand-written ZIP reader (stored and deflate entries only), extracts `pgtap.control` and `sql/pgtap.sql.in`, checks that the control file declares `module_pathname`, and then "Mirrors the upstream Makefile: copy pgtap.sql.in, then substitute the OS name and the numeric major.minor version. The 9.x compatibility patches are intentionally skipped because this harness targets PostgreSQL 17+." The substitutions are `MODULE_PATHNAME` → `pgtap`, `__OS__` → `windows` or `unix`, and `__VERSION__` → the numeric major.minor version.

`installPgtap()` then runs `create extension if not exists pgtap with schema extensions` and fails with `pgTAP could not be registered through extension_control_path.` if that does not work.

The net effect is that `create extension pgtap` resolves to a locally generated control file with no container, no `pgxn`, and no writes outside `.localdb/`. The harness needs network access once, on the first run, to fetch the archive; after that the control file is cached.

## pgTAP suites

`supabase/tests/database` holds 14 suites. Assertion counts are the `select plan(N);` value in each file.

| File                                      | Assertions | Subject                                                                                                                 |
| ----------------------------------------- | ---------: | ----------------------------------------------------------------------------------------------------------------------- |
| `00_schema.test.sql`                      |         18 | Core tables, enums, and helper functions exist                                                                          |
| `10_catalog.test.sql`                     |         22 | The plan, entitlement, role, permission, flag, platform, and branding catalogs                                          |
| `20_rls.test.sql`                         |         29 | RLS enablement, forced RLS, and cross-role read boundaries                                                              |
| `30_admin_bootstrap.test.sql`             |         10 | First-Super-Admin bootstrap atomicity, email binding, and single-audit-event behavior                                   |
| `40_audit_lifecycle.test.sql`             |          3 | Audit rows are append-only, with the narrow actor-anonymization exception                                               |
| `50_phase1_identity.test.sql`             |         31 | Profiles, legal acceptances, preferences, authentication events, status history, and suspensions                        |
| `60_phase1_admin_operations.test.sql`     |         24 | Admin overview, directory, detail, account actions, session revocation, and audit directory                             |
| `70_phase2_payment_lifecycle.test.sql`    |         90 | Payment methods, drafts, proofs, submission and review transitions, activation, refunds, reversals, corrections, expiry |
| `80_phase2_payment_privacy.test.sql`      |         51 | Forced RLS, column privacy, private buckets, resolver authorization, and direct-write rejection                         |
| `90_career_intelligence_profile.test.sql` |         83 | Career profiles, records, sub-career limits, the fact ledger, decisions, completeness, and documents                    |
| `100_job_ingestion.test.sql`              |         78 | Sources, scheduling, locks, upsert and deduplication signals, provenance, freshness, and entitlements                   |
| `110_career_radar.test.sql`               |         49 | Saved jobs, feedback, match persistence, the evidence trigger, and the radar and detail read models                     |
| `120_application_packs.test.sql`          |         54 | Usage metering and idempotency, pack creation, artifact truth gating, the tracker, and the timeline                     |
| `130_notifications.test.sql`              |         40 | Notification consent and entitlement gating, quiet hours, the outbox, idempotent queueing, and claim/complete/release   |
| `140_admin_job_operations.test.sql`       |         42 | Provider governance, ingestion health, the job directory, and deduplication diagnostics                                 |
| `150_career_insights.test.sql`            |         32 | Insight rates that are null rather than zero, and coaching that carries the count behind it                             |
| `160_cross_user_isolation.test.sql`       |         50 | Adversarial cross-user reads and writes across every customer table                                                     |
| `170_pack_generation.test.sql`            |         19 | Generation ownership, the frozen evidence set, and refusing to mark a pack ready with no artifact                       |

**Total: 725 assertions across 18 files.**

Verified in this repository: all 18 files passed, 725 of 725 assertions.

## What needs Docker

Docker Desktop is required for exactly these gates, and they cannot run in a container-less environment:

| Gate                        | Why                                                                                            |
| --------------------------- | ---------------------------------------------------------------------------------------------- |
| `pnpm db:start` / `db:stop` | The Supabase CLI starts its own container stack                                                |
| `pnpm db:reset`             | Supabase CLI migration application                                                             |
| `pnpm db:lint`              | `supabase db lint --local --level error` runs against the CLI's local database                 |
| `pnpm db:test`              | `supabase test db` runs pgTAP inside the CLI's database                                        |
| `pnpm e2e`                  | Playwright needs real Supabase Auth, Storage, and the local mail catcher that the CLI provides |
| `pnpm validate:local`       | It composes the five commands above                                                            |

Two further notes:

- The Dockerless harness provisionally covers `db:reset` and `db:test` through `db:harness:reset` and `db:harness:test`, and `db:types:check` works against it. It does **not** cover `db:lint` (that is a Supabase CLI linter), Supabase Auth, Supabase Storage, or the mail catcher, so `pnpm e2e` has no Dockerless equivalent.
- `.github/workflows/ci.yml` does **not** use the harness. It installs `supabase/setup-cli@v1` at version 2.109.1 and runs `pnpm validate`, `pnpm audit:prod`, `pnpm db:start`, `pnpm db:reset && pnpm db:lint`, `pnpm db:test && pnpm db:types:check`, then `pnpm e2e` on chromium. A container-less CI would need `pnpm validate:dockerless` instead, and would have to drop the browser suite.

## Not verified

The following are asserted nowhere in this repository and should not be treated as proven:

- Hosted Supabase behavior of any kind: migrations, RLS, Auth configuration, storage policies, redirects, or cookies.
- Resend delivery, sender DNS, bounce and complaint handling, and suppression.
- Production networking, CORS, CSP, HSTS, forwarding-header trust, and distributed rate limiting.
- `pnpm db:lint`, `pnpm e2e`, and `pnpm validate:local` in this repository, because Docker Desktop is not available here. Their commands, configuration, and prerequisites were read from source, not executed.
- `pnpm audit:prod` reports three moderate production advisories without failing. Whether those advisories affect a deployed build has not been assessed.
