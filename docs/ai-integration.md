# AI integration

How `@hanaply/ai` is wired into the API and the web application: the routes, the
metering, the pack generator choice, and what a deployment that has no provider
configured actually does.

[AI and truth gating](ai-and-truth-gating.md) documents the rules and the
deterministic engine underneath them. This document covers the seam: what calls
the layer, what it stores, and what the interface is allowed to say.

## The rule, restated at the seam

The model may never originate a factual claim about the member. `packages/ai`
enforces it in three places — trusted instructions built in code, a fixed output
schema per task, and `gateGeneratedOutput` rejecting any claim the confirmed
evidence does not support — and `supabase/migrations` enforces it again for
anything stored. This layer's only job is to not route around either.

Three consequences are visible in every response shape:

1. **Generated output never travels without its grounding.** `aiGroundingReportSchema`
   is a required field on every response that can carry model text, so a client
   cannot render a report without also holding the per-claim verdicts.
2. **Score and confidence come from `@hanaply/matching` only.** The analysis
   response carries `deterministicMatch`, copied from the stored match result.
   The model's output schema has no score field, and `findScoreLikeFields` in the
   truth gate rejects a response that invents one.
3. **Deterministic output is never labelled AI, and AI output is never labelled
   deterministic.** `aiProvenanceSchema.generated` says which one produced a
   payload, and the pack generation response carries `ai.path` explicitly.

## Routes

All five are authenticated-user routes; the actor comes from the verified access
token and no route accepts a user id.

| Route                                                       | What it does                                                                            |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `POST /v1/me/opportunities/{jobId}/analysis`                | Generates a grounded opportunity analysis, cached by evidence fingerprint               |
| `GET /v1/me/opportunities/{jobId}/analysis`                 | Reads the stored analysis without generating                                            |
| `GET /v1/me/coach/conversations`                            | Lists the caller's coach threads, with a provenance block for the surface's empty state |
| `POST /v1/me/coach/conversations`                           | Opens a thread                                                                          |
| `GET /v1/me/coach/conversations/{conversationId}`           | One thread with its messages, each carrying `facts` and `suggestions` separately        |
| `POST /v1/me/coach/conversations/{conversationId}/messages` | Sends a message and returns the thread with the grounded reply                          |
| `GET /v1/me/ai/status`                                      | Whether generation is configured, which provider and model, and the capability set      |

`GET /v1/me/ai/status` deliberately exposes no key, no base URL, and no
deployment name. It reports `configured`, `provider`, `model`, `degraded`,
`state`, the three capability values, and `deterministicAlternatives` — the list
of what still works, which is what the interface renders when generation is
unavailable.

## Opportunity analysis

`services/api/src/ai.service.ts` composes the request with
`buildOpportunityAnalysisRequest` from inputs it **reads** rather than recomputes:

| Input to the builder | Where it comes from                                                            |
| -------------------- | ------------------------------------------------------------------------------ |
| `match`              | `readPackMatchSnapshot(jobDetail.match)` — the matching engine's stored output |
| `facts`              | `confirmed_career_evidence` — the `status = 'confirmed'` ledger                |
| `profile`            | `career_profile_detail`, mapped onto `MatchingCareerProfile`                   |
| `job`                | `job_detail`, mapped onto `MatchingJob`                                        |

Nothing in `ai.service.ts` calls `scoreMatch`. The score, verdict, confidence,
dimension contributions, and requirement mapping are quoted from the stored
result, and `renderDeterministicInput` gives the model that same block as
authoritative data.

### The cache is keyed on evidence

`opportunity_analyses` has a unique key on
`(career_profile_id, job_id, provider, model, prompt_version, evidence_fingerprint)`.
The fingerprint is a SHA-256 over the sorted confirmed fact identifiers, the
match score, the match model version, and the profile and job identifiers. So:

- Confirming or rejecting a fact changes the fingerprint, and the next read
  generates rather than serving reasoning built on evidence the member has since
  changed.
- Re-running the same request with the same evidence is a cache hit: no provider
  call, no quota consumed, `cached: true` in the response.
- `refresh: true` skips the cache lookup and generates again.

A cache hit is recorded as an `ai_invocations` row with `cached = true`, so cost
reporting can tell cached reads from generated ones even though neither charges
a second unit.

## Coach

A thread is opened, the member's message is appended, a grounded reply is
generated, and the reply is appended. Order and storage rules:

- **The member's message is stored whether or not generation succeeds.** It is
  their text; losing it would be worse than a failed reply.
- **The assistant message is stored only after the truth gate passes.** The
  `coach_messages` check constraint refuses an assistant row that asserts facts
  (`jsonb_array_length(facts) > 0`) without citing confirmed fact ids
  (`cardinality(cited_fact_ids) > 0`), so an uncited claim cannot be persisted
  even if both earlier checks were bypassed.
- **Facts and suggestions are separate columns with separate shapes.** A `fact`
  carries `evidenceFactIds`; a `suggestion` is `kind: 'inference'` and cites
  nothing. A fact whose citations do not survive the admissible set is dropped
  from the facts channel rather than stored as an uncited assertion.
- **The body text labels the channels too.** `renderCoachBody` writes "What your
  confirmed facts support" and "Suggestions from Hanaply (inference, not a fact
  about you)" into the stored body, so a member reading the raw text still sees
  which sentence is which.

When generation is refused or fails, the reply is a stored notice that asserts
nothing about the member (`facts: []`), states what happened, and states that
nothing was charged.

## Application Pack artifacts

The existing deterministic generator stays the default and the fallback. The
request body carries `generator: 'auto' | 'deterministic'`:

| Condition                                           | Path that runs                  |
| --------------------------------------------------- | ------------------------------- |
| `generator: 'deterministic'`                        | `pack-generation.ts`            |
| No provider configured, or the provider is degraded | `pack-generation.ts`            |
| The pack has no frozen match result to quote        | `pack-generation.ts`            |
| Otherwise                                           | The provider, per artifact kind |

When the AI path runs, a kind the provider fails to produce, the truth gate
refuses, or the database refuses is **reported as skipped and replaced by the
deterministic draft for that kind**. A provider failure therefore cannot leave a
pack half-written, and the response names exactly which kinds fell back and why:

```json
{
  "ai": {
    "path": "ai",
    "provenance": { "generated": true, "provider": "openai", "model": "gpt-4o-mini" },
    "grounding": { "status": "passed" },
    "aiKinds": ["strategy", "requirement_map"],
    "aiSkippedKinds": [{ "kind": "resume", "reason": "…" }]
  }
}
```

Every draft — model-written or template-written — is persisted through the
existing `record_application_artifact`, so `validate_artifact_evidence` applies
to model output exactly as it applies to template output. There is no second
write path and no bypass.

The AI path is only reached when the pack has a frozen match result, because the
artifact prompt quotes the deterministic match analysis. Rather than hand the
model a zero score the engine never produced, a pack created before its posting
was scored is written deterministically and says so.

## Metering

Quota is consumed **exactly once per logical operation**, and the guarantee is
built the way `public.create_application_pack` builds its own: from the identity
of the operation rather than from the request.

`AiMeter` is keyed on an idempotency key derived server-side from who asked,
about what, and under which evidence:

| Operation            | Key identity                                                                    |
| -------------------- | ------------------------------------------------------------------------------- |
| Opportunity analysis | `opportunity_analysis` + user + profile + job + evidence fingerprint + `first`  |
| Forced refresh       | The same, ending in the server request id, because a refresh is a new operation |
| Coach message        | `coach_message` + user + conversation + SHA-256 of the message body             |
| Pack artifacts       | `artifact_generation` + user + pack + kinds + style + request id                |

The key contains no prompt, no completion, and no message text.

Three behaviours follow:

1. **A repeat is free.** A second `consume` under a key already in the ledger
   returns the same decision with `charged: false` and does not touch a counter.
2. **Entitlement comes first.** The allowance is read from `usage_summary` — the
   same source the usage page shows — so a plan that does not include the feature
   is refused with a 403 `ENTITLEMENT_REQUIRED` naming the allowance, and no
   generation starts.
3. **A generation that produced nothing consumes nothing.** `consume` reserves;
   `release` gives the reservation back. A provider failure, a truth-gate
   refusal, or a database refusal releases the unit, so a failed generation costs
   the member nothing and a later attempt at the same operation is a first
   attempt again rather than a repeat.

### What the database half does and does not do

`app_private.consume_usage` advances `usage_counters` and is the authority for
`application_pack`, which `public.create_application_pack` charges. The migration
that introduced the AI tables exposes **no service-role function that consumes
`ai_analysis` or `coach_message`** — `app_private.consume_usage` is not grantable
from the API, and the API does not reach around that with a direct write to
`usage_counters`. The API therefore reads the plan's allowance and the counter
from `usage_summary`, and holds the exactly-once guarantee in its own meter.

**The limitation, stated plainly:** the meter is process-local. With more than
one API instance, a retry routed to a different instance is a second charge. The
durable fix is a `security definer` wrapper that calls
`app_private.consume_usage(actor, feature, 1, idempotency_key)` for the two AI
features, exposed to `service_role`; that is a `supabase/**` change and is not
part of this work. Within one process the guarantee holds, and the integration
test asserts it.

## Degraded behaviour

`createAiProvider` never throws. A malformed environment, a selected provider
with no credential, and a missing base URL each produce a `DisabledAiProvider`
carrying the reason, so the caller always has a provider to ask and the answer to
"can a model generate?" is a value rather than an exception.

When no model may generate:

| Surface                | Behaviour                                                                                                                                                                                           |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/me/ai/status` | 200, `configured: false`, `degraded: true`, `reason` stated, and `deterministicAlternatives` listing what still works                                                                               |
| Opportunity analysis   | 200, `analysis: null`, `provenance.generated: false` with the reason, `grounding.status: 'not_evaluated'`, and `deterministicMatch` populated so the interface can point at the deterministic brief |
| Coach                  | The thread opens and the member's message is stored; the reply is a notice saying generation is unavailable, with `facts: []`                                                                       |
| Pack generation        | The deterministic generator runs and `ai.path` says `deterministic`                                                                                                                                 |

Nothing 500s because AI is unconfigured, and nothing returns deterministic text
labelled as model output. `grounding.status` is `not_evaluated` rather than
`passed` on a degraded response, so no client can present the absence of output
as a verified result.

## Observability

`ai_invocations` records one row per model call, including refusals and including
calls made while no provider exists, because a rising refusal rate is the signal
that a prompt or a model has regressed. The row holds the operation, provider,
model, prompt version, request id, outcome, rejection reason, token counts,
latency, attempt, and whether it was served from cache.

It has **nowhere to put a prompt or a completion**, by construction: the
function's own signature has no such parameter. The service logger follows the
same rule — it emits request ids, model, token counts, latency, and outcome, and
never a prompt, a completion, resume text, or a key.

`operation` is deliberately separate from `usage_feature`: it records what a call
was for, which may be free, while `usage_feature` meters billable quota.

## Tests

| File                               | Covers                                                                                                                                                                                                                                       |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/unit/ai-config.test.ts`     | Environment parsing, provider selection, `AI_PROVIDER=fake`, and the degraded state for a selected provider that cannot be constructed                                                                                                       |
| `tests/integration/ai-api.test.ts` | Every route against an injected `FakeAiProvider`: a generated analysis, a cached second read, a forced refresh, a grounding refusal, the coach round trip, exactly-once metering, a plan without the feature, and the disabled-provider path |

The provider is injected through `ApiRuntimeOverrides.aiProvider`, the same
mechanism `careerRepository` and `adminJobsRepository` use, so the routes run
against a deterministic, network-free provider that takes the real truth gate.

## Related reading

- [AI and truth gating](ai-and-truth-gating.md) — the rules, the matching engine, and the ledger
- [Entitlements](entitlements.md) — `coreAiAnalysis`, `advancedAiAnalysis`, and the metered features
- [Testing](testing.md) — how the suites are run
