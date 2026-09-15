import {
  parseAdminBootstrapEnvironment,
  parseApiEnvironment,
  parseBrowserEnvironment,
  parseEmailEnvironment,
  parseWebServerEnvironment,
  parseWorkerEnvironment,
} from '@hanaply/config';
import { describe, expect, it } from 'vitest';

const localServerEnvironment = {
  NODE_ENV: 'test',
  HANAPLY_ENV: 'local',
  LOG_LEVEL: 'silent',
  APP_BASE_URL: 'http://localhost:3100',
  API_BASE_URL: 'http://localhost:3101',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_PUBLISHABLE_KEY: 'publishable-test-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-test-key',
  CORS_ALLOWED_ORIGINS: 'http://localhost:3100',
  RATE_LIMIT_STORE: 'memory',
};

describe('environment schemas', () => {
  it('parses and normalizes the local API environment', () => {
    const parsed = parseApiEnvironment({ ...localServerEnvironment, API_PORT: '3101' });
    expect(parsed.API_PORT).toBe(3101);
    expect(parsed.CORS_ALLOWED_ORIGINS).toEqual(['http://localhost:3100']);
    expect(parsed.OPENAPI_ENABLED).toBe(true);
  });

  it('rejects unsafe production URLs before startup', () => {
    expect(() =>
      parseApiEnvironment({ ...localServerEnvironment, HANAPLY_ENV: 'production' }),
    ).toThrow(/HTTPS/u);
  });

  it('binds the port the hosting platform routes to', () => {
    // A platform-injected PORT wins over the default, because a service that
    // binds elsewhere receives no traffic no matter how healthy it reports.
    expect(parseApiEnvironment({ ...localServerEnvironment, PORT: '8080' }).API_PORT).toBe(8080);
    expect(
      parseWorkerEnvironment({ ...localServerEnvironment, PORT: '8080' }).WORKER_HEALTH_PORT,
    ).toBe(8080);

    // An explicit service port still wins over PORT, so a self-hosted
    // deployment keeps the port it was configured with.
    expect(
      parseApiEnvironment({ ...localServerEnvironment, PORT: '8080', API_PORT: '4100' }).API_PORT,
    ).toBe(4100);
    expect(
      parseWorkerEnvironment({
        ...localServerEnvironment,
        PORT: '8080',
        WORKER_HEALTH_PORT: '4200',
      }).WORKER_HEALTH_PORT,
    ).toBe(4200);

    // With neither set, the local defaults are unchanged.
    expect(parseApiEnvironment(localServerEnvironment).API_PORT).toBe(3101);
    expect(parseWorkerEnvironment(localServerEnvironment).WORKER_HEALTH_PORT).toBe(3102);
    expect(parseApiEnvironment(localServerEnvironment).PORT).toBeUndefined();
  });

  it('rejects wildcard production CORS', () => {
    expect(() =>
      parseApiEnvironment({
        ...localServerEnvironment,
        HANAPLY_ENV: 'production',
        APP_BASE_URL: 'https://hanaply.example',
        API_BASE_URL: 'https://api.hanaply.example',
        CORS_ALLOWED_ORIGINS: '*',
      }),
    ).toThrow(/Wildcard CORS/u);
  });

  it('keeps the distributed rate-limit store as a production gate', () => {
    expect(() =>
      parseApiEnvironment({
        ...localServerEnvironment,
        HANAPLY_ENV: 'production',
        APP_BASE_URL: 'https://hanaply.example',
        API_BASE_URL: 'https://api.hanaply.example',
        CORS_ALLOWED_ORIGINS: 'https://hanaply.example',
      }),
    ).toThrow(/distributed API rate-limit store/u);
  });

  it('configures the database-backed payment worker explicitly', () => {
    const worker = parseWorkerEnvironment({
      ...localServerEnvironment,
      WORKER_MODE: 'active',
      EMAIL_PROVIDER: 'capture',
      SUBSCRIPTION_EXPIRY_REMINDER_DAYS: '30,7,1,7',
    });
    expect(worker.WORKER_MODE).toBe('active');
    expect(worker.SUBSCRIPTION_EXPIRY_REMINDER_DAYS).toEqual([30, 7, 1]);
    expect(worker.WORKER_NOTIFICATION_BATCH_SIZE).toBe(25);
    expect(worker.WORKER_NOTIFICATION_MAX_ATTEMPTS).toBe(5);
    expect(worker.WORKER_STORAGE_CLEANUP_BATCH_SIZE).toBe(25);
    expect(worker.WORKER_STORAGE_CLEANUP_MAX_ATTEMPTS).toBe(5);
  });

  it('requires Resend credentials only when that provider is selected', () => {
    expect(parseEmailEnvironment({ EMAIL_PROVIDER: 'disabled' }).EMAIL_PROVIDER).toBe('disabled');
    expect(() => parseEmailEnvironment({ EMAIL_PROVIDER: 'resend' })).toThrow();
    expect(
      parseEmailEnvironment({ EMAIL_PROVIDER: 'capture', HANAPLY_ENV: 'local' }).EMAIL_PROVIDER,
    ).toBe('capture');
    expect(() =>
      parseEmailEnvironment({
        EMAIL_PROVIDER: 'resend',
        EMAIL_ALLOW_LIVE_SENDS: 'true',
        HANAPLY_ENV: 'local',
        RESEND_API_KEY: 're_test_key',
        RESEND_FROM_ADDRESS: 'Hanaply <no-reply@example.com>',
      }),
    ).toThrow(/forbidden in local/u);
  });

  it('keeps the first-admin bootstrap explicitly disabled and single-targeted', () => {
    expect(parseAdminBootstrapEnvironment({}).ADMIN_BOOTSTRAP_ENABLED).toBe(false);
    expect(() => parseAdminBootstrapEnvironment({ ADMIN_BOOTSTRAP_ENABLED: 'true' })).toThrow(
      /target email/u,
    );
    expect(
      parseAdminBootstrapEnvironment({
        ADMIN_BOOTSTRAP_ENABLED: 'true',
        ADMIN_BOOTSTRAP_EMAIL: 'Owner@Example.com',
      }).ADMIN_BOOTSTRAP_EMAIL,
    ).toBe('owner@example.com');
  });

  it('strips server-only values from the browser environment', () => {
    const parsed = parseBrowserEnvironment({
      NEXT_PUBLIC_APP_URL: 'http://localhost:3100',
      NEXT_PUBLIC_API_URL: 'http://localhost:3101',
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable-test-key',
      SUPABASE_SERVICE_ROLE_KEY: 'must-not-survive',
    });
    expect(parsed).not.toHaveProperty('SUPABASE_SERVICE_ROLE_KEY');
  });

  it('requires a strong production-only rate-limit pepper', () => {
    const browser = {
      NEXT_PUBLIC_APP_URL: 'https://hanaply.example',
      NEXT_PUBLIC_API_URL: 'https://api.hanaply.example',
      NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable-test-key',
    };
    expect(() =>
      parseWebServerEnvironment({
        ...browser,
        HANAPLY_ENV: 'production',
        AUTH_RATE_LIMIT_PEPPER: 'too-short-for-production',
      }),
    ).toThrow(/32 characters/u);
    expect(
      parseWebServerEnvironment({
        ...browser,
        HANAPLY_ENV: 'production',
        AUTH_RATE_LIMIT_PEPPER: 'a'.repeat(32),
      }).HANAPLY_ENV,
    ).toBe('production');
  });
});
