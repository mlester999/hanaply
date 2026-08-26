export const permissions = Object.freeze([
  'admins.read',
  'admins.manage',
  'users.read',
  'users.manage',
  'subscriptions.read',
  'subscriptions.manage',
  'payments.read',
  'payments.review',
  'payment_methods.read',
  'payment_methods.manage',
  'plans.manage',
  'job_sources.read',
  'job_sources.manage',
  'jobs.read',
  'jobs.moderate',
  'taxonomy.read',
  'taxonomy.manage',
  'ai.read',
  'ai.manage',
  'prompts.publish',
  'templates.manage',
  'notifications.manage',
  'cms.manage',
  'support.manage',
  'audit.read',
  'security.manage',
  'platforms.manage',
  'feature_flags.manage',
] as const);

export type Permission = (typeof permissions)[number];

export const adminRoles = Object.freeze([
  'super_admin',
  'operations_administrator',
  'payment_reviewer',
  'ai_administrator',
  'content_manager',
  'support_administrator',
  'security_administrator',
  'read_only_analyst',
] as const);

export type AdminRole = (typeof adminRoles)[number];

const allPermissions = [...permissions];

export const rolePermissionMatrix: Readonly<Record<AdminRole, readonly Permission[]>> =
  Object.freeze({
    super_admin: allPermissions,
    operations_administrator: [
      'admins.read',
      'users.read',
      'users.manage',
      'subscriptions.read',
      'subscriptions.manage',
      'payments.read',
      'payments.review',
      'payment_methods.read',
      'payment_methods.manage',
      'plans.manage',
      'job_sources.read',
      'job_sources.manage',
      'jobs.read',
      'jobs.moderate',
      'taxonomy.read',
      'taxonomy.manage',
      'notifications.manage',
      'support.manage',
      'audit.read',
      'platforms.manage',
      'feature_flags.manage',
    ],
    payment_reviewer: [
      'users.read',
      'subscriptions.read',
      'payments.read',
      'payments.review',
      'payment_methods.read',
    ],
    ai_administrator: [
      'job_sources.read',
      'jobs.read',
      'taxonomy.read',
      'ai.read',
      'ai.manage',
      'prompts.publish',
      'templates.manage',
      'audit.read',
    ],
    content_manager: ['templates.manage', 'notifications.manage', 'cms.manage'],
    support_administrator: [
      'users.read',
      'subscriptions.read',
      'payments.read',
      'payment_methods.read',
      'jobs.read',
      'support.manage',
    ],
    security_administrator: [
      'admins.read',
      'admins.manage',
      'users.read',
      'audit.read',
      'security.manage',
      'platforms.manage',
      'payment_methods.read',
    ],
    read_only_analyst: [
      'users.read',
      'subscriptions.read',
      'payments.read',
      'payment_methods.read',
      'job_sources.read',
      'jobs.read',
      'taxonomy.read',
      'ai.read',
      'audit.read',
    ],
  });

export interface AuthorizationPrincipal {
  userId: string;
  roles: readonly string[];
  permissions: ReadonlySet<string>;
}

export function hasPermission(
  principal: Pick<AuthorizationPrincipal, 'permissions'>,
  permission: Permission,
): boolean {
  return principal.permissions.has(permission);
}

export function hasEveryPermission(
  principal: Pick<AuthorizationPrincipal, 'permissions'>,
  required: readonly Permission[],
): boolean {
  return required.every((permission) => hasPermission(principal, permission));
}

export function hasAnyPermission(
  principal: Pick<AuthorizationPrincipal, 'permissions'>,
  required: readonly Permission[],
): boolean {
  return required.some((permission) => hasPermission(principal, permission));
}

export function sanitizeRedirectPath(
  candidate: string | null | undefined,
  fallback = '/dashboard',
) {
  if (!candidate) return fallback;
  const trimmed = candidate.trim();
  if (
    !trimmed.startsWith('/') ||
    trimmed.startsWith('//') ||
    trimmed.includes('\\') ||
    Array.from(trimmed).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127;
    })
  ) {
    return fallback;
  }
  try {
    const url = new URL(trimmed, 'https://hanaply.invalid');
    return url.origin === 'https://hanaply.invalid'
      ? `${url.pathname}${url.search}${url.hash}`
      : fallback;
  } catch {
    return fallback;
  }
}

export * from './account-status.js';
export * from './validation.js';
