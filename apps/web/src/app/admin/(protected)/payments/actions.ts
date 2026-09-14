'use server';

import {
  adminVersionedActionSchema,
  approvePaymentSchema,
  HanaplyApiError,
  paymentSubmissionParamsSchema,
  recordPaymentRefundSchema,
  rejectPaymentSchema,
  requestPaymentInformationSchema,
  reversePaymentSchema,
  versionedPaymentActionSchema,
} from '@hanaply/contracts';
import { revalidatePath } from 'next/cache';

import { assertTrustedMutationOrigin } from '@/lib/request-integrity';
import {
  createAuthenticatedApiClient,
  requireAdminPermission,
  requireAnyAdminPermission,
} from '@/lib/session';

export interface PaymentReviewActionState {
  status: 'idle' | 'success' | 'error';
  message: string | null;
}

function nullable(value: FormDataEntryValue | null): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function safeError(error: unknown): string {
  if (error instanceof HanaplyApiError) {
    if (error.envelope.error.code === 'CONFLICT')
      return 'Another reviewer changed this payment. Refresh before taking another action.';
    if (error.envelope.error.code === 'FORBIDDEN')
      return 'This review action is not permitted for the current administrator.';
    if (error.envelope.error.code === 'VALIDATION_ERROR')
      return 'The action is invalid for the current payment or subscription state.';
    if (error.envelope.error.code === 'RATE_LIMITED')
      return 'Too many review actions were attempted. Wait before trying again.';
    if (error.envelope.error.code === 'NOT_FOUND') return 'The payment submission was not found.';
  }
  return 'The payment review action could not be completed safely.';
}

function paymentId(formData: FormData) {
  return paymentSubmissionParamsSchema.safeParse({ submissionId: formData.get('submissionId') });
}

function finish(submissionId: string): PaymentReviewActionState {
  revalidatePath('/admin');
  revalidatePath('/admin/payments');
  revalidatePath(`/admin/payments/${submissionId}`);
  revalidatePath('/admin/subscriptions');
  revalidatePath('/admin/audit');
  revalidatePath('/dashboard/activation');
  revalidatePath('/dashboard');
  // The member-facing sentence is derived from the submission's own event history
  // by the page that renders it, so nothing here has to carry it across a
  // navigation that unmounts the form.
  return { status: 'idle', message: null };
}

export async function startPaymentReviewAction(
  _state: PaymentReviewActionState,
  formData: FormData,
): Promise<PaymentReviewActionState> {
  void _state;
  await assertTrustedMutationOrigin();
  const params = paymentId(formData);
  const body = versionedPaymentActionSchema.safeParse({
    expectedVersion: Number(formData.get('expectedVersion')),
  });
  if (!params.success || !body.success)
    return { status: 'error', message: 'The payment version is invalid.' };
  const { session } = await requireAdminPermission('payments.review');
  try {
    await createAuthenticatedApiClient(session).startPaymentReview(
      params.data.submissionId,
      body.data,
    );
    return finish(params.data.submissionId);
  } catch (error) {
    return { status: 'error', message: safeError(error) };
  }
}

export async function requestPaymentInformationAction(
  _state: PaymentReviewActionState,
  formData: FormData,
): Promise<PaymentReviewActionState> {
  void _state;
  await assertTrustedMutationOrigin();
  const params = paymentId(formData);
  const body = requestPaymentInformationSchema.safeParse({
    expectedVersion: Number(formData.get('expectedVersion')),
    reason: formData.get('reason'),
    reasonCategory: formData.get('reasonCategory'),
    publicMessage: formData.get('publicMessage'),
    internalNote: nullable(formData.get('internalNote')),
  });
  if (!params.success || !body.success)
    return {
      status: 'error',
      message: 'Add a public message, reason category, and clear action reason.',
    };
  const { session } = await requireAdminPermission('payments.review');
  try {
    await createAuthenticatedApiClient(session).requestPaymentInformation(
      params.data.submissionId,
      body.data,
    );
    return finish(params.data.submissionId);
  } catch (error) {
    return { status: 'error', message: safeError(error) };
  }
}

export async function approvePaymentAction(
  _state: PaymentReviewActionState,
  formData: FormData,
): Promise<PaymentReviewActionState> {
  void _state;
  await assertTrustedMutationOrigin();
  const params = paymentId(formData);
  const body = approvePaymentSchema.safeParse({
    expectedVersion: Number(formData.get('expectedVersion')),
    reason: formData.get('reason'),
    internalNote: nullable(formData.get('internalNote')),
  });
  if (!params.success || !body.success)
    return { status: 'error', message: 'Enter an approval reason between 10 and 500 characters.' };
  const { session } = await requireAdminPermission('payments.review');
  try {
    await createAuthenticatedApiClient(session).approvePaymentSubmission(
      params.data.submissionId,
      body.data,
    );
    return finish(params.data.submissionId);
  } catch (error) {
    return { status: 'error', message: safeError(error) };
  }
}

export async function rejectPaymentAction(
  _state: PaymentReviewActionState,
  formData: FormData,
): Promise<PaymentReviewActionState> {
  void _state;
  await assertTrustedMutationOrigin();
  const params = paymentId(formData);
  const body = rejectPaymentSchema.safeParse({
    expectedVersion: Number(formData.get('expectedVersion')),
    reason: formData.get('reason'),
    rejectionReasonCode: formData.get('rejectionReasonCode'),
    publicMessage: formData.get('publicMessage'),
    internalNote: nullable(formData.get('internalNote')),
  });
  if (!params.success || !body.success)
    return {
      status: 'error',
      message: 'Add a rejection code, customer message, and action reason.',
    };
  const { session } = await requireAdminPermission('payments.review');
  try {
    await createAuthenticatedApiClient(session).rejectPaymentSubmission(
      params.data.submissionId,
      body.data,
    );
    return finish(params.data.submissionId);
  } catch (error) {
    return { status: 'error', message: safeError(error) };
  }
}

export async function recordPaymentRefundAction(
  _state: PaymentReviewActionState,
  formData: FormData,
): Promise<PaymentReviewActionState> {
  void _state;
  await assertTrustedMutationOrigin();
  const params = paymentId(formData);
  const rawRefundedAt = formData.get('refundedAt');
  const rawTimestamp = typeof rawRefundedAt === 'string' ? rawRefundedAt : '';
  const refundedAt = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(rawTimestamp)
    ? new Date(`${rawTimestamp}:00+08:00`).toISOString()
    : rawTimestamp;
  const body = recordPaymentRefundSchema.safeParse({
    expectedVersion: Number(formData.get('expectedVersion')),
    reason: formData.get('reason'),
    refundedAmountMinor: Math.round(Number(formData.get('refundedAmount')) * 100),
    externalReference: nullable(formData.get('externalReference')),
    refundedAt,
    subscriptionImpact: formData.get('subscriptionImpact'),
    internalNote: nullable(formData.get('internalNote')),
  });
  if (!params.success || !body.success)
    return {
      status: 'error',
      message: 'Review the external refund amount, time, impact, and reason.',
    };
  const { session, admin } = await requireAnyAdminPermission(['subscriptions.manage']);
  if (!admin.permissions.includes('payments.review'))
    return {
      status: 'error',
      message: 'Payments review and subscription management permissions are required.',
    };
  try {
    await createAuthenticatedApiClient(session).recordPaymentRefund(
      params.data.submissionId,
      body.data,
    );
    return finish(params.data.submissionId);
  } catch (error) {
    return { status: 'error', message: safeError(error) };
  }
}

export async function reversePaymentApprovalAction(
  _state: PaymentReviewActionState,
  formData: FormData,
): Promise<PaymentReviewActionState> {
  void _state;
  await assertTrustedMutationOrigin();
  const params = paymentId(formData);
  const base = adminVersionedActionSchema.safeParse({
    expectedVersion: Number(formData.get('expectedVersion')),
    reason: formData.get('reason'),
  });
  const body = base.success
    ? reversePaymentSchema.safeParse({
        ...base.data,
        subscriptionImpact: 'end_access_now',
        internalNote: nullable(formData.get('internalNote')),
      })
    : base;
  if (!params.success || !body.success)
    return { status: 'error', message: 'Enter a reversal reason and confirm the access impact.' };
  const { session, admin } = await requireAnyAdminPermission(['subscriptions.manage']);
  if (!admin.permissions.includes('payments.review'))
    return {
      status: 'error',
      message: 'Payments review and subscription management permissions are required.',
    };
  try {
    await createAuthenticatedApiClient(session).reversePaymentApproval(
      params.data.submissionId,
      body.data,
    );
    return finish(params.data.submissionId);
  } catch (error) {
    return { status: 'error', message: safeError(error) };
  }
}
