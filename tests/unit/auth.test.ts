import {
  hasAnyPermission,
  hasEveryPermission,
  hasPermission,
  permissions,
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
