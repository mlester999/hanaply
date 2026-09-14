# AI and truth gating

Two rules govern every piece of intelligence Hanaply produces:

1. **Nothing is fabricated.** A missing attribute is reported as unknown, never guessed. Generated material may omit a claim, phrase it as transferable experience, ask the member, or record it as a gap — it may never invent it.
2. **Nothing is asserted that the member has not confirmed.** The evidence for any claim is a row in the `career_facts` truth ledger with `status = 'confirmed'`, and that rule is enforced by a database trigger rather than by convention.

Both rules are currently satisfied by deterministic code. There is no live AI generation anywhere in this repository.

## Live AI generation is not enabled

`packages/ai/src/index.ts` is a provider-neutral boundary and nothing more. It exports `AiProviderKind`, `AiTaskKind` (12 values including `job_extraction`, `preliminary_scoring`, `deep_job_analysis`, `resume_parsing`, `cover_letter_generation`, `resume_tailoring`, and `embedding`), `UntrustedSourceContent`, `AiGenerationRequest`, `AiUsage`, `TruthGateResult`, `AiGenerationResult`, `AiProvider`, and one implementation:

```ts
export class DisabledAiProvider implements AiProvider {
  readonly kind = 'openai_compatible' as const;
  generate<TOutput>(_request: AiGenerationRequest<TOutput>): Promise<AiGenerationResult<TOutput>> {
    return Promise.reject(new Error('Live AI generation is disabled in Phase 0'));
  }
  health(): Promise<'unavailable'> {
    return Promise.resolve('unavailable');
  }
}
```

No file under `services/api/src` or `services/worker/src` imports `@hanaply/ai` or any provider SDK, and neither service lists an AI dependency. The only traces of AI in the shipped system are forward-looking placeholders: the `ai_inference` value in `public.career_fact_source`, the nullable `model` and `prompt_version` columns on career document extractions, and the `ai.read`, `ai.manage`, and `prompts.publish` admin permissions, none of which the current controllers use.

What actually ships is deterministic:

- **Matching** is `scoreMatch` in `packages/matching/src/index.ts`, whose module header states that it "is deliberately deterministic: the same profile, job, and model version always produce the same score, every dimension contribution is returned, and nothing is written in prose by a language model." `modelVersion` is the literal `'matching-v1'`.
- **Resume extraction** is `extractCareerProfile` in `services/api/src/career-extraction.ts`, with `extractorVersion = 'deterministic-v1'`. Its module comment records the reason: "Every value is copied verbatim from a line that exists in the document", because "a missed item costs the user one form field, while a fabricated item would be a truthfulness failure." It imports only `node:crypto` and contract types. The service writes `model: null` and `promptVersion: null` alongside every extraction and records `extractor: 'deterministic'` and `status: 'needs_review'`.
- **Interview preparation, recruiter messages, cover letters, tailored resumes, and the weekly career strategy** have entitlement keys and database seams but no generator. The application pack and artifact tables exist, and artifacts are truth-gated on write, but no generation path populates them from a model.

## The matching engine

`packages/matching/src/index.ts` takes a `matchingCareerProfileSchema` profile, a `matchingJobSchema` job, and `ScoreMatchOptions` (`now`, `evidenceFactIds`, `confirmedFactCount`), and returns a `MatchResult`.

### Nine weighted dimensions

| Dimension               | Key                       | Weight | Label                   |
| ----------------------- | ------------------------- | -----: | ----------------------- |
| Role alignment          | `roleAlignment`           |     22 | Role alignment          |
| Skills coverage         | `skillsCoverage`          |     20 | Skills coverage         |
| Seniority alignment     | `seniorityAlignment`      |     12 | Seniority alignment     |
| Experience alignment    | `experienceAlignment`     |     12 | Experience alignment    |
| Location and work setup | `locationAlignment`       |     12 | Location and work setup |
| Compensation            | `compensationAlignment`   |      8 | Compensation            |
| Employment type         | `employmentTypeAlignment` |      6 | Employment type         |
| Career direction        | `careerDirection`         |      5 | Career direction        |
| Freshness               | `recency`                 |      3 | Freshness               |

The weights come from `dimensionWeights` and sum to 100.

### A dimension with insufficient data scores null

`DimensionScore.score` is `number | null`, documented as "0..100, or null when the available data cannot support a judgement". The engine collects every null dimension into `dataQuality.unknowns`.

Each dimension has an explicit insufficient-data condition:

| Dimension        | Returns null when                                                                                                                                                                 |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role alignment   | The profile records no target role titles                                                                                                                                         |
| Skills coverage  | The shared vocabulary is empty — the posting names no skills, the profile lists no skills, and no requirement carries a technology marker                                         |
| Seniority        | The posting's seniority is `unspecified`, or the profile has no career level, or either value is outside the seniority order                                                      |
| Experience       | The profile has no `yearsExperience`, or the posting states no minimum                                                                                                            |
| Location         | The posting states neither a work arrangement nor a location; or the posting is not remote, the profile records no preferred locations, and the posting is not in the Philippines |
| Compensation     | The profile records no salary minimum; or the posting publishes no salary; or the two are quoted in different currencies (they are then not compared at all)                      |
| Employment type  | The profile records no preferred employment types                                                                                                                                 |
| Career direction | The profile records no industries and has neither a headline nor a summary                                                                                                        |
| Freshness        | Never null. An unparsable or missing posting date returns the neutral score of 55                                                                                                 |

### Null contributes neutrally and the score is rescaled

```ts
const effective = score ?? neutralScore; // neutralScore = 55
contribution: Math.round((effective * weight) / 100);
```

The reported `contribution` for an unknown dimension is therefore its neutral value, so a reader sees what it added. The overall score, however, does **not** include it:

```ts
const knownWeight = sum of weights where score !== null
const knownContribution = sum of contributions where score !== null
const score = knownWeight === 0 ? 0 : clamp(Math.round((knownContribution / knownWeight) * 100))
```

The comment in the source gives the reason: "Unknown dimensions contribute a neutral value. The score is then rescaled so a profile with missing data is not artificially penalised or rewarded." A profile with no data at all in any dimension scores 0, because `knownWeight === 0`.

Selected dimension thresholds worth knowing:

- **Role alignment** is 100 for an exact normalized title match; otherwise the best of `round(containment * 80 + jaccardSimilarity * 40)`, and at least 70 when the profile's current role title matches the posting title or exceeds 0.6 Jaccard similarity.
- **Skills coverage** is `round(matched / vocabularySize * 100)`. The vocabulary is deliberately narrow: the posting's own skill list, the member's own skill list, and tokens in requirement text that carry an explicit technology marker (a `+`, `#`, or `.` symbol, or an all-caps acronym). Ordinary English words are never treated as skills, so a posting cannot be credited with a match it never asked for.
- **Seniority** uses an ordinal map: exact match 100, one step above 82, two steps 62, several steps above 30, one step below 78, well below 45.
- **Experience** is 100 when the member's years are within `[minimum, maximum + 2]`, 78 within one year below the minimum, and otherwise `clamp(round(100 - shortfall * 22))`.
- **Location** is 100 for a remote role when the member wants remote, 82 for remote otherwise, 45 for a remote role that may be country-restricted, 25 for on-site when the member asked for remote, 95 for a preferred location, 75 for a Philippines role with no stated preference, 45 for an acceptable foreign role, and 20 for a foreign role the member has not opted into.
- **Compensation** compares monthly-minor-normalized values (`toMonthlyMinor`: hourly × 8 × 22, daily × 22, annual ÷ 12). 100 when the whole advertised range meets the expectation, 80 when only the top end does, and `clamp(round((top / expectation) * 70))` when the top end falls short.
- **Career direction** is `clamp(70 + matchedIndustries * 10)` when a listed industry is mentioned, 45 when none is, and `clamp(round(40 + jaccardSimilarity * 120))` when direction is estimated from headline and summary.
- **Freshness** steps down with age: 100 within a day, 90 within three days, 75 within a week, 55 within two weeks, 35 within about a month, 15 beyond that.

### Confidence is computed separately from score

Confidence never feeds the score, and the score never feeds confidence.

```ts
const profileCompleteness =
  profile.skills.length >= 5 && profile.yearsExperience !== null && confirmedFactCount >= 3
    ? 'solid'
    : profile.skills.length > 0 || profile.yearsExperience !== null
      ? 'partial'
      : 'thin';
const jobDetail =
  job.requirements.length >= 3 && job.skills.length >= 3
    ? 'detailed'
    : job.requirements.length > 0 || job.skills.length > 0
      ? 'partial'
      : 'thin';
const confidence =
  profileCompleteness === 'solid' && jobDetail === 'detailed'
    ? 'high'
    : profileCompleteness === 'thin' || jobDetail === 'thin'
      ? 'low'
      : 'medium';
```

`confirmedFactCount` comes from `options.confirmedFactCount ?? options.evidenceFactIds?.length ?? 0`, so the count of confirmed career facts genuinely raises confidence without moving the score. This is also why `ScoreMatchOptions.evidenceFactIds` is documented as "Confirmed career fact identifiers. Their count drives confidence, not score."

The database agrees. `public.job_matches.confidence` is commented: "Separate from score: a high score computed from a thin profile is still low confidence and must be presented that way."

### Verdict thresholds

```ts
const verdict =
  blockers.length > 0
    ? 'not_recommended'
    : score >= 82 && confidence !== 'low'
      ? 'strong_match'
      : score >= 70
        ? 'good_match'
        : score >= 58
          ? 'stretch'
          : 'weak_match';
```

| Verdict           | Condition                                             | `verdictLabel`      |
| ----------------- | ----------------------------------------------------- | ------------------- |
| `not_recommended` | Any blocker present                                   | Not recommended     |
| `strong_match`    | Score at least 82 **and** confidence is not low       | Strong match        |
| `good_match`      | Score at least 70, or at least 82 with low confidence | Good match          |
| `stretch`         | Score at least 58                                     | Stretch opportunity |
| `weak_match`      | Score below 58                                        | Weak match          |

A blocker therefore overrides a perfect score, and a high score computed from a thin profile is capped at `good_match` rather than being presented as a strong match.

### Blocker rules

`MatchResult.blockers` is capped at five entries. Exactly three conditions produce one:

1. **Location.** `scoreLocationAlignment` returns a blocker — the only dimension that can — when the posting is outside the Philippines, the profile is not open to international work, and the profile is not open to relocation: `'This posting is outside the Philippines and your profile is not open to international roles.'`
2. **Excluded roles.** When a posting title matches a title in `profile.excludedRoleTitles` — either by normalized substring containment or by Jaccard similarity above 0.75 — the engine adds `'The role matches a role you asked Hanaply not to show you.'`
3. **Not active.** When `job.status !== 'active'`, it adds `'This posting is no longer active.'`

Blockers also change the recommendation: `buildRecommendedAction` returns `'Skip this one unless something in your situation has changed, and tell Hanaply why so future rankings improve.'` whenever any blocker is present, before it considers verdict or confidence.

Two related outputs are distinct from blockers, and neither forces `not_recommended`:

- **`rejectionRisks`** (capped at six) are screening risks the member should know about: unmet listed requirements, a seniority score below 62, an experience score below 70, a skills score below 45, and a posting with no published salary range.
- **`gaps`** (capped at six) name missing skills, a transferable-experience hint, and low experience, compensation, or employment-type scores. The transferable framing is explicit and deliberate: `'You may be able to frame adjacent experience with <skills> as transferable rather than claiming it directly.'`

`MatchResult` also carries `strengths` (capped at six), `requirementMapping`, `recommendedAction`, `dataQuality`, and `evidenceFactIds`.

### Requirement mapping

`buildRequirementMapping` produces at most 12 `RequirementMapping` entries, each with a status of `met`, `partially_met`, `unmet`, or `unknown`. The profile vocabulary it matches against is deliberately restricted to what the member can legitimately claim: listed skills, listed industries, and the skills recorded on their employment history. Requirement mapping is allowed a wider net than scoring — a capitalized term that is not at the start of a sentence is treated as a named technology — but the vocabulary used for the _score_ is not widened, "because widening the scoring vocabulary would distort coverage". When a posting lists no requirements and no preferred qualifications, the mapper falls back to the first six sentences of the description that are between 25 and 500 characters long.

Unmet requirements feed `rejectionRisks`, not `blockers`.

## The truth gate

### The `career_facts` ledger

`public.career_facts` is described in its own table comment as an "Append-oriented ledger of individual career claims. Only rows with status = confirmed are admissible evidence for generated application material."

| Column group | Columns                                                                                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Identity     | `id`, `career_profile_id`, `category` (`experience`, `responsibility`, `achievement`, `metric`, `skill`, `education`, `certification`, `preference`, `goal`) |
| Claim        | `statement` (3–500 characters), `confidence` (0–1)                                                                                                           |
| **Source**   | `source` — `user_entered`, `resume_extraction`, `ai_inference`, `imported`                                                                                   |
| **Status**   | `status` — `candidate`, `confirmed`, `rejected`, `superseded`, default `candidate`                                                                           |
| Evidence     | `evidence` jsonb pointer such as `{"kind":"employment","id":"<uuid>"}` or `{"kind":"document","id":"<uuid>","page":2}`                                       |
| Metrics      | `metric_value`, `metric_unit`, `metric_context`                                                                                                              |
| Provenance   | `document_id`, `confirmed_at`, `confirmed_by`, `superseded_by`, timestamps                                                                                   |

Two constraints matter:

- `career_facts_confirmation_check`: `status = 'confirmed'` implies `confirmed_at is not null`, and any other status implies `confirmed_at is null`. A confirmed fact cannot be a floating claim without a confirmation moment and actor.
- `career_facts_metric_check`: `metric_value` and `metric_unit` are both null or both present. The column comment states the intent: "Structured numeric evidence. Generated text may only quote numbers that exist here on a confirmed fact."

A unique partial index `career_facts_confirmed_statement_idx` on `(career_profile_id, lower(statement)) where status = 'confirmed'` prevents the same confirmed claim being recorded twice on one profile.

### Source and status are set by the writer, not the caller

`public.record_career_facts(actor_user_id, target_profile_id, facts, requested_source, source_document_id, action_request_id)` decides the initial status itself:

```sql
fact_status := case when requested_source = 'user_entered' then 'confirmed' else 'candidate' end;
```

So a fact the member typed is confirmed on the spot, while anything derived from a resume or an inference starts as `candidate` and requires an explicit decision. The function also requires `source_document_id` for `resume_extraction` and `ai_inference`, caps a batch at 200 facts, and requires a `metric_unit` whenever a `metric_value` is present.

`public.decide_career_fact(actor_user_id, target_fact_id, decision, override_statement, override_metric_unit, override_metric_value, action_request_id)` accepts `confirm`, `reject`, or `correct`:

- `confirm` sets `status = 'confirmed'`, `confirmed_at = now()`, `confirmed_by = actor`.
- `reject` sets `status = 'rejected'` and clears the confirmation columns.
- `correct` supersedes the original row and inserts a **new** row with `source = 'user_entered'` and `status = 'confirmed'`.
- A `superseded` fact can never be changed.

### Only `confirmed` facts are admissible evidence

```sql
create or replace function app_private.confirmed_fact_ids(target_career_profile_id uuid)
returns uuid[] ...
  select coalesce(pg_catalog.array_agg(fact.id order by fact.category, fact.created_at), '{}')
  from public.career_facts as fact
  where fact.career_profile_id = target_career_profile_id
    and fact.status = 'confirmed';
```

This is the single definition of admissible evidence. `candidate`, `rejected`, and `superseded` facts are invisible to it.

### The two validation triggers

**`validate_match_evidence`** — trigger `job_matches_validate_evidence` on `public.job_matches`, `before insert or update of evidence_fact_ids, career_profile_id`:

```sql
allowed := app_private.confirmed_fact_ids(new.career_profile_id);
foreach cited in array new.evidence_fact_ids
loop
  if not (cited = any (allowed)) then
    raise exception 'match evidence cites a fact that is not a confirmed claim on this profile'
      using errcode = '22023';
  end if;
end loop;
```

Its comment states the purpose: "This is the database-side half of the truth gate: the generator is expected to be honest, and the schema makes dishonesty impossible to persist."

**`validate_artifact_evidence`** — trigger `application_artifacts_validate_evidence` on `public.application_artifacts`, `before insert or update of evidence_fact_ids`:

```sql
select * into pack from public.application_packs where id = new.pack_id;
if pack.id is null then
  raise exception 'application pack does not exist' using errcode = 'P0002';
end if;
allowed := app_private.confirmed_fact_ids(pack.career_profile_id);
foreach cited in array new.evidence_fact_ids
loop
  if not (cited = any (allowed)) then
    raise exception 'an artifact may only cite confirmed career facts' using errcode = '22023';
  end if;
end loop;
```

The artifact trigger resolves admissibility through the **pack's** `career_profile_id`, because an artifact has no profile column of its own. `public.record_application_artifact` additionally compares the number of cited identifiers with the number of allowed ones and raises the same `22023` message when they differ, so an identifier outside the confirmed set can never be silently dropped instead of rejected.

Both triggers fire on `insert` and on `update` of the evidence column, so a later decision to reject a fact cannot be paired with a stale citation.

### What a generator may and may not do

Because admissibility is defined by the ledger, the permitted moves for any generated claim are:

| Permitted                                                                                                                         | Forbidden                                                    |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **Omit** the claim entirely                                                                                                       | Invent a claim, employer, title, date, or technology         |
| **Phrase it as transferable experience** — the engine already does this for adjacent skills, and does not assert the skill itself | Upgrade a `candidate` fact into an assertion                 |
| **Ask the member** to confirm or supply the missing item                                                                          | Treat repeated text, fluency, or plausibility as evidence    |
| **Record it as a gap** — `gaps` and `rejectionRisks` exist for exactly this                                                       | Quote a number that is not a confirmed fact's `metric_value` |

The second and fourth rows are enforced by the database. The first and third are design rules that the deterministic engine already follows: an unknown dimension is reported, not scored.

### The forward path

The intended AI design is already typed, so it can be added without changing the guarantee. `AiGenerationRequest` separates `trustedInstructions` from `untrustedInputs`, carries an explicit `verifiedFactIds` list, a named `outputSchemaName`, `timeoutMs`, `maxAttempts`, and a `validateOutput` callback. `AiGenerationResult` carries `provider`, `model`, `promptVersion`, `usage`, and a `TruthGateResult` with status `not_evaluated`, `passed`, `rejected`, or `needs_review` and an `unsupportedClaimIds` list. External pages, documents, job descriptions, and model output remain untrusted data and cannot enter trusted instructions directly.

Enabling any of it is an owner decision that requires data-processing, retention, region, cost, egress, and truth-gate review first; see [Owner actions](owner-actions.md).

## Related reading

- [Entitlements](entitlements.md) — how `coreAiAnalysis`, `advancedAiAnalysis`, and the pack limits gate these features
- [Job ingestion](job-ingestion.md) — how a posting becomes a `job_matches` row's input
- [Security and storage](security.md) — the external-content and prompt-injection boundary
