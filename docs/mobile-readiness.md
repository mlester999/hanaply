# Mobile readiness

**No mobile application exists.** This document records what is verified, what the client core already does, and what remains.

## What exists and is verified

`@hanaply/mobile-client` is a real, tested package. It is not an app, and it deliberately contains no React Native imports, so it runs and is tested without a device.

| Module          | What it does                                                                                                                        |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `session.ts`    | Sign-in, restore, refresh, and sign-out against Supabase, with the refresh token as the only thing that touches persistent storage. |
| `deep-links.ts` | An allowlist router for every customer route, with typed parameters and explicit rejection reasons.                                 |
| `api.ts`        | Wraps the same `createApiClient` the web app uses, against the same contract registry, with the session supplying the bearer token. |

`tests/unit/mobile-client.test.ts` holds 33 assertions over these, including the security properties below.

### The session contract that must not be weakened

- **Only the refresh token is persisted**, and only through a `SecureStorePort` the caller implements. On iOS that is the Keychain; on Android it is Keystore-backed storage. The package never decides where it lands.
- **The access token lives in memory only.** It is never persisted, never logged, and never placed in a URL. A test asserts the secure store holds exactly one key and that its value is not the access token.
- **The password is not retained.** A test asserts the session state cannot contain it.
- **Only the publishable anon key is used.** A test asserts the `apikey` header carries the anon key, and the package accepts no service-role key at all.
- **A rejected refresh token is discarded**, not retried on every launch.
- **Concurrent callers share one refresh**, so three simultaneous calls spend the refresh token once rather than three times.
- **Sign-out clears local state and secure storage even when server-side revocation fails.** A device must not stay signed in because the network was down.

### The deep-link contract

A deep link is attacker-influenced input, so `resolveDeepLink` is an allowlist rather than a helpful parser. It rejects, with a reason: a lookalike host, a custom scheme, `javascript:`, a protocol-relative URL, plain HTTP, path traversal, an encoded control character, a route that is not on the list, an identifier that is not a UUID, and a malformed URL. A query string is ignored rather than passed through, so a link cannot smuggle a token into a screen. `buildDeepLink` and `resolveDeepLink` round-trip every route, so the two directions cannot drift.

### The rest of the foundations

- The shared packages are runtime-neutral, and a test enforces it. `tests/unit/runtime-neutrality.test.ts` reads the sources of the contracts, auth, entitlements, platform, jobs, matching, and mobile-client packages and fails the build if `window`, `document`, `localStorage`, `sessionStorage`, `navigator`, `HTMLElement`, `ReactDOM`, `process.env`, `Buffer`, `__dirname`, or `__filename` appears.
- API authentication is bearer-only. Cookies and CSRF are web-specific and are not part of the mobile surface.
- Account status, authorization, plan entitlements, feature flags, and platform lifecycle are all evaluated server-side. The mobile client receives decisions and holds no copy of any rule.
- `/v1/meta` accepts `web`, `ios`, or `android` plus an optional semantic client version. iOS and Android are `planned`; web is `active`.

## What is not built

- **No Expo or React Native project exists.** No screens, no navigation, no app shell, no bundler configuration.
- No device registration and no push-token lifecycle.
- **No mobile-specific acceptance testing.** Nothing in this repository has run on a device or simulator.

## Secure mobile authentication

A mobile client must use Supabase's supported PKCE flow and store refresh material only in iOS Keychain or Android Keystore-backed secure storage, which is the port `session.ts` already defines. Tokens must never be placed in AsyncStorage, logs, analytics, crash metadata, deep-link parameters, screenshots, or clipboard flows. No service-role or provider key is ever shipped to a device.

The API verifies the session against the database and rejects suspended accounts, but device compromise, token rotation, remote sign-out latency, and platform SDK behaviour still require mobile-specific acceptance tests.

## Device registration and push tokens

A migration should model a user-owned device registration separately from a provider token:

- Device UUID, user UUID, platform, application version, locale, timezone, and last-seen timestamp.
- Provider token ciphertext or reference, a token hash for deduplication, the provider, environment, and rotation timestamp.
- Enabled categories, permission state, invalidated timestamp, and non-sensitive delivery diagnostics.

Registration and update APIs must be bearer-authenticated, idempotent, RLS-protected, and rate limited. Tokens are encrypted at rest or held in a secret-capable store, redacted everywhere, rotated on provider change, and deleted on logout or account deletion. An invalid-provider response disables that exact token without exposing it.

The database already has the notification model a push channel would extend: `public.notification_outbox` with its claim, complete, and release workflow, per-category preferences, and quiet hours. A push channel adds a transport, not a second queue.

## Deep links

`deep-links.ts` implements the allowlist half of this. Still required on the platform side:

- Verified Universal Links and Android App Links for owned HTTPS domains, wired to `resolveDeepLink`.
- Auth callback links use PKCE state and nonce with a single-use transaction record.
- An unavailable route resolves to a safe authenticated home state rather than a blank screen.
- Version the deep-link contract and test cold start, warm start, expired session, suspended account, and forced-upgrade behaviour.

## Private document previews

`career-documents` and the payment buckets are private and carry no anon or authenticated storage policy; object bytes are reachable only through short-lived signed URLs issued after an owner check. A mobile client must request those URLs through `GET /v1/me/career/documents/{documentId}/access` rather than reading storage directly. Cache only encrypted temporary data, apply OS data-protection classes, prevent backups where supported, clear previews on logout, and never write source documents to shared media storage. Preview telemetry may include a document ID and an outcome, never the URL or the content.

## Compatibility and release controls

`/v1/meta` precedence is maintenance, then planned or retired, then forced minimum-version upgrade, then available. Mobile startup should evaluate it before protected navigation and present the states with text as well as colour. A breaking API change requires a new versioned contract path rather than client sniffing.

## Suggested build order

1. An Expo project that implements `SecureStorePort` with `expo-secure-store` and passes `fetch` into `createMobileSession`. Nothing else in `@hanaply/mobile-client` needs to change.
2. Authentication screens, then onboarding and career profile, reusing the career contracts unchanged.
3. Job radar and opportunity detail, rendering the match explanation exactly as the web does.
4. Save, dismiss, and feedback.
5. Application tracker.
6. Application Pack viewing and generation.
7. Subscription status and settings.
8. Push notifications, once device registration exists.

Do not reimplement entitlement, matching, or truth-gating logic in the client. Every decision stays on the server, and `createMobileApi` is the only path to it.
