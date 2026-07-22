import { createApiClient, type Plan } from '@hanaply/contracts';
import { Alert, Badge, Card, LinkButton } from '@hanaply/ui';
import { Check, RadioTower } from 'lucide-react';
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Pricing',
  description: 'Configurable Plus and Pro plans for Hanaply.',
};

async function loadPlans(): Promise<readonly Plan[] | null> {
  try {
    const client = createApiClient({
      baseUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3101',
    });
    return (await client.plans()).data;
  } catch {
    return null;
  }
}

function formatPrice(plan: Plan): string {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: plan.currency,
    maximumFractionDigits: 0,
  }).format(plan.priceMinor / 100);
}

function entitlementSummary(plan: Plan): readonly string[] {
  const values = plan.entitlements;
  return [
    `${String(values.careerProfileLimit)} career search profile${values.careerProfileLimit === 1 ? '' : 's'}`,
    `${String(values.automaticPackMonthlyLimit)} automatic Application Packs monthly`,
    `Discovery priority: ${String(values.sourceDiscoveryPriority)}`,
    values.browserNotifications === true
      ? 'Browser notifications included'
      : 'Email alerts and daily digest',
  ];
}

export default async function PricingPage() {
  const plans = await loadPlans();
  return (
    <section className="page-section">
      <div className="page-container">
        <header className="centered-heading">
          <Badge tone="brand">Configurable plans, server-enforced limits</Badge>
          <h1>Choose the radar that fits your search.</h1>
          <p>Prices are stored in the plan catalog and evaluated by secure backend services.</p>
        </header>
        {!plans ? (
          <Alert title="Plan catalog is temporarily unavailable" tone="warning">
            Start the local API and Supabase stack to view live plan configuration. No fallback
            price is shown because pricing is database-authoritative.
          </Alert>
        ) : (
          <div className="pricing-grid">
            {plans.map((plan) => (
              <Card className="pricing-card" key={plan.code}>
                <div className="pricing-card-top">
                  <div>
                    <Badge tone={plan.tierCode === 'pro' ? 'success' : 'brand'}>
                      {plan.tierCode === 'pro' ? 'Priority radar' : 'Core radar'}
                    </Badge>
                    <h2>{plan.name}</h2>
                  </div>
                  <RadioTower aria-hidden="true" size={24} />
                </div>
                <div className="plan-price">
                  <strong>{formatPrice(plan)}</strong>
                  <span>/{plan.billingPeriod === 'monthly' ? 'month' : 'year'}</span>
                </div>
                <ul className="plan-features">
                  {entitlementSummary(plan).map((feature) => (
                    <li key={feature}>
                      <Check aria-hidden="true" size={18} /> {feature}
                    </li>
                  ))}
                </ul>
                <LinkButton
                  block
                  href="/register"
                  variant={plan.tierCode === 'pro' ? 'primary' : 'secondary'}
                >
                  Choose {plan.name}
                </LinkButton>
              </Card>
            ))}
          </div>
        )}
        <p className="pricing-note">
          Payment submission and activation review are planned for Phase 2. No payment is collected
          in this foundation release.
        </p>
      </div>
    </section>
  );
}
