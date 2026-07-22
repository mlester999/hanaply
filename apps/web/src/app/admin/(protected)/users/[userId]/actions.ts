'use server';

import {
  adminAccountActionSchema,
  adminUserParamsSchema,
  HanaplyApiError,
} from '@hanaply/contracts';
import { revalidatePath } from 'next/cache';

import { assertTrustedMutationOrigin } from '@/lib/request-integrity';
import {
  createAuthenticatedApiClient,
  requireAdminPermission,
  requireAnyAdminPermission,
} from '@/lib/session';

export interface AdminUserActionState {
  status: 'idle' | 'success' | 'error';
  message: string | null;
}

function parseAction(formData: FormData) {
  const params = adminUserParamsSchema.safeParse({ userId: formData.get('userId') });
  const body = adminAccountActionSchema.safeParse({ reason: formData.get('reason') });
  if (!params.success || !body.success) return { success: false as const };
  return { success: true as const, data: { ...params.data, ...body.data } };
}

function safeActionError(error: unknown): string {
  if (error instanceof HanaplyApiError) {
    if (error.envelope.error.code === 'FORBIDDEN') {
      return 'This operation is not permitted. Self-protection and last-Super-Admin rules may apply.';
    }
    if (error.envelope.error.code === 'NOT_FOUND') return 'The user account was not found.';
    if (error.envelope.error.code === 'RATE_LIMITED') {
      return 'Too many administrator actions. Wait before trying again.';
    }
    if (error.envelope.error.code === 'VALIDATION_ERROR') {
      return 'The action does not match the current account state.';
    }
  }
  return 'The administrator action could not be completed safely. Try again.';
}

function finish(userId: string, message: string): AdminUserActionState {
  revalidatePath('/admin');
  revalidatePath('/admin/users');
  revalidatePath(`/admin/users/${userId}`);
  revalidatePath('/admin/audit');
  return { status: 'success', message };
}

export async function suspendUserAction(
  _previousState: AdminUserActionState,
  formData: FormData,
): Promise<AdminUserActionState> {
  void _previousState;
  await assertTrustedMutationOrigin();
  const parsed = parseAction(formData);
  if (!parsed.success) {
    return { status: 'error', message: 'Enter a clear reason between 10 and 500 characters.' };
  }
  const { session } = await requireAdminPermission('users.manage');
  try {
    await createAuthenticatedApiClient(session).suspendAdminUser(parsed.data.userId, {
      reason: parsed.data.reason,
    });
    return finish(parsed.data.userId, 'The account was suspended and the action was audited.');
  } catch (error) {
    return { status: 'error', message: safeActionError(error) };
  }
}

export async function restoreUserAction(
  _previousState: AdminUserActionState,
  formData: FormData,
): Promise<AdminUserActionState> {
  void _previousState;
  await assertTrustedMutationOrigin();
  const parsed = parseAction(formData);
  if (!parsed.success) {
    return { status: 'error', message: 'Enter a clear reason between 10 and 500 characters.' };
  }
  const { session } = await requireAdminPermission('users.manage');
  try {
    await createAuthenticatedApiClient(session).restoreAdminUser(parsed.data.userId, {
      reason: parsed.data.reason,
    });
    return finish(parsed.data.userId, 'The account was restored and the action was audited.');
  } catch (error) {
    return { status: 'error', message: safeActionError(error) };
  }
}

export async function revokeUserSessionsAction(
  _previousState: AdminUserActionState,
  formData: FormData,
): Promise<AdminUserActionState> {
  void _previousState;
  await assertTrustedMutationOrigin();
  const parsed = parseAction(formData);
  if (!parsed.success) {
    return { status: 'error', message: 'Enter a clear reason between 10 and 500 characters.' };
  }
  const { session } = await requireAnyAdminPermission(['users.manage', 'security.manage']);
  try {
    const result = await createAuthenticatedApiClient(session).revokeAdminUserSessions(
      parsed.data.userId,
      { reason: parsed.data.reason },
    );
    return finish(
      parsed.data.userId,
      `${result.data.revokedSessionCount} session${result.data.revokedSessionCount === 1 ? '' : 's'} revoked.`,
    );
  } catch (error) {
    return { status: 'error', message: safeActionError(error) };
  }
}
