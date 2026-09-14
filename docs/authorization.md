# Authorization

## Layered enforcement

Hanaply uses four independent boundaries:

1. Next.js Proxy refreshes cookies and may redirect obviously logged-out requests.
2. Server layouts verify claims, account status, and API results before rendering protected content.
3. NestJS verifies bearer sessions and explicit permissions for every protected operation.
4. PostgreSQL grants, RLS, and fixed-search-path functions constrain data even when application checks fail.

Client components and JWT metadata are never authoritative for account status, plan, subscription, role, permission, or entitlement decisions.

## Account states

| State              | Authentication                             | Product/API access                          | Web state                     |
| ------------------ | ------------------------------------------ | ------------------------------------------- | ----------------------------- |
| `active`           | Allowed                                    | Allowed subject to permissions/entitlements | Dashboard/admin as authorized |
| `suspended`        | Identity may authenticate for safe routing | Denied                                      | `/account-suspended`          |
| `disabled`         | Denied after identity check                | Denied                                      | `/account-unavailable`        |
| `pending_deletion` | Denied after identity check                | Denied                                      | `/account-unavailable`        |

Suspension is enforced by the login action, protected layouts, API guard, session checks, and RLS helpers. A suspended user can read only the minimum profile status needed for safe routing and cannot update the profile or read subscription data.

## Admin identity and permissions

An administrator requires all of the following:

- A verified Supabase Auth user.
- An active application profile.
- An active `admin_memberships` row.
- At least one expanded role assignment.
- The explicit permission required by the route.

`get_my_admin_access()` derives active roles and expanded permission rows from PostgreSQL. Admin claims in JWT metadata, browser state, query strings, or request bodies are ignored. The shared catalog contains 28 explicit permissions and eight roles. `20260722094000_foundation_catalog.sql` seeds 26 permissions and eight roles; `20260728090000_phase2_payment_schema.sql` adds `payment_methods.read` and `payment_methods.manage`. `supabase/tests/database/10_catalog.test.sql` asserts the 28-permission count, the eight roles, and the expanded Super Admin rows. Super Admin receives expanded rows, not a runtime wildcard.

The route registry in `packages/contracts/src/api-contract.ts` carries no permission field. Each route declares only an `auth` value of `public`, `user`, or `admin`. Admin permissions are declared on the Nest controllers (`services/api/src/controllers.ts`, `services/api/src/payment.controllers.ts`, `services/api/src/career.controllers.ts`) through `@RequirePermission` and `@RequireAllPermissions`, and the service-only database functions re-check the same permission. A route with `auth: 'user'` requires a bearer session for an active account and no admin permission.

The implemented admin endpoint matrix is:

| Operation                                                                   | Required authority                                                 |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `GET /v1/admin/me`                                                          | Active admin membership                                            |
| `GET /v1/admin/overview`                                                    | `users.read`                                                       |
| `GET /v1/admin/users`                                                       | `users.read`                                                       |
| `GET /v1/admin/users/{userId}`                                              | `users.read`                                                       |
| `POST /v1/admin/users/{userId}/suspend`                                     | `users.manage`                                                     |
| `POST /v1/admin/users/{userId}/restore`                                     | `users.manage`                                                     |
| `POST /v1/admin/users/{userId}/revoke-sessions`                             | `users.manage` or `security.manage`                                |
| `GET /v1/admin/audit-events`                                                | `audit.read`                                                       |
| `GET /v1/admin/security`                                                    | `security.manage`                                                  |
| `GET/POST /v1/admin/payment-methods`                                        | `payment_methods.read`; creation requires `payment_methods.manage` |
| `GET/PATCH /v1/admin/payment-methods/{id}`                                  | `payment_methods.read`; update requires `payment_methods.manage`   |
| `POST .../payment-methods/{id}/enable`, `/disable`, `/archive`, `/qr`       | `payment_methods.manage`                                           |
| `GET /v1/admin/payment-submissions`                                         | `payments.read`                                                    |
| `GET .../payment-submissions/{id}`                                          | `payments.read`                                                    |
| `GET .../{id}/proof-access`                                                 | `payments.review`; database rechecks authority                     |
| `POST .../{id}/start-review`, `/request-information`, `/approve`, `/reject` | `payments.review`                                                  |
| `POST .../{id}/record-refund`, `/reverse`                                   | `payments.review` and `subscriptions.manage`                       |
| `GET /v1/admin/subscriptions`                                               | `subscriptions.read`                                               |
| `GET /v1/admin/subscriptions/{id}`                                          | `subscriptions.read`                                               |
| `POST .../subscriptions/{id}/correct`                                       | `subscriptions.manage`                                             |

The customer payment surface uses the same `auth: 'user'` bearer gate with no admin permission, plus ownership and active-account checks in RLS and in service-only functions:

| Operation                                                | Required authority                                                |
| -------------------------------------------------------- | ----------------------------------------------------------------- |
| `GET /v1/payment-methods`                                | Active customer: currently available public methods and QR access |
| `GET /v1/me/subscription`                                | Active customer: own subscription and entitlements                |
| `GET/POST /v1/me/payment-submissions`                    | Active customer: own payment history and canonical draft          |
| `GET/PATCH/DELETE /v1/me/payment-submissions/{id}`       | Active customer: own canonical draft                              |
| `POST .../{submissionId}/proof`                          | Active customer: own validated proof upload                       |
| `GET .../{submissionId}/proof-access`                    | Active customer: own short-lived proof URL                        |
| `POST .../{submissionId}/submit`, `/cancel`, `/resubmit` | Active customer: own versioned lifecycle action                   |

The career, jobs, opportunity, and application families are all `auth: 'user'` bearer routes with no admin permission. Their `user_id = auth.uid()` ownership and active-account checks live in RLS and in service-only functions rather than in a permission code:

| Route family                                                                  | Routes | Required authority                                                |
| ----------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------- |
| `/v1/me/career/profiles*`, `/v1/me/career/facts*`, `/v1/me/career/documents*` | 21     | Active customer: own career profile, truth ledger, and documents  |
| `/v1/me/jobs*` (feed, detail, save, unsave, feedback)                         | 5      | Active customer: own Career Radar reads, saved jobs, and feedback |
| `/v1/me/application-packs*` and `/v1/me/usage`                                | 4      | Active customer: own packs and metered usage                      |
| `/v1/me/applications*` (tracker, track, timeline, stage)                      | 4      | Active customer: own application tracker and stage history        |
| `/v1/me/onboarding`                                                           | 1      | Active customer: own onboarding state machine                     |

These customer families are grouped here rather than listed route by route; the registry lists each route individually. The career, jobs, application-pack/usage, and application families account for 34 of the 53 `auth: 'user'` routes, and `/v1/me/onboarding` is the 35th.

The admin navigation is filtered by permissions for usability, but API/database checks remain authoritative. Every admin mutation and every customer payment-lifecycle mutation requires a 10-to-500-character `reason` (`adminAccountActionSchema` and `adminVersionedActionSchema` in `packages/contracts/src/`, including `correctSubscriptionSchema`) and a request ID, is rate-limited, and writes an append-only audit event. Customer career, job, and application mutations do not follow that rule: they take optional free-text notes or reasons instead — `saveJobSchema` takes an optional 2000-character `note`, `jobFeedbackSchema` an optional 500-character `reason` (`packages/contracts/src/jobs.ts`), and `trackApplicationSchema` and `setApplicationStageSchema` optional notes of 4000 and 1000 characters (`packages/contracts/src/applications.ts`). Every API response still carries a UUID request ID.

## Account-operation constraints

Phase 1 admin actions can suspend an active user and restore a suspended user. Phase 2 adds permissioned payment method administration, review, atomic activation/renewal, refund/reversal, and controlled subscription correction. It does not expose role assignment or arbitrary subscription writes through the public API.

The service-only database function independently verifies the actor permission. Administrators cannot change their own account state, and the final active Super Admin cannot be suspended. Session revocation also verifies `users.manage` or `security.manage` inside PostgreSQL.

## Route and API boundaries

Customer pages call `requireUser`; admin layouts call `requireAdmin` and route-specific permission helpers. Failures route to login, forbidden, suspended, or unavailable states without rendering protected data first.

The API accepts only `Authorization: Bearer <access-token>`. It verifies the Supabase session, loads the profile status, resolves database admin access, validates Zod inputs, and returns a safe versioned envelope with a UUID request ID. Web cookies are not accepted by the API.

## RLS boundaries

Authenticated users may read their own safe profile/subscription fields and update only allowlisted profile fields while active. They may manage only their own optional notification preferences through a protected function and inspect only safe summaries of their own sessions.

They cannot directly:

- Change account status or status history.
- Read another user's profile, sessions, auth history, or legal records.
- Insert or modify subscriptions, plans, or entitlements.
- Create memberships or assign roles.
- Read admin tables, audit events, feature rules, or service diagnostics.
- Mutate append-only authentication, status, or audit history.
- Read payment reviewer assignments, review flags, notification outbox rows, entitlement events, private object paths, or reviewer snapshots through authenticated table access.
- Upload, list, or read payment objects directly through Supabase Storage.

Payment customer reads are limited by both `auth.uid()` ownership and active account status. Payment submission state, proof metadata links, review flags, refunds, subscription changes, and entitlement events are written only through service-role RPCs that independently validate the actor, expected version, review lock, canonical plan/method, and account state.

Career, job, opportunity, and application tables follow a different shape. `career_profiles`, `career_facts`, `career_documents`, `jobs`, `job_sources`, `companies`, `saved_jobs`, `job_feedback`, `job_matches`, `usage_counters`, `application_packs`, `application_artifacts`, `job_applications`, and `application_events` have select-only policies. Most are scoped to `user_id = auth.uid()` together with `app_private.is_account_active()`; `jobs`, `job_sources`, and `companies` are readable by any active account rather than by owner, and `usage_counters` is scoped to the owning user without an active-account clause. `jobs` rows are readable only where `status = 'active'`, and `job_sources` rows only where `status = 'active'`. None of these tables has an INSERT, UPDATE, or DELETE policy, and the only UPDATE policy on customer data in the schema is `profiles_update_own_active` on `public.profiles`. Every write goes through a `security definer` function that re-checks the caller.

Positive and negative pgTAP tests impersonate anonymous, normal, suspended, admin, and service roles. See [Database and RLS](database.md) for the tested grants and functions.

## Service-role boundary

The service role is server-only and used narrowly for readiness, admin directory/operations, payment lifecycle orchestration, worker maintenance, session existence checks, bootstrap, and controlled test setup. Worker maintenance covers job ingestion (`job_ingestion_schedule`, `acquire_ingestion_lock`, `upsert_ingested_job`, `refresh_job_freshness`), match computation (`matching_subjects`, `matching_job_candidates`, `record_job_matches`), notification and storage-cleanup claiming (`claim_payment_notifications`, `claim_storage_cleanup_jobs`), and subscription expiry maintenance. It is not accepted from browsers and no broad service-role passthrough endpoint exists. Service functions still take the actor UUID and re-check database permissions before privileged mutations.

The first-admin script is the only supported bootstrap path. It is environment-gated, confirmation-gated, email/UUID-bound, atomic, auditable, and disabled by default. See [Admin bootstrap](admin-bootstrap.md).
