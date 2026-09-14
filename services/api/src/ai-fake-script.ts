import {
  FakeAiProvider,
  type AiProvider,
  type AiStructuredGenerateRequest,
  type AiStructuredGenerateResult,
  type AiTaskKind,
} from '@hanaply/ai';

/**
 * A scripted `FakeAiProvider` for the browser suite.
 *
 * `AI_PROVIDER=fake` on its own selects a provider with an empty script, so
 * every generation through a running server fails with `not_configured`:
 * "The fake AI provider received no scripted response for this request."
 * In-process tests work around that by injecting `ApiRuntimeOverrides.aiProvider`
 * through `AppModule.register`, but a server started by Playwright has no such
 * hook, which made a model-written coach reply unreachable in the browser —
 * exactly the surface the end-to-end suite is supposed to prove.
 *
 * This module closes that gap without touching `@hanaply/ai`: it reads
 * `AI_FAKE_RESPONSES`, a JSON object keyed by AI task
 * (`coaching`, `opportunity_analysis`, `application_artifact`), and answers each
 * request from that task's queue. It is refused outside `local` and `test`, the
 * same environments `packages/config` allows `AI_PROVIDER=fake` in, so a
 * deployment cannot reach it. Nothing here is used when the variable is absent.
 *
 * Because a scripted response cannot know a tenant's identifiers, a string
 * anywhere in a scripted value may write `@fact:0` to cite the first admissible
 * confirmed fact the request carries, `@fact:1` the second, and so on. The
 * substitution is a test-double affordance, not a product feature: the truth
 * gate still rejects any identifier that is not admissible, so a script cannot
 * fabricate evidence.
 */

/**
 * Every task the provider can be asked for.
 *
 * Written as a `Record<AiTaskKind, true>` so the compiler refuses this file the
 * moment the union grows: a task missing here would silently answer
 * `not_configured` instead of the scripted response, which is exactly the kind
 * of quiet gap this seam exists to remove.
 */
const scriptedTasks: Record<AiTaskKind, true> = {
  job_extraction: true,
  preliminary_scoring: true,
  deep_job_analysis: true,
  resume_parsing: true,
  portfolio_parsing: true,
  cover_letter_generation: true,
  resume_tailoring: true,
  interview_preparation: true,
  recruiter_message: true,
  career_coaching: true,
  embedding: true,
  notification_summary: true,
};

function isScriptedTask(value: string): value is AiTaskKind {
  return Object.hasOwn(scriptedTasks, value);
}

const factReference = /@fact:(\d+)/gu;

export interface FakeScriptSource {
  AI_PROVIDER?: string | undefined;
  AI_MODEL?: string | undefined;
  HANAPLY_ENV?: string | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Replaces `@fact:N` with the Nth admissible fact identifier on the request.
 *
 * The walk is structural rather than schema-aware, so it works for any task's
 * response shape and never rewrites a key.
 */
function substituteFactReferences<T>(value: T, admissibleFactIds: readonly string[]): T {
  if (typeof value === 'string') {
    return value.replaceAll(factReference, (match, index: string) => {
      const factId = admissibleFactIds[Number(index)];
      if (factId === undefined) {
        throw new Error(
          `The AI_FAKE_RESPONSES script referenced ${match}, but the request carried ${admissibleFactIds.length} admissible confirmed fact(s). Confirm enough facts on the career profile first.`,
        );
      }
      return factId;
    }) as unknown as T;
  }
  if (Array.isArray(value)) {
    const entries: unknown[] = value;
    return entries.map((entry) => substituteFactReferences(entry, admissibleFactIds)) as T;
  }
  if (isRecord(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      result[key] = substituteFactReferences(entry, admissibleFactIds);
    }
    return result as unknown as T;
  }
  return value;
}

/**
 * Parses the script. Returns `null` when there is nothing to script, so the
 * caller falls back to `createAiProvider`.
 */
export function readFakeScript(
  raw: string | undefined,
  environment: FakeScriptSource,
): Record<string, readonly unknown[]> | null {
  if (environment.AI_PROVIDER !== 'fake') return null;
  if (!['local', 'test'].includes(environment.HANAPLY_ENV ?? '')) return null;
  const trimmed = raw?.trim();
  if (!trimmed) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    throw new Error(
      `AI_FAKE_RESPONSES is not valid JSON: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  }
  if (!isRecord(parsed)) {
    throw new Error('AI_FAKE_RESPONSES must be a JSON object keyed by AI task name.');
  }

  const script: Record<string, readonly unknown[]> = {};
  for (const [task, value] of Object.entries(parsed)) {
    if (!isScriptedTask(task)) {
      throw new Error(
        `AI_FAKE_RESPONSES has an unknown task "${task}". Use one of ${Object.keys(scriptedTasks).join(', ')}.`,
      );
    }
    if (!Array.isArray(value)) {
      throw new Error(`AI_FAKE_RESPONSES.${task} must be an array of responses.`);
    }
    script[task] = value;
  }
  return Object.keys(script).length > 0 ? script : null;
}

/** Answers each task from its own queue, then behaves like the stock fake. */
class ScriptedFakeAiProvider extends FakeAiProvider {
  readonly #script: Record<string, readonly unknown[]>;
  readonly #cursor = new Map<string, number>();

  constructor(options: { model: string; script: Record<string, readonly unknown[]> }) {
    super({ kind: 'fake', model: options.model });
    this.#script = options.script;
  }

  override structuredGenerate<TOutput>(
    request: AiStructuredGenerateRequest<TOutput>,
  ): Promise<AiStructuredGenerateResult<TOutput>> {
    const queue = this.#script[request.task];
    const position = this.#cursor.get(request.task) ?? 0;
    const next = queue?.[position];
    if (queue !== undefined && position < queue.length) {
      this.#cursor.set(request.task, position + 1);
      this.queue({ response: substituteFactReferences(next, request.admissibleFactIds) });
    }
    return super.structuredGenerate(request);
  }
}

/**
 * The provider the API should use, or `null` when no script is configured.
 */
export function createScriptedFakeProvider(
  environment: FakeScriptSource,
  raw: string | undefined = process.env.AI_FAKE_RESPONSES,
): AiProvider | null {
  const script = readFakeScript(raw, environment);
  if (script === null) return null;
  const model = environment.AI_MODEL;
  if (model === undefined) {
    throw new Error('AI_FAKE_RESPONSES requires AI_MODEL, exactly like AI_PROVIDER=fake does.');
  }
  return new ScriptedFakeAiProvider({ model, script });
}
