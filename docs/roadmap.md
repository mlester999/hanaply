# Roadmap

## Phase 0: production foundation

Status: implemented locally.

- Monorepo, strict tooling, contracts, design system, web/API/worker shells.
- Supabase schema, RLS, plans, entitlements, flags, platforms, admin RBAC, and audit.
- Login/logout and protected customer/admin boundaries.
- Local/CI validation, browser acceptance, and operational documentation.

## Phase 1: account and career profile

- Registration, email verification, recovery, and reset.
- Account/settings completion and onboarding state machine.
- Career Intelligence Profile, sub-careers, verified facts, and preferences.
- Private resume/portfolio upload, quarantine, scanning, parsing, and preview controls.
- Account deletion/export and owner-reviewed legal content.

## Phase 2: activation and payment review

- Manual payment submission, private proof storage, review queues, and audit trails.
- Authorized subscription activation, expiry, cancellation, and support tooling.
- Idempotent provider/payment references and reconciliation.
- Resend implementation for account and activation email categories.

## Phase 3: opportunity discovery

- Approved source adapters, source governance, robots/terms review, and schedules.
- Job normalization, deduplication, taxonomy, freshness, and moderation.
- Career radar configuration and database-backed match candidates.
- Distributed queue adapter, worker consumers, idempotency, retries, and dead-letter operations.

## Phase 4: explainable intelligence and application packs

- Provider implementations with prompt/model registry and cost controls.
- Requirement extraction, preliminary/deep matching, explanations, and gap analysis.
- Truth Gate against verified facts.
- Resume and cover-letter generation with versioned templates and human review.

## Phase 5: notifications and strategy

- Email alerts and daily digest through Resend.
- Browser notification permissions and delivery.
- Instant alerts, weekly strategy, interview preparation, and recruiter messages according to entitlements.
- Delivery preferences, quiet hours, idempotency, unsubscribe, and provider suppression handling.

## Phase 6: mobile

- React Native clients using the shared contracts/fetch transport.
- Secure session storage, device registration, push-token lifecycle, and deep links.
- Private document previews and platform compatibility enforcement.
- iOS/Android store readiness, privacy declarations, and mobile-specific security testing.

Each phase requires its own schema/security review, positive and negative tests, observability, operational runbooks, owner actions, and explicit release decision.
