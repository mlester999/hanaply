# Security and storage

## Threat model

Protected assets include Supabase credentials/sessions, identity and legal records, subscriptions/entitlements, admin authority, audit evidence, email links, and future private documents. Relevant adversaries include unauthenticated internet clients, compromised normal accounts, malicious or mistaken administrators, credential-stuffing automation, hostile email links, untrusted upstream content, and leaked server credentials.

The principal boundaries are browser to Next.js, web/API to Supabase, normal user to admin, RLS caller to service role, and local capture to live providers. Client state, query parameters, JWT metadata, plan codes, and provider responses are untrusted input.

## Authentication threats

- Supabase Auth is the sole password store; Hanaply has no parallel credential table.
- Shared Zod rules normalize email and enforce bounded passwords without blocking paste or password managers.
- Registration and recovery responses avoid account-enumeration distinctions.
- Registration, login, verification resend, recovery, reset, profile, session, search, and admin actions use persistent database-backed buckets where implemented. Hash keys combine a production pepper with source/subject context; raw addresses and emails are not stored in the limiter.
- Login permits 10 attempts per 15 minutes. Other bucket limits are defined in the forward migration and tested with allowed/denied calls.
- Production ingress must strip untrusted forwarding headers and set the canonical client address. Otherwise source-address limiting can be spoofed.
- Supabase Auth confirmation and recovery tokens are single-use/expiring. Invalid and reused callbacks resolve to safe states.
- Verification/recovery action URLs use exact configured origins and HTTPS outside loopback development.

## Session threats

- Web sessions use Supabase SSR cookies; the API accepts bearer tokens only.
- Next.js Proxy refreshes cookies and performs optimistic redirects, while server layouts and API guards repeat authoritative checks.
- API bearer validation uses Supabase `getClaims`, requires `sub` and `session_id`, enforces account status, and confirms that the refresh session still exists in `auth.sessions`.
- Safe session summaries exclude tokens. Users can revoke other sessions; admins with explicit authority can revoke all target sessions.
- Normal logout clears the local session, reset signs out globally, and password change reauthenticates then revokes other sessions.
- Access/refresh tokens, cookies, auth codes, OTP hashes, recovery URLs, and signed URLs are redacted from logs and forbidden in audit/email receipts.

## CSRF, redirects, and browser controls

Same-origin server actions compare Origin, Host, and the configured application origin before registration, login/logout, recovery/reset, settings, password, and admin mutations. The bearer-only API creates no cookie-authenticated API CSRF surface. Supabase SSR preserves secure cookie options; production cookies require HTTPS.

Redirect sanitization accepts only same-origin relative paths and rejects schemes, protocol-relative values, backslashes, malformed URLs, and control characters.

Every page receives a per-request CSP nonce with restricted scripts, explicit API/Supabase `connect-src`, no objects, same-origin forms, and `frame-ancestors 'none'`. Production adds HSTS and upgrade-insecure-requests. Referrer policy, Permissions Policy, and `nosniff` are tested in Playwright.

## Authorization and admin escalation

- Account status, membership, roles, permissions, plans, and entitlements come from PostgreSQL, never JWT metadata or browser claims.
- Admin routes require an active membership plus explicit expanded permissions. Permission-aware navigation is cosmetic; API and database functions re-check authority.
- Normal users cannot read admin tables/audit events, create memberships, assign roles, alter account status, or mutate subscriptions.
- State-changing admin functions require an actor UUID, independently verify permission, reject self-status changes, protect the final active Super Admin, require an audited reason, and are rate-limited.
- First-admin bootstrap is disabled by default, bound to an environment email and verified Auth UUID, service-only, exact-confirmation gated, atomic, idempotent for the same owner, and audited.

## API controls

The NestJS/Fastify API uses Helmet, explicit non-credentialed CORS, a 256 KiB body limit, Zod input/output validation, safe versioned envelopes, UUID request IDs, and structured redacted logging. Validation/provider exceptions are mapped to allowlisted client messages.

Local/test API throttling is in memory. Production startup intentionally fails until a distributed rate-limit adapter is selected and `RATE_LIMIT_STORE` no longer uses memory. Wildcard CORS and insecure production application/API URLs fail environment validation. OpenAPI/docs are unavailable in production regardless of the local flag.

## Database and service-role controls

RLS is enabled and forced on every exposed table. Broad grants are revoked before narrow column/function grants are applied. Security-definer functions use fixed empty search paths and schema-qualified names. Append-only authentication, status, and audit records reject updates/deletes.

Service-role credentials exist only in API/bootstrap/test server processes. No public endpoint proxies arbitrary service-role requests. Privileged admin functions still verify the supplied actor's database permission. The service key is rejected by browser schemas and must reside in a secret manager.

## Email-link and delivery security

Supabase Auth owns verification/recovery token generation. Local SMTP is Mailpit only. Live Resend delivery requires an explicit provider, live-send gate, sender, API key, non-local environment, safe URL, idempotency key, timeout, and bounded retry policy.

Delivery receipts mask recipients and omit body, action URL, token, and provider error details. Password-change and security messages cannot be disabled through marketing preferences. Hosted Resend SMTP, DNS, redirect, expiry/reuse, bounce, and complaint behavior remain pending owner validation.

## Audit events

Authentication, logout, profile, preference, account status, session revocation, admin action, and bootstrap events use allowlisted action names and safe actor/target/request context. Before/after/metadata values are sanitized and must never contain request bodies, passwords, tokens, document contents, payment evidence, or private URLs.

Audit rows are append-only. Auth-user deletion may null the actor foreign key through a narrowly validated FK path while preserving the event. Admin audit responses return a redacted allowlist and require `audit.read`.

## Secrets and observability

- One ignored root `.env.local`; one placeholder-only `.env.example`.
- Separate browser, server, worker, email, and bootstrap schemas; browser output contains only public keys.
- Production requires HTTPS URLs, strong rate-limit pepper, Resend mode, live-send confirmation, and a distributed API limiter.
- Pino includes service/environment and AsyncLocalStorage request/task context.
- Redaction covers authorization/cookies, tokens, keys, URLs, documents, resumes, cover letters, payment content, profiles/private records, and provider credentials.
- The secret scanner checks committed source/document formats for JWT, Supabase service, Resend, and OpenAI patterns while excluding generated caches.

## Future private document storage

Phase 1 creates no bucket or upload route. A later document system must implement:

- A private bucket such as `user-documents-private`, never a public bucket.
- Random `{userUuid}/{randomUuid}/{randomUuid}.{validatedExtension}` paths with no identity/title data.
- Server-issued authorization and signed preview/download URLs targeted at five minutes or less.
- MIME allowlists plus server-side magic-byte verification; client filename/type is not evidence.
- Explicit size and image decompression/dimension limits with metadata/EXIF removal.
- Quarantine, asynchronous malware scanning, versioned results, and service-only release/review.
- Per-user RLS/service mediation, isolated previews, safe download headers, and audited status IDs only.

## LLM and external-content boundary

External pages, documents, job descriptions, and model output remain untrusted data and cannot enter trusted instructions directly. Provider contracts separate instructions from source content and reserve prompt/model versions, output schemas, cost/token metadata, timeout/retry controls, verified facts, and Truth Gate results.

No live model call exists. Future providers require secret management, egress controls, retention/data-region review, output validation, and completed Truth Gate acceptance.

## Release gates and residual work

Mandatory local gates are clean migrations, schema lint, pgTAP/RLS, generated-type drift, formatting, lint, strict types, unit/API/component tests, production builds, OpenAPI/token drift, secret scan, dependency audit, and Playwright auth/admin/responsive/reduced-motion/Axe checks.

Hosted Supabase/Resend, ingress forwarding-header trust, production cookie/CORS/CSP behavior, first-owner bootstrap, distributed API limiting, backups/restore, monitoring, legal approval, and production smoke tests are owner gates. They must be marked pending until executed; local success does not prove them.
