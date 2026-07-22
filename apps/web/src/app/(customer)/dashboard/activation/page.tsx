import type { Plan } from '@hanaply/contracts';
import { Alert, Badge, Card, PageHeader } from '@hanaply/ui';
import { CalendarDays, CreditCard } from 'lucide-react';
import type { Metadata } from 'next';

import { createAuthenticatedApiClient, requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Activation Center' };

function money(minor: number): string {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(minor / 100);
}

function tierPlans(plans: readonly Plan[], tier: Plan['tierCode']) {
  return {
    monthly: plans.find((plan) => plan.tierCode === tier && plan.billingPeriod === 'monthly'),
    annual: plans.find((plan) => plan.tierCode === tier && plan.billingPeriod === 'annual'),
  };
}

export default async function ActivationPage() {
  const { session, me } = await requireUser();
  let plans: readonly Plan[] = [];
  let plansUnavailable = false;
  try {
    plans = (await createAuthenticatedApiClient(session).plans()).data;
  } catch {
    plansUnavailable = true;
  }
  return (
    <div className="workspace-page">
      <PageHeader
        description="Review the configured Plus and Pro plans. Manual activation arrives in Phase 2."
        eyebrow="Customer dashboard"
        title="Activation Center"
      />
      <Alert title="Do not send payment yet" tone="warning">
        Hanaply does not accept payment proofs, reference numbers, or activation requests in Phase
        1. A safe reviewed process is planned for Phase 2.
      </Alert>
      <Card className="activation-status-card">
        <CreditCard aria-hidden="true" size={22} />
        <div>
          <span className="h-eyebrow">Current access</span>
          <h2>
            {me.subscription.status === 'active'
              ? 'Subscription active'
              : 'No active paid subscription'}
          </h2>
          <p>
            {me.subscription.planCode
              ? `Current plan: ${me.subscription.planCode}`
              : 'No plan has been granted or activated for this account.'}
          </p>
        </div>
      </Card>
      {plansUnavailable ? (
        <Alert title="Plan catalog unavailable" tone="danger">
          Pricing could not be loaded from the API. No fallback price is being invented.
        </Alert>
      ) : (
        <div className="activation-plan-grid">
          {(['plus', 'pro'] as const).map((tier) => {
            const configured = tierPlans(plans, tier);
            if (!configured.monthly || !configured.annual) return null;
            const savings = configured.monthly.priceMinor * 12 - configured.annual.priceMinor;
            return (
              <Card className="activation-plan-card" key={tier}>
                <div className="activation-plan-heading">
                  <div>
                    <Badge tone={tier === 'pro' ? 'brand' : 'neutral'}>
                      {tier === 'pro' ? 'Pro' : 'Plus'}
                    </Badge>
                    <h2>{tier === 'pro' ? 'Pro' : 'Plus'}</h2>
                  </div>
                  <CalendarDays aria-hidden="true" size={22} />
                </div>
                <dl>
                  <div>
                    <dt>Monthly</dt>
                    <dd>{money(configured.monthly.priceMinor)}</dd>
                  </div>
                  <div>
                    <dt>Annual</dt>
                    <dd>{money(configured.annual.priceMinor)}</dd>
                  </div>
                  <div>
                    <dt>Annual savings</dt>
                    <dd>{money(savings)}</dd>
                  </div>
                </dl>
                <p>Configured in PostgreSQL. Activation controls are intentionally unavailable.</p>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
