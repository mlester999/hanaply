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
    const parsed = parseApiEnvironment(localServerEnvironment);
    expect(parsed.API_PORT).toBe(3101);
    expect(parsed.CORS_ALLOWED_ORIGINS).toEqual(['http://localhost:3100']);
    expect(parsed.OPENAPI_ENABLED).toBe(true);
  });

  it('rejects unsafe production URLs before startup', () => {
    expect(() =>
      parseApiEnvironment({ ...localServerEnvironment, HANAPLY_ENV: 'production' }),
    ).toThrow(/HTTPS/u);
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

  it('refuses active worker mode without a production queue adapter', () => {
    expect(() =>
      parseWorkerEnvironment({ ...localServerEnvironment, WORKER_MODE: 'active' }),
    ).toThrow(/production queue adapter/u);
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
