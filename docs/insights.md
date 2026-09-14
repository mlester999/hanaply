# Career insights and coaching

`public.career_insights(actor_user_id, career_profile_id, window_weeks)` returns the analytics and coaching payload for one career profile. It is defined in `supabase/migrations/20260921090000_career_insights_and_coaching.sql` and exposed as `GET /v1/me/career/insights`.

Nothing in this path calls a model. Every number is arithmetic over data the subscriber already produced: their career profile, their confirmed fact ledger, the opportunities they were matched against, and their own tracker. That is a deliberate choice. A weekly summary that is computed from real counts is cheaper, faster, and more trustworthy than generated prose, and there is nothing in it that can be invented.

## The two rules

**A rate with a zero denominator is null, never zero.** Telling someone who has not applied anywhere that their response rate is 0% is a false statement, and it is the kind of false statement that changes behaviour. Every rate in the payload — `strongMatchRate`, `interviewRate`, `offerRate`, `rejectionRate` — is `null` until its denominator is non-zero. `app_private.safe_rate(numerator, denominator)` is the only place a ratio is computed.

**Every coaching suggestion carries its evidence.** `app_private.coach_suggestion` requires an `evidence` argument, so a suggestion cannot be emitted without the count that justifies it, and the evidence is structured data rather than prose. If the subscriber cannot see why the product is telling them something, they cannot judge whether it is true.

## Payload

| Section           | Contents                                                                                                                                              |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `profileStrength` | The completeness percentage and, for each field that changes match quality, whether it is present and what its absence costs.                         |
| `matching`        | Opportunities analysed in the window, strong matches, and the strong match rate.                                                                      |
| `pipeline`        | Saved, applied, interviewing, offer, and rejected counts, plus the three rates.                                                                       |
| `gaps`            | Requirements the subscriber does not meet across **two or more** opportunities, most frequent first. A single unmet requirement is not yet a pattern. |
| `salary`          | The observed range across matched postings at or above a score of 55, the sample size, the stated expectation, and how many postings fall below it.   |
| `directions`      | Normalized job titles among matched opportunities, with a count and an average score.                                                                 |
| `activity`        | Weekly buckets across the window, each with the number of opportunities analysed and applications started.                                            |
| `coaching`        | Ranked suggestions, each with a title, a detail, an action, a priority, and its evidence.                                                             |

## Field impact, and why it matters

`app_private.profile_strength` reports each field in the order it affects the score, and states the consequence of leaving it blank. These are not generic tips; each one names the mechanism:

- **Target role titles** — role alignment is the heaviest dimension, so without it the engine can only fall back on the current title.
- **Career level** — seniority alignment compares this against the posting, so without it a mid-level and a principal role score the same.
- **Years of experience** — experience alignment is reported as unknown rather than assumed, which lowers confidence on every result.
- **Preferred work arrangement** — this is how on-site roles in another country are excluded instead of being recommended.
- **Preferred locations** — location alignment cannot be scored without it.
- **Salary expectation** — compensation alignment stays unknown, so a role below the floor is not flagged.
- **Excluded role titles** — these become hard blockers, so without them those roles still reach the radar.
- **Professional summary** — at least 80 characters gives the requirement mapping something to match against.

## Salary comparison is currency-safe

`belowExpectationCount` filters to postings whose currency matches the stated expectation. A PHP expectation against a USD posting is not a comparable number, and the payload does not present one as if it were. When no expectation is stated the field is `null` rather than zero.

## Suggestions

The rules are evaluated in priority order, and only the ones that are true for this subscriber are emitted:

| Key                | Condition                               | Why it fires                                                                       |
| ------------------ | --------------------------------------- | ---------------------------------------------------------------------------------- |
| `create_profile`   | No career profile exists                | Nothing can be ranked.                                                             |
| `confirm_facts`    | Fewer than five confirmed facts         | Generated material may cite confirmed facts only.                                  |
| `complete_profile` | Any high-impact field is missing        | Each missing field is reported as unknown.                                         |
| `start_applying`   | Opportunities saved, none applied to    | Saving is not applying, so the funnel stays empty.                                 |
| `review_targeting` | Five or more applications, no interview | At that volume the pattern points at targeting or material.                        |
| `widen_search`     | Opportunities analysed, no strong match | Either the targets are too narrow or the profile lacks the fields the score needs. |
| `address_gaps`     | Three or more repeated gaps             | A requirement that repeats is worth learning or targeting around.                  |

The list is capped at six so it stays actionable.

## Authorization

The function requires an active actor and resolves the profile through `app_private.resolve_insight_profile`, which calls `require_career_profile_owner` when a profile is named. Only `service_role` may execute it; the API resolves the actor from the access token and passes it explicitly, so a client cannot ask for someone else's insights. `supabase/tests/database/150_career_insights.test.sql` asserts all of this, including that a subscriber cannot read another subscriber's profile through it.

## Known limitations

- The window is bounded to 52 weeks and the gap list to ten entries.
- `directions` groups by normalized title only. Employer, industry, and seniority are not yet part of the grouping.
- Nothing here is persisted. The payload is computed on read, which is cheap at the current data volume but would need caching before it is called on every dashboard load at scale.
- Coaching is rule-based, not generated. There is no plan to replace it with a model; a model would add cost and a fabrication risk without adding accuracy to arithmetic.
