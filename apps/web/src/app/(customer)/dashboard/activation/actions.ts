'use server';

import {
  createPaymentDraftSchema,
  HanaplyApiError,
  paymentSubmissionParamsSchema,
  updatePaymentDraftSchema,
  versionedPaymentActionSchema,
  type HanaplyApiClient,
  type PaymentSubmission,
} from '@hanaply/contracts';
import { revalidatePath } from 'next/cache';

import { assertTrustedMutationOrigin } from '@/lib/request-integrity';
import { createAuthenticatedApiClient, requireUser } from '@/lib/session';

export interface PaymentActionState {
  status: 'idle' | 'success' | 'error';
  message: string | null;
}

function optionalText(value: FormDataEntryValue | null): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function paymentTimestamp(value: FormDataEntryValue | null): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(value)) return null;
  const timestamp = new Date(`${value}:00+08:00`);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString();
}

function uploadFrom(formData: FormData): File | null {
  const entry = formData.get('proof');
  return entry instanceof File && entry.size > 0 ? entry : null;
}

function safePaymentError(error: unknown): string {
  if (error instanceof HanaplyApiError) {
    if (error.envelope.error.code === 'CONFLICT') {
      return 'This payment changed in another session. Refresh the page before trying again.';
    }
    if (error.envelope.error.code === 'RATE_LIMITED') {
      return 'Too many payment actions were attempted. Wait a moment before trying again.';
    }
    if (error.envelope.error.code === 'VALIDATION_ERROR') {
      return 'Review the payment details, proof image, and current payment status.';
    }
    if (error.envelope.error.code === 'NOT_FOUND') return 'The payment draft was not found.';
    if (error.envelope.error.code === 'FORBIDDEN') {
      return 'This account cannot perform that payment action.';
    }
  }
  return 'The payment action could not be completed safely. Try again.';
}

async function saveDraft(client: HanaplyApiClient, formData: FormData): Promise<PaymentSubmission> {
  const submission = paymentSubmissionParamsSchema.safeParse({
    submissionId: formData.get('submissionId'),
  });
  const expectedVersion = Number(formData.get('expectedVersion'));
  const status = optionalText(formData.get('status'));
  const shared = {
    referenceNumber: optionalText(formData.get('referenceNumber')),
    paidAt: paymentTimestamp(formData.get('paidAt')),
    userNote: optionalText(formData.get('userNote')),
  };
  let payment: PaymentSubmission;
  if (submission.success) {
    const parsed = updatePaymentDraftSchema.safeParse({
      expectedVersion,
      ...(status === 'draft'
        ? {
            planCode: formData.get('planCode'),
            paymentMethodId: formData.get('paymentMethodId'),
          }
        : {}),
      ...shared,
      ...(status === 'needs_information'
        ? { informationResponse: optionalText(formData.get('informationResponse')) }
        : {}),
    });
    if (!parsed.success) throw new Error('invalid_payment_form');
    payment = (await client.updatePaymentSubmission(submission.data.submissionId, parsed.data))
      .data;
  } else {
    const parsed = createPaymentDraftSchema.safeParse({
      planCode: formData.get('planCode'),
      paymentMethodId: formData.get('paymentMethodId'),
      ...shared,
    });
    if (!parsed.success) throw new Error('invalid_payment_form');
    payment = (await client.createPaymentSubmission(parsed.data)).data;
  }

  const proof = uploadFrom(formData);
  if (proof) {
    await client.uploadPaymentProof(payment.id, proof, proof.name);
    payment = (await client.myPaymentSubmission(payment.id)).data;
  }
  return payment;
}

function finish(message: string): PaymentActionState {
  revalidatePath('/dashboard');
  revalidatePath('/dashboard/activation');
  return { status: 'success', message };
}

export async function savePaymentDraftAction(
  _previousState: PaymentActionState,
  formData: FormData,
): Promise<PaymentActionState> {
  void _previousState;
  await assertTrustedMutationOrigin();
  const { session } = await requireUser();
  try {
    await saveDraft(createAuthenticatedApiClient(session), formData);
    return finish('Your payment draft was saved. No paid access has been granted.');
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof Error && error.message === 'invalid_payment_form'
          ? 'Choose a plan and payment method, then review the payment fields.'
          : safePaymentError(error),
    };
  }
}

export async function submitPaymentAction(
  _previousState: PaymentActionState,
  formData: FormData,
): Promise<PaymentActionState> {
  void _previousState;
  await assertTrustedMutationOrigin();
  if (formData.get('declarationAccepted') !== 'on') {
    return { status: 'error', message: 'Accept the payment declaration before submitting.' };
  }
  const { session } = await requireUser();
  const client = createAuthenticatedApiClient(session);
  try {
    const payment = await saveDraft(client, formData);
    if (payment.status === 'needs_information') {
      const response = optionalText(formData.get('informationResponse'));
      if (!response) {
        return { status: 'error', message: 'Add a response to the reviewer before resubmitting.' };
      }
      await client.resubmitPaymentSubmission(payment.id, {
        expectedVersion: payment.version,
        response,
        declarationAccepted: true,
      });
      return finish('Your response was submitted for another review. Paid access is unchanged.');
    }
    await client.submitPaymentSubmission(payment.id, {
      expectedVersion: payment.version,
      declarationAccepted: true,
    });
    return finish('Your payment was submitted for review. Approval is not guaranteed.');
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof Error && error.message === 'invalid_payment_form'
          ? 'Complete the required payment details before submitting.'
          : safePaymentError(error),
    };
  }
}

export async function cancelPaymentAction(
  _previousState: PaymentActionState,
  formData: FormData,
): Promise<PaymentActionState> {
  void _previousState;
  await assertTrustedMutationOrigin();
  const params = paymentSubmissionParamsSchema.safeParse({
    submissionId: formData.get('submissionId'),
  });
  const body = versionedPaymentActionSchema.safeParse({
    expectedVersion: Number(formData.get('expectedVersion')),
  });
  if (!params.success || !body.success) {
    return { status: 'error', message: 'The payment could not be identified safely.' };
  }
  const { session } = await requireUser();
  try {
    await createAuthenticatedApiClient(session).cancelPaymentSubmission(
      params.data.submissionId,
      body.data,
    );
    return finish('The payment was cancelled. Any draft proof was scheduled for cleanup.');
  } catch (error) {
    return { status: 'error', message: safePaymentError(error) };
  }
}
