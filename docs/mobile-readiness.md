# Mobile readiness

**No mobile application exists.** This document is the specification for one, and it records what is already verified so the remaining work is additive rather than exploratory.

## What is verified today

- The shared packages are genuinely runtime-neutral, and a test enforces it. `tests/unit/runtime-neutrality.test.ts` reads the sources of `@hanaply/contracts`, `@hanaply/auth`, `@hanaply/entitlements`, `@hanaply/platform`, `@hanaply/jobs`, and `@hanaply/matching` and fails the build if `window`, `document`, `localStorage`, `sessionStorage`, `navigator`, `HTMLElement`, `ReactDOM`, `process.env`, `Buffer`, `__dirname`, or `__filename` appears. Each package is an ES module that publishes an entry point.
- The fetch client is transport-agnostic: `createApiClient` accepts an injected `fetch` and an asynchronous `getAccessToken` callback, so a React Native caller can supply its own transport and read tokens from Keychain or Keystore.
- REST paths and Zod schemas live in the same registry the web app uses, so a mobile client cannot drift from the server contract.
- API authentication is bearer-only. Cookies and CSRF are web-specific and are not part of the mobile surface.
- Account status, authorization, plan entitlements, feature flags, and platform lifecycle are all evaluated server-side. A mobile client receives decisions, never the rules.
- `/v1/meta` accepts `web`, `ios`, or `android` plus an optional semantic client version. iOS and Android are `planned`; web is `active`.

## What is not built

- No Expo or React Native project exists.
- No device registration, push-token lifecycle, or deep-link handling exists.
- No mobile-specific acceptance testing exists.

## Secure mobile authentication

A mobile client must use Supabase's supported PKCE flow and store refresh material only in iOS Keychain or Android Keystore-backed secure storage. Access tokens may live in memory. Tokens must never be placed in AsyncStorage, logs, analytics, crash metadata, deep-link parameters, screenshots, or clipboard flows. No service-role or provider key is ever shipped to a device.

Logout must revoke or clear the Supabase session and remove local secure values. The API already verifies the session against the database and rejects suspended accounts, but device compromise, token rotation, remote sign-out latency, and platform SDK behaviour still require mobile-specific acceptance tests.

## Device registration and push tokens

A migration should model a user-owned device registration separately from a provider token:

- Device UUID, user UUID, platform, application version, locale, timezone, and last-seen timestamp.
- Provider token ciphertext or reference, a token hash for deduplication, the provider, environment, and rotation timestamp.
- Enabled categories, permission state, invalidated timestamp, and non-sensitive delivery diagnostics.

Registration and update APIs must be bearer-authenticated, idempotent, RLS-protected, and rate limited. Tokens are encrypted at rest or held in a secret-capable store, redacted everywhere, rotated on provider change, and deleted on logout or account deletion. An invalid-provider response disables that exact token without exposing it.

The database already has the notification model a push channel would extend: `public.notification_outbox` with its claim, complete, and release workflow, per-category preferences, and quiet hours. A push channel adds a transport, not a second queue.

## Deep links

- Use verified Universal Links and Android App Links for owned HTTPS domains.
- Maintain an allowlist of route names and typed parameters; reject arbitrary URLs, schemes, hosts, traversal, and control characters.
- Auth callback links use PKCE state and nonce with a single-use transaction record.
- Sensitive tokens and private document URLs never appear in deep-link query strings.
- An unavailable route resolves to a safe authenticated home state.
- Version the deep-link contract and test cold start, warm start, expired session, suspended account, and forced-upgrade behaviour.

## Private document previews

`career-documents` and the payment buckets are private and carry no anon or authenticated storage policy; object bytes are reachable only through short-lived signed URLs issued after an owner check. A mobile client must request those URLs through `GET /v1/me/career/documents/{documentId}/access` rather than reading storage directly. Cache only encrypted temporary data, apply OS data-protection classes, prevent backups where supported, clear previews on logout, and never write source documents to shared media storage. Preview telemetry may include a document ID and an outcome, never the URL or the content.

## Compatibility and release controls

`/v1/meta` precedence is maintenance, then planned or retired, then forced minimum-version upgrade, then available. Mobile startup should evaluate it before protected navigation and present the states with text as well as colour. A breaking API change requires a new versioned contract path rather than client sniffing.

## Suggested build order

1. Authentication and secure session storage, reusing `createApiClient` with the Supabase access token.
2. Onboarding and career profile, reusing the career contracts unchanged.
3. Job radar and opportunity detail, including the match explanation exactly as the web renders it.
4. Save, dismiss, and feedback.
5. Application tracker.
6. Application Pack viewing.
7. Subscription status and settings.
8. Push notifications, once device registration exists.

Do not reimplement entitlement, matching, or truth-gating logic in the client. Every decision stays on the server.
