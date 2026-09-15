# Authentication

## Authority and protocol

Supabase Auth is Hanaply's only password and session authority. Passwords go directly from a same-origin Next.js server action to the installed Supabase SDK; Hanaply does not maintain a password table or expose a custom password API.

The web application uses Supabase SSR cookies. The REST API remains bearer-only so future React Native clients can use the same account, entitlement, and authorization contracts without browser cookies. No API route authenticates from a cookie.

## Registration

`POST`-style form mutation at `/register` performs these steps:

1. Verify Origin/Host against the configured application origin.
2. Normalize the email with Unicode NFKC, trim, and lowercase.
3. Validate first/last name, password, confirmation, and legal choices through `@hanaply/auth`.
4. Require the draft Terms and Privacy versions; keep marketing consent optional and false by default.
5. Consume database-backed registration limits keyed by hashed client address and hashed address/email subject.
6. Call `supabase.auth.signUp` with the allowlisted profile/legal metadata and a fixed local callback origin.
7. Redirect to `/verify-email?registered=1` without creating a usable pre-verification web session.

The Auth provisioning trigger creates/reconciles the profile, legal-acceptance rows, and notification preferences atomically from allowlisted metadata. Duplicate/nonexistent-account distinctions are not exposed to the browser. Server failures return a safe availability message; passwords and raw provider errors are never logged.

Password rules are 10 to 128 characters, at least one letter and number, no control characters, and no paste/password-manager interference. This application rule is stricter than the local Supabase minimum and is enforced on registration, reset, and authenticated password change.

## Email verification

Supabase Auth sends the confirmation message. Locally it is captured by Mailpit with the branded template in `templates/confirmation.html`. The action URL reaches `/auth/callback` using either a PKCE code or a `token_hash`/allowlisted OTP type.

The callback:

- Exchanges or verifies the one-time value through Supabase Auth.
- Rejects missing, invalid, expired, and reused links with a safe verification state.
- Sanitizes the requested next path to a same-origin relative path.
- Reconciles the caller's profile through a fixed-search-path function.
- Deletes the short-lived masked verification-hint cookie.
- Redirects a successful signup to the protected dashboard.

Verification resend is server-rate-limited and calls Supabase's `resend` API. The UI never treats a client-side countdown as the security control.

## Login and admin login

`/login` and `/admin/login` share the same Supabase identity flow. After password authentication, the server checks the profile status, verifies the bearer token through the API, records an append-only authentication event, and only then redirects.

Admin intent adds an authoritative `/v1/admin/me` check. An active Supabase session without active database membership and permissions is signed out and receives a generic admin-denial message. JWT user/app metadata is never consulted for admin authority.

Invalid credentials use one generic response. Login is limited to 10 attempts per 15-minute database window for both a hashed source-address key and a hashed address/email key. Production requires a strong `AUTH_RATE_LIMIT_PEPPER`. The API carries the same policy as a declared scope: a route that takes a submitted identifier is keyed by address and identifier, and it is configured by `RATE_LIMIT_SENSITIVE_*` (see `docs/security.md`), so an authentication route added to the API inherits the rule rather than re-deriving it.

## Session refresh, validation, and logout

Next.js `proxy.ts` calls `getClaims` to refresh Supabase SSR cookies and performs only optimistic redirects. Protected server layouts repeat the authoritative checks and call the API with the access token.

The API validates issuer/expiry through Supabase `getClaims`, requires `sub` and `session_id`, and verifies that the refresh session still exists in `auth.sessions` through a service-only database function. A revoked session therefore cannot continue using a still-unexpired access token against protected API routes.

The security page returns safe session summaries only: session identifier, creation/last-seen timestamps, user-agent text, and whether it is current. It never returns access or refresh tokens. Users can revoke all other sessions. Normal logout records an event and clears only the current browser session; password reset performs global signout, while authenticated password change reauthenticates the current password and revokes other sessions.

## Password recovery and change

`/forgot-password` always returns the same success sentence after a syntactically valid email, whether or not an account exists. Supabase Auth sends a one-time recovery link to the fixed callback origin.

The callback fixes recovery navigation to `/reset-password` and sets a 15-minute HttpOnly, SameSite=Lax recovery marker only after Supabase verifies the link. Reset requires both that marker and authenticated recovery claims, revalidates the password policy, updates through Supabase Auth, deletes the marker, signs out globally, and returns to login. Invalid, expired, and reused links fail safely.

Authenticated password change additionally requires the current password. A successful change revokes every other session. Supabase's password-change security notification is enabled locally and must remain enabled in hosted Auth.

## Redirect and enumeration protections

Redirect candidates must begin with one slash and remain on the synthetic same origin. Schemes, protocol-relative paths, backslashes, malformed URLs, and control characters fall back to `/dashboard` or `/admin`.

Registration, recovery, and invalid-login responses avoid disclosing account existence or provider details. Verification pages store only a masked address hint. Email links and recovery tokens are excluded from application logs, audit metadata, and delivery receipts.

## Local and hosted behavior

Local Supabase sends only to Mailpit at `http://127.0.0.1:55424`; Playwright reads that API and never contacts a real mailbox. Test identities are created by global setup and deleted at teardown.

Hosted validation remains pending. Before release, the owner must configure exact redirect URLs, cookie/HTTPS behavior, Resend custom SMTP, templates, sender DNS, and then test signup, verification, refresh, recovery, password change, logout, revocation, and suspension against the hosted project. Remote migrations and hosted bootstrap are never run by CI.

## Future mobile compatibility

A mobile client should use Supabase's supported PKCE flow and the same bearer API. Refresh material belongs only in Keychain/Keystore-backed storage; access tokens should remain in memory. Universal/App Links must use an allowlisted route contract and never carry private document URLs or arbitrary redirects. Device registration, push-token lifecycle, and remote signout are deferred and described in [Mobile readiness](mobile-readiness.md).
