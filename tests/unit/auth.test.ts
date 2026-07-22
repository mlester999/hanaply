import {
  changePasswordSchema,
  evaluateAccountAccess,
  hasAnyPermission,
  hasEveryPermission,
  hasPermission,
  maskEmail,
  normalizeEmail,
  passwordSchema,
  permissions,
  profileUpdateSchema,
  registrationSchema,
  rolePermissionMatrix,
  sanitizeRedirectPath,
} from '@hanaply/auth';
import { describe, expect, it } from 'vitest';

describe('redirect sanitization', () => {
  it.each([
    [undefined, '/dashboard'],
    ['', '/dashboard'],
    ['https://evil.example', '/dashboard'],
    ['//evil.example/path', '/dashboard'],
    ['/\\evil.example', '/dashboard'],
    ['/safe\u0000path', '/dashboard'],
    ['javascript:alert(1)', '/dashboard'],
  ])('maps %s to a safe fallback', (candidate, expected) => {
    expect(sanitizeRedirectPath(candidate)).toBe(expected);
  });

  it('preserves a same-origin relative path, query, and fragment', () => {
    expect(sanitizeRedirectPath('/dashboard/settings?tab=profile#name')).toBe(
      '/dashboard/settings?tab=profile#name',
    );
  });
});

describe('permission evaluation', () => {
  const principal = { permissions: new Set(['users.read', 'audit.read']) };

  it('supports single, any, and all checks', () => {
    expect(hasPermission(principal, 'users.read')).toBe(true);
    expect(hasAnyPermission(principal, ['payments.read', 'audit.read'])).toBe(true);
    expect(hasEveryPermission(principal, ['users.read', 'audit.read'])).toBe(true);
    expect(hasEveryPermission(principal, ['users.read', 'users.manage'])).toBe(false);
  });

  it('expands Super Admin without runtime wildcards', () => {
    expect(rolePermissionMatrix.super_admin).toEqual(permissions);
    expect(rolePermissionMatrix.super_admin).not.toContain('*');
  });

  it('includes explicit administrator role permissions', () => {
    expect(rolePermissionMatrix.security_administrator).toEqual(
      expect.arrayContaining(['admins.read', 'admins.manage']),
    );
    expect(rolePermissionMatrix.operations_administrator).toContain('admins.read');
  });
});

describe('Phase 1 authentication validation', () => {
  it('normalizes email without provider-specific rewriting', () => {
    expect(normalizeEmail('  Person+Career@Example.COM ')).toBe('person+career@example.com');
    expect(maskEmail('person@example.com')).toBe('pe****@example.com');
  });

  it('uses a clear, practical password policy', () => {
    expect(passwordSchema.safeParse('long-enough-7').success).toBe(true);
    expect(passwordSchema.safeParse('onlyletters').success).toBe(false);
    expect(passwordSchema.safeParse('short7').success).toBe(false);
  });

  it('requires current-password confirmation for an in-session password change', () => {
    expect(
      changePasswordSchema.safeParse({
        currentPassword: 'CurrentPass7',
        password: 'NewSecurePass8',
        passwordConfirmation: 'NewSecurePass8',
      }).success,
    ).toBe(true);
    expect(
      changePasswordSchema.safeParse({
        currentPassword: 'SamePassword7',
        password: 'SamePassword7',
        passwordConfirmation: 'SamePassword7',
      }).success,
    ).toBe(false);
  });

  it('requires matching passwords and both legal agreements', () => {
    const input = {
      firstName: 'Ana',
      lastName: 'Reyes',
      email: 'ANA@EXAMPLE.COM',
      password: 'CareerReady7',
      passwordConfirmation: 'CareerReady7',
      termsAccepted: true,
      privacyAccepted: true,
      marketingConsent: false,
    };
    expect(registrationSchema.parse(input).email).toBe('ana@example.com');
    expect(registrationSchema.safeParse({ ...input, termsAccepted: false }).success).toBe(false);
    expect(
      registrationSchema.safeParse({ ...input, passwordConfirmation: 'Different7' }).success,
    ).toBe(false);
  });

  it('validates safe profile fields and IANA timezones', () => {
    expect(
      profileUpdateSchema.safeParse({
        firstName: 'Ana',
        lastName: 'Reyes',
        displayName: '',
        countryCode: 'ph',
        locale: 'en-PH',
        timezone: 'Asia/Manila',
      }).success,
    ).toBe(true);
    expect(
      profileUpdateSchema.safeParse({
        firstName: 'Ana',
        lastName: 'Reyes',
        displayName: null,
        countryCode: 'PH',
        locale: 'en-PH',
        timezone: 'Not/AZone',
      }).success,
    ).toBe(false);
  });

  it('fails product access closed for every non-active account state', () => {
    expect(evaluateAccountAccess('active').mayAccessProduct).toBe(true);
    expect(evaluateAccountAccess('suspended')).toMatchObject({
      mayAuthenticate: true,
      mayAccessProduct: false,
      route: '/account-suspended',
    });
    expect(evaluateAccountAccess('disabled').mayAuthenticate).toBe(false);
    expect(evaluateAccountAccess('pending_deletion').mayAccessProduct).toBe(false);
  });
});
