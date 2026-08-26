import { PageHeader } from '@hanaply/ui';
import type { Metadata } from 'next';

import { PaymentMethodForm } from '@/components/payment-method-form';
import { requireAdminPermission } from '@/lib/session';

export const metadata: Metadata = { title: 'New Payment Method' };

export default async function NewPaymentMethodPage() {
  await requireAdminPermission('payment_methods.manage');
  return (
    <div className="workspace-page">
      <PageHeader
        description="Create a versioned manual payment method. Use fictional details until the owner completes the production configuration review."
        eyebrow="Payment operations"
        title="New Payment Method"
      />
      <PaymentMethodForm />
    </div>
  );
}
