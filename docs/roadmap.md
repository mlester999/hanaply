# Roadmap

This file describes what exists in the repository today, then what genuinely remains. Status is grounded in `supabase/migrations`, `packages/*/src`, `services/*/src`, and `apps/web/src`.

## Current state

Implementation status by area. "Implemented" means the code, schema, and tests exist locally. Nothing is hosted, and no production release has happened.

| Area                                                                           | Status                                | Evidence                                                                                                                                                              |
| ------------------------------------------------------------------------------ | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Monorepo, tooling, contracts, design system                                    | Implemented                           | `package.json`, `turbo.json`, `packages/contracts`, `packages/design-tokens`                                                                                          |
| Supabase schema, RLS, plans, entitlements, flags, platforms, admin RBAC, audit | Implemented                           | `20260722090000`–`20260722106000`                                                                                                                                     |
| Authentication, sessions, account status                                       | Implemented                           | `packages/auth`, `20260722103000`, `apps/web/src/proxy.ts`, `services/api/src/auth.ts`                                                                                |
| Admin operations                                                               | Implemented                           | `20260722104000`, `services/api/src/controllers.ts`                                                                                                                   |
| Manual payment activation and subscription lifecycle                           | Implemented                           | `20260728090000`–`20260728101000`, `services/api/src/payment.*`, `services/worker/src/payments.ts`                                                                    |
| Career intelligence profile and records                                        | Implemented                           | `20260914090000`, `services/api/src/career.*`, `apps/web/src/app/(customer)/dashboard/career/**`                                                                      |
| Career truth ledger and evidence gating                                        | Implemented                           | `public.career_facts`, `app_private.validate_match_evidence`, `app_private.validate_artifact_evidence`                                                                |
| Career documents, upload, and parsing                                          | Implemented                           | `20260914095000`, `services/api/src/career-files.ts`, `services/api/src/career-extraction.ts`                                                                         |
| Job ingestion and source adapters                                              | Implemented, no source enabled        | `20260915090000`, `packages/jobs`, `services/worker/src/jobs.ts`; all five catalogued providers are `paused`                                                          |
| Multi-signal deduplication and provenance                                      | Implemented                           | `public.upsert_ingested_job`, `public.job_dedup_candidates`, `packages/jobs/src/dedupe.ts`                                                                            |
| Freshness and provider health                                                  | Implemented                           | `public.refresh_job_freshness`, `public.complete_ingestion_run`                                                                                                       |
| Explainable matching engine                                                    | Implemented                           | `packages/matching/src/index.ts`, `20260916090000`, `20260917090000`                                                                                                  |
| Career Radar feed, job detail, save, feedback                                  | Implemented                           | `20260916095000`, `/v1/me/jobs*`, `apps/web/src/app/(customer)/dashboard/radar/**`                                                                                    |
| Application packs, usage metering, tracker data and API                        | Implemented                           | `20260918090000`, `/v1/me/application-packs`, `/v1/me/usage`, `/v1/me/applications`                                                                                   |
| Application pack and tracker web surfaces                                      | Implemented                           | `apps/web/src/app/(customer)/dashboard/packs/**` and `applications/**`, `components/application/**`                                                                   |
| Application artifact generation                                                | Implemented deterministically         | `20260922090000`, `services/api/src/pack-generation.ts`, `POST /v1/me/application-packs/{packId}/generate`; no model is involved                                      |
| Live AI generation                                                             | **Not implemented**                   | `packages/ai/src/index.ts` exports only `DisabledAiProvider`; nothing imports it                                                                                      |
| Account export and deletion                                                    | Not implemented                       | No export route, no deletion route, no deletion worker                                                                                                                |
| Job alerts and digest notifications                                            | Implemented, undeliverable by default | `20260919090000` plus the notification cycle in `services/worker/src/jobs.ts`; delivery needs an email provider, so with the default `EMAIL_PROVIDER` nothing is sent |
| Production queue and worker monitoring                                         | Not implemented                       | `services/worker/src/queue.ts` is not wired into the runtime; only `tests/unit/tasks.test.ts` imports it                                                              |
| Native mobile clients                                                          | Not implemented                       | `platform_settings` seeds `ios` and `android` as `planned`; `/v1/meta` evaluates them                                                                                 |
| Hosted deployment of any kind                                                  | Not performed                         | No hosted project, DNS record, deployment, or remote migration exists                                                                                                 |

The landing-page status copy in `apps/web/src/content/landing.ts` was stale and has been corrected to match the code. Marketing copy is a product surface: a status claim there is a claim about the product, and it must be updated in the same change as the feature it describes.

## Historical phases

### Phase 0: production foundation

Implemented locally. Monorepo and strict tooling, contracts, design system, web/API/worker shells, the Supabase schema with RLS, plans and entitlements, feature flags, platforms, branding, admin RBAC, audit, local validation, and operational documentation. See [Phase 0 report](phase-0-report.md).

### Phase 1: authentication and SaaS core experience

Implemented locally. Registration, email verification and resend, login and logout, password recovery, reset and change, session refresh and revocation, protected customer settings, account-status enforcement, permissioned admin user operations, transactional-email adapters, audit trails, and executable security and accessibility gates. Hosted Supabase, Resend, and production-owner gates remain pending. See [Phase 1 report](phase-1-report.md).

### Phase 2: activation and career foundation

The manual-payment activation checkpoint is implemented locally: manual payment methods and QR instructions, private proof upload and signed access, permissioned review with approve, reject, and request-information outcomes, atomic subscription and entitlement lifecycle, refunds, reversals and corrections, and the database-backed notification and cleanup worker. See [Phase 2 report](phase-2-report.md).

The career-foundation half of the Phase 2 entry is also now implemented, minus the account export and deletion work listed above.

## What genuinely remains

### 1. Generate application artifact content

Implemented deterministically. `services/api/src/pack-generation.ts` assembles all six artifact kinds from the career profile, the confirmed career facts, the posting, and the match snapshot the pack froze at creation; `public.generate_application_pack_artifacts` supplies that context and refuses a pack the caller does not own, and every draft is recorded through `public.record_application_artifact` so the truth gate still decides what may be persisted. A pack cannot be marked ready before it has an artifact.

What is deliberately not done is model-written prose. The generator quotes confirmed facts verbatim and never computes, rounds, or scales a figure, so the same inputs always produce identical drafts. A language model may later paraphrase what this module selects; admissibility stays `career_facts.status = 'confirmed'` either way.

### 2. Approve and enable job providers

Ingestion is complete but idle. Enabling a source requires reviewing its terms and attribution, recording cadence limits, and supplying Adzuna and Jooble credentials. See [Job ingestion](job-ingestion.md) and [Owner actions](owner-actions.md).

### 3. Decide on AI providers

`packages/ai` defines the request, result, usage, and truth-gate types. A provider implementation, model and prompt registry, cost controls, and the acceptance review that goes with live generation do not exist. Nothing changes about the truth gate if a provider is added: admissibility stays `career_facts.status = 'confirmed'`.

### 4. Account export and deletion

No export route, no deletion route, and no deletion worker exist. `profiles.account_status` already has a `pending_deletion` value and the account-state machinery handles it, but nothing produces the export or performs the deletion.

### 5. Deliver opportunity notifications

Job alerts and the digest are implemented end to end in code. `20260919090000_job_alerts_and_digest.sql` adds real consent toggles (`job_alerts`, `daily_digest`, `instant_alerts`, `weekly_strategy`), quiet hours, the `notification_outbox` table, consent-and-entitlement gating in `app_private.notification_allowed`, and the queue, claim, complete, and release functions. `apps/web/src/components/notification-settings-form.tsx` renders all four toggles and both quiet-hours fields. `packages/email` ships `job-alert` and `daily-digest` templates with their required categories, and the notification cycle in `services/worker/src/jobs.ts` resolves each row's category from its template id, delivers through the configured provider, and completes or releases the claim with bounded retries.

What is not done is operational: delivery runs through the email provider, and the shipped default is `EMAIL_PROVIDER=disabled`, so nothing leaves the process until an owner configures and approves Resend and sender DNS. Two smaller gaps remain: `instant_alerts` and `weekly_strategy` are stored preferences with no queue function or template behind them, and browser push is not implemented at all — `browserNotifications` is an entitlement key with no delivery mechanism. `platform_settings` and the `futureMobileAccess` entitlement are seams, not features.

### 6. Production queue and worker monitoring

`services/worker/src/queue.ts` provides `TaskQueue`, `DisabledQueueAdapter`, `InMemoryTaskQueue`, `retryDelayMilliseconds`, and `isRetryableTaskError`, but no production queue adapter is selected and the module is not imported by the worker runtime. Both live workers call Supabase RPCs directly and rely on database-side locking. Selecting a queue, adding dead-letter storage, and approving worker monitoring are owner decisions.

### 7. Native mobile

No React Native client exists. `platform_settings` seeds `ios` and `android` as `planned` for every environment, `/v1/meta` evaluates platform lifecycle, and `@hanaply/contracts` plus its fetch client are DOM-free so a native client can reuse them. See [Mobile readiness](mobile-readiness.md).

### 8. Every hosted gate

Hosted Supabase, Resend and sender DNS, production infrastructure and networking, a distributed rate-limit store, the first Super Admin bootstrap, legal review, deployment, and production smoke validation. None has been performed. See [Owner actions](owner-actions.md).

## How a phase is closed

Each phase requires its own schema and security review, positive and negative tests, observability, operational runbooks, owner actions, and an explicit release decision. The local validation gates are listed in [Testing](testing.md); the owner gates are listed in [Owner actions](owner-actions.md). Local success never proves a hosted gate.
