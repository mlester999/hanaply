'use server';

import {
  correctSubscriptionSchema,
  HanaplyApiError,
  subscriptionParamsSchema,
} from '@hanaply/contracts';
import { revalidatePath } from 'next/cache';

import { assertTrustedMutationOrigin } from '@/lib/request-integrity';
import { createAuthenticatedApiClient, requireAdminPermission } from '@/lib/session';

export interface SubscriptionCorrectionState {
  status: 'idle' | 'success' | 'error';
  message: string | null;
}

function nullable(value: FormDataEntryValue | null): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function utcTimestamp(value: FormDataEntryValue | null): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(value)) return '';
  const parsed = new Date(`${value}:00Z`);
  return Number.isNaN(parsed.valueOf()) ? '' : parsed.toISOString();
}

function safeError(error: unknown): string {
  if (error instanceof HanaplyApiError) {
    if (error.envelope.error.code === 'CONFLICT') {
      return 'Another administrator changed this subscription. Refresh before correcting it.';
    }
    if (error.envelope.error.code === 'FORBIDDEN') {
      return 'This correction is not permitted for the current administrator.';
    }
    if (error.envelope.error.code === 'VALIDATION_ERROR') {
      return 'The correction is invalid for the current subscription state.';
    }
    if (error.envelope.error.code === 'RATE_LIMITED') {
      return 'Too many corrections were attempted. Wait before trying again.';
    }
    if (error.envelope.error.code === 'NOT_FOUND') return 'The subscription was not found.';
  }
  return 'The subscription correction could not be completed safely.';
}

export async function correctSubscriptionAction(
  _previousState: SubscriptionCorrectionState,
  formData: FormData,
): Promise<SubscriptionCorrectionState> {
  void _previousState;
  await assertTrustedMutationOrigin();
  if (formData.get('confirmCorrection') !== 'yes') {
    return { status: 'error', message: 'Confirm that you reviewed the dates and access impact.' };
  }
  const params = subscriptionParamsSchema.safeParse({
    subscriptionId: formData.get('subscriptionId'),
  });
  const body = correctSubscriptionSchema.safeParse({
    expectedVersion: Number(formData.get('expectedVersion')),
    startsAt: utcTimestamp(formData.get('startsAt')),
    endsAt: utcTimestamp(formData.get('endsAt')),
    reason: formData.get('reason'),
    internalNote: nullable(formData.get('internalNote')),
    restoreReversed: formData.get('restoreReversed') === 'yes',
  });
  if (!params.success || !body.success) {
    return {
      status: 'error',
      message: 'Enter valid UTC dates, keep the end after the start, and add a clear reason.',
    };
  }
  const { session, admin } = await requireAdminPermission('subscriptions.manage');
  if (body.data.restoreReversed && !admin.permissions.includes('security.manage')) {
    return {
      status: 'error',
      message: 'Security management permission is required to restore reversed access.',
    };
  }
  try {
    const result = await createAuthenticatedApiClient(session).correctAdminSubscription(
      params.data.subscriptionId,
      body.data,
    );
    revalidatePath('/admin');
    revalidatePath('/admin/subscriptions');
    revalidatePath(`/admin/subscriptions/${params.data.subscriptionId}`);
    revalidatePath('/admin/payments');
    revalidatePath('/admin/audit');
    revalidatePath('/dashboard/activation');
    return {
      status: 'success',
      message: `The correction was recorded. Access now ends ${new Date(result.data.endsAt ?? '').toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}.`,
    };
  } catch (error) {
    return { status: 'error', message: safeError(error) };
  }
}
