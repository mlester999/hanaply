# Owner actions

No hosted project, external provider, production infrastructure, deployment, Git tag, or remote push was changed during Phase 0 implementation.

## Before a hosted staging environment

1. Create or select an owner-controlled Supabase project and record its region, project reference, and data-residency decision.
2. Review every migration and RLS test, link the Supabase CLI intentionally, apply migrations to staging, regenerate types, and rerun the hosted smoke suite.
3. Configure staging application/API HTTPS URLs, CORS origins, Supabase redirect allowlists, and secret-manager values. Never place the service key in a `NEXT_PUBLIC_` variable.
4. Implement a distributed API rate-limit store. Production API configuration intentionally rejects the Phase 0 memory store.
5. Choose deployment targets for web, API, and idle worker; configure health probes, log retention/redaction, alerting, backups, PITR, and migration ownership.
6. Have the owner/legal reviewer approve privacy and terms text.

## First Super Admin

Choose and verify the owner user's Supabase Auth UUID. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in a private server shell or secret-backed job, then run:

```text
pnpm admin:bootstrap --user <verified-auth-uuid> --confirm ASSIGN_FIRST_SUPER_ADMIN
```

The RPC requires the service role, an exact confirmation phrase, and an existing Auth user. It atomically creates/activates membership, assigns the expanded Super Admin role, and appends an audit event. A same-user retry is idempotent; a different second bootstrap is rejected. Do not paste the service key into the command line, chat, issue tracker, or CI log.

Afterward, remove the temporary shell secret, sign in through the admin route, verify `/v1/admin/me`, and review the audit event. Add later admins only through a permission-gated management workflow, not by editing JWT metadata.

## Resend and email

Phase 0 contains only the adapter contract. Before enabling email:

1. Verify a sending domain and required DNS records in the owner Resend account.
2. Implement and review a `ResendEmailProvider` with category/template versions, idempotency keys, bounded timeout/retry behavior, suppression handling, and safe receipts.
3. Store `RESEND_API_KEY` in the server/worker secret manager and configure an approved from address.
4. Add integration tests against a safe test mode and monitoring for bounce/complaint rates.
5. Keep document contents, tokens, and private records out of logs and delivery metadata.

## AI, queue, storage, and mobile

- Select providers and models only after data-processing, retention, region, cost, and safety review. Implement secrets/egress, output schemas, prompt versioning, and Truth Gate enforcement before any live call.
- Select a production queue and distributed idempotency/dead-letter store before enabling active worker mode.
- Approve the private bucket, MIME/signature policy, quarantine scanner, retention/deletion policy, and isolated preview design before uploads.
- Approve Keychain/Keystore storage, device/push-token encryption, Universal/App Links, and platform privacy requirements before mobile work.

## Production release checklist

- Hosted reset-equivalent migration verification, RLS/pgTAP, backups, and restore drill.
- Production secrets and URLs validated; no wildcard CORS; docs exposure intentionally configured.
- Distributed rate limiter operational.
- First admin securely bootstrapped and audited.
- `pnpm validate:local` and production smoke tests pass from the release commit.
- Dependency audit and secret scan clean at the configured severity.
- Monitoring, incident ownership, support contacts, legal text, and rollback plan approved.
- Owner explicitly authorizes deployment and remote Git push/tag.
