# Email operations

## Delivery ownership

Supabase Auth owns signup confirmation, password recovery, and password-change security notifications. Locally its SMTP sink is Mailpit. In hosted environments, Supabase Auth must use the owner-controlled Resend custom SMTP configuration so Auth retains one-time-token ownership while Resend performs transport.

`@hanaply/email` supplies application-owned transactional delivery for future account messages. It includes:

- `DisabledEmailProvider`, which validates and returns an honest disabled receipt.
- `CaptureEmailProvider`, which stores rendered messages only in process memory for tests.
- `ResendEmailProvider`, which calls the official SDK only when every live-send gate passes.

No live email was sent during implementation or validation.

## Templates and categories

Version `v1` templates are `verify-email`, `password-reset`, `password-changed`, `welcome`, and `security-alert`. Every template has responsive, image-independent HTML and a plain-text fallback. Template/category combinations are allowlisted; action links require HTTPS except for loopback local development.

Supabase Auth templates live in `templates/confirmation.html`, `templates/recovery.html`, and `supabase/templates/password-changed.html`. Hosted copies must be reviewed after upload because hosted Auth configuration is not changed by local migrations.

Authentication and security notifications are mandatory. Optional product/marketing preferences do not suppress verification, recovery, password-change, or security alerts. Non-authentication notification delivery remains outside Phase 1.

## Provider safety gates

The actual environment names are:

```text
EMAIL_PROVIDER=disabled|capture|resend
EMAIL_ALLOW_LIVE_SENDS=true|false
RESEND_API_KEY=
RESEND_FROM_ADDRESS=
RESEND_REPLY_TO_ADDRESS=
RESEND_REQUEST_TIMEOUT_MS=8000
```

`resend` requires an API key, validated sender address, and explicit `EMAIL_ALLOW_LIVE_SENDS=true`. It is rejected in `local` and `test`, and production rejects disabled/capture mode. Browser environment parsing never exposes these fields.

Messages require a safe opaque idempotency key. Resend receives that key plus category/template/version tags. Delivery uses an 8-second default timeout, up to three attempts by default, full-jitter exponential delays capped at two seconds, and retries only transport failures, timeouts, HTTP 429, and 5xx responses. Permanent provider rejection fails immediately.

Receipts contain only provider, safe status, provider message ID, template/version, masked recipient, attempt count, and a small failure code. They exclude action URLs, message bodies, tokens, API keys, and raw provider errors.

## Local testing

Start Supabase and visit Mailpit at `http://127.0.0.1:54324`. Playwright clears the mailbox, registers or recovers a `@hanaply.test` address, waits for the expected subject, extracts the one-time link, and completes the browser flow. It never sends to a public mailbox.

Vitest covers HTML/plain text, safe links, category validation, missing credentials, invalid sender/live-send configuration, disabled/capture modes, timeout/retry behavior, provider rejection, idempotency propagation, masked receipts, and secret-safe errors.

## Failure handling

Authentication forms return generic messages and do not expose whether an address exists. Provider failures are not logged verbatim. A failed production send must emit a redacted operational event and retain only allowlisted delivery metadata; storing tokenized action URLs in `email_delivery_events` is prohibited.

The current database includes a protected delivery-event foundation, but no Phase 1 web route writes arbitrary application email. Provider webhooks, bounce/complaint processing, suppression lists, and retry queues remain future operational work.

## Hosted Resend owner actions

1. Add and verify an owner-controlled sending domain in Resend; publish SPF/DKIM and any required DMARC records.
2. Choose approved From and Reply-To addresses. Do not use a public consumer mailbox as the sender.
3. Store the Resend key and SMTP credentials in the hosted secret managers, never `.env.local`, CI output, or Supabase client variables.
4. Configure Supabase Auth custom SMTP with Resend and upload/review all three Auth templates.
5. Add exact production/staging redirect URLs in Supabase Auth.
6. Run hosted signup, resend, recovery, password-change, expiration/reuse, and mobile-email rendering tests using owner-controlled test inboxes.
7. Configure bounce/complaint monitoring, suppression handling, alerting, and key rotation.
8. Keep `EMAIL_ALLOW_LIVE_SENDS=false` until the sender domain and hosted smoke suite are approved.

Until these steps pass, email readiness is local-only and the release decision remains conditional.
