import { Alert, Badge, Card, LinkButton, PageHeader } from '@hanaply/ui';
import { CheckCircle2, Circle, CreditCard, LockKeyhole, Radar, UserRound } from 'lucide-react';
import type { Metadata } from 'next';

import { requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Career Radar' };

export default async function DashboardPage() {
  const { me } = await requireUser();
  const preferredName = me.profile.firstName ?? me.profile.displayName ?? 'there';
  const subscriptionActive = me.subscription.status === 'active';
  return (
    <div className="workspace-page">
      <PageHeader
        actions={<Badge tone="success">Protected account</Badge>}
        description="Your account workspace is active. Paid access begins only after an authorized manual-payment review."
        eyebrow="Customer dashboard"
        title={`Welcome, ${preferredName}.`}
      />
      {!subscriptionActive ? (
        <Alert title="Activation required" tone="info">
          Your account has no active paid subscription. Open the Activation Center to review any
          currently available manual payment method and submit proof for review. Approval is not
          guaranteed.
        </Alert>
      ) : null}
      <div className="dashboard-overview-grid">
        <Card className="dashboard-welcome-card">
          <div className="dashboard-card-heading">
            <UserRound aria-hidden="true" size={22} />
            <div>
              <span className="h-eyebrow">Account checklist</span>
              <h2>Your secure foundation</h2>
            </div>
          </div>
          <ul className="account-checklist">
            <li>
              <CheckCircle2 aria-hidden="true" size={19} />
              <span>Email verified</span>
            </li>
            <li>
              <CheckCircle2 aria-hidden="true" size={19} />
              <span>Basic profile created</span>
            </li>
            <li>
              <CheckCircle2 aria-hidden="true" size={19} />
              <span>Protected session active</span>
            </li>
            <li className="account-checklist--pending">
              <Circle aria-hidden="true" size={19} />
              <span>
                {subscriptionActive ? 'Subscription active' : 'Subscription activation pending'}
              </span>
            </li>
            <li className="account-checklist--future">
              <Circle aria-hidden="true" size={19} />
              <span>Career profile coming in a future phase</span>
            </li>
          </ul>
        </Card>
        <Card className="dashboard-access-card">
          <div className="dashboard-card-heading">
            <CreditCard aria-hidden="true" size={22} />
            <div>
              <span className="h-eyebrow">Product access</span>
              <h2>{subscriptionActive ? 'Active subscription' : 'Registered, not activated'}</h2>
            </div>
          </div>
          <dl className="dashboard-facts">
            <div>
              <dt>Account</dt>
              <dd>{me.profile.accountStatus}</dd>
            </div>
            <div>
              <dt>Subscription</dt>
              <dd>{me.subscription.status}</dd>
            </div>
            <div>
              <dt>Plan</dt>
              <dd>{me.subscription.planCode ?? 'None'}</dd>
            </div>
          </dl>
          {!subscriptionActive ? (
            <LinkButton href="/dashboard/activation">Review Activation Center</LinkButton>
          ) : null}
        </Card>
      </div>
      <section className="dashboard-shortcuts" aria-labelledby="account-shortcuts-title">
        <div className="settings-section-heading">
          <span className="h-eyebrow">Account shortcuts</span>
          <h2 id="account-shortcuts-title">Keep your account ready.</h2>
        </div>
        <div className="dashboard-shortcut-grid">
          <LinkButton href="/dashboard/settings/profile" variant="secondary">
            <UserRound aria-hidden="true" size={18} /> Update Profile
          </LinkButton>
          <LinkButton href="/dashboard/settings/security" variant="secondary">
            <LockKeyhole aria-hidden="true" size={18} /> Review Security
          </LinkButton>
        </div>
      </section>
      <Card className="future-capabilities-card">
        <Radar aria-hidden="true" size={24} />
        <div>
          <span className="h-eyebrow">Coming in future phases</span>
          <h2>Career intelligence is not active yet.</h2>
          <p>
            Career profiles, job discovery, match analysis, and Application Packs remain deferred.
            No jobs, matches, documents, or activity metrics are invented here.
          </p>
        </div>
      </Card>
    </div>
  );
}
