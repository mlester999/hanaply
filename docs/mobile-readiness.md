# Mobile readiness

Phase 1 does not create a mobile application. It establishes working authentication, account-status, session, authorization, and contract boundaries that let a future React Native client reuse server behavior without inheriting browser assumptions.

## Reusable foundations

- REST paths and Zod schemas live in `@hanaply/contracts`.
- The fetch client is DOM-free and accepts `baseUrl` plus an optional asynchronous bearer-token callback.
- JSON is camelCase and versioned under `/v1`.
- API auth is bearer-only; cookies and CSRF conventions remain web-specific.
- Entitlements, platform state, feature flags, and admin access are server evaluated.
- Platform meta accepts `web`, `ios`, or `android` and an optional semantic client version.
- iOS and Android begin in `planned` state; web is active.
- Registration/profile/preference/session schemas and safe error envelopes are shared rather than duplicated in browser components.

## Secure mobile authentication

A mobile client must use Supabase's supported PKCE/session flow and store refresh material only in iOS Keychain or Android Keystore-backed secure storage. Access tokens may live in memory. Tokens must not be placed in AsyncStorage, logs, analytics, crash metadata, deep-link parameters, screenshots, or clipboard flows. No service-role or provider key is ever shipped to a device.

Logout must revoke/clear the Supabase session and remove local secure values. The Phase 1 API verifies `session_id` against the database and rejects suspended accounts, but device compromise, token rotation, remote sign-out latency, and platform SDK behavior still require mobile-specific acceptance tests.

## Future device registration and push tokens

A later migration should model a user-owned device registration separately from a provider token. Recommended fields include:

- Device UUID, user UUID, platform, application version, locale, timezone, and last-seen timestamp.
- Provider token ciphertext/reference, token hash for deduplication, provider, environment, and rotation timestamp.
- Enabled categories, permission state, invalidated timestamp, and non-sensitive delivery diagnostics.

Registration/update APIs must be bearer-authenticated, idempotent, RLS-protected, and rate limited. Tokens are encrypted at rest or held in a dedicated secret-capable store, redacted everywhere, rotated on provider change, and deleted on logout/account deletion. Invalid-provider responses disable the exact token without exposing it.

## Deep links

- Use verified Universal Links and Android App Links for owned HTTPS domains.
- Maintain an allowlist of route names and typed parameters; reject arbitrary URLs, schemes, hosts, traversal, and control characters.
- Auth callback links use PKCE state/nonce and a single-use transaction record.
- Sensitive tokens and private document URLs never appear in deep-link query strings.
- If a requested route is unavailable, route to a safe authenticated home state.
- Version deep-link contracts and test cold start, warm start, expired session, suspended account, and forced-upgrade behavior.

## Private document previews

Mobile previews must request a short-lived signed URL through the API after entitlement and ownership checks. Cache only encrypted temporary data, apply OS data-protection classes, prevent backups where supported, clear previews on logout, and avoid writing source documents to shared media storage. Preview telemetry may include a document ID and outcome, never the URL or content.

## Compatibility and release controls

The `/v1/meta` precedence is maintenance, planned/retired, forced minimum-version upgrade, then available. Mobile startup should evaluate it before protected navigation and use non-color, localized states. Future breaking API changes require a new versioned contract path rather than client sniffing.
