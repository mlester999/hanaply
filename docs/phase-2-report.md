# Phase 2 report

Date: 2026-08-26 (Asia/Singapore)

Scope: manual-payment activation checkpoint only. Career Profile, resume/portfolio, job ingestion, AI matching, application packs, push, and mobile work were not started.

## Decision

The Phase 2 manual-payment activation checkpoint is implemented locally and all local quality gates pass as of this report. Production release remains conditional on hosted Supabase/Auth/RLS/storage validation, worker operations, Resend/DNS delivery, production networking and rate limiting, owner bootstrap, legal/support approval, backups, monitoring, and deployment authorization.

The broader roadmap entry “Phase 2: activation and career foundation” is not fully complete because the career-foundation items remain intentionally deferred. Phase 3 has not started.

## Implemented lifecycle

- Administrators create, version, enable, disable, and archive PHP manual payment methods with amount limits and effective windows.
- Customers see only currently available public instructions and short-lived signed QR access, create canonical drafts, upload validated proof images, save details, submit, cancel, and resubmit after an information request.
- Proof bytes are re-encoded and stored in private buckets. Metadata is separate from bytes; object paths, scan state, duplicate signals, and reviewer notes are not customer-readable.
- Reviewers claim a 15-minute lock and can request information, reject, or approve. Approval rechecks account state, canonical plan/price, payment method version/availability, proof ownership/state, duplicate references, and the lock in one transaction.
- Approval creates or extends one authoritative subscription and records subscription and entitlement events. Plan changes across tiers or billing periods are not silently applied mid-cycle.
- Authorized operators can record one externally completed refund with explicit access impact, reverse an incorrect approval, and apply an audited, versioned subscription correction.
- Payment/subscription notifications use a service-only, claim-token outbox. The worker queues expiry reminders, delivers allowlisted templates with bounded retries, expires subscriptions, and cleans failed/deferred private objects.
- Payment and subscription lifecycle evidence is append-only or controlled, with privacy-safe customer messages and audited administrative actions.

## Database and security checkpoint

Six forward-only Phase 2 migrations add the payment schema, customer lifecycle, review/subscription lifecycle, RLS and storage boundary, notification delivery, and release hardening. All payment tables have forced RLS. Customer column grants expose only public/owned fields; payment writes and privileged reads use service-only functions that re-check the actor and permission.

The `payment-proofs` and `payment-qr-codes` buckets are private, MIME/size constrained, and have no anonymous or authenticated storage policies. The API validates magic bytes, MIME/extension agreement, dimensions, pixel count, single-page input, and re-encodes images before upload. Signed URLs default to five minutes and are capped at ten minutes. No malware scanner is configured in this checkpoint; `not_configured` is explicit and approval remains a manual reviewer decision.

## Validation

Final local validation:

- `pnpm validate:local` — PASS. This includes `pnpm format:check`, `pnpm lint` (zero errors and warnings), `pnpm typecheck` (25 Turbo tasks plus the test TypeScript project), `pnpm test` (14 files, 125 tests), design-token generation check, `pnpm build` (15 packages), OpenAPI check, secret scan, clean database reset, schema lint, database tests, generated database-type check, and E2E.
- `pnpm db:test` — PASS: 9 files, 278 assertions.
- `pnpm e2e` — PASS: 13 browser scenarios.
- `pnpm audit:prod` — PASS: no known production dependency vulnerabilities.

The formatter was run with `pnpm format`, and the canonical contract was regenerated with `pnpm openapi:generate` before the checks above.

## Remaining risks and owner actions

- Hosted migrations, hosted storage policies, Auth configuration, production URLs/CORS/CSP, distributed API rate limiting, first-owner bootstrap, backups/restore, monitoring, and deployment have not been executed from this local checkpoint.
- Resend sender DNS, custom SMTP, delivery webhooks, bounce/complaint suppression, and production inbox tests remain owner-controlled work.
- Failed notification or storage-cleanup rows require monitoring and an operational replay/remediation procedure.
- Manual payments are recorded evidence only; Hanaply does not initiate or verify a bank/e-wallet transfer automatically.
- Career Profile, resume/portfolio, account export/deletion, job, AI, application-pack, push, and mobile scope remains deferred.
