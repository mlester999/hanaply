'use server';

import {
  adminVersionedActionSchema,
  HanaplyApiError,
  paymentMethodMutationSchema,
  paymentMethodParamsSchema,
  updatePaymentMethodSchema,
} from '@hanaply/contracts';
import { revalidatePath } from 'next/cache';

import { assertTrustedMutationOrigin } from '@/lib/request-integrity';
import { createAuthenticatedApiClient, requireAdminPermission } from '@/lib/session';

export interface PaymentMethodActionState {
  status: 'idle' | 'success' | 'error';
  message: string | null;
  paymentMethodId: string | null;
}

function optionalText(value: FormDataEntryValue | null): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function optionalMoneyMinor(value: FormDataEntryValue | null): number | null {
  const parsed = typeof value === 'string' && value.trim() ? Number(value) * 100 : null;
  return parsed !== null && Number.isSafeInteger(parsed) ? parsed : null;
}

function optionalTimestamp(value: FormDataEntryValue | null): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function methodInput(formData: FormData) {
  return paymentMethodMutationSchema.safeParse({
    displayName: formData.get('displayName'),
    methodType: formData.get('methodType'),
    enabled: formData.get('enabled') === 'on',
    displayOrder: Number(formData.get('displayOrder')),
    currency: 'PHP',
    accountHolderName: optionalText(formData.get('accountHolderName')),
    accountIdentifier: optionalText(formData.get('accountIdentifier')),
    bankName: optionalText(formData.get('bankName')),
    branchDetails: optionalText(formData.get('branchDetails')),
    publicInstructions: formData.get('publicInstructions'),
    publicNotes: optionalText(formData.get('publicNotes')),
    privateNotes: optionalText(formData.get('privateNotes')),
    effectiveStartAt: optionalTimestamp(formData.get('effectiveStartAt')),
    effectiveEndAt: optionalTimestamp(formData.get('effectiveEndAt')),
    minimumAmountMinor: optionalMoneyMinor(formData.get('minimumAmountPesos')),
    maximumAmountMinor: optionalMoneyMinor(formData.get('maximumAmountPesos')),
  });
}

function safeError(error: unknown): string {
  if (error instanceof HanaplyApiError) {
    if (error.envelope.error.code === 'CONFLICT') {
      return 'This payment method changed. Refresh before saving another update.';
    }
    if (error.envelope.error.code === 'RATE_LIMITED') {
      return 'Too many payment method changes were attempted. Wait before trying again.';
    }
    if (error.envelope.error.code === 'VALIDATION_ERROR') {
      return 'Review the method fields, amount limits, effective dates, and image.';
    }
    if (error.envelope.error.code === 'FORBIDDEN') return 'This change is not permitted.';
  }
  return 'The payment method change could not be completed safely.';
}

function finish(paymentMethodId: string, message: string): PaymentMethodActionState {
  revalidatePath('/admin/payment-methods');
  revalidatePath(`/admin/payment-methods/${paymentMethodId}`);
  revalidatePath('/dashboard/activation');
  revalidatePath('/admin/audit');
  return { status: 'success', message, paymentMethodId };
}

export async function createPaymentMethodAction(
  _previousState: PaymentMethodActionState,
  formData: FormData,
): Promise<PaymentMethodActionState> {
  void _previousState;
  await assertTrustedMutationOrigin();
  const parsed = methodInput(formData);
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Review every required payment method field.',
      paymentMethodId: null,
    };
  }
  const { session } = await requireAdminPermission('payment_methods.manage');
  try {
    const result = await createAuthenticatedApiClient(session).createAdminPaymentMethod(
      parsed.data,
    );
    return finish(result.data.id, 'The payment method was created and audited.');
  } catch (error) {
    return { status: 'error', message: safeError(error), paymentMethodId: null };
  }
}

export async function updatePaymentMethodAction(
  _previousState: PaymentMethodActionState,
  formData: FormData,
): Promise<PaymentMethodActionState> {
  void _previousState;
  await assertTrustedMutationOrigin();
  const params = paymentMethodParamsSchema.safeParse({
    paymentMethodId: formData.get('paymentMethodId'),
  });
  const method = methodInput(formData);
  const body = method.success
    ? updatePaymentMethodSchema.safeParse({
        ...method.data,
        expectedVersion: Number(formData.get('expectedVersion')),
      })
    : method;
  if (!params.success || !body.success) {
    return {
      status: 'error',
      message: 'Review every required payment method field.',
      paymentMethodId: null,
    };
  }
  const { session } = await requireAdminPermission('payment_methods.manage');
  try {
    await createAuthenticatedApiClient(session).updateAdminPaymentMethod(
      params.data.paymentMethodId,
      body.data,
    );
    return finish(params.data.paymentMethodId, 'The payment method was updated and versioned.');
  } catch (error) {
    return {
      status: 'error',
      message: safeError(error),
      paymentMethodId: params.data.paymentMethodId,
    };
  }
}

async function methodStateAction(
  formData: FormData,
  action: 'enable' | 'disable' | 'archive',
): Promise<PaymentMethodActionState> {
  await assertTrustedMutationOrigin();
  const params = paymentMethodParamsSchema.safeParse({
    paymentMethodId: formData.get('paymentMethodId'),
  });
  const body = adminVersionedActionSchema.safeParse({
    expectedVersion: Number(formData.get('expectedVersion')),
    reason: formData.get('reason'),
  });
  if (!params.success || !body.success) {
    return {
      status: 'error',
      message: 'Enter a clear reason between 10 and 500 characters.',
      paymentMethodId: null,
    };
  }
  const { session } = await requireAdminPermission('payment_methods.manage');
  const client = createAuthenticatedApiClient(session);
  try {
    if (action === 'enable')
      await client.enableAdminPaymentMethod(params.data.paymentMethodId, body.data);
    if (action === 'disable')
      await client.disableAdminPaymentMethod(params.data.paymentMethodId, body.data);
    if (action === 'archive')
      await client.archiveAdminPaymentMethod(params.data.paymentMethodId, body.data);
    return finish(
      params.data.paymentMethodId,
      `The payment method was ${action === 'enable' ? 'enabled' : action === 'disable' ? 'disabled' : 'archived'} and audited.`,
    );
  } catch (error) {
    return {
      status: 'error',
      message: safeError(error),
      paymentMethodId: params.data.paymentMethodId,
    };
  }
}

export async function enablePaymentMethodAction(
  _previousState: PaymentMethodActionState,
  formData: FormData,
) {
  void _previousState;
  return methodStateAction(formData, 'enable');
}

export async function disablePaymentMethodAction(
  _previousState: PaymentMethodActionState,
  formData: FormData,
) {
  void _previousState;
  return methodStateAction(formData, 'disable');
}

export async function archivePaymentMethodAction(
  _previousState: PaymentMethodActionState,
  formData: FormData,
) {
  void _previousState;
  return methodStateAction(formData, 'archive');
}

export async function uploadPaymentMethodQrAction(
  _previousState: PaymentMethodActionState,
  formData: FormData,
): Promise<PaymentMethodActionState> {
  void _previousState;
  await assertTrustedMutationOrigin();
  const params = paymentMethodParamsSchema.safeParse({
    paymentMethodId: formData.get('paymentMethodId'),
  });
  const proof = formData.get('qrCode');
  if (!params.success || !(proof instanceof File) || proof.size === 0) {
    return {
      status: 'error',
      message: 'Choose a JPEG, PNG, or WebP QR image.',
      paymentMethodId: null,
    };
  }
  const { session } = await requireAdminPermission('payment_methods.manage');
  try {
    await createAuthenticatedApiClient(session).uploadAdminPaymentMethodQr(
      params.data.paymentMethodId,
      proof,
      proof.name,
    );
    return finish(params.data.paymentMethodId, 'The private QR image was validated and replaced.');
  } catch (error) {
    return {
      status: 'error',
      message: safeError(error),
      paymentMethodId: params.data.paymentMethodId,
    };
  }
}
