# Product lock

This document separates implemented Phase 0 behavior from approved future scope. A page or empty state must not imply operational data that does not exist.

## Phase 0 scope

- Working password login, logout, cookie refresh, auth callback, route protection, suspension handling, and admin enforcement.
- Marketing, pricing, legal-draft, security, help, customer, activation, settings, and admin shells.
- Database-backed public pricing and server-side entitlement evaluation.
- Platform and feature configuration foundations.
- Idle worker, disabled email provider, and disabled AI provider.
- Security boundaries, migrations, RLS, tests, CI, and operational documentation.

Registration, recovery, reset, and verification routes are polished Phase 1 placeholders. No job, user, revenue, payment, application, or AI statistics are invented.

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

## Deferred product systems

- Career profile onboarding and resume/portfolio handling
- Payment submission, review, activation, and accounting
- Job-source ingestion, deduplication, taxonomy, matching, and alerts
- AI extraction, analysis, document generation, and Truth Gate execution
- Email delivery through Resend
- Browser and mobile push delivery
- Production queues and worker consumers
- Native iOS/Android applications
- Hosted deployment and production analytics

These systems require later migrations, services, security review, and acceptance gates. Their contracts in Phase 0 are seams, not claims of availability.
