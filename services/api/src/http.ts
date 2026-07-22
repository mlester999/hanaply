import type { ApiErrorEnvelope, ErrorCode } from '@hanaply/contracts';
import type { FastifyRequest } from 'fastify';

export interface AuthContext {
  userId: string;
  accessToken: string;
  accountStatus: 'active' | 'suspended' | 'closed';
  roles?: readonly string[];
  permissions?: ReadonlySet<string>;
}

export interface AuthenticatedRequest extends FastifyRequest {
  auth?: AuthContext;
}

export function responseMeta(request: FastifyRequest) {
  return { apiVersion: 'v1' as const, requestId: request.id };
}

export function successEnvelope<TData>(request: FastifyRequest, data: TData) {
  return { data, meta: responseMeta(request) };
}

export function errorEnvelope(
  requestId: string,
  code: ErrorCode,
  message: string,
  details?: readonly { path: readonly (string | number)[]; code: string; message: string }[],
): ApiErrorEnvelope {
  return {
    error: {
      code,
      message,
      ...(details
        ? { details: details.map((detail) => ({ ...detail, path: [...detail.path] })) }
        : {}),
    },
    meta: { apiVersion: 'v1', requestId },
  };
}
