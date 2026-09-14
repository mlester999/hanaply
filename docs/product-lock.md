# Product lock

This document separates what Hanaply actually does from what is aspirational. A page, an empty state, or a marketing headline must not imply operational data or a capability that does not exist.

## What ships today

### Accounts and access

- Registration with required draft legal acknowledgements, email verification and resend, login and logout, cookie refresh, password recovery, reset, and change, and session revocation.
- Notification preferences that a member can actually set — product updates, marketing email, job alerts, daily digest, instant alerts, weekly strategy, and quiet hours — profile settings, authentication and account-status history, and account-state enforcement for `active`, `suspended`, `disabled`, and `pending_deletion`. The preferences are stored and gated correctly, and the worker queues and delivers alerts and the digest; live delivery still needs an approved email provider.
- Database-backed public pricing and server-side entitlement evaluation.

### Manual payment activation

- Manual payment methods with version history, effective windows, and amount limits; QR instructions delivered as short-lived signed URLs over private buckets.
- Customer drafts, validated proof image upload, submit, cancel, and resubmit after an information request.
- Reviewer claim locks with request-information, reject, and approve outcomes; approval atomically creates or extends one authoritative subscription.
- Refunds, approval reversals, and audited subscription corrections.
- A service-only notification outbox and private-object cleanup, driven by the worker.

No payment provider and no bank or e-wallet transfer is initiated by Hanaply. A submission is recorded evidence that an authorized human reviews.

### Career intelligence

- Multiple career profiles per the plan limit, with employment, projects, education, certifications, links, skills, and sub-careers.
- Resume and document upload (PDF, DOCX, RTF, plain text, Markdown; 10 MB maximum) into a private `career-documents` bucket, validated by magic bytes and re-checked against the declared filename extension.
- Deterministic resume extraction that produces a `needs_review` draft. Every extracted value is copied verbatim from a line that exists in the document, and the draft carries `model: null` and `promptVersion: null`.
- The `career_facts` truth ledger, where a member confirms, rejects, or corrects each claim. Only `confirmed` facts are admissible evidence, enforced by `validate_match_evidence` and `validate_artifact_evidence`.

### Job intelligence

- Job ingestion from nine provider adapters (Remotive, Arbeitnow, Hacker News Who Is Hiring, Greenhouse, Lever, Ashby, Workable, Adzuna, Jooble) across seven credential-free and two credential-backed providers.
- Multi-signal deduplication with retained provenance per source posting, and freshness transitions from active to stale to expired.
- A deterministic nine-dimension matching engine with a `matching-v1` model version, per-dimension contributions, honest unknown dimensions, and confidence computed separately from score.
- The Career Radar feed, saved opportunities, job intelligence detail, and save, unsave, and feedback actions.

No job provider is enabled. Every catalogued provider starts `paused`, so the radar has no live postings until an operator activates a source and the worker ingests it.

### Application packs and tracker

The tables, SQL functions, API routes, server actions, and pages exist for application packs, usage metering, and the eight-stage application tracker.

- `/dashboard/radar/[jobId]` carries the Application Pack action, which creates one pack per career profile and opportunity and draws one unit from the period allowance. It links to the pack instead when one already exists.
- `/dashboard/packs` shows the period allowance and the member's packs. `/dashboard/packs/[packId]` shows the pack status, how many confirmed career facts back it, and any stored artifacts with their own truth-gate result.
- `/dashboard/applications` is the tracker board, grouped by stage, with notes, next actions, and a per-application timeline.

What does **not** exist is artifact content generation. Nothing in the repository calls `record_application_artifact` or `complete_application_pack`, so a created pack has no artifacts, and its detail page shows an empty state rather than a placeholder. Hanaply does not write resumes, cover letters, or screening answers today.

## What is not implemented

- **Live AI generation.** `packages/ai/src/index.ts` exports only `DisabledAiProvider`, whose `generate` rejects. No service imports it or any provider SDK.
- **Application artifact generation.** Pack creation, viewing, usage display, and the tracker ship; the generator that would populate `application_artifacts` does not.
- **Account export and deletion.** No route, no worker.
- **Opportunity notification delivery in operation.** Consent toggles, quiet hours, the `notification_outbox`, consent-and-entitlement gating, `job-alert` and `daily-digest` templates, and the queue/claim/deliver/complete cycle in `services/worker/src/jobs.ts` all exist, but the shipped `EMAIL_PROVIDER` is `disabled`, so nothing leaves the process until an owner configures and approves Resend and sender DNS. `instant_alerts` and `weekly_strategy` are stored preferences with no queue function or template, and browser push is not implemented at all.
- **A production task queue.** `services/worker/src/queue.ts` is test-only.
- **Native iOS and Android clients.** `platform_settings` seeds both as `planned`.
- **Any hosted environment.** No hosted Supabase project, Resend domain, DNS record, deployment, or remote migration.

## No invented data, anywhere

- Every score, dimension contribution, and gap in the radar comes from `packages/matching` and is persisted in `job_matches`. No statistic is hardcoded in a customer surface.
- Admin totals and directory rows come from the database.
- Pricing, payment instructions, payment status, subscription state, and entitlement evaluation are real catalog and subscription records.
- The large visuals on the marketing home page (`CareerRadarSimulator`, `ApplicationPackDemo`, `ProductPreviews`, `ProductScenes`, `CareerSignalPreview`) render **hardcoded sample data**. They take no props, fetch nothing, and label themselves in the interface as `Demonstration Data`, `Product visualization`, `Conceptual customer dashboard`, and `VISION SIMULATION · NO REAL ACTION`. A sample profile named "Alex Santos" and fictional employers such as "Northstar Systems" appear only inside them.
- The radar visual is code-native. There are no stock screenshots, fake customer logos, generated product images, or fake metrics anywhere in the application.

## Marketing copy

`apps/web/src/content/landing.ts` was stale and contradicted this document; it has since been corrected to match the code:

| Location        | Copy now shipped                                                                                                                                                                 | Matches reality |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| `productStatus` | Seven entries covering the account foundation, Activation Center, career profile and resume review, Career Radar, Application Packs and tracker, alerts and coaching, and mobile | Yes             |
| FAQ answers     | Rewritten in the present tense, including that extraction can only propose, that nine match dimensions are explained, and that provider data carries attribution                 | Yes             |
| `roadmap`       | Six phases marked available and two in progress, with mobile planned                                                                                                             | Yes             |

Marketing copy is part of the product surface and must be updated in the same change as the feature it describes. A status claim on the landing page is a claim about the product, and this document treats it as one.

## Locked marketing language

- Headline: **Your career radar never stops searching.**
- Copy: **Hanaply discovers fresh jobs, analyzes how well they match your real experience, and prepares tailored resumes and cover letters for opportunities worth pursuing.**
- Primary CTA: **Build My Career Radar**
- Secondary CTA: **See How Hanaply Works**
- Trust line: **Verified facts. Explainable signals. You stay in control.**
- Tagline: **Hanap smarter. Apply stronger.**

The second line promises tailored resumes and cover letters. The pack record, the artifact schema, the truth gate that would constrain the wording, and the entitlement keys that gate the feature all exist, and a member can create a pack from an opportunity page. What does not exist is the generator that writes the content. Copy that promises usable output should not appear inside a pack view that has no artifacts to show.

## Plan catalog

| Code           | Tier | Period  | PHP minor units | Display price |
| -------------- | ---- | ------- | --------------: | ------------: |
| `plus_monthly` | Plus | Monthly |          49,900 |       PHP 499 |
| `plus_annual`  | Plus | Annual  |         479,900 |     PHP 4,799 |
| `pro_monthly`  | Pro  | Monthly |          99,900 |       PHP 999 |
| `pro_annual`   | Pro  | Annual  |         959,900 |     PHP 9,599 |

Monthly and annual plans in the same tier share entitlement values. No free plan exists. A caller without a valid active subscription receives `planCode: null` and deny-by-default values. Full detail is in [Entitlements](entitlements.md).

### Plus

- 1 career profile and 2 sub-careers per profile
- 15-minute source scan target
- 1 cover letter and 1 tailored resume per eligible job
- 1 cover-letter and 1 resume style slot
- 40 automatic packs monthly
- Standard processing
- Email alerts, daily digest, core analysis, basic resume building, and application tracking

### Pro

- 3 career profiles and 5 sub-careers per profile
- 5-minute source scan target
- 3 cover letters and 3 tailored resumes per eligible job
- 3 cover-letter and 3 resume style slots
- 100 automatic packs monthly
- Priority processing and future stretch-pack opt-in
- Everything in Plus, plus instant and browser alerts, advanced analysis and templates, interview preparation, recruiter messages, weekly strategy, and future mobile access

Entitlement values are configuration, not client input. Unknown, incomplete, or malformed active-plan configuration returns `SERVICE_UNAVAILABLE`.

Entitlement keys are sold ahead of the features they name. `coreAiAnalysis`, `advancedAiAnalysis`, `interviewPreparation`, `recruiterMessages`, and `weeklyAiCareerStrategy` resolve correctly today, but no generator consumes them. Treat them as reserved capacity, not as delivered capability.

## Copy rules

1. A stat, score, or count on a customer surface must come from the database or from `packages/matching`.
2. A demo visual must be labeled as demonstration data in the interface, not only in a comment.
3. An empty state must say what is missing and why, the way `job-intelligence.tsx` does for application packs.
4. A feature with an entitlement key but no implementation must not be presented as available.
5. No page may imply a payment, a transfer, an email, or a job posting exists unless a record of it does.
