# Entitlements

Plans and entitlements are data, not code constants. They live in three catalog tables seeded by `supabase/migrations/20260722094000_foundation_catalog.sql`, and both the API and the database resolve them the same way.

## Where the definitions live

| Table                            | Purpose                                                                                                                                  |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `public.plans`                   | The four sellable plans: `code`, `tier_code`, `name`, `billing_period`, `currency`, `price_minor`, `active`, `display_order`, `metadata` |
| `public.entitlement_definitions` | The closed set of entitlement keys with `value_type`, `default_value`, `description`, `unit`, and `constraints`                          |
| `public.plan_entitlements`       | The per-plan values: `(plan_id, entitlement_key, value)`                                                                                 |

Related but separate: `public.subscriptions` holds the caller's term and status, and `public.entitlement_events` is an append-only record of entitlement changes.

## The plan catalog

All four plans are `active`, currency `PHP`, price in minor units.

| Code           | Tier | Name         | Period  | `price_minor` | Display |
| -------------- | ---- | ------------ | ------- | ------------: | ------: |
| `plus_monthly` | plus | Plus Monthly | monthly |        49,900 |    ₱499 |
| `plus_annual`  | plus | Plus Annual  | annual  |       479,900 |  ₱4,799 |
| `pro_monthly`  | pro  | Pro Monthly  | monthly |        99,900 |    ₱999 |
| `pro_annual`   | pro  | Pro Annual   | annual  |       959,900 |  ₱9,599 |

`tier_code` is a `public.plan_tier` enum with exactly two values, `plus` and `pro`. There is no free plan. `display_order` is 10, 20, 30, and 40 respectively.

`metadata` carries the default document styles for the tier. Plus gets `{"defaultCoverLetterStyles":["professional"],"defaultResumeStyles":["ats_professional"]}`; Pro gets `{"defaultCoverLetterStyles":["professional","results_first","warm_conversational"],"defaultResumeStyles":["ats_professional","results_led","technical_depth"]}`. Note that the Plus plan advertises one cover-letter style and one resume style, which matches its `coverLetterStyleSlotLimit` and `resumeStyleSlotLimit` of 1.

## Monthly and annual plans share entitlement values

`plan_entitlements` is inserted by joining a tier-level values list onto `public.plans` on `tier_code`:

```sql
insert into public.plan_entitlements (plan_id, entitlement_key, value)
select p.id, tv.entitlement_key, tv.value
from public.plans p
join tier_values tv on tv.tier_code = p.tier_code
on conflict (plan_id, entitlement_key) do update set value = excluded.value;
```

So the values are declared once per tier and land on both the monthly and the annual plan. Plus Monthly and Plus Annual are identical in every entitlement; only `billing_period`, `price_minor`, and `display_order` differ. The same holds for Pro.

## The entitlement catalog

`public.entitlement_definitions` holds 24 keys. Every `default_value` is the deny case: `0` for integers, `false` for booleans, and `"none"` for the one string key.

| Key                         | Type    | Default  | Unit        | Description                                          |
| --------------------------- | ------- | -------- | ----------- | ---------------------------------------------------- |
| `careerProfileLimit`        | integer | `0`      | profiles    | Maximum career search profiles                       |
| `subCareerLimitPerProfile`  | integer | `0`      | sub-careers | Maximum sub-careers per career profile               |
| `scanIntervalMinutes`       | integer | `0`      | minutes     | Target source discovery interval                     |
| `coverLetterPerJobLimit`    | integer | `0`      | documents   | Cover letters available per eligible job             |
| `tailoredResumePerJobLimit` | integer | `0`      | documents   | Tailored resumes available per eligible job          |
| `coverLetterStyleSlotLimit` | integer | `0`      | slots       | Configurable cover-letter style slots                |
| `resumeStyleSlotLimit`      | integer | `0`      | slots       | Configurable resume style slots                      |
| `automaticPackMonthlyLimit` | integer | `0`      | packs       | Approximate automatic Application Pack monthly limit |
| `sourceDiscoveryPriority`   | string  | `"none"` | —           | Allowed values `none`, `standard`, `priority`        |
| `emailAlerts`               | boolean | `false`  | —           | Email job alerts                                     |
| `dailyDigest`               | boolean | `false`  | —           | Daily digest email                                   |
| `instantAlerts`             | boolean | `false`  | —           | Instant opportunity alerts                           |
| `browserNotifications`      | boolean | `false`  | —           | Browser notification access                          |
| `basicResumeBuilder`        | boolean | `false`  | —           | Basic resume builder access                          |
| `advancedResumeTemplates`   | boolean | `false`  | —           | Advanced visual resume templates                     |
| `applicationTracking`       | boolean | `false`  | —           | Application tracking access                          |
| `coreAiAnalysis`            | boolean | `false`  | —           | Core AI job analysis                                 |
| `advancedAiAnalysis`        | boolean | `false`  | —           | Advanced AI job analysis                             |
| `interviewPreparation`      | boolean | `false`  | —           | Interview preparation tools                          |
| `recruiterMessages`         | boolean | `false`  | —           | Recruiter message generation                         |
| `weeklyAiCareerStrategy`    | boolean | `false`  | —           | Weekly AI career strategy                            |
| `priorityProcessing`        | boolean | `false`  | —           | Priority background processing                       |
| `futureMobileAccess`        | boolean | `false`  | —           | Future mobile application access                     |
| `automaticStretchPackOptIn` | boolean | `false`  | —           | Future opt-in for stretch-opportunity packs          |

The same closed set is mirrored in TypeScript as `entitlementDefinitions` in `packages/entitlements/src/index.ts`, which also enforces the value type and the `allowedValues` list for `sourceDiscoveryPriority` at evaluation time.

Three of these keys gate real delivery rather than reserved capacity. `app_private.notification_allowed(target_user_id, requested_category)` requires **both** the subscriber's own consent toggle in `public.user_notification_preferences` and the matching plan entitlement before anything is queued:

| Notification category | Consent column    | Required entitlement key |
| --------------------- | ----------------- | ------------------------ |
| `job_alert`           | `job_alerts`      | `emailAlerts`            |
| `daily_digest`        | `daily_digest`    | `dailyDigest`            |
| `weekly_strategy`     | `weekly_strategy` | `weeklyAiCareerStrategy` |

The migration comment states the rule: "Consent and entitlement are both required. Either one alone is not enough: an upgrade must never start sending mail a subscriber did not ask for." An unrecognized category returns `false`. See [Database and RLS](database.md) for the outbox and the worker that consumes it.

Five keys still gate features with no generator: `coreAiAnalysis`, `advancedAiAnalysis`, `interviewPreparation`, `recruiterMessages`, and `weeklyAiCareerStrategy`. They resolve correctly, but no live AI generation exists; see [AI and truth gating](ai-and-truth-gating.md).

## Plus and Pro values

| Entitlement                 |         Plus |          Pro |
| --------------------------- | -----------: | -----------: |
| `careerProfileLimit`        |            1 |            3 |
| `subCareerLimitPerProfile`  |            2 |            5 |
| `scanIntervalMinutes`       |           15 |            5 |
| `coverLetterPerJobLimit`    |            1 |            3 |
| `tailoredResumePerJobLimit` |            1 |            3 |
| `coverLetterStyleSlotLimit` |            1 |            3 |
| `resumeStyleSlotLimit`      |            1 |            3 |
| `automaticPackMonthlyLimit` |           40 |          100 |
| `sourceDiscoveryPriority`   | `"standard"` | `"priority"` |
| `emailAlerts`               |         true |         true |
| `dailyDigest`               |         true |         true |
| `instantAlerts`             |        false |         true |
| `browserNotifications`      |        false |         true |
| `basicResumeBuilder`        |         true |         true |
| `advancedResumeTemplates`   |        false |         true |
| `applicationTracking`       |         true |         true |
| `coreAiAnalysis`            |         true |         true |
| `advancedAiAnalysis`        |        false |         true |
| `interviewPreparation`      |        false |         true |
| `recruiterMessages`         |        false |         true |
| `weeklyAiCareerStrategy`    |        false |         true |
| `priorityProcessing`        |        false |         true |
| `futureMobileAccess`        |        false |         true |
| `automaticStretchPackOptIn` |        false |         true |

Pro is Plus plus the priority and alert tiers, higher document and profile limits, and a five-minute scan interval instead of fifteen.

`scanIntervalMinutes` is a _target_ cadence, not a per-subscriber polling rate. Ingestion is shared: one scan per source serves every subscriber, and the fastest active subscriber's `scanIntervalMinutes` only decides how often that shared scan runs, floored by the source's own `min_scan_interval_minutes`. See [Job ingestion](job-ingestion.md).

## Deny by default

A caller without an active subscription receives deny-by-default values, from two independent implementations that agree by construction.

**In TypeScript**, `evaluateEntitlements({ subscription, plan, now })` in `packages/entitlements/src/index.ts` returns the deny snapshot when:

- `subscription` is null or its `status` is anything other than `'active'`;
- `startsAt` is in the future; or
- `endsAt` is at or before `now`.

In every one of those cases it returns `planCode: null`, `validFrom: null`, `validUntil: null`, and `entitlements: { ...denyByDefaultEntitlements }`, where `denyByDefaultEntitlements` is derived from each definition's `defaultValue`.

When the subscription is active it additionally requires `plan.code === subscription.planCode` and validates the plan's entitlement map with `validatePlanEntitlements`, which throws `EntitlementConfigurationError` if a configured key is unknown **or** if any known key is missing from the plan. Malformed configuration therefore fails closed rather than silently granting access.

**In SQL**, `app_private.career_entitlements(actor_user_id)` aggregates `plan_entitlements` for a subscription where `status = 'active'`, `starts_at <= now()`, and `ends_at is null or ends_at > now()`. When nothing resolves it returns the empty object `'{}'::jsonb`. `app_private.career_entitlement_integer` then returns `0` for any key that is absent or not a JSON number, which is the deny-by-default path: no active subscription means every integer entitlement reads `0`.

## The server enforces limits inside SQL functions as well as in the API

Entitlement resolution happens on both sides of the boundary, and the database is the side that cannot be bypassed.

| Enforcement point                  | What it does                                                                                                                                   |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/entitlements` in the API | Resolves the caller's snapshot for `/v1/me/entitlements`, `/v1/me/subscription`, and feature gating                                            |
| `public.create_career_profile`     | Raises `'the current plan allows % career profiles'` with `errcode 42501` when the count of non-archived profiles reaches `careerProfileLimit` |
| `public.upsert_career_record`      | Raises the equivalent error for `subCareerLimitPerProfile` on new `sub_career` inserts; updates to existing sub-careers are exempt             |
| `app_private.consume_usage`        | The metering enforcement point for pack, document, and analysis features                                                                       |
| `public.create_application_pack`   | Raises `'the current plan allows % Application Packs this month'` with `errcode 42501` when the usage check refuses                            |
| `public.job_ingestion_schedule`    | Reads the fastest active subscriber's `scanIntervalMinutes` and floors it at the source's `min_scan_interval_minutes`                          |
| `public.matching_subjects`         | Sets `priority = 0` when the plan's `priorityProcessing` is `'true'`, otherwise `1`; only returns profiles with an active subscription at all  |

The practical consequence is blunt and intentional: with no active subscription, `careerProfileLimit` is `0` and `public.create_career_profile` refuses the very first profile with a `42501` entitlement error. Every mutation of this kind is reachable only through the API, which holds the service role, so there is no path around the SQL check.

## Changing a plan

Because plans, definitions, and values are catalog rows, changing what a plan includes is a data change:

1. **Add or change an entitlement key** by inserting into `public.entitlement_definitions` with its `value_type`, `default_value`, `description`, `unit`, and `constraints`. The `on conflict (key) do update` clause makes the migration re-runnable.
2. **Change a tier's value** by updating the tier values list and re-running the `plan_entitlements` insert, or by updating `public.plan_entitlements` directly for a plan. Because the insert selects on `tier_code`, a tier-level change reaches both the monthly and the annual plan in one statement.
3. **Add a plan** by inserting into `public.plans` with a `code`, `tier_code`, `billing_period`, `currency`, `price_minor`, `active`, and `display_order`. A new tier requires a new `public.plan_tier` enum value.
4. **Change a price** by updating `plans.price_minor`. Prices are positive PHP minor units, enforced by the table's own check.
5. **Mirror any new key** in `entitlementDefinitions` in `packages/entitlements/src/index.ts`, or `validatePlanEntitlements` will reject every plan whose entitlement map includes a key TypeScript does not know.

`public.plan_entitlements` has a `plan_entitlements_validate_value` trigger calling `app_private.validate_entitlement_json_value()`, so a value whose JSON type contradicts its definition is rejected at write time rather than at read time.

Do not add entitlement constants to UI components or controller code. `apps/web/src/app/admin/(protected)/subscriptions`, `/dashboard/activation`, and the pricing copy all read the catalog; a value that exists only in a component is a value the server will not enforce.

## Usage metering

Metering is the mechanism that turns an entitlement value into an enforced monthly allowance. It lives in `20260918090000_application_packs_and_tracker.sql`.

### Period

`app_private.usage_period_start()` returns `date_trunc('month', now() at time zone 'UTC')::date`, so periods are UTC calendar months.

### Two tables

**`public.usage_counters`** — one row per `(user_id, feature, period_start)`, enforced by `usage_counters_period_unique`.

| Column           | Meaning                                                                                                                                             |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `feature`        | `public.usage_feature`: `application_pack`, `resume_variant`, `cover_letter`, `ai_analysis`, `interview_prep`, `recruiter_message`, `coach_message` |
| `used`           | Units consumed this period                                                                                                                          |
| `limit_snapshot` | The allowance, snapshotted when the period opens, "so a mid-cycle plan change cannot retroactively invalidate usage that was already permitted"     |

**`public.usage_events`** — an append-only log with one row per metered operation.

| Column                | Meaning                                                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `feature`             | The metered feature                                                                                                                              |
| `units`               | Positive integer, default 1                                                                                                                      |
| `idempotency_key`     | 8–200 characters. "The idempotency key is what makes a retried request free instead of double billed, so it is the identity of the consumption." |
| `period_start`        | The period the consumption belongs to                                                                                                            |
| `application_pack_id` | Optional link to the pack the consumption produced                                                                                               |

### Feature to entitlement mapping

`app_private.usage_limit_for(actor_user_id, requested_feature)` maps:

| Feature                             | Entitlement key             |
| ----------------------------------- | --------------------------- |
| `application_pack`                  | `automaticPackMonthlyLimit` |
| `resume_variant`                    | `tailoredResumePerJobLimit` |
| `cover_letter`                      | `coverLetterPerJobLimit`    |
| `ai_analysis`                       | `coreAiAnalysis`            |
| `interview_prep`                    | `interviewPreparation`      |
| `recruiter_message`                 | `recruiterMessages`         |
| anything else, i.e. `coach_message` | `advancedAiAnalysis`        |

A missing key returns `0` (deny). A boolean key returns `100000` when true and `0` when false — booleans are "unlimited within the plan, represented as a large but finite ceiling so the counter still exists for operations reporting", not literally unlimited. A JSON number returns that integer; any other type returns `0`.

### The idempotency guarantee

`app_private.consume_usage(actor_user_id, requested_feature, requested_units, requested_idempotency_key, target_application_pack_id)` is where the guarantee lives:

1. Requires an active actor. Rejects `units` outside 1–1000 and idempotency keys outside 8–200 characters.
2. Reads the allowance and inserts the counter row `on conflict (user_id, feature, period_start) do nothing`, then selects it `for update` so concurrent calls serialize on the counter.
3. Inserts the event with `on conflict (user_id, feature, idempotency_key) do nothing returning true`.
4. **If nothing was inserted, the key has already been consumed.** It returns `{allowed: true, duplicate: true, used, limit, remaining}` and does not increment anything. This is the whole guarantee: "a repeated call returns the same decision without incrementing the counter, so a retry after a timeout can never double-charge a subscriber."
5. If `used + units > limit_snapshot`, it **deletes the event row it just inserted** and returns `{allowed: false, duplicate: false, used, limit, remaining}`. The refusal leaves no trace, so a denied attempt does not consume quota it was never granted.
6. Otherwise it increments `used` and returns `{allowed: true, duplicate: false, used, limit, remaining}`.

The unique constraint `usage_events_idempotency_unique (user_id, feature, idempotency_key)` scoped per feature is the mechanism, and its comment states the contract: "Append-only record of every metered operation. The unique idempotency key is the whole point: repeating an operation is free."

`public.create_application_pack` is idempotent twice over: first by identity, since `application_packs_unique (user_id, career_profile_id, job_id)` means an existing pack returns `{pack, created: false, usage: null}` and charges nothing; then by calling `consume_usage` with the caller's idempotency key. After a successful charge it back-fills `usage_events.application_pack_id` with the new pack id.

### Reporting

`public.usage_summary(actor_user_id)` returns `{periodStart, periodEnd, items}` where each item is `{feature, used, limit, remaining}` for all seven `usage_feature` values. It uses the live allowance rather than the snapshot. This backs `GET /v1/me/usage`.

## Related reading

- [AI and truth gating](ai-and-truth-gating.md) — what the AI entitlement keys will gate once a provider exists
- [Job ingestion](job-ingestion.md) — how `scanIntervalMinutes` and `min_scan_interval_minutes` interact
- [Database and RLS](database.md) — the catalog tables' policies and grants
- [Testing](testing.md) — the suites that assert the catalog values and the metering guarantee
