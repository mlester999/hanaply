import { Alert, EmptyState, LinkButton, PageHeader } from '@hanaply/ui';
import { CreditCard } from 'lucide-react';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Activation Center' };

export default function ActivationPage() {
  return (
    <div className="workspace-page">
      <PageHeader
        description="Plan activation and manual payment review are designed for Phase 2."
        eyebrow="Customer dashboard"
        title="Activation Center"
      />
      <Alert title="No payment is collected in Phase 0" tone="info">
        Payment methods, QR codes, proof uploads, and review statuses are intentionally unavailable.
      </Alert>
      <EmptyState
        action={
          <LinkButton href="/pricing" variant="secondary">
            Review configured plans
          </LinkButton>
        }
        description="Your plan choices can be reviewed now, but submitting or approving a payment is not yet possible."
        eyebrow="Activation not submitted"
        icon={<CreditCard aria-hidden="true" size={24} />}
        title="Activation will be transparent and reviewable."
      />
    </div>
  );
}
