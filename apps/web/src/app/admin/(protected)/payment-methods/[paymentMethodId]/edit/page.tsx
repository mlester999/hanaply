import { HanaplyApiError, type AdminPaymentMethod } from '@hanaply/contracts';
import { PageHeader } from '@hanaply/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { PaymentMethodForm } from '@/components/payment-method-form';
import { createAuthenticatedApiClient, requireAdminPermission } from '@/lib/session';

export const metadata: Metadata = { title: 'Edit Payment Method' };

export default async function EditPaymentMethodPage({
  params,
}: {
  params: Promise<{ paymentMethodId: string }>;
}) {
  const { paymentMethodId } = await params;
  const { session } = await requireAdminPermission('payment_methods.manage');
  let method: AdminPaymentMethod;
  try {
    method = (await createAuthenticatedApiClient(session).adminPaymentMethod(paymentMethodId)).data;
  } catch (error) {
    if (error instanceof HanaplyApiError && error.status === 404) notFound();
    throw error;
  }
  return (
    <div className="workspace-page">
      <PageHeader
        description="Saving creates a new immutable configuration version. Existing payment snapshots remain unchanged."
        eyebrow="Payment operations"
        title={`Edit ${method.displayName}`}
      />
      <PaymentMethodForm method={method} />
    </div>
  );
}
