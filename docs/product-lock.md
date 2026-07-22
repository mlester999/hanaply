# Product lock

This document separates implemented Phase 1 behavior from approved future scope. A page or empty state must not imply operational data that does not exist.

## Phase 1 scope

- Working registration, email verification/resend, login/logout, cookie refresh, password recovery/reset/change, and session revocation.
- Required draft legal acknowledgements, optional preferences, profile settings, authentication/status history, and account-state enforcement.
- Marketing, pricing, legal-draft, security, help, customer, activation, settings, and admin shells.
- Database-backed public pricing and server-side entitlement evaluation.
- Permissioned real-data admin overview, user directory/detail, suspend/restore, session revocation, audit directory, and safe security diagnostics.
- Supabase Auth email templates, Mailpit local delivery, and production-gated capture/disabled/Resend application adapters.
- Platform/feature foundations, idle worker, disabled AI provider, security boundaries, migrations, RLS, CI, and operational documentation.

No job, revenue, payment, application, or AI statistic is invented. Admin identity/account totals and directory rows come from the local/hosted database. Activation Center pricing/subscription state is real, while payment instructions explicitly remain unavailable.

## Locked marketing language

- Headline: **Your career radar never stops searching.**
- Copy: **Hanaply discovers fresh jobs, analyzes how well they match your real experience, and prepares tailored resumes and cover letters for opportunities worth pursuing.**
- Primary CTA: **Build My Career Radar**
- Secondary CTA: **See How Hanaply Works**
- Trust line: **Verified facts. Explainable signals. You stay in control.**
- Tagline: **Hanap smarter. Apply stronger.**

The radar visual is code-native. There are no stock screenshots, fake customer logos, generated product images, or fake metrics.

## Plan catalog

| Code           | Tier | Period  | PHP minor units | Display price |
| -------------- | ---- | ------- | --------------: | ------------: |
| `plus_monthly` | Plus | Monthly |          49,900 |       PHP 499 |
| `plus_annual`  | Plus | Annual  |         479,900 |     PHP 4,799 |
| `pro_monthly`  | Pro  | Monthly |          99,900 |       PHP 999 |
| `pro_annual`   | Pro  | Annual  |         959,900 |     PHP 9,599 |

Monthly and annual plans in the same tier share entitlement values. No free plan exists. A caller without a valid active subscription receives `planCode: null` and deny-by-default values.

### Plus

- 1 career profile and 2 sub-careers per profile
- 15-minute source scan target
- 1 cover letter and tailored resume per eligible job
- 1 cover-letter and resume style slot
- 40 automatic packs monthly
- Standard processing
- Email alerts, daily digest, core analysis, basic resume building, and application tracking

### Pro

- 3 career profiles and 5 sub-careers per profile
- 5-minute source scan target
- 3 cover letters and tailored resumes per eligible job
- 3 cover-letter and resume style slots
- 100 automatic packs monthly
- Priority processing and future stretch-pack opt-in
- Everything in Plus, plus instant/browser alerts, advanced analysis/templates, interview preparation, recruiter messages, weekly strategy, and future mobile access

Entitlement values are configuration, not client input. Unknown, incomplete, or malformed active-plan configuration returns `SERVICE_UNAVAILABLE`.

## Deferred Phase 2 and later systems

- Career profile onboarding and resume/portfolio handling
- Payment submission, review, activation, and accounting
- Job-source ingestion, deduplication, taxonomy, matching, and alerts
- AI extraction, analysis, document generation, and Truth Gate execution
- Non-authentication notifications, hosted Resend/DNS operationalization, and provider webhooks/suppressions
- Browser and mobile push delivery
- Production queues and worker consumers
- Native iOS/Android applications
- Hosted deployment and production analytics

These systems require later migrations, services, security review, and acceptance gates. Existing contracts, entitlement names, settings, and empty states are seams, not claims of availability. Phase 2 must not begin without owner approval after the Phase 1 report.
