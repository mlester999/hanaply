# Owner actions

No hosted project, external provider, DNS record, production infrastructure, deployment, Git tag, remote migration, or remote push was changed during this local Phase 2 activation checkpoint. The following hosted and owner-controlled gates are pending and are not counted as passed.

## Hosted staging Supabase

1. Create/select an owner-controlled project and approve its region, data residency, plan, backups, PITR, and access ownership.
2. Review all 19 forward migrations and nine pgTAP files from the release commit.
3. Link the Supabase CLI only from an owner-controlled shell. Preview migration changes, back up staging, apply them intentionally, regenerate types, and confirm no drift.
4. Configure exact staging/production Site URLs and redirect allowlists for signup and recovery. Remove localhost entries from production-only configuration where appropriate.
5. Set Auth confirmation on, secure password change on, one-hour OTP expiry, and the reviewed confirmation/recovery/password-change templates.
6. Run hosted signup, verify, resend, invalid/expired/reused link, login, refresh, logout, recovery, password change, revocation, suspended-account, and RLS smoke tests.
7. Verify production HTTPS cookie behavior, CORS, CSP, API connectivity, request IDs, and account-state enforcement.

Do not point `pnpm db:reset` at a hosted project. CI must not apply remote migrations.

## Resend and sender DNS

1. Verify an owner-controlled sender domain and publish required SPF/DKIM/DMARC records.
2. Select approved From/Reply-To identities and establish bounce/complaint ownership.
3. Store Resend API/SMTP credentials in server and Supabase secret stores; never use `NEXT_PUBLIC_` fields.
4. Configure Supabase Auth custom SMTP to Resend and review hosted template rendering.
5. Keep `EMAIL_ALLOW_LIVE_SENDS=false` until an owner approves sender DNS and hosted test delivery.
6. Validate idempotency, timeout/failure behavior, bounce/complaint/suppression processing, alerting, and key rotation with test recipients only.

## Production configuration and infrastructure

1. Configure HTTPS application/API URLs, exact CORS origins, a strong random `AUTH_RATE_LIMIT_PEPPER`, log level, build SHA, Supabase credentials, and provider secrets.
2. Ensure the ingress strips client-supplied forwarding headers and sets the trusted client IP used by web auth throttling.
3. Implement and validate a distributed API rate-limit store. Production intentionally rejects `RATE_LIMIT_STORE=memory`.
4. Choose web/API/idle-worker targets and configure health probes, redacted log retention, metrics/alerts, backups, restore drills, incident ownership, and migration ownership.
5. Keep OpenAPI/docs production exposure disabled unless separately reviewed.

## First Super Admin

Choose one verified owner identity and follow [Admin bootstrap](admin-bootstrap.md). In summary:

```text
pnpm admin:bootstrap --user <verified-auth-uuid> --confirm ASSIGN_FIRST_SUPER_ADMIN
```

The private shell must set `ADMIN_BOOTSTRAP_ENABLED=true`, `ADMIN_BOOTSTRAP_EMAIL`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY`. Disable/remove them immediately afterward, verify `/v1/admin/me`, and inspect `admin.bootstrap_completed`. The hosted bootstrap has not been executed.

## Legal, support, and operations

- Have qualified owner/legal reviewers approve Privacy and Terms; current versions are explicitly engineering drafts.
- Approve support/security contact channels before security emails direct users to them.
- Define account suspension, restoration, disabled/deletion, data export/deletion, retention, and incident procedures.
- Approve audit access/retention and administrator access reviews.

## Phase 2 manual-payment release

1. Deploy the six Phase 2 migrations to an owner-controlled staging project after backup/PITR review; regenerate database types and run the hosted RLS/payment smoke suite.
2. Create and verify the approved payment methods, effective windows, amount limits, public instructions, and private QR images. Confirm that old method snapshots remain unchanged on existing submissions.
3. Exercise the full hosted path with a controlled test account: draft, proof upload, submit, review lock, request-information/resubmit, reject, approve, subscription/entitlement evaluation, renewal, refund, reversal, correction, expiry, and duplicate/idempotent retry behavior.
4. Configure an active worker target with database-outbox access, health probes, bounded notification/storage-cleanup retries, failed-row alerting, and an operational replay/remediation procedure.
5. Configure owner-approved Resend SMTP/API delivery, templates, sender DNS, bounce/complaint monitoring, suppression handling, and test inboxes. Keep live sends disabled until evidence is approved.
6. Confirm retention/deletion ownership for payment proof bytes and metadata, including failed cleanup jobs and incident response. Do not enable career documents, jobs, AI matching, or mobile clients as part of this checkpoint.

## AI, future queue, future documents, notifications, and mobile

- Select AI providers/models only after data-processing, retention, region, cost, egress, and Truth Gate review.
- Select a production queue and distributed idempotency/dead-letter store before active worker mode for future job/AI consumers. Phase 2 payment maintenance uses the database outbox and still needs production monitoring.
- Approve private career-document buckets, MIME/signature validation, quarantine scanning, retention/deletion, and isolated previews before uploads.
- Approve Keychain/Keystore storage, device and encrypted push-token lifecycle, Universal/App Links, platform privacy declarations, and mobile threat tests before React Native work.
- Implement non-authentication email/browser/push delivery only in its approved future phase.

## Production release checklist

- Local `pnpm validate:local`, `pnpm audit:prod`, secret scan, and generated artifacts pass from the exact release commit.
- Hosted migrations/RLS/Auth/Resend/security smoke tests pass and evidence is retained.
- Backups, restore drill, distributed limiting, forwarding-header trust, monitoring, and incident ownership are approved.
- First owner is securely bootstrapped and audited; bootstrap gate is disabled.
- Legal text, support contacts, sender domain, production URLs, and rollback/roll-forward plan are approved.
- Owner explicitly authorizes deployment and remote Git push/tag.

## Phase 2 approval

The manual-payment activation checkpoint is implemented locally and all local validation gates must pass from the release commit. The release decision remains conditional until hosted Supabase/RLS, payment storage retention, worker monitoring, Resend/DNS, production configuration, first-owner bootstrap, legal, and deployment gates pass. Career Profile, resume/portfolio, job, AI matching, and mobile work are explicitly outside this checkpoint; no automatic continuation is authorized.
