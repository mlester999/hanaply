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

`get_my_admin_access()` derives active roles and expanded permission rows from PostgreSQL. Admin claims in JWT metadata, browser state, query strings, or request bodies are ignored. The shared catalog contains 25 explicit permissions and eight roles; Super Admin receives expanded rows, not a runtime wildcard.

The implemented Phase 1 and Phase 2 endpoint matrix is:

| Operation                                       | Required authority                                               |
| ----------------------------------------------- | ---------------------------------------------------------------- |
| `GET /v1/admin/me`                              | Active admin membership                                          |
| `GET /v1/admin/overview`                        | `users.read`                                                     |
| `GET /v1/admin/users`                           | `users.read`                                                     |
| `GET /v1/admin/users/{userId}`                  | `users.read`                                                     |
| `POST /v1/admin/users/{userId}/suspend`         | `users.manage`                                                   |
| `POST /v1/admin/users/{userId}/restore`         | `users.manage`                                                   |
| `POST /v1/admin/users/{userId}/revoke-sessions` | `users.manage` or `security.manage`                              |
| `GET /v1/admin/audit-events`                    | `audit.read`                                                     |
| `GET /v1/admin/security`                        | `security.manage`                                                |
| `GET /v1/payment-methods`                       | Active customer: public methods and QR access                    |
| `GET /v1/me/subscription`                       | Active customer: own subscription and entitlements               |
| `GET /v1/me/payment-submissions`                | Active customer: own payment history                             |
| `POST/PATCH /v1/me/payment-submissions`         | Active customer: own canonical draft                             |
| `POST .../{submissionId}/proof`                 | Active customer: own validated proof upload                      |
| `GET .../{submissionId}/proof-access`           | Active customer: own short-lived proof URL                       |
| `POST .../{submissionId}/submit                 | cancel                                                           | resubmit`                                    | Active customer: own versioned lifecycle action |
| `GET/POST/PATCH /v1/admin/payment-methods`      | Payment-method permissions; database rechecks authority          |
| `POST .../payment-methods/{id}/enable           | disable                                                          | archive                                      | qr`                                             | `payment_methods.manage` |
| `GET /v1/admin/payment-submissions`             | `payments.read`                                                  |
| `GET .../payment-submissions/{id}`              | `payments.read`; proof URL separately requires `payments.review` |
| `POST .../{id}/start-review                     | request-information                                              | approve                                      | reject`                                         | `payments.review`        |
| `POST .../{id}/record-refund                    | reverse`                                                         | `payments.review` and `subscriptions.manage` |
| `GET/POST /v1/admin/subscriptions`              | `subscriptions.read`; correction requires `subscriptions.manage` |

The admin navigation is filtered by permissions for usability, but API/database checks remain authoritative. Every state-changing operation requires a 10-to-500-character reason and a request ID, is rate-limited, and writes an append-only audit event.

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

Positive and negative pgTAP tests impersonate anonymous, normal, suspended, admin, and service roles. See [Database and RLS](database.md) for the tested grants and functions.

## Service-role boundary

The service role is server-only and used narrowly for readiness, admin directory/operations, payment lifecycle orchestration, worker maintenance, session existence checks, bootstrap, and controlled test setup. It is not accepted from browsers and no broad service-role passthrough endpoint exists. Service functions still take the actor UUID and re-check database permissions before privileged mutations.

The first-admin script is the only supported bootstrap path. It is environment-gated, confirmation-gated, email/UUID-bound, atomic, auditable, and disabled by default. See [Admin bootstrap](admin-bootstrap.md).
