import type {
  AiCapabilities,
  AiGroundingClaim,
  AiGroundingReport,
  AiProvenance,
  AiStatus,
  CoachTopic,
  PackGenerationAi,
  PackGenerationPath,
} from '@hanaply/contracts';
import type { BadgeTone } from '@hanaply/ui';

/** `ai` or `deterministic`: who writes one capability in this deployment. */
type AiCapability = AiCapabilities['opportunityAnalysis'];

/**
 * Display helpers for the AI surfaces.
 *
 * Everything the AI layer returns is already labelled: a response states whether
 * a model wrote it, which claims the truth gate supported, and what is available
 * when it is not. This module only turns those labels into sentences, tones, and
 * option lists, and it never decides anything of its own.
 *
 * Two rules shape every function here.
 *
 *   - It has no score and no confidence. The only score or confidence any
 *     surface may show comes from `deterministicMatch`, which the API copies
 *     from `@hanaply/matching`; nothing in this file computes or invents one.
 *   - "Not generated" is a state with copy attached, not an error. Every
 *     accessor that can be reached with `generated: false` returns a reason
 *     sentence, so no caller can render an empty box or label deterministic
 *     output as model-written.
 */

/**
 * How a provider kind is named in a sentence. The list mirrors
 * `aiProviderKindSchema`; an unknown kind is printed as-is rather than being
 * mapped to a vendor the deployment did not configure.
 */
const providerLabels: Readonly<Record<string, string>> = {
  disabled: 'no provider',
  fake: 'the development fake provider',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  azure_openai: 'Azure OpenAI',
  openrouter: 'OpenRouter',
  together: 'Together AI',
  groq: 'Groq',
  deepseek: 'DeepSeek',
  ollama: 'Ollama',
  vllm: 'vLLM',
  openai_compatible: 'an OpenAI-compatible provider',
};

export function providerLabel(kind: string | null): string {
  if (kind === null) return 'no provider';
  const labels: Readonly<Record<string, string>> = providerLabels;
  return labels[kind] ?? kind;
}

function humaniseToken(value: string): string {
  const spaced = value.replaceAll('_', ' ').trim();
  if (spaced === '') return value;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export const aiStateLabels: Readonly<Record<AiStatus['state'], string>> = {
  available: 'AI generation is available',
  degraded: 'AI generation is degraded',
  unavailable: 'AI generation is unavailable',
  disabled: 'AI generation is switched off',
};

export function aiStateTone(state: AiStatus['state']): BadgeTone {
  switch (state) {
    case 'available':
      return 'success';
    case 'degraded':
      return 'warning';
    case 'unavailable':
      return 'danger';
    case 'disabled':
      return 'neutral';
  }
}

/** What the member is being told, in one sentence, for each capability. */
export function aiCapabilitySentence(capability: AiCapability): string {
  return capability === 'ai'
    ? 'A model may write this. Every statement it produces is checked against your confirmed facts before anything is stored.'
    : 'Hanaply’s own engine writes this from your confirmed facts. No model is involved.';
}

export interface AiCapabilityRow {
  key: 'opportunityAnalysis' | 'coach' | 'artifactGeneration';
  label: string;
  capability: AiCapability;
}

export function aiCapabilityRows(status: AiStatus): readonly AiCapabilityRow[] {
  return [
    {
      key: 'opportunityAnalysis',
      label: 'Opportunity analysis',
      capability: status.capabilities.opportunityAnalysis,
    },
    { key: 'coach', label: 'Coach', capability: status.capabilities.coach },
    {
      key: 'artifactGeneration',
      label: 'Application Pack artifacts',
      capability: status.capabilities.artifactGeneration,
    },
  ];
}

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

export interface ProvenanceSummary {
  tone: BadgeTone;
  /** Who wrote the payload, stated plainly. */
  headline: string;
  /** Provider, model, prompt version, and cost, when the API reported them. */
  details: readonly string[];
  /** Why nothing was generated, when nothing was. Never null when it was not. */
  reason: string | null;
}

/**
 * `subject` names what is being described, for the headline sentence.
 *
 * When `generated` is false the headline says so outright. There is deliberately
 * no branch that describes unattributed text as model output.
 */
export function summariseProvenance(provenance: AiProvenance, subject: string): ProvenanceSummary {
  const details: string[] = [`Provider: ${providerLabel(provenance.provider)}`];
  if (provenance.model !== null) details.push(`Model: ${provenance.model}`);
  if (provenance.promptVersion !== null) {
    details.push(`Prompt version: ${provenance.promptVersion}`);
  }
  if (provenance.inputTokens !== null) details.push(`Input tokens: ${provenance.inputTokens}`);
  if (provenance.outputTokens !== null) details.push(`Output tokens: ${provenance.outputTokens}`);
  if (provenance.latencyMs !== null) details.push(`Latency: ${provenance.latencyMs} ms`);

  if (!provenance.generated) {
    return {
      tone: provenance.degraded ? 'warning' : 'neutral',
      headline: `${subject} was not written by a model.`,
      details,
      reason: unavailableReason(provenance),
    };
  }

  const writer = provenance.model ?? providerLabel(provenance.provider);
  return {
    tone: 'brand',
    headline: `${subject} was written by ${writer} under the truth gate.`,
    details,
    reason: provenance.reason,
  };
}

/**
 * The sentence a surface prints when nothing generated the payload.
 *
 * A response that carries no output also carries the reason, so this is what
 * keeps "AI is unavailable" from becoming an empty box.
 */
export function unavailableReason(provenance: AiProvenance): string {
  const reason = provenance.reason?.trim() ?? '';
  return reason === ''
    ? 'Hanaply did not report why generation was unavailable, so nothing is claimed about it here.'
    : reason;
}

// ---------------------------------------------------------------------------
// Grounding
// ---------------------------------------------------------------------------

export const groundingStatusLabels: Readonly<Record<AiGroundingReport['status'], string>> = {
  passed: 'Every checked claim was supported',
  partial: 'Some claims were dropped',
  rejected: 'The generated text was refused',
  not_evaluated: 'Not evaluated on this read',
};

export function groundingTone(status: AiGroundingReport['status']): BadgeTone {
  switch (status) {
    case 'passed':
      return 'success';
    case 'partial':
      return 'warning';
    case 'rejected':
      return 'danger';
    case 'not_evaluated':
      return 'neutral';
  }
}

export interface GroundingSummary {
  tone: BadgeTone;
  statusLabel: string;
  /** One sentence a surface can print under the status badge. */
  sentence: string;
  supported: number;
  dropped: number;
  rejected: number;
  totalClaims: number;
  /** Claims the gate did not support, so the interface can show them in place. */
  refusedClaims: readonly AiGroundingClaim[];
}

export function summariseGrounding(report: AiGroundingReport): GroundingSummary {
  const counts = { supported: 0, dropped: 0, rejected: 0 };
  for (const claim of report.claims) {
    counts[claim.status] += 1;
  }
  const refusedClaims = report.claims.filter((claim) => claim.status !== 'supported');
  const totalClaims = report.claims.length;

  let sentence: string;
  if (report.status === 'not_evaluated') {
    sentence =
      'The truth gate did not run on this read. The per-claim verdicts were computed when the text was generated or stored, and reading it back does not re-check it, so no verdict is claimed here.';
  } else if (totalClaims === 0) {
    sentence = `The gate recorded no individual claims for this response. It checked ${report.numericClaimsChecked} numeric, ${report.entityClaimsChecked} entity, and ${report.experienceClaimsChecked} experience claims, and admitted ${report.admissibleFactIds.length} of your confirmed facts as evidence.`;
  } else {
    sentence = `${counts.supported} of ${totalClaims} checked ${totalClaims === 1 ? 'claim' : 'claims'} were supported by your confirmed facts. The gate checked ${report.numericClaimsChecked} numeric, ${report.entityClaimsChecked} entity, and ${report.experienceClaimsChecked} experience claims, and admitted ${report.admissibleFactIds.length} confirmed ${report.admissibleFactIds.length === 1 ? 'fact' : 'facts'} as evidence.`;
  }

  return {
    tone: groundingTone(report.status),
    statusLabel: groundingStatusLabels[report.status],
    sentence,
    supported: counts.supported,
    dropped: counts.dropped,
    rejected: counts.rejected,
    totalClaims,
    refusedClaims,
  };
}

// ---------------------------------------------------------------------------
// Application Pack generation path
// ---------------------------------------------------------------------------

export function packGenerationPathLabel(path: PackGenerationPath): string {
  return path === 'ai' ? 'AI under the truth gate' : 'the deterministic generator';
}

export interface PackGenerationSummary {
  path: PackGenerationPath;
  pathLabel: string;
  /** The sentence a success notice leads with. */
  headline: string;
  /** Where the wording came from, and what checked it. */
  detail: string;
  /** One sentence per kind the model was asked for and did not produce. */
  skipped: readonly string[];
}

/**
 * Which path wrote the artifacts, in the words the member is shown.
 *
 * The two paths are not interchangeable — one quotes confirmed facts through a
 * fixed template, the other is a model writing prose under the truth gate — so
 * the headline names the one that actually ran and never blends them.
 */
export function summarisePackGeneration(ai: PackGenerationAi): PackGenerationSummary {
  const grounding = summariseGrounding(ai.grounding);
  const skipped = ai.aiSkippedKinds.map(
    (entry) => `${humaniseToken(entry.kind)} was not produced by the model: ${entry.reason}`,
  );

  if (ai.path === 'deterministic') {
    return {
      path: ai.path,
      pathLabel: packGenerationPathLabel(ai.path),
      headline: 'Written by the deterministic generator',
      detail:
        'Hanaply composed each artifact from your confirmed career facts through a fixed template. No model wrote this text, and nothing here is a model’s paraphrase of your evidence.',
      skipped,
    };
  }

  const model = ai.provenance.model ?? providerLabel(ai.provenance.provider);
  return {
    path: ai.path,
    pathLabel: packGenerationPathLabel(ai.path),
    headline: `Written by ${model} under the truth gate`,
    detail: `Provider ${providerLabel(ai.provenance.provider)}, grounding: ${grounding.statusLabel.toLowerCase()}. Every statement was checked against your confirmed facts, and anything the gate did not support was kept out of the stored artifacts.`,
    skipped,
  };
}

// ---------------------------------------------------------------------------
// Coach
// ---------------------------------------------------------------------------

/**
 * The coach topics, mirroring `coachTopicSchema`.
 *
 * The `satisfies` clause is the point: adding a topic to the contract without
 * adding it here is a type error rather than a form that silently cannot open
 * the new kind of thread.
 */
export const coachTopics = [
  'general',
  'career_strategy',
  'resume',
  'profile',
  'skills',
  'job_search',
  'interview',
  'application',
] as const satisfies readonly CoachTopic[];

export const coachTopicLabels: Readonly<Record<CoachTopic, string>> = {
  general: 'General',
  career_strategy: 'Career strategy',
  resume: 'Resume',
  profile: 'Profile',
  skills: 'Skills',
  job_search: 'Job search',
  interview: 'Interview',
  application: 'Application',
};

export function coachTopicLabel(topic: string): string {
  const labels: Readonly<Record<string, string>> = coachTopicLabels;
  return labels[topic] ?? humaniseToken(topic);
}

export function coachConversationStatusLabel(status: 'open' | 'archived'): string {
  return status === 'open' ? 'Open' : 'Archived';
}

export function messageCountLabel(count: number): string {
  return count === 1 ? '1 message' : `${count} messages`;
}
