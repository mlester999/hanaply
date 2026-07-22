# Database and RLS

## Migration model

All schema changes are UTC-named, forward-only SQL migrations under `supabase/migrations`. The local reset applies eight migrations in order:

1. Extensions, enums, private schema, and timestamp helper.
2. Profiles, Auth provisioning, admin RBAC, audit events, and protected functions.
3. Plans, typed entitlements, validation, and subscriptions.
4. Feature flags/rules, platforms, and branding.
5. Production-safe roles, permissions, plans, entitlements, flags, platforms, and branding catalog.
6. Least-privilege grants and RLS policies.
7. Atomic first-Super-Admin bootstrap RPC.
8. Narrow audit-actor anonymization for Auth FK deletion.

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
- Fixed `search_path` on security-sensitive functions.

## RLS behavior

RLS is enabled and forced on every exposed public table. Broad grants are revoked before narrow grants are added.

Authenticated users can:

- Read only their own profile.
- Update only `display_name`, `locale`, `timezone`, and `country_code`, and only while active.
- Read only their own allowlisted subscription columns while active.
- Read active public plans, definitions, and plan entitlement values.
- Call `get_my_admin_access`, which returns only their own active roles and expanded permissions.

Authenticated users cannot:

- Insert or mutate subscriptions.
- Read `activation_metadata`.
- Change plan, entitlement, onboarding, or account status.
- Read or mutate admin tables, feature rules, audit events, platform administration, or branding administration.
- Create admin membership or role assignments.

Anonymous users can read active public plan data only. The service role performs configuration and service-only operations, but application code must still minimize its use.

Suspended users can read their profile status for safe routing but cannot update it or read subscriptions. The API and web layouts apply the same account-status decision.

## Audit lifecycle

Audit rows reject direct updates and deletes, including service-role attempts. The sole exception is PostgreSQL's nested `ON DELETE SET NULL` action for `actor_user_id` when an Auth user is removed. The trigger verifies that only the actor FK changes, preserving the event and every other field.

Audit before/after/metadata values must be allowlisted and sanitized by the service that writes them. Tokens, documents, payment proof, raw private records, and arbitrary request bodies never belong in audit JSON.

## Generated types

`packages/database/src/generated.types.ts` is generated from the running local schema.

```text
pnpm db:types
pnpm db:types:check
```

The check generates a fresh copy without overwriting the committed file and fails on byte-normalized drift. CI runs it after a clean reset.

## pgTAP coverage

`pnpm db:test` runs 80 assertions across five files. Coverage includes schema/forced-RLS state, catalog prices and matrices, positive and negative reads/writes, cross-user access, column escalation, self-activation, self-promotion, suspended users, service-only operations, first-admin idempotency/auditing, and Auth-user audit anonymization.
