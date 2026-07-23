import type { Metadata } from 'next';
import Link from 'next/link';

import { plans } from '@/content/landing';
import { RegistrationForm } from '@/components/registration-form';

export const metadata: Metadata = { title: 'Register' };

const planByKey = {
  plus: plans[0],
  pro: plans[1],
} as const;

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; billing?: string }>;
}) {
  const { plan, billing } = await searchParams;
  const selectedPlan = plan === 'plus' || plan === 'pro' ? planByKey[plan] : null;
  const billingPeriod = billing === 'annual' ? 'annual' : 'monthly';
  const selectedPlanCode = selectedPlan
    ? `${selectedPlan.name.toLowerCase()}_${billingPeriod}`
    : undefined;
  const selectedPrice = selectedPlan
    ? billingPeriod === 'annual'
      ? selectedPlan.annual
      : selectedPlan.monthly
    : null;

  return (
    <div className="auth-card auth-card--wide">
      {selectedPlan ? (
        <aside className="auth-plan-chip" aria-label={`${selectedPlan.name} plan selected`}>
          <div className="auth-plan-chip__main">
            <span className="auth-plan-chip__eyebrow">Selected plan</span>
            <strong>{selectedPlan.name}</strong>
          </div>
          <div className="auth-plan-chip__side">
            <span>
              ₱{selectedPrice?.toLocaleString()}
              <small>/{billingPeriod === 'annual' ? 'year' : 'month'}</small>
            </span>
            <Link href="/#pricing">Change</Link>
          </div>
        </aside>
      ) : (
        <p className="auth-card-kicker">Create your account</p>
      )}
      <h1>Create your Hanaply account.</h1>
      <p>
        {selectedPlan
          ? 'Your plan selection will be saved with your registration. Payment and activation are not available yet.'
          : 'Register and verify your email to enter your Hanaply account. Career Profile creation is coming in a later phase.'}
      </p>
      <RegistrationForm {...(selectedPlanCode ? { selectedPlanCode } : {})} />
    </div>
  );
}
