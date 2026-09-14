'use server';

import {
  adminDedupParamsSchema,
  adminDedupResolutionSchema,
  HanaplyApiError,
} from '@hanaply/contracts';
import { revalidatePath } from 'next/cache';

import { assertTrustedMutationOrigin } from '@/lib/request-integrity';
import { createAuthenticatedApiClient, requireAdminPermission } from '@/lib/session';

export interface AdminDedupActionState {
  status: 'idle' | 'success' | 'error';
  message: string | null;
}

export async function resolveDedupCandidateAction(
  _previousState: AdminDedupActionState,
  formData: FormData,
): Promise<AdminDedupActionState> {
  void _previousState;
  await assertTrustedMutationOrigin();
  const params = adminDedupParamsSchema.safeParse({ candidateId: formData.get('candidateId') });
  const body = adminDedupResolutionSchema.safeParse({
    resolution: formData.get('resolution'),
    reason: formData.get('reason'),
  });
  if (!params.success) {
    return { status: 'error', message: 'The deduplication candidate reference is invalid.' };
  }
  if (!body.success) {
    return {
      status: 'error',
      message: 'Choose merge or keep separate and enter a reason of 10 to 500 characters.',
    };
  }
  const { session } = await requireAdminPermission('jobs.moderate');
  try {
    const result = await createAuthenticatedApiClient(session).adminResolveDedupCandidate(
      params.data.candidateId,
      body.data,
    );
    revalidatePath('/admin/deduplication');
    revalidatePath('/admin/jobs');
    revalidatePath('/admin/ingestion');
    revalidatePath('/admin/audit');
    if (!result.data.resolved) {
      return {
        status: 'error',
        message:
          'The decision was not recorded. The pair may already have been resolved elsewhere.',
      };
    }
    return {
      status: 'success',
      message:
        body.data.resolution === 'merged'
          ? 'The pair was merged. Source records now point at the surviving job and nothing was deleted.'
          : 'The pair was recorded as two distinct postings and the decision was audited.',
    };
  } catch (error) {
    if (error instanceof HanaplyApiError) {
      if (error.envelope.error.code === 'RATE_LIMITED') {
        return { status: 'error', message: 'Too many decisions. Wait before trying again.' };
      }
      if (error.envelope.error.code === 'FORBIDDEN') {
        return { status: 'error', message: 'Deduplication review is not permitted for your role.' };
      }
      if (error.envelope.error.code === 'NOT_FOUND') {
        return { status: 'error', message: 'The deduplication candidate no longer exists.' };
      }
      if (error.envelope.error.code === 'VALIDATION_ERROR') {
        return { status: 'error', message: error.envelope.error.message };
      }
    }
    return { status: 'error', message: 'The decision could not be recorded safely.' };
  }
}
