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
    EMAIL_PROVIDER: z.enum(['disabled', 'resend']).default('disabled'),
    RESEND_API_KEY: z.string().trim().optional(),
    RESEND_FROM_ADDRESS: z.string().trim().optional(),
  })
  .superRefine((value, context) => {
    if (value.EMAIL_PROVIDER !== 'resend') return;
    if (!value.RESEND_API_KEY) {
      context.addIssue({
        code: 'custom',
        path: ['RESEND_API_KEY'],
        message: 'Required for Resend',
      });
    }
    if (!value.RESEND_FROM_ADDRESS) {
      context.addIssue({
        code: 'custom',
        path: ['RESEND_FROM_ADDRESS'],
        message: 'Required for Resend',
      });
    }
  });

export type BrowserEnvironment = z.infer<typeof browserEnvironmentSchema>;
export type ApiEnvironment = z.infer<typeof apiEnvironmentSchema>;
export type WorkerEnvironment = z.infer<typeof workerEnvironmentSchema>;
export type EmailEnvironment = z.infer<typeof emailEnvironmentSchema>;

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

export const browserEnvironmentKeys = Object.freeze([
  'NEXT_PUBLIC_APP_URL',
  'NEXT_PUBLIC_API_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
] as const);
