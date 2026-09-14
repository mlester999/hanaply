'use server';

import { adminJobParamsSchema, adminJobStatusSchema, HanaplyApiError } from '@hanaply/contracts';
import { revalidatePath } from 'next/cache';

import { assertTrustedMutationOrigin } from '@/lib/request-integrity';
import { createAuthenticatedApiClient, requireAdminPermission } from '@/lib/session';

export interface AdminJobStatusActionState {
  status: 'idle' | 'success' | 'error';
  message: string | null;
}

export async function setJobStatusAction(
  _previousState: AdminJobStatusActionState,
  formData: FormData,
): Promise<AdminJobStatusActionState> {
  void _previousState;
  await assertTrustedMutationOrigin();
  const params = adminJobParamsSchema.safeParse({ jobId: formData.get('jobId') });
  const body = adminJobStatusSchema.safeParse({
    status: formData.get('status'),
    reason: formData.get('reason'),
  });
  if (!params.success) {
    return { status: 'error', message: 'The job reference is invalid.' };
  }
  if (!body.success) {
    return {
      status: 'error',
      message: 'Choose a supported status and enter a reason of 10 to 500 characters.',
    };
  }
  const { session } = await requireAdminPermission('jobs.moderate');
  try {
    await createAuthenticatedApiClient(session).adminSetJobStatus(params.data.jobId, body.data);
    revalidatePath('/admin/jobs');
    revalidatePath(`/admin/jobs/${params.data.jobId}`);
    revalidatePath('/admin/ingestion');
    revalidatePath('/admin/deduplication');
    revalidatePath('/admin/audit');
    return {
      status: 'success',
      message: `The posting is now ${body.data.status.replaceAll('_', ' ')} and the change was audited.`,
    };
  } catch (error) {
    if (error instanceof HanaplyApiError) {
      if (error.envelope.error.code === 'RATE_LIMITED') {
        return {
          status: 'error',
          message: 'Too many moderation changes. Wait before trying again.',
        };
      }
      if (error.envelope.error.code === 'FORBIDDEN') {
        return { status: 'error', message: 'Job moderation is not permitted for your role.' };
      }
      if (error.envelope.error.code === 'NOT_FOUND') {
        return { status: 'error', message: 'The job no longer exists.' };
      }
      if (error.envelope.error.code === 'VALIDATION_ERROR') {
        return { status: 'error', message: error.envelope.error.message };
      }
    }
    return { status: 'error', message: 'The job status could not be changed safely.' };
  }
}
