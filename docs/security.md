# Security and storage

## Threat model

Protected assets include Supabase credentials/sessions, identity and legal records, subscriptions/entitlements, manual payment references and proof images, payment QR instructions, admin authority, audit evidence, email links, and future private documents. Relevant adversaries include unauthenticated internet clients, compromised normal accounts, malicious or mistaken administrators, credential-stuffing automation, hostile email links, untrusted upstream content, and leaked server credentials.

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
- Payment method administration, review locks, approval, refunds, reversals, and subscription corrections require explicit database permissions and server-side optimistic versions/locks; proof access additionally requires `payments.review`.
- Customer payment actions use active-account checks and controlled RPCs. A payment submission cannot create a subscription or entitlement until the atomic approval function succeeds.

## API controls

The NestJS/Fastify API uses Helmet, explicit non-credentialed CORS, a 256 KiB JSON body limit plus one 8 MiB-or-smaller multipart image, Zod input/output validation, safe versioned envelopes, UUID request IDs, and structured redacted logging. Validation/provider exceptions are mapped to allowlisted client messages. Payment images are checked against magic bytes, declared MIME type, filename extension, dimensions, pixel count, and single-page limits, then re-encoded before storage.

## API rate limiting

Every API route is limited, and the bucket is chosen from what the request can prove rather than from the address it arrives on. The web application calls the API server-to-server with the member's access token, so keying on the address gave every member one shared allowance: one member's burst answered 429 to unrelated members. That shared bucket no longer exists.

- An authenticated route is keyed by the user id from the verified session — the token is checked against Supabase, the session's liveness and the account's status are read from PostgreSQL — so one member's traffic cannot spend another member's allowance.
- A public route is keyed by client address, the correct scope when there is no identity to key on.
- An authentication route that takes a submitted identifier is keyed by the address _and_ the identifier, so one account cannot be sprayed from many addresses and many addresses cannot be used to spray one account. This API terminates no such route: credential entry, verification resend, password recovery, and token refresh are Supabase Auth operations the web server performs directly, and `apps/web/src/lib/rate-limit.ts` applies that address-plus-subject policy through `consume_auth_rate_limit`. The scope is configured and tested here so a route added later inherits it by declaring it.
- Model, document, and generation routes carry a second, tighter per-member ceiling that no single route's decorator can loosen.
- Per-route `@Throttle` decorators are unchanged and still decide their route's limit and window; only the key changed. A refusal is a 429 with the standard `RATE_LIMITED` envelope and a `Retry-After`, and the window resets as configured.

Every limit and window is environment-validated (`RATE_LIMIT_AUTHENTICATED_*`, `RATE_LIMIT_ANONYMOUS_*`, `RATE_LIMIT_SENSITIVE_*`, `RATE_LIMIT_EXPENSIVE_*`); see `.env.example`. Tokens and submitted identifiers are never logged, and a tracker is hashed before it reaches the store.

Local/test API throttling is in memory, and the store is per process: with two API instances each keeps its own buckets, so a member's effective allowance is the configured limit times the number of instances. Production startup intentionally fails until a distributed rate-limit adapter is selected and `RATE_LIMIT_STORE` no longer uses memory. Wildcard CORS and insecure production application/API URLs fail environment validation. OpenAPI/docs are unavailable in production regardless of the local flag.

## Database and service-role controls

RLS is enabled and forced on every exposed table. Broad grants are revoked before narrow column/function grants are applied. Security-definer functions use fixed empty search paths and schema-qualified names. Append-only authentication, status, and audit records reject updates/deletes.

Service-role credentials exist only in API/worker/bootstrap/test server processes. No public endpoint proxies arbitrary service-role requests. Privileged payment and admin functions still verify the supplied actor's database permission. The service key is rejected by browser schemas and must reside in a secret manager. Payment table writes are controlled by lifecycle functions; append-only history and review-warning mutations reject direct writes.

## Email-link and delivery security

Supabase Auth owns verification/recovery token generation. Local SMTP is Mailpit only. Live Resend delivery requires an explicit provider, live-send gate, sender, API key, non-local environment, safe URL, idempotency key, timeout, and bounded retry policy.

Delivery receipts mask recipients and omit body, action URL, token, and provider error details. Password-change and security messages cannot be disabled through marketing preferences. Phase 2 payment/subscription messages are queued in a service-only outbox, claimed with opaque tokens, retried with bounded attempts, and never attach proof images or private payment instructions. Hosted Resend SMTP, DNS, redirect, expiry/reuse, bounce, and complaint behavior remain pending owner validation.

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

## Phase 2 private payment storage

Payment proof and payment QR buckets are private, have allowlisted image MIME types and fixed size limits, and have no anonymous/authenticated storage policies. The API writes through the service client only after server-side magic-byte and image validation. Object paths are opaque UUID-based values, never returned as record fields, and are exposed only through short-lived signed URLs (five minutes by default, with a ten-minute maximum). Replacements/cancellations enqueue old objects for cleanup when immediate deletion is unavailable.

Payment proof metadata is separated from object bytes, customer RLS excludes storage paths, scan state, duplicate signals, reviewer notes, and private snapshots, and reviewer proof access requires `payments.review`. Malware scanning is not configured in this checkpoint; `scan_status = not_configured` is explicit and approval remains an authorized manual decision. A future scanning system must change the acceptance policy before enabling pending uploads.

## Career document storage

Resume and portfolio bytes are sensitive, and the implementation reflects that:

- The `career-documents` bucket is private with a 10 MiB limit and a MIME allowlist of PDF, DOCX, RTF, plain text, and Markdown. No anon or authenticated storage policy exists for it, so direct upload, listing, and read all fail even when a caller guesses an object path.
- Object paths are `{ownerUuid}/{documentUuid}/{randomUuid}.{validatedExtension}`, carry no identity or title data, and are never returned as a client field or written to an audit event.
- The API writes bytes through the service client only, and the container format is decided from magic bytes: a declared MIME type and a filename extension are treated as claims, not evidence.
- Owners reach their bytes only through `GET /v1/me/career/documents/{documentId}/access`, which performs an ownership check and returns a short-lived signed URL.
- Uploaded bytes are decoded server-side, and the extracted text is stored as a proposal in `app_private.career_document_extractions`. Nothing extracted becomes a fact until the owner confirms it (see [AI and truth gating](ai-and-truth-gating.md)).
- Deleted and replaced objects are queued in `app_private.storage_cleanup_jobs` so bytes are reclaimed rather than orphaned.

Still unimplemented, and required before uploads are treated as fully hardened:

- Asynchronous malware scanning. `career_documents.status` and `payment_submission_files.scan_status` already model a quarantine result, but no scanner is wired up.
- Image metadata and EXIF removal on the payment proof path is handled by re-encoding through `sharp`; career documents are not images, so no equivalent step applies.
- A retention and deletion policy for failed cleanup jobs, approved by the owner.

## LLM and external-content boundary

External pages, documents, job descriptions, and model output are untrusted data and cannot enter trusted instructions directly. `packages/ai` defines the provider contract: it separates trusted instructions from untrusted source content, pins a prompt and model version, requires an output schema, and reserves cost, token, timeout, retry, verified-fact, and Truth Gate fields.

`DisabledAiProvider` is the only implementation, and it rejects every generation request. No live model call exists anywhere in the repository, and no job description, resume, or external page is ever sent to a provider. The shipped matching and extraction are deterministic code, so the untrusted-content boundary is currently enforced by not having a model in the path at all.

Enabling a provider requires secret management, egress controls, a retention and data-region review, output validation, and completed Truth Gate acceptance. That is an owner decision, not a repository change.

## Release gates and residual work

Mandatory local gates are clean migrations, schema lint, pgTAP/RLS, generated-type drift, formatting, lint, strict types, unit/API/component tests, production builds, OpenAPI/token drift, secret scan, dependency audit, and Playwright auth/admin/responsive/reduced-motion/Axe checks.

Hosted Supabase/Resend, ingress forwarding-header trust, production cookie/CORS/CSP behavior, first-owner bootstrap, distributed API limiting, backups/restore, monitoring, legal approval, and production smoke tests are owner gates. They must be marked pending until executed; local success does not prove them.
