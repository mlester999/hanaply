import { z } from 'zod';

export const environmentNameSchema = z.enum(['local', 'test', 'staging', 'production']);
export type EnvironmentName = z.infer<typeof environmentNameSchema>;

export const logLevelSchema = z.enum([
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
]);

const urlSchema = z.url();
const nonEmptyString = z.string().trim().min(1);
const booleanFromEnvironment = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  if (value.toLowerCase() === 'true') return true;
  if (value.toLowerCase() === 'false') return false;
  return value;
}, z.boolean());
const portFromEnvironment = z.coerce.number().int().min(1).max(65_535);
/**
 * The port a hosting platform routes traffic to.
 *
 * A platform injects `PORT` to tell a service which port it is targeting. This
 * schema stays platform-neutral, so it only describes the variable; deciding
 * that `PORT` outranks a service's own setting is `resolveServicePort`, which
 * the service entry points call before parsing. A service that binds a port the
 * router is not looking at starts cleanly, reports itself healthy in its own
 * logs, and still receives no traffic.
 */
const platformPort = portFromEnvironment.optional();
const mailboxSchema = z
  .string()
  .trim()
  .min(3)
  .max(320)
  .refine((value) => {
    const bracketed = /<([^<>]+)>$/u.exec(value);
    return z.email().safeParse(bracketed?.[1] ?? value).success;
  }, 'Use a valid email address or Name <email@example.com> format');

const browserEnvironmentSchema = z.object({
  NEXT_PUBLIC_APP_URL: urlSchema,
  NEXT_PUBLIC_API_URL: urlSchema,
  NEXT_PUBLIC_SUPABASE_URL: urlSchema,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: nonEmptyString,
});

const webServerEnvironmentSchema = browserEnvironmentSchema
  .extend({
    HANAPLY_ENV: environmentNameSchema.default('local'),
    AUTH_RATE_LIMIT_PEPPER: z.string().min(16).default('local-only-rate-limit-pepper'),
  })
  .superRefine((value, context) => {
    if (value.HANAPLY_ENV === 'production' && value.AUTH_RATE_LIMIT_PEPPER.length < 32) {
      context.addIssue({
        code: 'custom',
        path: ['AUTH_RATE_LIMIT_PEPPER'],
        message: 'Production rate-limit pepper must contain at least 32 characters',
      });
    }
  });

const sharedServerEnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HANAPLY_ENV: environmentNameSchema.default('local'),
  LOG_LEVEL: logLevelSchema.default('info'),
  PORT: platformPort,
  APP_BASE_URL: urlSchema,
  API_BASE_URL: urlSchema,
  SUPABASE_URL: urlSchema,
  SUPABASE_PUBLISHABLE_KEY: nonEmptyString,
  SUPABASE_SERVICE_ROLE_KEY: nonEmptyString,
  SUPABASE_DB_URL: nonEmptyString.optional(),
  SUPABASE_PROJECT_REF: nonEmptyString.optional(),
  BUILD_SHA: nonEmptyString.default('local'),
});

/**
 * AI provider configuration.
 *
 * One OpenAI-compatible contract covers every provider Hanaply supports, so
 * these settings describe a deployment choice rather than a vendor integration.
 * `disabled` is the default and means what it says: no generation happens, the
 * deterministic paths in `@hanaply/matching` and `services/api` remain the
 * product, and nothing labels their output as model-written. Selecting a
 * provider without credentials is not a configuration this schema accepts in
 * production, because a silently absent key would present deterministic text as
 * though a model had produced it.
 */
export const aiProviderNames = [
  'disabled',
  'fake',
  'openai',
  'azure_openai',
  'openrouter',
  'together',
  'groq',
  'deepseek',
  'ollama',
  'vllm',
  'openai_compatible',
] as const;

export const aiProviderNameSchema = z.enum(aiProviderNames);

export const aiBaseUrlDefaults: Readonly<Record<(typeof aiProviderNames)[number], string | null>> =
  Object.freeze({
    disabled: null,
    fake: null,
    openai: 'https://api.openai.com/v1',
    azure_openai: null,
    openrouter: 'https://openrouter.ai/api/v1',
    together: 'https://api.together.xyz/v1',
    groq: 'https://api.groq.com/openai/v1',
    deepseek: 'https://api.deepseek.com/v1',
    ollama: 'http://127.0.0.1:11434/v1',
    vllm: 'http://127.0.0.1:8000/v1',
    openai_compatible: null,
  });

const providersRequiringAnApiKey = new Set<(typeof aiProviderNames)[number]>([
  'openai',
  'azure_openai',
  'openrouter',
  'together',
  'groq',
  'deepseek',
  'openai_compatible',
]);

const aiBaseUrlSchema = z
  .string()
  .trim()
  .min(8)
  .max(500)
  .refine((value) => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'https:' || parsed.protocol === 'http:';
    } catch {
      return false;
    }
  }, 'Use an absolute http(s) base URL');

const aiEnvironmentShape = {
  AI_PROVIDER: aiProviderNameSchema.default('disabled'),
  AI_MODEL: z.string().trim().min(1).max(120).optional(),
  AI_API_KEY: z.string().trim().min(1).max(400).optional(),
  AI_BASE_URL: aiBaseUrlSchema.optional(),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(64).max(16_000).default(1_600),
  AI_MAX_INPUT_CHARACTERS: z.coerce.number().int().min(1_000).max(400_000).default(60_000),
  AI_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.2),
  AI_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(5).default(3),
  AI_RETRY_BASE_DELAY_MS: z.coerce.number().int().min(10).max(10_000).default(250),
  AI_STRUCTURED_OUTPUT: z.enum(['auto', 'json_schema', 'parse']).default('auto'),
} as const;

/**
 * The AI settings, enforced wherever a process may generate.
 *
 * Declared once as a shape so the API environment and the standalone AI
 * environment cannot drift: the API is the process that actually constructs a
 * provider, so it has to validate the same rules the provider factory applies.
 * A production deployment that selects a keyed provider without a key is refused
 * at startup rather than silently degrading at request time.
 */
function enforceAiSettings(
  value: {
    HANAPLY_ENV: z.infer<typeof environmentNameSchema>;
    AI_PROVIDER?: z.infer<typeof aiProviderNameSchema>;
    AI_MODEL?: string | undefined;
    AI_API_KEY?: string | undefined;
    AI_BASE_URL?: string | undefined;
  },
  context: z.RefinementCtx,
): void {
  const provider = value.AI_PROVIDER ?? 'disabled';
  if (provider === 'disabled') return;
  if (value.AI_MODEL === undefined) {
    context.addIssue({
      code: 'custom',
      path: ['AI_MODEL'],
      message: 'Required whenever a provider other than disabled is selected',
    });
  }
  if (provider === 'fake' && !['local', 'test'].includes(value.HANAPLY_ENV)) {
    context.addIssue({
      code: 'custom',
      path: ['AI_PROVIDER'],
      message: 'The deterministic fake provider is only selectable in local and test',
    });
  }
  if (provider === 'azure_openai' && value.AI_BASE_URL === undefined) {
    context.addIssue({
      code: 'custom',
      path: ['AI_BASE_URL'],
      message: 'Azure OpenAI requires the full deployment endpoint',
    });
  }
  if (
    !providersRequiringAnApiKey.has(provider) ||
    value.AI_API_KEY !== undefined ||
    value.HANAPLY_ENV !== 'production'
  ) {
    return;
  }
  // Local and staging may run a keyless endpoint (Ollama, vLLM, an internal
  // gateway). Production may not: an absent key there is a silent fallback to
  // deterministic output, which is the failure this schema exists to prevent.
  context.addIssue({
    code: 'custom',
    path: ['AI_API_KEY'],
    message: 'Production requires an API key for the selected AI provider',
  });
}

const apiEnvironmentSchema = sharedServerEnvironmentSchema
  .extend({
    API_PORT: portFromEnvironment.default(3101),
    RATE_LIMIT_STORE: z.literal('memory').default('memory'),
    /**
     * A deliberate statement that this deployment runs exactly one API instance.
     *
     * The in-memory throttler store is per process, so with two instances each
     * keeps its own buckets and a member's effective allowance is the configured
     * limit multiplied by the instance count. Production was therefore refused
     * outright whenever the store was `memory` - but `memory` is the only store
     * this repository implements, so *every* production start was refused and the
     * product could not be deployed at all. The check was right about the danger
     * and wrong about the remedy: it blocked the safe case together with the
     * unsafe one, and nothing caught it because no part of the validation path
     * ever parsed a production environment.
     *
     * The operator now has to say which case they are in. While this is false, a
     * production environment on the in-memory store is still refused, so a
     * multi-instance deployment cannot be started by accident. While it is true, a
     * single-instance launch is legal and the constraint is stated rather than
     * implied. Scaling out means implementing a shared store and selecting it in
     * `createThrottlerStorage`; this flag is not a substitute for that.
     */
    RATE_LIMIT_SINGLE_INSTANCE: booleanFromEnvironment.default(false),
    /**
     * The API's rate limits, per scope.
     *
     * The old shape was one bucket for every route, keyed by the caller's
     * address. The web application reaches the API server-to-server, so that one
     * address carried every member's traffic and one member's burst refused
     * unrelated members. These are the same numbers in different buckets; see
     * `services/api/src/rate-limit.ts` for the scope each one applies to.
     *
     * `AUTHENTICATED` is the per-member default for a route that requires a
     * session, and the 100-per-minute posture is the value the shared bucket used
     * to carry — now spent by one member rather than by everybody.
     * `ANONYMOUS` is what an unproven caller (no session, or an unusable one)
     * gets, keyed by address.
     * `SENSITIVE` is for an authentication route that takes a submitted
     * identifier, keyed by address and identifier; it mirrors the
     * ten-attempts-per-fifteen-minutes policy `docs/authentication.md` records
     * for credential entry.
     * `EXPENSIVE` is a second, tighter ceiling on the model and generation
     * routes, keyed by member.
     */
    RATE_LIMIT_AUTHENTICATED_LIMIT: z.coerce.number().int().min(1).max(1_000_000).default(100),
    RATE_LIMIT_AUTHENTICATED_TTL_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(3_600_000)
      .default(60_000),
    RATE_LIMIT_ANONYMOUS_LIMIT: z.coerce.number().int().min(1).max(1_000_000).default(60),
    RATE_LIMIT_ANONYMOUS_TTL_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(60_000),
    RATE_LIMIT_SENSITIVE_LIMIT: z.coerce.number().int().min(1).max(1_000_000).default(10),
    RATE_LIMIT_SENSITIVE_TTL_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(900_000),
    RATE_LIMIT_EXPENSIVE_LIMIT: z.coerce.number().int().min(1).max(1_000_000).default(60),
    RATE_LIMIT_EXPENSIVE_TTL_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(60_000),
    CORS_ALLOWED_ORIGINS: nonEmptyString.transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
    OPENAPI_ENABLED: booleanFromEnvironment.default(true),
    ...aiEnvironmentShape,
    EMAIL_PROVIDER: z.enum(['disabled', 'capture', 'resend']).default('disabled'),
    EMAIL_ALLOW_LIVE_SENDS: booleanFromEnvironment.default(false),
    ADMIN_BOOTSTRAP_ENABLED: booleanFromEnvironment.default(false),
    PAYMENT_PROOF_BUCKET: z.literal('payment-proofs').default('payment-proofs'),
    PAYMENT_QR_BUCKET: z.literal('payment-qr-codes').default('payment-qr-codes'),
    PAYMENT_PROOF_MAX_BYTES: z.coerce
      .number()
      .int()
      .min(5 * 1024 * 1024)
      .max(8 * 1024 * 1024)
      .default(8 * 1024 * 1024),
    PAYMENT_QR_MAX_BYTES: z.coerce
      .number()
      .int()
      .min(1)
      .max(5 * 1024 * 1024)
      .default(5 * 1024 * 1024),
    PAYMENT_IMAGE_MAX_PIXELS: z.coerce
      .number()
      .int()
      .min(1_000_000)
      .max(144_000_000)
      .default(40_000_000),
    PAYMENT_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().min(30).max(600).default(300),
    STORAGE_CLEANUP_MODE: z.enum(['immediate', 'queue']).default('immediate'),
  })
  .superRefine((value, context) => {
    enforceAiSettings(value, context);
  });

const workerEnvironmentSchema = sharedServerEnvironmentSchema.extend({
  WORKER_HEALTH_PORT: portFromEnvironment.default(3102),
  /**
   * `idle` serves health only, `active` runs the cycles on the poll timer, and
   * `once` runs every cycle exactly once and exits.
   *
   * `once` exists because match computation is otherwise only exercised by a
   * process nobody can wait on: a deterministic gate needs to run the real
   * orchestration and then observe the rows it produced. It is the same
   * `JobIntelligenceWorker` and the same cycles as `active`, started from the
   * same entry point, so what it proves is what a deployment runs.
   */
  WORKER_MODE: z.enum(['idle', 'active', 'once']).default('idle'),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(1_000).max(60_000).default(5_000),
  WORKER_MAINTENANCE_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(60_000)
    .max(86_400_000)
    .default(300_000),
  WORKER_NOTIFICATION_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(25),
  WORKER_NOTIFICATION_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  WORKER_STORAGE_CLEANUP_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(25),
  WORKER_STORAGE_CLEANUP_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  SUBSCRIPTION_EXPIRY_REMINDER_DAYS: z
    .string()
    .trim()
    .default('30,7,1')
    .transform((value, context) => {
      const days = [...new Set(value.split(',').map((entry) => Number(entry.trim())))];
      if (days.length === 0 || days.some((day) => !Number.isInteger(day) || day < 1 || day > 365)) {
        context.addIssue({
          code: 'custom',
          message: 'Use comma-separated reminder days from 1 to 365',
        });
        return z.NEVER;
      }
      return days.sort((left, right) => right - left);
    }),
  EMAIL_PROVIDER: z.enum(['disabled', 'capture', 'resend']).default('disabled'),
  EMAIL_ALLOW_LIVE_SENDS: booleanFromEnvironment.default(false),
  RESEND_API_KEY: z.string().trim().optional(),
  RESEND_FROM_ADDRESS: mailboxSchema.optional(),
  RESEND_REPLY_TO_ADDRESS: z.email().optional(),
  RESEND_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(30_000).default(8_000),

  // Job intelligence. Ingestion is shared infrastructure, so these bound one
  // shared scan per source rather than one request per subscriber.
  JOB_INGESTION_USER_AGENT: z
    .string()
    .trim()
    .min(8)
    .max(200)
    .default('HanaplyBot/1.0 (+https://hanaply.com/bot)'),
  JOB_INGESTION_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(15_000),
  JOB_STALE_AFTER_HOURS: z.coerce.number().int().min(1).max(8_760).default(168),
  JOB_EXPIRE_AFTER_HOURS: z.coerce.number().int().min(2).max(8_760).default(720),
  MATCHING_BATCH_SIZE: z.coerce.number().int().min(1).max(200).default(25),
  MATCHING_CANDIDATE_LIMIT: z.coerce.number().int().min(1).max(200).default(60),
  MATCHING_STALE_AFTER_HOURS: z.coerce.number().int().min(1).max(720).default(12),

  // Opportunity notification delivery. Queueing is decided entirely inside the
  // database: a row is only created when the subscriber's own preference is on
  // *and* their plan includes the feature, so these settings can only narrow
  // what an already-consented subscriber receives.
  JOB_ALERT_WINDOW_MINUTES: z.coerce.number().int().min(5).max(1_440).default(30),
  JOB_ALERT_MINIMUM_SCORE: z.coerce.number().int().min(0).max(100).default(75),
  DIGEST_MINIMUM_SCORE: z.coerce.number().int().min(0).max(100).default(55),
  NOTIFICATION_BATCH_SIZE: z.coerce.number().int().min(1).max(200).default(25),
});

const emailEnvironmentSchema = z
  .object({
    HANAPLY_ENV: environmentNameSchema.default('local'),
    EMAIL_PROVIDER: z.enum(['disabled', 'capture', 'resend']).default('disabled'),
    EMAIL_ALLOW_LIVE_SENDS: booleanFromEnvironment.default(false),
    /**
     * Optional JSON-lines sink for `EMAIL_PROVIDER=capture`. When set, the
     * capture provider appends every rendered message so another process (the
     * Dockerless e2e mailbox) can read it. Unset, capture stays in memory.
     */
    EMAIL_CAPTURE_FILE: z.string().trim().min(1).optional(),
    RESEND_API_KEY: z.string().trim().optional(),
    RESEND_FROM_ADDRESS: mailboxSchema.optional(),
    RESEND_REPLY_TO_ADDRESS: z.email().optional(),
    RESEND_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(30_000).default(8_000),
  })
  .superRefine((value, context) => {
    if (value.EMAIL_PROVIDER === 'resend' && !value.RESEND_API_KEY) {
      context.addIssue({
        code: 'custom',
        path: ['RESEND_API_KEY'],
        message: 'Required for Resend',
      });
    }
    if (value.EMAIL_PROVIDER === 'resend' && !value.RESEND_FROM_ADDRESS) {
      context.addIssue({
        code: 'custom',
        path: ['RESEND_FROM_ADDRESS'],
        message: 'Required for Resend',
      });
    }
    if (value.EMAIL_PROVIDER === 'resend' && !value.EMAIL_ALLOW_LIVE_SENDS) {
      context.addIssue({
        code: 'custom',
        path: ['EMAIL_ALLOW_LIVE_SENDS'],
        message: 'Live email delivery must be enabled explicitly',
      });
    }
    if (
      value.EMAIL_ALLOW_LIVE_SENDS &&
      (value.HANAPLY_ENV === 'local' || value.HANAPLY_ENV === 'test')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['EMAIL_ALLOW_LIVE_SENDS'],
        message: 'Live email delivery is forbidden in local and test environments',
      });
    }
    if (value.HANAPLY_ENV === 'production' && value.EMAIL_PROVIDER !== 'resend') {
      context.addIssue({
        code: 'custom',
        path: ['EMAIL_PROVIDER'],
        message: 'Production requires the reviewed Resend provider',
      });
    }
  });

const adminBootstrapEnvironmentSchema = z
  .object({
    HANAPLY_ENV: environmentNameSchema.default('local'),
    ADMIN_BOOTSTRAP_ENABLED: booleanFromEnvironment.default(false),
    ADMIN_BOOTSTRAP_EMAIL: z
      .email()
      .transform((value) => value.trim().toLowerCase())
      .optional(),
  })
  .superRefine((value, context) => {
    if (value.ADMIN_BOOTSTRAP_ENABLED && !value.ADMIN_BOOTSTRAP_EMAIL) {
      context.addIssue({
        code: 'custom',
        path: ['ADMIN_BOOTSTRAP_EMAIL'],
        message: 'A single verified target email is required when bootstrap is enabled',
      });
    }
  });

const aiEnvironmentSchema = z
  .object({
    HANAPLY_ENV: environmentNameSchema.default('local'),
    ...aiEnvironmentShape,
  })
  .superRefine((value, context) => {
    enforceAiSettings(value, context);
  });

export type BrowserEnvironment = z.infer<typeof browserEnvironmentSchema>;
export type WebServerEnvironment = z.infer<typeof webServerEnvironmentSchema>;
export type ApiEnvironment = z.infer<typeof apiEnvironmentSchema>;
export type WorkerEnvironment = z.infer<typeof workerEnvironmentSchema>;
export type EmailEnvironment = z.infer<typeof emailEnvironmentSchema>;
export type AdminBootstrapEnvironment = z.infer<typeof adminBootstrapEnvironmentSchema>;
export type AiEnvironment = z.infer<typeof aiEnvironmentSchema>;

function enforceProductionUrls(
  environment: Pick<ApiEnvironment, 'HANAPLY_ENV' | 'APP_BASE_URL' | 'API_BASE_URL'>,
): void {
  if (environment.HANAPLY_ENV !== 'production') return;
  for (const [name, value] of Object.entries({
    APP_BASE_URL: environment.APP_BASE_URL,
    API_BASE_URL: environment.API_BASE_URL,
  })) {
    if (new URL(value).protocol !== 'https:') {
      throw new Error(`${name} must use HTTPS in production`);
    }
  }
}

export function parseBrowserEnvironment(input: Record<string, unknown>): BrowserEnvironment {
  return browserEnvironmentSchema.parse(input);
}

export function parseWebServerEnvironment(input: Record<string, unknown>): WebServerEnvironment {
  return webServerEnvironmentSchema.parse(input);
}

/**
 * Folds a platform-injected `PORT` into the variable a service actually reads.
 *
 * The variable is copied rather than read from `process.env` so this module
 * needs no Node type definitions and stays safe to import from the browser
 * bundle, and so the precedence is one statement a unit test can state exactly:
 * an explicit `API_PORT`/`WORKER_HEALTH_PORT` wins, then `PORT`, then the
 * schema's own default. A platform must be able to override the port, because a
 * service that binds where the router is not looking never receives a request.
 */
function resolveServicePort(
  input: Record<string, unknown>,
  serviceVariable: string,
): Record<string, unknown> {
  const explicit = input[serviceVariable];
  if (explicit !== undefined && explicit !== '') {
    return { ...input, PORT: explicit };
  }
  const platform = input.PORT;
  if (platform === undefined || platform === '') return input;
  return { ...input, [serviceVariable]: platform };
}

export function parseApiEnvironment(input: Record<string, unknown>): ApiEnvironment {
  const environment = apiEnvironmentSchema.parse(resolveServicePort(input, 'API_PORT'));
  enforceProductionUrls(environment);
  if (environment.HANAPLY_ENV === 'production' && environment.CORS_ALLOWED_ORIGINS.includes('*')) {
    throw new Error('Wildcard CORS is forbidden in production');
  }
  if (
    environment.HANAPLY_ENV === 'production' &&
    environment.RATE_LIMIT_STORE === 'memory' &&
    !environment.RATE_LIMIT_SINGLE_INSTANCE
  ) {
    throw new Error(
      'A distributed API rate-limit store is required in production unless this deployment is a single API instance. ' +
        'Set RATE_LIMIT_SINGLE_INSTANCE=true to state that it is, or implement a shared store and select it in createThrottlerStorage.',
    );
  }
  return environment;
}

export function parseWorkerEnvironment(input: Record<string, unknown>): WorkerEnvironment {
  const environment = workerEnvironmentSchema.parse(
    resolveServicePort(input, 'WORKER_HEALTH_PORT'),
  );
  enforceProductionUrls(environment);
  parseEmailEnvironment(environment);
  return environment;
}

export function parseEmailEnvironment(input: Record<string, unknown>): EmailEnvironment {
  return emailEnvironmentSchema.parse(input);
}

export function parseAdminBootstrapEnvironment(
  input: Record<string, unknown>,
): AdminBootstrapEnvironment {
  return adminBootstrapEnvironmentSchema.parse(input);
}

export function parseAiEnvironment(input: Record<string, unknown>): AiEnvironment {
  return aiEnvironmentSchema.parse(input);
}

export const browserEnvironmentKeys = Object.freeze([
  'NEXT_PUBLIC_APP_URL',
  'NEXT_PUBLIC_API_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
] as const);
