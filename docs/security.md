# Security and storage

## Trust boundaries

- Browser cookies authenticate the Next.js web session only.
- API authentication is bearer-only; API routes do not consume browser cookies and therefore do not create a cookie-authenticated CSRF surface.
- Proxy refresh and redirects are optimistic. Server layouts, API guards, and PostgreSQL policies are authoritative.
- Admin permissions come only from protected database tables/functions, never JWT metadata or client state.
- Plan codes and entitlement values come only from the database.
- External pages, uploaded text, job descriptions, and LLM content are untrusted data.

## Web controls

- Per-request CSP nonce with `default-src 'self'`, restricted API/Supabase `connect-src`, no objects, same-origin forms, and `frame-ancestors 'none'`.
- HSTS and upgrade-insecure-requests in production.
- Strict referrer policy, restrictive camera/microphone/geolocation/payment/USB policy, and `nosniff`.
- Same-origin relative redirect sanitization rejects schemes, protocol-relative values, backslashes, and control characters.
- Server actions compare Origin, Host, and configured application origin before login/logout mutations.
- Supabase SSR cookie options are preserved during refresh; service-role keys never enter browser schemas.

## API controls

- Helmet, explicit CORS allowlist, no credentialed CORS, 256 KiB body limit, Zod validation, safe envelopes, UUID request IDs, and structured logging.
- In-memory Phase 0 throttling with route-specific limits. API production startup fails until a distributed rate-limit store is implemented.
- Supabase `getClaims` verifies bearer sessions; caller-token repositories preserve RLS.
- Responses are schema-validated in controllers.
- OpenAPI/docs are disabled in production regardless of the local flag.

## Secrets and observability

- One ignored root `.env.local`; one placeholder-only `.env.example`.
- Separate browser, API, worker, and email schemas. Unknown server fields are stripped from browser output.
- Production HTTP application/API URLs and wildcard CORS fail validation.
- Active worker mode and memory-only production rate limiting fail startup.
- Pino logs include service/environment and AsyncLocalStorage request/task context.
- Redaction covers access/refresh tokens, authorization/cookies, API/service keys, URLs and signed URLs, documents, resumes, cover letters, payment content, profile/private records, and provider credentials.
- The repository secret scanner ignores generated caches but scans committed source/document formats for JWT, Resend, and OpenAI key patterns.

## Future private document storage

Phase 0 creates no bucket and exposes no upload route. A later document system must implement all of the following before release:

- A private bucket such as `user-documents-private`; never a public bucket.
- Random object paths such as `{userUuid}/{randomUuid}/{randomUuid}.{validatedExtension}` with no email, name, or document title.
- Server-issued upload authorization and short-lived signed preview/download URLs, targeted at five minutes or less.
- MIME allowlists plus server-side magic-byte/signature verification. The client filename and `Content-Type` are not evidence.
- Explicit size limits no greater than the current 10 MiB local storage limit unless reviewed.
- Image dimension/decompression limits and metadata/EXIF removal before safe derivatives.
- Quarantine state, asynchronous malware scanning, scan-version/result metadata, and service-only release/review.
- Per-user RLS or service mediation for object metadata; no cross-user object listing.
- Preview rendering isolated from the application origin where practical, with download-oriented headers for unsafe formats.
- Audit events containing object IDs and safe status transitions, never signed URLs or document contents.

## LLM/provider boundary

Trusted instructions and untrusted source content are separate fields. Untrusted content cannot become a system/developer instruction. Requests carry prompt/model versions, verified fact IDs, output schema, timeout, and retry limits. Results reserve token/cost and Truth Gate metadata.

OpenAI, Anthropic, Gemini, OpenRouter, and compatible providers are represented only by a neutral interface. `DisabledAiProvider` makes no network call. Production implementations must use a secret manager, egress allowlist, timeouts, bounded retries, output validation, logging redaction, and a completed Truth Gate review.

## Security release gates

- Clean migration reset, schema lint, pgTAP, and generated-type check.
- Formatting, lint, strict type checks, unit/API/component tests, production build, artifact drift, and secret scan.
- Playwright route/auth/responsive/reduced-motion tests and Axe scans.
- Production dependency audit with no high-severity advisory.
- Hosted configuration review, secure first-admin assignment, and production smoke tests owned outside this repository run.
