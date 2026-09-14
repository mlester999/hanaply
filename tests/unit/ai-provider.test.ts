import { describe, expect, it } from 'vitest';

import {
  AiProviderError,
  DisabledAiProvider,
  FakeAiProvider,
  OpenAiCompatibleProvider,
  applicationArtifactAiSchema,
  backoffDelay,
  createAiProvider,
  defaultBaseUrl,
  extractJsonObject,
  isAiUnavailable,
  isDegraded,
  isDeterministicOnly,
  readUsage,
  strictifyJsonSchema,
  withBoundedRetries,
  type AiPromptEnvelope,
  type AiStructuredGenerateRequest,
  type AiUsageEvent,
  type FetchLike,
} from '@hanaply/ai';

import {
  admissibleFactIds,
  automationJob,
  careerProfile,
  confirmedFacts,
} from './fixtures/ai-fixtures.js';

const API_KEY = 'sk-hanaply-test-key-do-not-log-0123456789';

/** A small artifact, used as the schema under test for the transport itself. */
const artifactOutput = applicationArtifactAiSchema;

function artifact(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'cover_letter',
    title: 'Cover letter',
    sections: [{ heading: 'Opening', paragraphs: ['I am applying.'] }],
    evidenceFactIds: ['c1000000-0000-4000-8000-0000000000f1'],
    ...overrides,
  };
}

function prompt(overrides: Partial<AiPromptEnvelope> = {}): AiPromptEnvelope {
  return {
    system: ['You are Hanaply. Never originate a factual claim about the member.'],
    user: 'HANAPLY_UNTRUSTED_ABCD BEGIN UNTRUSTED DATA\njob text\nHANAPLY_UNTRUSTED_ABCD END UNTRUSTED DATA',
    untrustedDelimiter: 'HANAPLY_UNTRUSTED_ABCD',
    untrustedSources: [
      {
        sourceId: 'job-1',
        sourceType: 'job_post',
        sha256: 'a'.repeat(64),
        originalLength: 120,
        includedLength: 100,
        truncated: false,
      },
    ],
    promptVersion: 'ai-v1',
    truncated: false,
    neutralisedInstructionRemovals: 0,
    ...overrides,
  };
}

function request(
  overrides: Partial<AiStructuredGenerateRequest<Record<string, unknown>>> = {},
): AiStructuredGenerateRequest<Record<string, unknown>> {
  return {
    requestId: 'req-0001',
    task: 'deep_job_analysis',
    output: artifactOutput,
    prompt: prompt(),
    budgets: { maxOutputTokens: 400, timeoutMs: 5_000, maxAttempts: 3, temperature: 0 },
    admissibleFactIds: ['fact-1'],
    ...overrides,
  };
}

interface RecordedCall {
  readonly url: string;
  readonly init: RequestInit;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function completionBody(
  content: string,
  usage = { prompt_tokens: 120, completion_tokens: 40 },
): unknown {
  return {
    model: 'gpt-test',
    choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage,
  };
}

/** A scripted response, or a function that receives the request it answers. */
type ScriptedResponse = Response | ((init: RequestInit) => Response | Promise<Response>);

function recordingFetch(responses: readonly ScriptedResponse[]): {
  fetch: FetchLike;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  let index = 0;
  const fetchImplementation: FetchLike = (url, init) => {
    calls.push({ url, init });
    const entry = responses[Math.min(index, responses.length - 1)];
    index += 1;
    if (entry === undefined) throw new Error('no scripted response');
    return Promise.resolve(typeof entry === 'function' ? entry(init) : entry);
  };
  return { fetch: fetchImplementation, calls };
}

function provider(
  responses: readonly ScriptedResponse[],
  overrides: Partial<ConstructorParameters<typeof OpenAiCompatibleProvider>[0]> = {},
): { provider: OpenAiCompatibleProvider; calls: RecordedCall[] } {
  const recorded = recordingFetch(responses);
  return {
    provider: new OpenAiCompatibleProvider({
      kind: 'openai',
      model: 'gpt-test',
      baseUrl: 'https://api.example.test/v1',
      apiKey: API_KEY,
      structuredOutput: 'json_schema',
      defaultBudgets: request().budgets,
      retryBaseDelayMs: 1,
      fetch: recorded.fetch,
      now: () => 1_000,
      sleep: () => Promise.resolve(),
      ...overrides,
    }),
    calls: recorded.calls,
  };
}

function bodyOf(call: RecordedCall | undefined): Record<string, unknown> {
  const raw = call?.init.body;
  if (typeof raw !== 'string') throw new Error('request body was not a string');
  return JSON.parse(raw) as Record<string, unknown>;
}

describe('the fake provider', () => {
  it('round-trips a schema-valid response and records the request', async () => {
    const fake = new FakeAiProvider({ responses: [artifact({ title: 'Grounded summary.' })] });
    const result = await fake.structuredGenerate(request());

    expect(result.value.title).toBe('Grounded summary.');
    expect(result.meta.provider).toBe('fake');
    expect(result.meta.model).toBe('hanaply-fake-1');
    expect(result.meta.promptVersion).toBe('ai-v1');
    expect(result.meta.finishReason).toBe('stop');
    expect(result.meta.attempts).toBe(1);
    expect(result.meta.usage.inputTokens).toBeGreaterThan(0);
    expect(fake.requests).toHaveLength(1);
    expect(fake.lastRequest?.request.requestId).toBe('req-0001');
    expect(fake.lastRequest?.system).toEqual(prompt().system);
    expect(fake.lastRequest?.user).toContain('BEGIN UNTRUSTED DATA');
  });

  it('rejects a response that does not match the schema', async () => {
    const fake = new FakeAiProvider({ responses: [artifact({ sections: 42 })] });
    await expect(fake.structuredGenerate(request())).rejects.toMatchObject({
      code: 'schema_invalid',
    });
  });

  it('produces each failure mode as a typed error rather than raw provider text', async () => {
    const cases = [
      { mode: 'timeout', code: 'timeout' },
      { mode: 'malformed_json', code: 'malformed_response' },
      { mode: 'schema_invalid', code: 'schema_invalid' },
      { mode: 'rate_limit', code: 'rate_limit' },
      { mode: 'server_error', code: 'provider_error' },
      { mode: 'auth', code: 'auth' },
      { mode: 'network', code: 'network' },
    ] as const;

    for (const entry of cases) {
      const fake = new FakeAiProvider({ failures: [{ mode: entry.mode }] });
      const error = await fake.structuredGenerate(request()).then(
        () => null,
        (thrown: unknown) => thrown,
      );
      expect(error).toBeInstanceOf(AiProviderError);
      expect(error).toMatchObject({ code: entry.code, provider: 'fake', requestId: 'req-0001' });
    }
  });

  it('marks exactly the transient codes retryable', async () => {
    const retryable = new FakeAiProvider({ failures: [{ mode: 'rate_limit' }] });
    const permanent = new FakeAiProvider({ failures: [{ mode: 'auth' }] });

    const rateLimited = await retryable
      .structuredGenerate(request())
      .catch((error: unknown) => error);
    const unauthenticated = await permanent
      .structuredGenerate(request())
      .catch((error: unknown) => error);

    expect(rateLimited).toMatchObject({ retryable: true });
    expect(unauthenticated).toMatchObject({ retryable: false });
  });

  it('simulates a timeout when the scripted delay exceeds the budget', async () => {
    const fake = new FakeAiProvider({ responses: [] });
    fake.queue({ delayMs: 9_000, response: artifact() });
    await expect(
      fake.structuredGenerate(request({ budgets: { ...request().budgets, timeoutMs: 1_000 } })),
    ).rejects.toMatchObject({ code: 'timeout' });
  });

  it('throws a typed error when it is asked for a response it was not given', async () => {
    const fake = new FakeAiProvider();
    await expect(fake.structuredGenerate(request())).rejects.toMatchObject({
      code: 'not_configured',
    });
  });

  it('repeats a failure the requested number of times', async () => {
    const fake = new FakeAiProvider({ failures: [{ mode: 'rate_limit', times: 2 }] });
    const first = await fake.structuredGenerate(request()).catch((error: unknown) => error);
    const second = await fake.structuredGenerate(request()).catch((error: unknown) => error);
    const third = await fake.structuredGenerate(request()).catch((error: unknown) => error);

    expect(first).toMatchObject({ code: 'rate_limit' });
    expect(second).toMatchObject({ code: 'rate_limit' });
    expect(third).toMatchObject({ code: 'not_configured' });
  });

  it('reports available health with no reason and no credential', async () => {
    const fake = new FakeAiProvider();
    const health = await fake.healthCheck();
    expect(health.state).toBe('available');
    expect(health.configured).toBe(true);
    expect(health.reachable).toBe(true);
    expect(health.model).toBe('hanaply-fake-1');
    expect(health.reason).toBeNull();
    expect(JSON.stringify(health)).not.toContain('sk-');
  });

  it('refuses a truth-gate failure and reports the claim that failed', async () => {
    const fake = new FakeAiProvider({ responses: [] });
    const grounding = {
      facts: confirmedFacts(),
      deterministic: {
        job: {
          id: automationJob().id,
          title: automationJob().title,
          companyName: automationJob().companyName,
          description: automationJob().description,
          location: automationJob().locationRaw,
          employmentType: automationJob().employmentType,
          seniority: automationJob().seniority,
          salaryText: 'PHP 9000000-12000000 monthly, in minor units',
          skills: automationJob().skills,
          requirements: automationJob().requirements,
          preferredQualifications: automationJob().preferredQualifications,
        },
        match: {
          score: 88,
          verdict: 'strong_match',
          confidence: 'high',
          modelVersion: 'matching-v1',
          strengths: [],
          gaps: [],
          blockers: [],
          rejectionRisks: [],
          recommendedAction: 'Apply.',
          dimensionDetails: [],
          requirementStatements: [],
        },
        profileIdentity: {
          name: careerProfile().headline ?? 'the member',
          headline: null,
          currentRoleTitle: 'Automation Specialist',
          totalYearsExperience: 3,
          employers: ['Northstar Systems'],
          employmentTitles: ['Automation Specialist'],
          institutions: [],
          certifications: [],
          skills: ['n8n'],
          industries: ['SaaS'],
          locations: ['Metro Manila'],
        },
        admissibleFactIds,
      },
    };
    fake.queue({
      evidenceFactIds: ['fact-1'],
      sections: [
        {
          heading: 'Summary',
          paragraphs: ['I increased revenue by 340% at Globex Corporation.'],
        },
      ],
      kind: 'resume',
      title: 'Resume',
    });
    const result = await fake.generateApplicationArtifact({
      requestId: 'req-gate',
      task: 'resume_tailoring',
      output: artifactOutput,
      prompt: prompt(),
      budgets: request().budgets,
      grounding,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('schema_invalid');
    expect(result.grounding?.status).toBe('rejected');
    expect(result.grounding?.unsupportedClaimIds.length).toBeGreaterThan(0);
  });
});

describe('the OpenAI-compatible provider', () => {
  it('sends the trusted instruction in the system role and the data in the user role', async () => {
    const { provider: subject, calls } = provider([
      jsonResponse(completionBody(JSON.stringify(artifact()))),
    ]);
    const result = await subject.structuredGenerate(request());

    expect(result.value.kind).toBe('cover_letter');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.example.test/v1/chat/completions');
    const body = bodyOf(calls[0]);
    const messages = body.messages as { role: string; content: string }[];
    expect(messages[0]?.role).toBe('system');
    expect(messages[0]?.content).toContain('Never originate a factual claim');
    expect(messages[1]?.role).toBe('user');
    expect(messages[1]?.content).toContain('BEGIN UNTRUSTED DATA');
    expect(body.model).toBe('gpt-test');
    expect(body.stream).toBe(false);
    expect(result.meta.model).toBe('gpt-test');
    expect(result.meta.provider).toBe('openai');
    expect(result.meta.usage.inputTokens).toBe(120);
    expect(result.meta.usage.outputTokens).toBe(40);
    expect(result.meta.usage.estimatedCostMinorUsd).toBeNull();
  });

  it('sends a closed JSON schema when the deployment supports one', async () => {
    const { provider: subject, calls } = provider([
      jsonResponse(completionBody(JSON.stringify(artifact()))),
    ]);
    await subject.structuredGenerate(request());

    const body = bodyOf(calls[0]);
    const format = body.response_format as {
      type: string;
      json_schema: { name: string; strict: boolean; schema: Record<string, unknown> };
    };
    expect(format.type).toBe('json_schema');
    expect(format.json_schema.name).toBe('hanaply_application_artifact_v1');
    expect(format.json_schema.strict).toBe(true);
    expect(format.json_schema.schema.additionalProperties).toBe(false);
    expect(format.json_schema.schema.$schema).toBeUndefined();
  });

  it('falls back to the parse path when a deployment rejects the JSON schema format', async () => {
    const { provider: subject, calls } = provider([
      jsonResponse({ error: { message: 'response_format is not supported' } }, 400),
      jsonResponse(completionBody(`\`\`\`json\n${JSON.stringify(artifact())}\n\`\`\``)),
    ]);
    const result = await subject.structuredGenerate(request());

    expect(result.value.kind).toBe('cover_letter');
    expect(result.meta.structuredOutputMode).toBe('parse');
    expect(result.meta.repaired).toBe(true);
    expect(calls).toHaveLength(2);
    const second = bodyOf(calls[1]);
    expect((second.response_format as { type: string }).type).toBe('json_object');
    const messages = second.messages as { role: string; content: string }[];
    expect(messages[0]?.content).toContain('evidenceFactIds');
  });

  it('retries a rate limit and then succeeds, within the attempt bound', async () => {
    const { provider: subject, calls } = provider([
      jsonResponse({ error: 'slow down' }, 429),
      jsonResponse(completionBody(JSON.stringify(artifact({ title: 'Second time.' })))),
    ]);
    const result = await subject.structuredGenerate(request());

    expect(result.value.title).toBe('Second time.');
    expect(result.meta.attempts).toBe(2);
    expect(calls).toHaveLength(2);
  });

  it('stops at the attempt bound and reports the last typed error', async () => {
    const { provider: subject, calls } = provider([jsonResponse({ error: 'overloaded' }, 503)]);
    const error = await subject.structuredGenerate(request()).catch((thrown: unknown) => thrown);

    expect(error).toMatchObject({ code: 'provider_error', retryable: true, statusCode: 503 });
    expect(calls).toHaveLength(3);
  });

  it('does not retry a permanent failure', async () => {
    const { provider: subject, calls } = provider([jsonResponse({ error: 'bad key' }, 401)]);
    const error = await subject.structuredGenerate(request()).catch((thrown: unknown) => thrown);

    expect(error).toMatchObject({ code: 'auth', retryable: false });
    expect(calls).toHaveLength(1);
  });

  it('does not retry a response that fails schema validation', async () => {
    const { provider: subject, calls } = provider([
      jsonResponse(completionBody('{"unexpected":"shape"}')),
    ]);
    const error = await subject.structuredGenerate(request()).catch((thrown: unknown) => thrown);

    expect(error).toMatchObject({ code: 'schema_invalid' });
    expect(calls).toHaveLength(1);
  });

  it('normalises unparseable completions, network failures, and timeouts', async () => {
    const malformed = provider([jsonResponse(completionBody('this is not json at all'))]);
    const notJson = await malformed.provider
      .structuredGenerate(request())
      .catch((thrown: unknown) => thrown);
    expect(notJson).toMatchObject({ code: 'malformed_response' });

    const offline = provider([
      () => {
        throw new TypeError('fetch failed');
      },
    ]);
    const network = await offline.provider
      .structuredGenerate(request())
      .catch((thrown: unknown) => thrown);
    expect(network).toMatchObject({ code: 'network', retryable: true });

    const abortedMidFlight = provider([
      () => {
        const error = new Error('The operation was aborted.');
        error.name = 'AbortError';
        throw error;
      },
    ]);
    const aborted = await abortedMidFlight.provider
      .structuredGenerate(request())
      .catch((thrown: unknown) => thrown);
    expect(aborted).toMatchObject({ code: 'timeout', retryable: true });

    const aborting = provider([
      (init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init.signal;
          if (signal === null || signal === undefined) {
            reject(new Error('the provider did not pass an abort signal'));
            return;
          }
          signal.addEventListener('abort', () => {
            const error = new Error('The operation was aborted.');
            error.name = 'AbortError';
            reject(error);
          });
        }),
    ]);
    const timeout = await aborting.provider
      .structuredGenerate(request({ budgets: { ...request().budgets, timeoutMs: 20 } }))
      .catch((thrown: unknown) => thrown);
    expect(timeout).toMatchObject({ code: 'timeout', retryable: true });
  });

  it('carries no raw provider text on an error', async () => {
    const { provider: subject } = provider([
      jsonResponse({ error: { message: `invalid key ${API_KEY}` } }, 401),
    ]);
    const error = await subject.structuredGenerate(request()).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(AiProviderError);
    expect((error as Error).message).toBe('The AI provider rejected the credentials.');
    expect(JSON.stringify(error)).not.toContain(API_KEY);
    expect(JSON.stringify(error)).not.toContain('invalid key');
  });

  it('never places the key in a body, an error, a health report, or a usage event', async () => {
    const events: AiUsageEvent[] = [];
    const { provider: subject, calls } = provider(
      [jsonResponse(completionBody(JSON.stringify(artifact())))],
      { logger: (event) => events.push(event) },
    );

    await subject.structuredGenerate(request());
    const health = await subject.healthCheck();

    const serialised = JSON.stringify({
      body: bodyOf(calls[0]),
      health,
      events,
      model: subject.model,
      kind: subject.kind,
    });
    expect(serialised).not.toContain(API_KEY);
    expect(serialised).not.toContain('sk-');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      requestId: 'req-0001',
      provider: 'openai',
      model: 'gpt-test',
      outcome: 'succeeded',
      errorCode: null,
    });
    expect(Object.keys(events[0] ?? {}).sort()).toEqual([
      'attempts',
      'errorCode',
      'inputTokens',
      'latencyMs',
      'model',
      'outcome',
      'outputTokens',
      'promptVersion',
      'provider',
      'requestId',
      'task',
      'truncatedInputCharacters',
    ]);
  });

  it('uses the credential only as an authorization header', async () => {
    const { provider: subject, calls } = provider([
      jsonResponse(completionBody(JSON.stringify(artifact()))),
    ]);
    await subject.structuredGenerate(request());

    const headers = (calls[0]?.init.headers ?? {}) as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${API_KEY}`);
    expect(Object.values(headers).filter((value) => value.includes(API_KEY))).toHaveLength(1);
  });

  it('uses the api-key header for Azure and never a bearer token', async () => {
    const { provider: subject, calls } = provider(
      [jsonResponse(completionBody(JSON.stringify(artifact())))],
      { kind: 'azure_openai', authHeader: 'api-key' },
    );
    await subject.structuredGenerate(request());

    const headers = (calls[0]?.init.headers ?? {}) as Record<string, string>;
    expect(headers['api-key']).toBe(API_KEY);
    expect(headers.authorization).toBeUndefined();
  });

  it('reports health by probing the models route without spending a generation', async () => {
    const { provider: subject, calls } = provider([jsonResponse({ data: [] })]);
    const health = await subject.healthCheck();

    expect(health).toMatchObject({ state: 'available', configured: true, reachable: true });
    expect(health.capabilities.jsonSchema).toBe(true);
    expect(health.reason).toBeNull();
    expect(calls[0]?.url).toBe('https://api.example.test/v1/models');
    expect(calls[0]?.init.method).toBe('GET');
  });

  it('reports an unreachable provider as a degraded health result instead of throwing', async () => {
    const { provider: subject } = provider([
      () => {
        throw new TypeError('fetch failed');
      },
    ]);
    const health = await subject.healthCheck();

    expect(health).toMatchObject({ state: 'unavailable', configured: true, reachable: false });
    expect(health.reason).toBe('The AI provider could not be reached.');
  });

  it('reports a rejected credential as an unavailable health result', async () => {
    const { provider: subject } = provider([jsonResponse({ error: 'unauthorized' }, 401)]);
    const health = await subject.healthCheck();

    expect(health).toMatchObject({ state: 'unavailable', reachable: true });
    expect(health.reason).toBe('The AI provider rejected the credentials.');
  });
});

describe('bounded retries and timeouts', () => {
  it('backs off exponentially with a ceiling', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((attempt) => backoffDelay(attempt, 250))).toEqual([
      250, 500, 1_000, 2_000, 4_000, 8_000, 8_000, 8_000, 8_000, 8_000,
    ]);
    expect(backoffDelay(1, 1)).toBe(1);
    expect(backoffDelay(0, 250)).toBe(250);
  });

  it('retries only what the caller marks retryable, and only up to the bound', async () => {
    let attempts = 0;
    const controller = new AbortController();
    const outcome = await withBoundedRetries({
      maxAttempts: 4,
      baseDelayMs: 1,
      signal: controller.signal,
      sleep: () => Promise.resolve(),
      shouldRetry: (error) => error.retryable,
      run: () => {
        attempts += 1;
        throw new AiProviderError({
          code: 'rate_limit',
          message: 'rate limited',
          provider: 'fake',
          requestId: 'req-1',
          retryable: true,
        });
      },
    }).catch((error: unknown) => error);

    expect(attempts).toBe(4);
    expect(outcome).toBeInstanceOf(AiProviderError);
  });

  it('stops immediately on a non-retryable error', async () => {
    let attempts = 0;
    const controller = new AbortController();
    await withBoundedRetries({
      maxAttempts: 5,
      baseDelayMs: 1,
      signal: controller.signal,
      sleep: () => Promise.resolve(),
      shouldRetry: (error) => error.retryable,
      run: () => {
        attempts += 1;
        throw new AiProviderError({
          code: 'invalid_request',
          message: 'invalid',
          provider: 'fake',
          requestId: 'req-1',
          retryable: false,
        });
      },
    }).catch(() => undefined);

    expect(attempts).toBe(1);
  });

  it('refuses a malformed retry policy rather than retrying zero times silently', async () => {
    const controller = new AbortController();
    const result = await withBoundedRetries({
      maxAttempts: 0,
      baseDelayMs: 1,
      signal: controller.signal,
      sleep: () => Promise.resolve(),
      shouldRetry: () => true,
      run: () => Promise.resolve('ok'),
    });
    expect(result.attempts).toBe(1);
  });
});

describe('the provider registry', () => {
  it('returns a disabled provider when nothing is configured', async () => {
    const subject = createAiProvider({});
    expect(subject).toBeInstanceOf(DisabledAiProvider);
    expect(subject.kind).toBe('disabled');
    expect(isDeterministicOnly(subject)).toBe(true);
    expect(isDegraded(subject)).toBe(false);

    const health = await subject.healthCheck();
    expect(health.state).toBe('disabled');
    expect(health.configured).toBe(false);
    expect(health.reachable).toBe(false);
    expect(health.model).toBeNull();
    expect(health.reason).toContain('deterministic');
  });

  it('keeps the disabled provider failing loudly on every task call', async () => {
    const subject = createAiProvider({});
    await expect(subject.structuredGenerate(request())).rejects.toMatchObject({
      code: 'not_configured',
    });

    const task = await subject.coach({
      requestId: 'req-disabled',
      task: 'career_coaching',
      output: artifactOutput,
      prompt: prompt(),
      budgets: request().budgets,
      grounding: {
        facts: [],
        deterministic: {
          job: {
            id: 'none',
            title: '',
            companyName: '',
            description: '',
            location: null,
            employmentType: null,
            seniority: null,
            salaryText: null,
            skills: [],
            requirements: [],
            preferredQualifications: [],
          },
          match: {
            score: 0,
            verdict: '',
            confidence: '',
            modelVersion: '',
            strengths: [],
            gaps: [],
            blockers: [],
            rejectionRisks: [],
            recommendedAction: '',
            dimensionDetails: [],
            requirementStatements: [],
          },
          profileIdentity: {
            name: '',
            headline: null,
            currentRoleTitle: null,
            totalYearsExperience: null,
            employers: [],
            employmentTitles: [],
            institutions: [],
            certifications: [],
            skills: [],
            industries: [],
            locations: [],
          },
          admissibleFactIds: [],
        },
      },
    });
    expect(task.ok).toBe(false);
    if (task.ok) return;
    expect(task.error.code).toBe('not_configured');
    expect(isAiUnavailable(task.error)).toBe(true);
  });

  it('treats a production deployment with no key as explicitly degraded', () => {
    const subject = createAiProvider({
      HANAPLY_ENV: 'production',
      AI_PROVIDER: 'openai',
      AI_MODEL: 'gpt-4.1-mini',
      AI_API_KEY: undefined,
    });

    expect(subject).toBeInstanceOf(DisabledAiProvider);
    expect(isDegraded(subject)).toBe(true);
    expect(isDeterministicOnly(subject)).toBe(true);
    expect((subject as DisabledAiProvider).reason).toContain('AI_API_KEY');
    expect((subject as DisabledAiProvider).reason).toContain('Production requires');
  });

  it('rejects a production environment that names a provider but no key at all', async () => {
    const subject = createAiProvider({
      HANAPLY_ENV: 'production',
      AI_PROVIDER: 'openai',
      AI_MODEL: 'gpt-4.1-mini',
    });

    expect(subject).toBeInstanceOf(DisabledAiProvider);
    expect(isDegraded(subject)).toBe(true);
    const health = await subject.healthCheck();
    expect(health.state).toBe('disabled');
    expect(health.reason).toContain('AI_API_KEY');
  });

  it('reports a malformed environment as degraded rather than throwing', async () => {
    const subject = createAiProvider({ AI_PROVIDER: 'openai', AI_MODEL: '' });
    expect(subject).toBeInstanceOf(DisabledAiProvider);
    const health = await subject.healthCheck();
    expect(health.state).toBe('disabled');
    expect(health.reason).toContain('could not be parsed');
  });

  it('builds a real provider from a complete environment without any network call', () => {
    const subject = createAiProvider({
      HANAPLY_ENV: 'local',
      AI_PROVIDER: 'openai',
      AI_MODEL: 'gpt-4.1-mini',
      AI_API_KEY: API_KEY,
      AI_TIMEOUT_MS: '4000',
      AI_MAX_ATTEMPTS: '2',
      AI_STRUCTURED_OUTPUT: 'parse',
    });

    expect(subject).toBeInstanceOf(OpenAiCompatibleProvider);
    expect(subject.kind).toBe('openai');
    expect(subject.model).toBe('gpt-4.1-mini');
    expect(subject.capabilities.jsonSchema).toBe(false);
    expect(isDeterministicOnly(subject)).toBe(false);
  });

  it('applies the documented base URL default per provider', () => {
    const expectations: readonly [string, string][] = [
      ['openai', 'https://api.openai.com/v1'],
      ['openrouter', 'https://openrouter.ai/api/v1'],
      ['groq', 'https://api.groq.com/openai/v1'],
      ['together', 'https://api.together.xyz/v1'],
      ['deepseek', 'https://api.deepseek.com/v1'],
      ['ollama', 'http://127.0.0.1:11434/v1'],
      ['vllm', 'http://127.0.0.1:8000/v1'],
    ];
    for (const [kind, baseUrl] of expectations) {
      expect(defaultBaseUrl(kind as 'openai')).toBe(baseUrl);
    }
    expect(defaultBaseUrl('azure_openai')).toBeNull();
    expect(defaultBaseUrl('openai_compatible')).toBeNull();

    const subject = createAiProvider({
      HANAPLY_ENV: 'local',
      AI_PROVIDER: 'groq',
      AI_MODEL: 'llama-3.3-70b-versatile',
      AI_API_KEY: API_KEY,
    });
    expect(subject).toBeInstanceOf(OpenAiCompatibleProvider);
    expect(subject.model).toBe('llama-3.3-70b-versatile');
  });

  it('builds the deterministic fake only in local and test', () => {
    const local = createAiProvider({
      HANAPLY_ENV: 'local',
      AI_PROVIDER: 'fake',
      AI_MODEL: 'hanaply-fake-1',
    });
    expect(local).toBeInstanceOf(FakeAiProvider);

    const production = createAiProvider({
      HANAPLY_ENV: 'production',
      AI_PROVIDER: 'fake',
      AI_MODEL: 'hanaply-fake-1',
    });
    expect(production).toBeInstanceOf(DisabledAiProvider);
    expect(isDegraded(production)).toBe(true);
  });
});

describe('JSON handling helpers', () => {
  it('unwraps a fenced object and rejects prose without one', () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJsonObject('Here is the answer: {"a":1} — hope that helps')).toEqual({ a: 1 });
    expect(extractJsonObject('no object here')).toBeNull();
    expect(extractJsonObject('   ')).toBeNull();
  });

  it('closes every object node in a schema', () => {
    const closed = strictifyJsonSchema({
      type: 'object',
      properties: {
        nested: { type: 'object', properties: { value: { type: 'string' } } },
        list: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' } } } },
      },
    });
    expect(closed.additionalProperties).toBe(false);
    const properties = closed.properties as Record<string, Record<string, unknown>>;
    expect(properties.nested?.additionalProperties).toBe(false);
    const items = (properties.list?.items ?? {}) as Record<string, unknown>;
    expect(items.additionalProperties).toBe(false);
  });

  it('reads token usage and defaults to zero rather than guessing', () => {
    expect(readUsage({ usage: { prompt_tokens: 10, completion_tokens: 4 } })).toEqual({
      inputTokens: 10,
      outputTokens: 4,
      estimatedCostMinorUsd: null,
    });
    expect(readUsage({})).toEqual({ inputTokens: 0, outputTokens: 0, estimatedCostMinorUsd: null });
  });

  it('reports the declared capabilities honestly', () => {
    const { provider: subject } = provider([
      jsonResponse(completionBody(JSON.stringify(artifact()))),
    ]);
    expect(subject.capabilities).toEqual({
      structuredOutput: true,
      jsonSchema: true,
      streaming: false,
      toolCalls: false,
      vision: false,
    });

    const parseOnly = provider([jsonResponse(completionBody(JSON.stringify(artifact())))], {
      structuredOutput: 'parse',
    });
    expect(parseOnly.provider.capabilities.jsonSchema).toBe(false);
  });
});
