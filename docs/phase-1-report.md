# Phase 1 report

Date: 2026-07-22 (Asia/Singapore)

This is a historical Phase 1 snapshot. The current manual-payment activation checkpoint is documented in [Phase 2 report](phase-2-report.md); the Phase 1 statements below describe the repository as it stood on this report date.

Decision: **CONDITIONAL GO for Phase 2**

All mandatory local Phase 1 authentication, authorization, account-status, migration, RLS, API, build, security, responsive, accessibility, and end-to-end gates pass. No critical local security issue remains. Hosted Supabase, Resend/DNS, production URLs/ingress, distributed API rate limiting, first-owner bootstrap, legal approval, deployment, and hosted smoke tests require owner credentials or authority and remain pending.

Phase 2 was not started.

## 1. Executive summary

Hanaply now has a secure, usable local SaaS account core built on the existing Phase 0 architecture. A user can register, verify through captured email, log in/out, recover or change a password, refresh/revoke sessions, update allowlisted profile/preferences, and reach protected customer pages. Account state is enforced across web, API, session existence, and RLS.

An explicitly authorized administrator can log in, inspect real identity/account data, search/filter/paginate users, view safe details, suspend/restore an account, revoke sessions, and review redacted audit events. The first Super Admin is assigned only through a disabled-by-default, email/UUID/confirmation-gated service process.

Supabase Auth remains the only credential provider. Shared Zod contracts, bearer-only API design, server-derived permissions, forward-only PostgreSQL changes, and strict local gates preserve mobile readiness and Phase 0 boundaries.

## 2. Phase 0 baseline validation

The pre-edit worktree was clean on `main`. Phase 0 documentation, all eight migrations, RLS policies/tests, web/API/admin shells, environment schemas, CI, and provider boundaries were inspected directly.

The existing baseline passed with Node 24.12.0 and pnpm 11.10.0:

- Frozen-lockfile install: passed.
- Formatting, lint, strict type checking, token/OpenAPI/type drift, secret scan, and production builds: passed.
- Vitest/API/component: 9 files and 59 tests passed.
- Local reset/lint: all 8 Phase 0 migrations and no schema errors.
- pgTAP: 5 files and 80 assertions passed.
- Playwright/Axe: 9 scenarios passed at the required widths.
- Production dependency audit: no known vulnerabilities.

No Phase 0 repair commit was required. Phase 1 expanded the existing authentication system rather than creating a second one.

## 3. Features implemented

- Registration with normalized email, bounded password rules, duplicate-submit protection, required versioned Terms/Privacy acknowledgements, and optional marketing consent.
- Email verification, safe callback, masked pending state, resend throttling, invalid/expired/reused link handling, and profile reconciliation.
- Login/logout, safe redirects, Supabase SSR refresh, API session-ID validation, generic errors, and authentication history.
- Generic forgot-password, verified recovery session, password reset, global signout, authenticated password change, and other-session revocation.
- Protected dashboard, profile, optional notification preferences, security/session page, and honest Activation Center.
- Active/suspended/disabled/pending-deletion account decisions in shared code, web layouts, API guards, database access, and admin workflows.
- Admin login, membership/role/permission enforcement, overview, user directory/detail, suspend/restore, session revocation, audit directory, and safe security status.
- Secure first-Super-Admin CLI/RPC flow with one-time auditing and final-owner protection.
- Branded Supabase Auth email templates plus disabled/capture/Resend application-email providers.
- Expanded contracts/OpenAPI, migrations/RLS/types, CI, local mail tests, responsive checks, keyboard/reduced-motion coverage, Axe scans, and documentation.

## 4. Authentication flows

Registration and authentication mutations are same-origin Next.js server actions using the installed Supabase SDK. Passwords are not sent through the Hanaply REST API and are never stored by application tables.

Registration validates through `@hanaply/auth`, consumes persistent hashed limits, starts confirmation through Supabase Auth, and reaches the verification-pending page without a usable unverified session. Provisioning/reconciliation creates the profile, legal rows, and default preferences from allowlisted metadata.

The callback accepts supported PKCE codes or OTP hashes, verifies through Supabase, rejects unsafe/reused links, sanitizes navigation, reconciles the profile, and enters the dashboard. Login checks profile state and the bearer API before redirecting. Admin intent additionally requires active database admin access.

Recovery always gives the same account-agnostic response, fixes the callback destination, requires both verified claims and a short-lived HttpOnly recovery marker, applies the password policy, signs out globally, and verifies that only the new password works.

## 5. Session architecture

- Web: Supabase SSR HttpOnly cookies refreshed by Next.js Proxy.
- Authoritative web checks: server layouts call `getClaims`, evaluate account status, and call the API before rendering protected data.
- API: bearer-only; Supabase `getClaims` verifies the access token and a service-only function checks that `session_id` remains present in `auth.sessions`.
- User session UI: safe identifier/timestamps/user-agent/current marker only; no token values.
- Normal logout: current browser session; reset: global signout; password change: current-password reauthentication plus other-session revocation.
- Admin revocation: permissioned and audited full target-session revocation.

This allows revoked refresh sessions to be rejected by the API even while an old access token has not yet reached its encoded expiry.

## 6. Account-status enforcement

`active` may use protected functionality. `suspended` authenticates only far enough to reach a safe suspended state and is denied protected API/business data. `disabled` and `pending_deletion` route to account unavailable and are denied.

Enforcement exists in shared helpers, login, customer/admin server layouts, API bearer guard, admin resolution, session activity checks, caller repositories, and RLS. Admin suspension revokes sessions, appends status/suspension/audit history, rejects self-status changes, and cannot suspend the final active Super Admin.

## 7. Customer dashboard and settings

The dashboard uses the caller's real safe profile/subscription summary and has no invented activity metrics. Profile settings update only first name, last name, display name, locale, IANA timezone, and two-letter country code. Notification settings change only optional product/marketing preferences; mandatory security/authentication messages remain locked.

Security settings show safe sessions, revoke other sessions, and change password only after current-password reauthentication. The Activation Center loads the real plan/subscription contract, shows annual comparisons, and explicitly says not to send payment because Phase 2 payment processing does not exist.

## 8. Admin authentication and experience

`/admin/login` uses the same Supabase identity but requires `/v1/admin/me` before entry. Normal users receive a dedicated forbidden state. The protected shell derives permission-aware navigation from server-returned permissions.

Overview counts and user rows come from PostgreSQL. Directory filters include search, verification, account status, created range, and pagination. Detail pages expose allowlisted profile, verification, subscription, status, safe event, and audit data. Confirmation dialogs require meaningful reasons for suspend, restore, and revoke operations.

## 9. Roles and permissions

Eight catalog roles and 25 explicit permissions remain expanded in PostgreSQL. No runtime wildcard or JWT permission claim is accepted.

Implemented route requirements are active admin membership for `/v1/admin/me`; `users.read` for overview/directory/detail; `users.manage` for suspend/restore; `users.manage` or `security.manage` for revocation; `audit.read` for audit; and `security.manage` for security diagnostics. Nest guards and service-only database functions both enforce the operation.

## 10. Super Admin bootstrap

`pnpm admin:bootstrap` requires:

- `ADMIN_BOOTSTRAP_ENABLED=true`.
- An exact normalized `ADMIN_BOOTSTRAP_EMAIL`.
- Server-only Supabase URL/service key, with HTTPS remotely.
- A verified existing Auth UUID matching that email.
- `--confirm ASSIGN_FIRST_SUPER_ADMIN`.

The transaction creates/activates membership, assigns the expanded role, and writes `admin.bootstrap_completed`. A same-owner retry is idempotent; a different second bootstrap is rejected. E2E invokes this exact controlled process locally and verifies one audit event. Hosted bootstrap was not executed.

## 11. Database migrations

Phase 1 adds five forward-only migrations after the eight Phase 0 migrations:

1. `20260722102000_phase1_account_status_enum.sql` - four-state account model.
2. `20260722103000_phase1_identity_and_preferences.sql` - legal acceptance, preferences, authentication/status/suspension/delivery history, persistent auth limits, triggers, reconciliation, and safe user functions.
3. `20260722104000_phase1_admin_operations.sql` - permission-aware overview, directory/detail/audit, suspend/restore, session revocation, session summaries, and session existence.
4. `20260722105000_phase1_rls_and_grants.sql` - Phase 1 revokes/grants/RLS and active-account admin inspection.
5. `20260722106000_phase1_admin_bootstrap_hardening.sql` - verified email-bound idempotent first-owner bootstrap.

All 13 migrations reset cleanly. Generated TypeScript database types match the local schema.

## 12. RLS changes

New exposed tables have RLS enabled and forced. Normal users can read their own legal/preferences/allowlisted authentication records and update optional preferences only through protected functions. Profile column grants now include only the six intended user-editable fields.

Users cannot read another identity/auth record, change verification/account/subscription/admin state, grant a role, read service suspension notes or admin audit, or mutate append-only history. Suspended users lose profile-update, preference, subscription, and protected business access. Admin functions are service-role callable but re-check actor permission in the database.

Seven pgTAP files exercise both allowed and denied paths, including protected-column escalation, self-suspension/promotion, unauthorized administrator actions, service-only functions, audit mutation, final-Super-Admin protection, and session revocation.

## 13. API endpoints

The canonical registry/OpenAPI now contains 19 paths and 21 operations. Phase 1 adds:

- `PATCH /v1/me`
- `GET/PATCH /v1/me/preferences`
- `GET /v1/me/sessions`
- `POST /v1/me/sessions/revoke-others`
- `GET /v1/admin/overview`
- `GET /v1/admin/users`
- `GET /v1/admin/users/{userId}`
- `POST /v1/admin/users/{userId}/suspend`
- `POST /v1/admin/users/{userId}/restore`
- `POST /v1/admin/users/{userId}/revoke-sessions`
- `GET /v1/admin/audit-events`
- `GET /v1/admin/security`

Existing public/me/entitlement operations remain. Every controller uses the shared contract, safe envelope, request ID, validation, bearer/account guard where required, and explicit throttling/permissions.

## 14. Resend integration

Supabase Auth owns confirmation, recovery, and password-change notification tokens. Local SMTP goes to Mailpit with branded responsive templates.

`@hanaply/email` uses the official Resend SDK and provides versioned verify/reset/password-changed/welcome/security templates with HTML/plain text, safe action URLs, categories, idempotency, masked receipts, an 8-second default timeout, bounded retry with full jitter, and safe failure codes.

Live delivery requires `EMAIL_PROVIDER=resend`, explicit live-send approval, key, sender, and a non-local/test environment. No live email was sent. Hosted Resend SMTP, domain DNS, templates, bounce/complaint handling, and test delivery are pending owner gates.

## 15. Audit events

Phase 1 records or exposes safe history for registration, email verification, password change, customer/admin login, logout, session revocation, profile/preferences update, suspension, restoration, and bootstrap. Account actions include actor, target, request ID, bounded reason, and allowlisted before/after state.

History/audit tables reject direct update/delete. Admin audit listing requires `audit.read` and returns redacted fields only. Tokens, credentials, private documents, raw request bodies, payment material, and action URLs are prohibited.

## 16. Security controls

- Same-origin mutation checks and bearer-only API CSRF boundary.
- Same-origin redirect sanitizer and fixed callback origins.
- Database-backed authentication/reset/resend limiting and route-specific API/admin limits.
- Production startup gates for strong pepper, HTTPS, exact CORS, distributed API limiting, Resend, and safe worker mode.
- Nonce CSP, HSTS in production, frame denial, permissions/referrer/content-type headers.
- Generic auth/recovery errors and masked verification/email receipts.
- Supabase claim/session checks, database account status, server permissions, forced RLS, and narrow service-role use.
- Pino/request correlation and sensitive-field redaction.
- Secret-pattern scan and high-severity production dependency audit.

## 17. Responsive and accessibility work

Authentication, customer, and admin routes use semantic labels/autocomplete, visible focus, password-manager-friendly fields, accessible async messages/dialogs/drawers/tables, non-color status cues, 44px targets, safe-area padding, and reduced-motion fallbacks.

Validation caught and fixed an activation-card contrast issue and a 1280px admin-directory filter overflow. Browser checks cover 1440, 1280, 1024, 768, 430, 390, and 360px with no document-level horizontal overflow. Core routes pass Axe; keyboard tests cover skip navigation and mobile drawers.

## 18. Tests executed

Final environment: Windows local workspace, Node 24.12.0, pnpm 11.10.0, Supabase CLI 2.109.1, Docker-backed local Supabase.

| Command/gate                     | Exact final result                                                 |
| -------------------------------- | ------------------------------------------------------------------ |
| `pnpm install --frozen-lockfile` | PASS: all 16 workspace projects already up to date; 417ms          |
| `pnpm format:check`              | PASS: all matched files use Prettier                               |
| `pnpm lint`                      | PASS: zero warnings allowed                                        |
| `pnpm typecheck`                 | PASS: 15 package scopes plus tests/tooling; 24 Turbo tasks         |
| `pnpm test`                      | PASS: 10 files, 85 tests; final run 4.53s                          |
| `pnpm tokens:check`              | PASS: generated tokens match canonical JSON                        |
| `pnpm build`                     | PASS: all 15 package scopes and Next.js production application     |
| `pnpm openapi:check`             | PASS: generated OpenAPI matches 19 paths/21 operations             |
| `pnpm secrets:check`             | PASS: no committed credential pattern found                        |
| `pnpm db:reset`                  | PASS: all 13 migrations and production-safe catalog seed           |
| `pnpm db:lint`                   | PASS: no schema errors in `app_private`, `extensions`, or `public` |
| `pnpm db:test`                   | PASS: 7 files, 137 assertions                                      |
| `pnpm db:types:check`            | PASS: generated database types match                               |
| `pnpm e2e`                       | PASS: 11 scenarios in 1.4m                                         |
| `pnpm validate:local`            | PASS: complete chained gate in 253.8s                              |
| `pnpm audit:prod`                | PASS: no known production dependency vulnerabilities; 2.0s         |

The 11 E2E scenarios cover real local registration/legal/verification/link reuse/login; generic recovery/reset/new-vs-old password; route protection/profile/preferences/sessions/logout; suspension/normal-user admin denial; controlled bootstrap and real admin actions/audit; database pricing/Activation Center; all required responsive widths; reduced motion/keyboard; Axe/security headers. Test setup removes all temporary Auth users.

## 19. Exact acceptance result

`pnpm validate:local` exited 0 after 253.8 seconds. It ran, in order, formatting, lint, strict types, 85 Vitest tests, token drift, production builds, OpenAPI drift, secret scan, clean database reset, schema lint, 137 pgTAP assertions, database-type drift, and all 11 Playwright/Axe scenarios. The independent production audit then exited 0 with no known vulnerabilities.

## 20. Hosted Supabase validation status

**PENDING - not run and not represented as passed.**

No hosted credentials or authorization were supplied. No project was linked, no remote migration was applied, no hosted redirect/cookie/CORS/CSP behavior was tested, no live Resend email was sent, and no hosted admin was bootstrapped. Exact hosted steps are in [Owner actions](owner-actions.md).

## 21. Known limitations

- Production API startup remains blocked until a distributed rate-limit store replaces local memory throttling.
- Production ingress must be configured to replace untrusted forwarding headers for source-address limits.
- Hosted Resend SMTP/domain/templates/webhooks/suppressions and real email-client testing are pending.
- Privacy and Terms are versioned engineering drafts awaiting legal approval.
- Phase 1 has no general admin role-assignment UI; only controlled first-owner bootstrap exists.
- Disabled/pending-deletion states are enforced but no end-user deletion/export workflow exists.
- Email delivery history is a protected schema foundation; application notification orchestration/webhooks are deferred.
- Browser automation uses Chromium; hosted cross-browser/device testing remains an owner release task.
- MFA/CAPTCHA, breached-password screening, and production bot controls require a separate owner risk/configuration review.
- Worker mode remains idle; AI/queue/upload/payment/job/mobile providers remain disabled or absent.

## 22. Deferred Phase 2 work

Manual payments/proof upload/review/activation, career-profile onboarding, resume/portfolio upload/parsing/preview, account export/deletion, and activation email orchestration are not implemented. Job ingestion, AI matching/application packs, non-auth notifications, production queues, push, and React Native remain later phases.

No fake records, payment instructions, jobs, documents, AI output, or delivery claims were created.

## 23. Owner actions

Before production or unconditional Phase 2 approval, the owner must validate hosted Supabase migrations/Auth/RLS, configure exact URLs and ingress, verify Resend sender DNS/custom SMTP/templates, implement distributed API limiting, run the controlled hosted first-admin bootstrap, approve legal/support/retention/incident procedures, configure backups/monitoring/rollback ownership, and authorize deployment/push/tag.

See [Owner actions](owner-actions.md), [Email operations](email.md), and [Admin bootstrap](admin-bootstrap.md).

## 24. Git commits

1. `b93dac9` - Auth contracts, validation, and environment safety gates.
2. `0844ec8` - Phase 1 identity/admin database model, RLS, tests, and generated types.
3. `d01b1b0` - Registration, verification, local Auth email templates, and throttling.
4. `4159623` - Login/logout, refresh, status, and session enforcement.
5. `3b904d1` - Secure password recovery/reset and global revocation.
6. `c13ab19` - Customer dashboard, profile/preferences, security, sessions, and Activation Center.
7. `13010aa` - Permissioned admin identity operations, audit, and controlled bootstrap.
8. `0cfe613` - Safe Resend provider and versioned transactional templates.
9. `914116a` - Complete Phase 1 E2E/Axe/responsive coverage and CI gate.
10. Documentation and final validation - the commit containing this report.

No commit was pushed and no tag or pull request was created.

## 25. Final decision

**CONDITIONAL GO for Phase 2.**

Reason: every mandatory local Phase 1 gate passes and no critical local security defect remains, but hosted Supabase/Auth/RLS, Resend/DNS, production networking/limiting, secure owner bootstrap, legal, and deployment-owner gates are still pending. This is not authorization to begin Phase 2. Stop here and wait for owner review and explicit approval.
