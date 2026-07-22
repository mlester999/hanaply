import type { Permission } from '@hanaply/auth';
import { createPublicDatabaseClient } from '@hanaply/database';
import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ApiEnvironment } from '@hanaply/config';

import { AppError } from './app-error.js';
import type { AuthenticatedRequest } from './http.js';
import { HanaplyRepository } from './repository.js';
import { API_ENVIRONMENT } from './tokens.js';

const REQUIRED_PERMISSIONS = 'hanaply.required_permissions';

interface PermissionRequirement {
  mode: 'all' | 'any';
  permissions: readonly Permission[];
}

export const RequirePermission = (permission: Permission) =>
  SetMetadata(REQUIRED_PERMISSIONS, {
    mode: 'all',
    permissions: [permission],
  } satisfies PermissionRequirement);

export const RequireAllPermissions = (...permissions: readonly Permission[]) =>
  SetMetadata(REQUIRED_PERMISSIONS, { mode: 'all', permissions } satisfies PermissionRequirement);

export const RequireAnyPermission = (...permissions: readonly Permission[]) =>
  SetMetadata(REQUIRED_PERMISSIONS, { mode: 'any', permissions } satisfies PermissionRequirement);

export const RequirePermissions = RequireAllPermissions;

function authenticationError(message = 'Authentication is required'): AppError {
  return new AppError({ code: 'AUTHENTICATION_REQUIRED', status: 401, message });
}

@Injectable()
export class SupabaseAuthService {
  private readonly verificationClient;

  constructor(
    @Inject(API_ENVIRONMENT) environment: ApiEnvironment,
    @Inject(HanaplyRepository) private readonly repository: HanaplyRepository,
  ) {
    this.verificationClient = createPublicDatabaseClient(
      environment.SUPABASE_URL,
      environment.SUPABASE_PUBLISHABLE_KEY,
    );
  }

  async authenticate(request: AuthenticatedRequest): Promise<void> {
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer ')) throw authenticationError();
    const accessToken = authorization.slice('Bearer '.length).trim();
    if (!accessToken || accessToken.includes(' '))
      throw authenticationError('Bearer token is invalid');
    const claimsResult = await this.verificationClient.auth.getClaims(accessToken);
    const claims = claimsResult.data?.claims;
    const userId = claims?.sub;
    if (claimsResult.error || !claims || !userId)
      throw authenticationError('Session is invalid or expired');
    const sessionId = claims.session_id;
    if (
      typeof sessionId !== 'string' ||
      !(await this.repository.isAuthSessionActive(userId, sessionId))
    ) {
      throw authenticationError('Session is invalid or expired');
    }
    const profile = await this.repository.getProfile(accessToken, userId);
    if (!profile) throw authenticationError('Account profile is unavailable');
    if (profile.accountStatus === 'suspended') {
      throw new AppError({
        code: 'ACCOUNT_SUSPENDED',
        status: 403,
        message: 'This account is suspended',
      });
    }
    if (profile.accountStatus !== 'active') {
      throw new AppError({ code: 'FORBIDDEN', status: 403, message: 'This account is not active' });
    }
    request.auth = { userId, accessToken, accountStatus: profile.accountStatus };
  }

  async authorizeAdmin(
    request: AuthenticatedRequest,
    requirement: PermissionRequirement,
  ): Promise<void> {
    const auth = request.auth;
    if (!auth) throw authenticationError();
    const access = await this.repository.getAdminAccess(auth.accessToken);
    if (!access) {
      throw new AppError({
        code: 'FORBIDDEN',
        status: 403,
        message: 'Administrator membership is required',
      });
    }
    const permissionSet = new Set(access.permissions);
    const permitted =
      requirement.mode === 'any'
        ? requirement.permissions.some((permission) => permissionSet.has(permission))
        : requirement.permissions.every((permission) => permissionSet.has(permission));
    if (!permitted) {
      throw new AppError({
        code: 'FORBIDDEN',
        status: 403,
        message: 'Required administrator permission is missing',
      });
    }
    request.auth = {
      ...auth,
      roles: access.roles,
      permissions: permissionSet,
    };
  }
}

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  constructor(@Inject(SupabaseAuthService) private readonly authService: SupabaseAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    await this.authService.authenticate(request);
    return true;
  }
}

@Injectable()
export class AdminAuthorizationGuard implements CanActivate {
  constructor(
    @Inject(SupabaseAuthService) private readonly authService: SupabaseAuthService,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const requirement = this.reflector.getAllAndOverride<PermissionRequirement>(
      REQUIRED_PERMISSIONS,
      [context.getHandler(), context.getClass()],
    ) ?? { mode: 'all', permissions: [] };
    await this.authService.authorizeAdmin(request, requirement);
    return true;
  }
}
