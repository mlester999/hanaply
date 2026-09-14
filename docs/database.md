# Database and RLS

## Migration model

All schema changes are UTC-named, forward-only SQL migrations under `supabase/migrations`. The local reset applies 27 migrations in order. The first 13 establish the Phase 0 and Phase 1 foundation:

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

The career, job intelligence, matching, radar, and application-pack domains add seven more:

20. `20260914090000_career_intelligence_profile.sql` - career profiles, sub-careers, employment, projects, education, certifications, links, skills, the `career_facts` truth ledger, completeness scoring, and the career read models.
21. `20260914095000_career_documents_and_parsing.sql` - the private `career-documents` bucket, `app_private.career_document_extractions`, and the document registration, extraction, and access functions.
22. `20260915090000_job_ingestion_foundation.sql` - job sources, companies, canonical jobs, source provenance, ingestion runs, dedup candidates, ingestion locks, the source catalog, scheduling, the `upsert_ingested_job` write path, and freshness maintenance.
23. `20260916090000_opportunity_intelligence.sql` - saved jobs, job feedback, job matches, and the `validate_match_evidence` truth-gate trigger.
24. `20260916095000_career_radar_feed.sql` - the ranked radar feed and job detail read models.
25. `20260917090000_match_computation_support.sql` - the `matching_subjects` and `matching_job_candidates` functions the worker uses to decide what to score.
26. `20260918090000_application_packs_and_tracker.sql` - usage counters and events, application packs, artifacts with the `validate_artifact_evidence` truth gate, the eight-stage application tracker, and the timeline.
27. `20260919090000_job_alerts_and_digest.sql` - real notification consent toggles, quiet hours, the `notification_outbox` table, consent-and-entitlement gating, and the queue/claim/complete/release functions for job alerts and digests. The `create trigger` count is higher than the runtime trigger count because some migrations drop and recreate a trigger under the same name.

`supabase/seed.sql` contains comments only: it has no users and no product activity, and states that static catalog data is migration-owned so every environment receives the same baseline.

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
- Read their own career profiles, sub-careers, employment history, projects, education, certifications, links, skills, facts, and documents, while active.
- Read only active job postings and active job sources. Neither the provenance table `job_source_records`, nor `job_ingestion_runs`, nor `job_dedup_candidates` is readable through a customer policy, and anonymous users read no job data at all.
- Read their own saved jobs, job feedback, cached job matches, usage counters, application packs, artifacts, tracked applications, and application events, while active.

Authenticated users cannot:

- Insert or mutate subscriptions.
- Read `activation_metadata`.
- Change plan, entitlement, onboarding, or account status.
- Read or mutate admin tables, feature rules, audit events, platform administration, or branding administration.
- Create admin membership or role assignments.
- Read another user's identity, legal, preference, authentication, session, status, suspension, delivery, career, job-tracking, usage, or application records.
- Update/delete authentication events, status history, or audit events.
- Write any career, job, match, usage, pack, or tracker row directly. Every one of those tables has `select` policies only; all writes go through `security definer` functions.

Every RLS policy in the schema is `for select`, with the single exception of `profiles_update_own_active`. Tables with RLS enabled and no policy at all — including `admin_memberships`, `audit_events`, `feature_flags`, `platform_settings`, `branding_settings`, `job_source_records`, `job_ingestion_runs`, `job_dedup_candidates`, `payment_notifications`, and the payment history tables — are unreadable and unwritable from a customer or anonymous session by construction.

Anonymous users can read active public plan data only. The service role performs configuration and service-only operations, but application code must still minimize its use.

Suspended users can read their profile status for safe routing but cannot update it, read subscriptions/preferences, or use protected API orchestration. Disabled and pending-deletion users receive the unavailable state. The login action, server layouts, API guard, session checks, and RLS apply the same fail-closed decision.

Admin directory and mutation functions are service-role callable only, but they require an actor UUID and resolve the actor's active database permissions internally. Account actions reject self-status changes, protect the final active Super Admin, require a bounded reason, write account-status history and audit rows, and support only suspend and restore. Payment method, review, refund, reversal, and subscription-correction functions repeat the same database-side permission checks and optimistic-version and lock checks. Career, job, match, usage, pack, and tracker functions likewise require the service role and then verify the supplied actor owns the row and holds an active account; the ingestion, scheduling, freshness, evidence, and metering functions require the service role and nothing else, because they are called only by the worker.

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

`pnpm db:test` runs the 14 suites through the Supabase CLI, and `pnpm db:harness:test` runs the same 14 suites through the Dockerless harness. Together they contain **582 assertions**. In addition to the Phase 0 and Phase 1 coverage, the suites cover: canonical prices and method windows; draft, proof, submit, resubmit, review, and approval transitions; optimistic conflicts; duplicate references and proofs; review locks; atomic subscription and entitlement assignment; renewal term guards; refunds, reversals, corrections, and expiry; claim-token notifications; cleanup jobs; forced RLS; private columns; private storage buckets; resolver authorization; direct-write rejection; career profiles, records, sub-career limits, the fact ledger and its decisions, completeness, and documents; job sources, scheduling, locks, upsert and deduplication signals, provenance, freshness, and ingestion entitlements; saved jobs, feedback, match persistence, the evidence trigger, and the radar and detail read models; usage metering idempotency, pack creation, artifact truth gating, the tracker, and the timeline; and notification consent and entitlement gating, quiet hours, the outbox, idempotent queueing, and claim/complete/release.

Per-suite assertion counts are listed in [Testing](testing.md).

## Notifications

`20260919090000_job_alerts_and_digest.sql` turns the Phase 1 notification placeholders into real consent. It drops the Phase 1 `user_notification_preferences_check` constraint that pinned `future_job_alerts` and `future_daily_digest` to false, keeps those historical columns unused so the migration stays forward-only, and adds real toggles: `job_alerts`, `daily_digest`, `instant_alerts`, `weekly_strategy`, `quiet_hours_start`, and `quiet_hours_end` (local hour 0–23, Asia/Manila, null disables quiet hours).

`public.notification_outbox` is the delivery queue, separate from the Phase 2 `public.payment_notifications` outbox. It has forced RLS, is fully revoked from `public`, `anon`, and `authenticated`, and is accessible only to the service role. `category` is constrained to `job_alert`, `daily_digest`, or `weekly_strategy`; `template_version` is pinned to `'v1'`; `idempotency_key` is unique, so a repeated queueing pass inserts nothing new.

Service-role-only functions: `queue_job_alert_notifications`, `queue_job_digest_notifications`, `claim_notification_outbox`, `complete_notification_outbox`, and `release_notification_outbox`, with `app_private.notification_allowed` and `app_private.notification_in_quiet_hours` as the gating helpers. The Phase 1 `update_my_notification_preferences` signature was dropped and replaced rather than overloaded, so a caller cannot change preferences without touching the new toggles.

The notification cycle in `services/worker/src/jobs.ts` calls `queue_job_alert_notifications`, `queue_job_digest_notifications`, `claim_notification_outbox`, `complete_notification_outbox`, and `release_notification_outbox`. It resolves each claimed row's category from its `template_id` through `emailTemplateCategory` rather than trusting a stored category, so a row whose template and category disagree is refused as `notification_template_unsupported` instead of being rendered with a mismatched category. Delivery runs through the configured email provider, which defaults to `disabled`; with that default the worker completes nothing and no mail leaves the process.

`instant_alerts` and `weekly_strategy` are stored preferences with no queue function and no template. `application_reminder` categories have no template either.

## Roll-forward and rollback reasoning

Migrations are forward-only. No down migration is shipped because reversing identity/security changes can destroy audit or legal evidence. A faulty unreleased local migration is corrected with another migration before deployment. After hosted deployment, recovery is a reviewed roll-forward migration; destructive rollback requires an owner-approved backup/PITR restore and incident plan. Remote migration execution is never automatic in CI.
