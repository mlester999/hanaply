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

const sharedServerEnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HANAPLY_ENV: environmentNameSchema.default('local'),
  LOG_LEVEL: logLevelSchema.default('info'),
  APP_BASE_URL: urlSchema,
  API_BASE_URL: urlSchema,
  SUPABASE_URL: urlSchema,
  SUPABASE_PUBLISHABLE_KEY: nonEmptyString,
  SUPABASE_SERVICE_ROLE_KEY: nonEmptyString,
  SUPABASE_DB_URL: nonEmptyString.optional(),
  SUPABASE_PROJECT_REF: nonEmptyString.optional(),
  BUILD_SHA: nonEmptyString.default('local'),
});

const apiEnvironmentSchema = sharedServerEnvironmentSchema.extend({
  API_PORT: portFromEnvironment.default(3101),
  RATE_LIMIT_STORE: z.literal('memory').default('memory'),
  CORS_ALLOWED_ORIGINS: nonEmptyString.transform((value) =>
    value
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  ),
  OPENAPI_ENABLED: booleanFromEnvironment.default(true),
});

const workerEnvironmentSchema = sharedServerEnvironmentSchema.extend({
  WORKER_HEALTH_PORT: portFromEnvironment.default(3102),
  WORKER_MODE: z.enum(['idle', 'active']).default('idle'),
});

const emailEnvironmentSchema = z
  .object({
    HANAPLY_ENV: environmentNameSchema.default('local'),
    EMAIL_PROVIDER: z.enum(['disabled', 'capture', 'resend']).default('disabled'),
    EMAIL_ALLOW_LIVE_SENDS: booleanFromEnvironment.default(false),
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

export type BrowserEnvironment = z.infer<typeof browserEnvironmentSchema>;
export type ApiEnvironment = z.infer<typeof apiEnvironmentSchema>;
export type WorkerEnvironment = z.infer<typeof workerEnvironmentSchema>;
export type EmailEnvironment = z.infer<typeof emailEnvironmentSchema>;
export type AdminBootstrapEnvironment = z.infer<typeof adminBootstrapEnvironmentSchema>;

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

export function parseApiEnvironment(input: Record<string, unknown>): ApiEnvironment {
  const environment = apiEnvironmentSchema.parse(input);
  enforceProductionUrls(environment);
  if (environment.HANAPLY_ENV === 'production' && environment.CORS_ALLOWED_ORIGINS.includes('*')) {
    throw new Error('Wildcard CORS is forbidden in production');
  }
  if (environment.HANAPLY_ENV === 'production' && environment.RATE_LIMIT_STORE === 'memory') {
    throw new Error('A distributed API rate-limit store is required in production');
  }
  return environment;
}

export function parseWorkerEnvironment(input: Record<string, unknown>): WorkerEnvironment {
  const environment = workerEnvironmentSchema.parse(input);
  enforceProductionUrls(environment);
  if (environment.WORKER_MODE === 'active') {
    throw new Error('No production queue adapter is configured for active worker mode');
  }
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

export const browserEnvironmentKeys = Object.freeze([
  'NEXT_PUBLIC_APP_URL',
  'NEXT_PUBLIC_API_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
] as const);
