# Database and RLS

## Migration model

All schema changes are UTC-named, forward-only SQL migrations under `supabase/migrations`. The local reset applies 19 migrations in order. The first 13 establish the Phase 0 and Phase 1 foundation:

1. Extensions, enums, private schema, and timestamp helper.
2. Profiles, Auth provisioning, admin RBAC, audit events, and protected functions.
3. Plans, typed entitlements, validation, and subscriptions.
4. Feature flags/rules, platforms, and branding.
5. Production-safe roles, permissions, plans, entitlements, flags, platforms, and branding catalog.
6. Least-privilege grants and RLS policies.
7. Atomic first-Super-Admin bootstrap RPC.
8. Narrow audit-actor anonymization for Auth FK deletion.
9. Expand application account status to active, suspended, disabled, and pending deletion.
10. Add legal acceptance, notification preferences, authentication history, account status history/suspensions, delivery metadata, persistent auth throttling, profile reconciliation, and security triggers.
11. Add permission-checking admin overview/directory/detail/audit/account/session functions and safe caller session inspection.
12. Apply Phase 1 least-privilege grants/RLS and replace admin self-inspection with active-account enforcement.
13. Bind first-Super-Admin bootstrap to the verified environment-selected email and make same-owner retries idempotent.

Phase 2 adds six forward migrations:

14. `20260728090000_phase2_payment_schema.sql` - manual payment methods/submissions, proof metadata, review/audit history, subscriptions, entitlement events, notification outbox, cleanup jobs, private buckets, and forced RLS.
15. `20260728091000_phase2_customer_payment_lifecycle.sql` - method administration, canonical customer drafts, proof attachment, submit/cancel/resubmit, reference normalization, and service-only cleanup queueing.
16. `20260728092000_phase2_review_and_subscription_lifecycle.sql` - review locks, request-information/reject/approve, atomic activation/renewal, refunds, reversals, corrections, and expiry.
17. `20260728093000_phase2_rls_grants_and_storage.sql` - least-privilege columns, customer RLS, service authorization, private object resolvers, and storage bucket policy boundary.
18. `20260728100000_phase2_notification_delivery.sql` - claim-token notification delivery and idempotent expiry reminders.
19. `20260728101000_phase2_release_hardening.sql` - resubmission/subscription/refund invariants, proof duplicate/cancellation cleanup, safe cleanup paths, append-only warnings, and worker cleanup claims.

`supabase/seed.sql` contains no users or product activity. Static catalog data is migration-owned so every environment receives the same baseline.

## Core invariants

- UUID primary keys and explicit foreign keys.
- `timestamptz` for temporal data; PostgreSQL stores it as an absolute instant.
- One row with `subscriptions.status = active` per user through a partial unique index.
- Subscription end must follow start.
- Positive PHP minor-unit plan prices and nonnegative integer entitlement values.
- Typed boolean/integer/string entitlement definitions with string allowlists.
- Unique rule priority per feature flag.
- Valid semantic platform versions and a minimum version when forced upgrade is enabled.
- Restricted profile columns and append-only audit content.
- Immutable legal policy acceptance per user/version and one preference row per user.
- Append-only authentication/account-status history with bounded allowlisted event types.
- At most one active suspension per user and restore-only resolution semantics.
- Hashed authentication-rate keys with positive windows/attempt counts; no raw email or address storage.
- Fixed `search_path` on security-sensitive functions.

## RLS behavior

RLS is enabled and forced on every exposed public table. Broad grants are revoked before narrow grants are added.

Authenticated users can:

- Read only their own profile.
- Update only `first_name`, `last_name`, `display_name`, `locale`, `timezone`, and `country_code`, and only while active.
- Read only their own allowlisted subscription columns while active.
- Read their own legal acknowledgements, optional preferences, and allowlisted authentication-event columns.
- Update optional notification preferences and list/revoke sessions only through protected functions.
- Read active public plans, definitions, and plan entitlement values.
- Call `get_my_admin_access`, which returns only their own active roles and expanded permissions.
- Read only currently enabled, effective manual payment methods and their public instructions.
- Read only their own payment submissions, safe proof metadata, public lifecycle messages, subscription summary, and public subscription events.

Authenticated users cannot:

- Insert or mutate subscriptions.
- Read `activation_metadata`.
- Change plan, entitlement, onboarding, or account status.
- Read or mutate admin tables, feature rules, audit events, platform administration, or branding administration.
- Create admin membership or role assignments.
- Read another user's identity, legal, preference, authentication, session, status, suspension, or delivery records.
- Update/delete authentication events, status history, or audit events.

Anonymous users can read active public plan data only. The service role performs configuration and service-only operations, but application code must still minimize its use.

Suspended users can read their profile status for safe routing but cannot update it, read subscriptions/preferences, or use protected API orchestration. Disabled and pending-deletion users receive the unavailable state. The login action, server layouts, API guard, session checks, and RLS apply the same fail-closed decision.

Admin directory and mutation functions are service-role callable only, but they require an actor UUID and resolve the actor's active database permissions internally. Account actions reject self-status changes, protect the final active Super Admin, require a bounded reason, write account-status history and audit rows, and support only suspend/restore in Phase 1. Phase 2 payment method, review, refund, reversal, and subscription-correction functions repeat the same database-side permission checks and optimistic-version/lock checks.

## Audit lifecycle

Audit rows reject direct updates and deletes, including service-role attempts. The sole exception is PostgreSQL's nested `ON DELETE SET NULL` action for `actor_user_id` when an Auth user is removed. The trigger verifies that only the actor FK changes, preserving the event and every other field.

Audit before/after/metadata values must be allowlisted and sanitized by the service that writes them. Tokens, documents, payment proof bytes, raw private records, and arbitrary request bodies never belong in audit JSON. Payment lifecycle events keep customer-visible messages separate from reviewer notes and private snapshots.

## Generated types

`packages/database/src/generated.types.ts` is generated from the running local schema.

```text
pnpm db:types
pnpm db:types:check
```

The check generates a fresh copy without overwriting the committed file and fails on byte-normalized drift. CI runs it after a clean reset.

## pgTAP coverage

`pnpm db:test` runs 278 assertions across nine files. In addition to the Phase 0/1 coverage, Phase 2 tests cover canonical prices and method windows, draft/proof/submit/resubmit/review/approval transitions, optimistic conflicts, duplicate references/proofs, review locks, atomic subscription/entitlement assignment, renewal term guards, refunds, reversals, corrections, expiry, claim-token notifications, cleanup jobs, forced RLS, private columns, private storage buckets, resolver authorization, and direct-write rejection.

## Roll-forward and rollback reasoning

Migrations are forward-only. No down migration is shipped because reversing identity/security changes can destroy audit or legal evidence. A faulty unreleased local migration is corrected with another migration before deployment. After hosted deployment, recovery is a reviewed roll-forward migration; destructive rollback requires an owner-approved backup/PITR restore and incident plan. Remote migration execution is never automatic in CI.
