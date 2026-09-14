import { type CareerProfileDetail, type CareerProfileDirectory } from '@hanaply/contracts';
import { Alert, Badge, Card, LinkButton, PageHeader } from '@hanaply/ui';
import {
  CheckCircle2,
  Circle,
  Compass,
  CreditCard,
  FileText,
  ListChecks,
  LockKeyhole,
  UserRound,
} from 'lucide-react';
import type { Metadata } from 'next';

import { CareerCompletenessMeter } from '@/components/career/career-completeness';
import { humanise } from '@/lib/career';
import { createAuthenticatedApiClient, requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Career Radar' };

export default async function DashboardPage() {
  const { session, me } = await requireUser();
  const preferredName = me.profile.firstName ?? me.profile.displayName ?? 'there';
  const subscriptionActive = me.subscription.status === 'active';
  const emailVerified = me.profile.emailVerifiedAt !== null;
  const profileDetailsComplete = Boolean(me.profile.firstName && me.profile.lastName);
  const onboardingComplete = me.profile.onboardingStatus === 'complete';

  const client = createAuthenticatedApiClient(session);
  let directory: CareerProfileDirectory | null = null;
  let careerProfile: CareerProfileDetail | null = null;
  let careerUnavailable = false;
  try {
    directory = (await client.careerProfiles()).data;
    const target = directory.items.find((item) => item.isPrimary) ?? directory.items[0];
    if (target) careerProfile = (await client.careerProfile(target.id)).data;
  } catch {
    careerUnavailable = true;
  }

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
            <li className={emailVerified ? undefined : 'account-checklist--pending'}>
              {emailVerified ? (
                <CheckCircle2 aria-hidden="true" size={19} />
              ) : (
                <Circle aria-hidden="true" size={19} />
              )}
              <span>{emailVerified ? 'Email verified' : 'Email verification pending'}</span>
            </li>
            <li className={profileDetailsComplete ? undefined : 'account-checklist--pending'}>
              {profileDetailsComplete ? (
                <CheckCircle2 aria-hidden="true" size={19} />
              ) : (
                <Circle aria-hidden="true" size={19} />
              )}
              <span>
                {profileDetailsComplete
                  ? 'Profile details recorded'
                  : 'Profile details incomplete (first and last name)'}
              </span>
            </li>
            <li>
              <CheckCircle2 aria-hidden="true" size={19} />
              <span>Protected session active</span>
            </li>
            <li className={subscriptionActive ? undefined : 'account-checklist--pending'}>
              {subscriptionActive ? (
                <CheckCircle2 aria-hidden="true" size={19} />
              ) : (
                <Circle aria-hidden="true" size={19} />
              )}
              <span>
                {subscriptionActive ? 'Subscription active' : 'Subscription activation pending'}
              </span>
            </li>
            <li className={onboardingComplete ? undefined : 'account-checklist--pending'}>
              {onboardingComplete ? (
                <CheckCircle2 aria-hidden="true" size={19} />
              ) : (
                <Circle aria-hidden="true" size={19} />
              )}
              <span>
                {onboardingComplete
                  ? 'Career profile onboarding complete'
                  : `Career profile onboarding ${humanise(me.profile.onboardingStatus).toLowerCase()}`}
              </span>
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

      <Card className="dashboard-career-card">
        <div className="dashboard-card-heading">
          <Compass aria-hidden="true" size={22} />
          <div>
            <span className="h-eyebrow">Career intelligence</span>
            <h2>{careerProfile ? careerProfile.name : 'No career profile yet'}</h2>
          </div>
        </div>
        {careerUnavailable ? (
          <Alert title="Career profile unavailable" tone="warning">
            Hanaply could not read your career profile just now. No completeness percentage or fact
            count is shown rather than a number that may be stale.
          </Alert>
        ) : careerProfile ? (
          <>
            <CareerCompletenessMeter
              label={`${careerProfile.name} completeness`}
              percent={careerProfile.completeness.percent}
            />
            <dl className="dashboard-facts">
              <div>
                <dt>Confirmed facts</dt>
                <dd>{careerProfile.factCounts.confirmed}</dd>
              </div>
              <div>
                <dt>Claims awaiting review</dt>
                <dd>{careerProfile.factCounts.candidate}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{humanise(careerProfile.status)}</dd>
              </div>
              <div>
                <dt>Missing completeness items</dt>
                <dd>{careerProfile.completeness.missing.length}</dd>
              </div>
            </dl>
            <div className="career-card-actions">
              <LinkButton href="/dashboard/career">Open career profile</LinkButton>
              <LinkButton href={`/dashboard/career/${careerProfile.id}/facts`} variant="secondary">
                <ListChecks aria-hidden="true" size={18} /> Truth ledger
              </LinkButton>
              {!onboardingComplete ? (
                <LinkButton href="/dashboard/onboarding" variant="secondary">
                  Continue onboarding
                </LinkButton>
              ) : null}
            </div>
          </>
        ) : (
          <>
            <p className="career-hint">
              No career profile exists yet. Onboarding records your current situation, target roles,
              skills, experience, education, links, and summary, then shows exactly what is still
              missing. Nothing is invented on your behalf.
            </p>
            <div className="career-card-actions">
              <LinkButton href="/dashboard/onboarding">Start onboarding</LinkButton>
              <LinkButton href="/dashboard/career" variant="secondary">
                Career profile hub
              </LinkButton>
            </div>
          </>
        )}
        {directory && directory.items.length > 1 ? (
          <p className="career-hint">
            {directory.items.length} of {directory.limits.careerProfileLimit} allowed career
            profiles are in use.
          </p>
        ) : null}
      </Card>

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
          <LinkButton href="/dashboard/career/documents" variant="secondary">
            <FileText aria-hidden="true" size={18} /> Documents
          </LinkButton>
        </div>
      </section>
    </div>
  );
}
