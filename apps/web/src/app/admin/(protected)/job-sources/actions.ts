'use server';

import {
  adminJobSourceConfigSchema,
  adminJobSourceParamsSchema,
  adminJobSourceStateSchema,
  HanaplyApiError,
} from '@hanaply/contracts';
import { revalidatePath } from 'next/cache';

import { assertTrustedMutationOrigin } from '@/lib/request-integrity';
import { createAuthenticatedApiClient, requireAdminPermission } from '@/lib/session';

export interface AdminJobSourceActionState {
  status: 'idle' | 'success' | 'error';
  message: string | null;
}

function safeActionError(error: unknown, fallback: string): string {
  if (error instanceof HanaplyApiError) {
    if (error.envelope.error.code === 'RATE_LIMITED') {
      return 'Too many provider operations were attempted. Wait before trying again.';
    }
    if (error.envelope.error.code === 'FORBIDDEN') {
      return 'This provider operation is not permitted for your administrator role.';
    }
    if (error.envelope.error.code === 'NOT_FOUND') return 'The provider no longer exists.';
    if (error.envelope.error.code === 'VALIDATION_ERROR') {
      // The database functions explain exactly which rule refused the change,
      // and the operator needs that wording rather than a generic summary.
      return error.envelope.error.message;
    }
  }
  return fallback;
}

function revalidateJobSourcePaths(sourceId: string): void {
  revalidatePath('/admin/job-sources');
  revalidatePath('/admin/ingestion');
  revalidatePath(`/admin/job-sources/${sourceId}`);
  revalidatePath('/admin/audit');
}

export async function setJobSourceStateAction(
  _previousState: AdminJobSourceActionState,
  formData: FormData,
): Promise<AdminJobSourceActionState> {
  void _previousState;
  await assertTrustedMutationOrigin();
  const params = adminJobSourceParamsSchema.safeParse({ sourceId: formData.get('sourceId') });
  const body = adminJobSourceStateSchema.safeParse({
    action: formData.get('action'),
    reason: formData.get('reason'),
  });
  if (!params.success) {
    return { status: 'error', message: 'The provider reference is invalid.' };
  }
  if (!body.success) {
    return { status: 'error', message: 'Enter a clear reason between 10 and 500 characters.' };
  }
  const { session } = await requireAdminPermission('job_sources.manage');
  try {
    const result = await createAuthenticatedApiClient(session).adminSetJobSourceState(
      params.data.sourceId,
      body.data,
    );
    revalidateJobSourcePaths(params.data.sourceId);
    if (!result.data.changed) {
      return {
        status: 'error',
        message: 'The provider already had that status, so nothing changed.',
      };
    }
    return {
      status: 'success',
      message: `The provider was ${body.data.action === 'enable' ? 'enabled' : body.data.action === 'pause' ? 'paused' : 'disabled'} and the change was audited.`,
    };
  } catch (error) {
    return {
      status: 'error',
      message: safeActionError(error, 'The provider state could not be changed safely.'),
    };
  }
}

export async function requestJobSourceScanAction(
  _previousState: AdminJobSourceActionState,
  formData: FormData,
): Promise<AdminJobSourceActionState> {
  void _previousState;
  await assertTrustedMutationOrigin();
  const params = adminJobSourceParamsSchema.safeParse({ sourceId: formData.get('sourceId') });
  if (!params.success) {
    return { status: 'error', message: 'The provider reference is invalid.' };
  }
  const { session } = await requireAdminPermission('job_sources.manage');
  try {
    await createAuthenticatedApiClient(session).adminRequestJobSourceScan(params.data.sourceId);
    revalidateJobSourcePaths(params.data.sourceId);
    return {
      status: 'success',
      message:
        'The provider is now due. The worker starts the scan on its next tick, not immediately.',
    };
  } catch (error) {
    return {
      status: 'error',
      message: safeActionError(error, 'The scan request could not be recorded safely.'),
    };
  }
}

export async function updateJobSourceConfigAction(
  _previousState: AdminJobSourceActionState,
  formData: FormData,
): Promise<AdminJobSourceActionState> {
  void _previousState;
  await assertTrustedMutationOrigin();
  const params = adminJobSourceParamsSchema.safeParse({ sourceId: formData.get('sourceId') });
  if (!params.success) {
    return { status: 'error', message: 'The provider reference is invalid.' };
  }
  const raw = formData.get('config');
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return { status: 'error', message: 'Provide the configuration as a JSON object.' };
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return { status: 'error', message: 'The configuration is not valid JSON.' };
  }
  if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) {
    return { status: 'error', message: 'The configuration must be a JSON object.' };
  }
  const body = adminJobSourceConfigSchema.safeParse({
    config: decoded,
    reason: formData.get('reason'),
  });
  if (!body.success) {
    return { status: 'error', message: 'Enter a clear reason between 10 and 500 characters.' };
  }
  const { session } = await requireAdminPermission('job_sources.manage');
  try {
    await createAuthenticatedApiClient(session).adminUpdateJobSourceConfig(
      params.data.sourceId,
      body.data,
    );
    revalidateJobSourcePaths(params.data.sourceId);
    return { status: 'success', message: 'The provider configuration was replaced and audited.' };
  } catch (error) {
    return {
      status: 'error',
      message: safeActionError(error, 'The provider configuration could not be saved safely.'),
    };
  }
}
