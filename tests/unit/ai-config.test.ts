import {
  createAiProvider,
  DisabledAiProvider,
  FakeAiProvider,
  isDegraded,
  isDeterministicOnly,
  OpenAiCompatibleProvider,
  parseAiEnvironment,
} from '@hanaply/ai';
import { parseApiEnvironment } from '@hanaply/config';
import { describe, expect, it } from 'vitest';

/**
 * AI environment parsing and provider selection.
 *
 * `createAiProvider` is the one place a deployment decides whether a model may
 * write anything, and it never throws: every failure path returns a disabled
 * provider that carries the reason. These cases pin the three outcomes that
 * matter — the fake provider is selected in local and test, a real provider is
 * selected only with a usable endpoint and credential, and a selected provider
 * that cannot be constructed reports a degraded state rather than silently
 * falling back to deterministic output. The last one is the failure the AI
 * layer exists to prevent, so it is asserted twice: once on the provider and
 * once through the status shape a member-facing surface reads.
 */

const fakeEnvironment = {
  HANAPLY_ENV: 'local',
  AI_PROVIDER: 'fake',
  AI_MODEL: 'hanaply-fake-1',
} as const;

/** A production API environment, which is what the API actually parses. */
const productionApiEnvironment = {
  NODE_ENV: 'production',
  HANAPLY_ENV: 'production',
  LOG_LEVEL: 'info',
  APP_BASE_URL: 'https://hanaply.example',
  API_BASE_URL: 'https://api.hanaply.example',
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  CORS_ALLOWED_ORIGINS: 'https://hanaply.example',
  RATE_LIMIT_STORE: 'memory',
} as const;

describe('AI environment parsing', () => {
  it('defaults to disabled, and disabled means no generation', () => {
    const parsed = parseAiEnvironment({});
    expect(parsed.AI_PROVIDER).toBe('disabled');
    expect(parsed.AI_MODEL).toBeUndefined();
    expect(parsed.AI_TIMEOUT_MS).toBe(30_000);
    expect(parsed.AI_MAX_OUTPUT_TOKENS).toBe(1_600);
    expect(parsed.AI_MAX_ATTEMPTS).toBe(3);
    expect(parsed.AI_TEMPERATURE).toBe(0.2);
    expect(parsed.AI_STRUCTURED_OUTPUT).toBe('auto');
  });

  it('requires a model whenever any provider other than disabled is selected', () => {
    expect(() => parseAiEnvironment({ AI_PROVIDER: 'openai' })).toThrow(/AI_MODEL/u);
    expect(parseAiEnvironment({ AI_PROVIDER: 'openai', AI_MODEL: 'gpt-4o-mini' }).AI_MODEL).toBe(
      'gpt-4o-mini',
    );
  });

  it('permits the deterministic fake provider only in local and test', () => {
    expect(parseAiEnvironment({ ...fakeEnvironment, HANAPLY_ENV: 'test' }).AI_PROVIDER).toBe(
      'fake',
    );
    expect(parseAiEnvironment({ ...fakeEnvironment, HANAPLY_ENV: 'local' }).AI_PROVIDER).toBe(
      'fake',
    );
    expect(() => parseAiEnvironment({ ...fakeEnvironment, HANAPLY_ENV: 'staging' })).toThrow(
      /only selectable in local and test/u,
    );
    expect(() => parseAiEnvironment({ ...fakeEnvironment, HANAPLY_ENV: 'production' })).toThrow(
      /only selectable in local and test/u,
    );
  });

  it('requires an API key for a keyed provider in production, and accepts a keyless one for a local gateway', () => {
    expect(() =>
      parseAiEnvironment({
        HANAPLY_ENV: 'production',
        AI_PROVIDER: 'openai',
        AI_MODEL: 'gpt-4o-mini',
      }),
    ).toThrow(/API key/u);
    // A local or staging deployment may legitimately run a keyless endpoint.
    expect(
      parseAiEnvironment({
        HANAPLY_ENV: 'staging',
        AI_PROVIDER: 'openai',
        AI_MODEL: 'gpt-4o-mini',
      }).AI_PROVIDER,
    ).toBe('openai');
    // Ollama and vLLM are keyless by design, so production accepts them without
    // one rather than refusing the only self-hosted options.
    expect(
      parseAiEnvironment({
        HANAPLY_ENV: 'production',
        AI_PROVIDER: 'ollama',
        AI_MODEL: 'llama3.1',
      }).AI_PROVIDER,
    ).toBe('ollama');
  });

  it('requires a full deployment endpoint for Azure OpenAI', () => {
    expect(() =>
      parseAiEnvironment({
        HANAPLY_ENV: 'staging',
        AI_PROVIDER: 'azure_openai',
        AI_MODEL: 'gpt-4o',
        AI_API_KEY: 'azure-key',
      }),
    ).toThrow(/deployment endpoint/u);
  });

  it('rejects a base URL that is not absolute http(s)', () => {
    expect(() =>
      parseAiEnvironment({
        AI_PROVIDER: 'openai_compatible',
        AI_MODEL: 'local-model',
        AI_BASE_URL: 'not-a-url',
      }),
    ).toThrow(/absolute http\(s\) base URL/u);
  });
});

describe('AI provider selection', () => {
  it('selects the deterministic fake provider for AI_PROVIDER=fake', () => {
    const provider = createAiProvider({ ...fakeEnvironment, HANAPLY_ENV: 'test' });
    expect(provider).toBeInstanceOf(FakeAiProvider);
    expect(provider.kind).toBe('fake');
    expect(provider.model).toBe('hanaply-fake-1');
    // The fake provider is a provider: it is not a degraded deployment.
    expect(isDeterministicOnly(provider)).toBe(false);
    expect(isDegraded(provider)).toBe(false);
  });

  it('returns a disabled provider, not a throw, for an unconfigured deployment', () => {
    const provider = createAiProvider({ HANAPLY_ENV: 'local' });
    expect(provider).toBeInstanceOf(DisabledAiProvider);
    expect(isDeterministicOnly(provider)).toBe(true);
    // Nothing was selected, so nothing is degraded: this is the intended state.
    expect(isDegraded(provider)).toBe(false);
    expect(provider.kind).toBe('disabled');
    expect(provider.model).toBeNull();
  });

  it('yields the degraded state when the environment a real provider needs is incomplete', () => {
    // In production the schema refuses this outright, and `createAiProvider`
    // reports the refusal as a degraded provider rather than throwing: the API
    // still has to answer the request it was given.
    const provider = createAiProvider({
      HANAPLY_ENV: 'production',
      AI_PROVIDER: 'openai',
      AI_MODEL: 'gpt-4o-mini',
    });
    expect(provider).toBeInstanceOf(DisabledAiProvider);
    expect(isDeterministicOnly(provider)).toBe(true);
    expect(isDegraded(provider)).toBe(true);
    expect(provider.model).toBeNull();
    const reason = (provider as DisabledAiProvider).reason;
    expect(reason).toMatch(/could not be parsed/u);
    expect(reason).toMatch(/API key/u);
    // The reason states the configuration defect; it does not mislabel the
    // output. A degraded deployment says what is wrong rather than presenting
    // deterministic text as model-written.
    expect(reason).not.toMatch(/generated by|written by/iu);
  });

  it('yields the degraded state when a selected provider has no reachable endpoint', () => {
    const provider = createAiProvider({
      HANAPLY_ENV: 'staging',
      AI_PROVIDER: 'azure_openai',
      AI_MODEL: 'gpt-4o',
      AI_API_KEY: 'azure-key',
    });
    expect(provider).toBeInstanceOf(DisabledAiProvider);
    expect(isDegraded(provider)).toBe(true);
    expect(provider.model).toBeNull();
    expect((provider as DisabledAiProvider).reason).toMatch(/deployment endpoint/u);
  });

  it('never throws on an unparseable environment, and says why', () => {
    const provider = createAiProvider({
      HANAPLY_ENV: 'not-an-environment',
      AI_PROVIDER: 'fake',
      AI_MODEL: 'hanaply-fake-1',
    });
    expect(provider).toBeInstanceOf(DisabledAiProvider);
    expect(isDegraded(provider)).toBe(true);
    expect((provider as DisabledAiProvider).reason).toMatch(/could not be parsed/u);
  });

  it('reports the degradation through the health shape a status surface reads', async () => {
    const provider = createAiProvider({
      HANAPLY_ENV: 'staging',
      AI_PROVIDER: 'deepseek',
      AI_MODEL: 'deepseek-chat',
      AI_BASE_URL: 'not-a-url',
    });
    const health = await provider.healthCheck();
    expect(health.state).toBe('disabled');
    expect(health.configured).toBe(false);
    expect(health.reachable).toBe(false);
    expect(health.model).toBeNull();
    expect(health.reason).toBeTruthy();
    // The capability set is closed, so a caller cannot read generation out of a
    // provider that cannot generate.
    expect(health.capabilities.structuredOutput).toBe(false);
    expect(health.capabilities.jsonSchema).toBe(false);
    // Nothing credential-shaped reaches a status surface: no key prefix, no base
    // URL, no authorisation header name.
    const serialized = JSON.stringify(health);
    expect(serialized).not.toMatch(/sk-/u);
    expect(serialized).not.toMatch(/authorization/iu);
    expect(serialized).not.toMatch(/https?:\/\//u);
  });

  it('selects an OpenAI-compatible provider when the deployment is complete', () => {
    const provider = createAiProvider({
      HANAPLY_ENV: 'staging',
      AI_PROVIDER: 'deepseek',
      AI_MODEL: 'deepseek-chat',
      AI_API_KEY: 'test-key',
    });
    expect(provider).toBeInstanceOf(OpenAiCompatibleProvider);
    expect(provider.kind).toBe('deepseek');
    expect(provider.model).toBe('deepseek-chat');
    expect(isDegraded(provider)).toBe(false);
    expect(provider.capabilities.structuredOutput).toBe(true);
  });

  it('refuses generation from a disabled provider rather than resolving an empty value', async () => {
    const provider = createAiProvider({ HANAPLY_ENV: 'local' });
    const result = await provider.analyzeOpportunity({
      requestId: '41000000-0000-4000-8000-0000000000aa',
      task: 'deep_job_analysis',
      output: {
        schemaName: 'x',
        schema: { safeParse: () => ({ success: false }) },
        jsonSchema: {},
      } as never,
      prompt: {
        system: [],
        user: '',
        untrustedDelimiter: '---',
        untrustedSources: [],
        promptVersion: 'ai-v1',
        truncated: false,
        neutralisedInstructionRemovals: 0,
      },
      budgets: { maxOutputTokens: 100, timeoutMs: 1_000, maxAttempts: 1, temperature: 0 },
      grounding: {
        facts: [],
        deterministic: {
          job: {
            id: 'job',
            title: 'title',
            companyName: 'company',
            description: 'description',
            location: null,
            employmentType: null,
            seniority: null,
            skills: [],
            requirements: [],
            preferredQualifications: [],
            salaryText: null,
          },
          match: {
            score: 0,
            verdict: 'none',
            confidence: 'none',
            modelVersion: 'none',
            strengths: [],
            gaps: [],
            blockers: [],
            rejectionRisks: [],
            recommendedAction: 'none',
            dimensionDetails: [],
            requirementStatements: [],
          },
          profileIdentity: {
            name: 'the member',
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
    // A resolved "nothing" could be mistaken for a model that chose to say
    // nothing, so the disabled provider answers with a typed failure instead.
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('not_configured');
      expect(result.grounding).toBeNull();
    }
  });

  it('refuses to start a production API with a keyed provider and no key', () => {
    // A keyed provider selected without a key in production is the silent
    // fallback to deterministic output this schema exists to prevent, so it is
    // refused at startup rather than degraded at request time.
    expect(() =>
      parseApiEnvironment({
        ...productionApiEnvironment,
        AI_PROVIDER: 'openai',
        AI_MODEL: 'gpt-4o-mini',
      }),
    ).toThrow(/API key/u);
  });

  it('carries the AI settings through the API environment so the API can select a provider', () => {
    const parsed = parseApiEnvironment({
      ...productionApiEnvironment,
      NODE_ENV: 'test',
      HANAPLY_ENV: 'test',
      AI_PROVIDER: 'openai',
      AI_MODEL: 'gpt-4o-mini',
      AI_API_KEY: 'test-key',
    });
    expect(parsed.AI_PROVIDER).toBe('openai');
    expect(parsed.AI_MODEL).toBe('gpt-4o-mini');

    const provider = createAiProvider(parsed);
    expect(provider).toBeInstanceOf(OpenAiCompatibleProvider);
    expect(provider.kind).toBe('openai');
    expect(provider.model).toBe('gpt-4o-mini');
    expect(isDegraded(provider)).toBe(false);
  });

  it('selects the fake provider through a parsed API environment', () => {
    // The API environment is where a deployment's configuration is validated,
    // and it now carries the same AI keys the provider factory reads, so the
    // selection the API makes is the selection the schema approved.
    const parsed = parseApiEnvironment({
      ...productionApiEnvironment,
      NODE_ENV: 'test',
      HANAPLY_ENV: 'test',
      AI_PROVIDER: 'fake',
      AI_MODEL: 'hanaply-fake-1',
    });
    const provider = createAiProvider(parsed);
    expect(provider).toBeInstanceOf(FakeAiProvider);
    expect(isDeterministicOnly(provider)).toBe(false);
    expect(isDegraded(provider)).toBe(false);
  });

  it('defaults every deployment to the deterministic disabled provider', () => {
    const parsed = parseApiEnvironment({
      ...productionApiEnvironment,
      NODE_ENV: 'test',
      HANAPLY_ENV: 'test',
    });
    expect(parsed.AI_PROVIDER).toBe('disabled');
    const provider = createAiProvider(parsed);
    expect(provider).toBeInstanceOf(DisabledAiProvider);
    // Not configured is the intended state, not a degradation of one.
    expect(isDeterministicOnly(provider)).toBe(true);
    expect(isDegraded(provider)).toBe(false);
  });
});
