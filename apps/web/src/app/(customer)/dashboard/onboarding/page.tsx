import {
  HanaplyApiError,
  type CareerProfileDetail,
  type CareerProfileSummary,
} from '@hanaply/contracts';
import { Alert, LinkButton, PageHeader } from '@hanaply/ui';
import type { Metadata } from 'next';

import { OnboardingWizard } from '@/components/career/onboarding-wizard';
import { readActiveCareerProfileCookie } from '@/lib/career-cookie';
import { createAuthenticatedApiClient, requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Career Profile Onboarding' };

export default async function OnboardingPage() {
  const { session, me } = await requireUser();
  const client = createAuthenticatedApiClient(session);

  let profiles: readonly CareerProfileSummary[] = [];
  let profile: CareerProfileDetail | null = null;
  let unavailable: string | null = null;
  try {
    profiles = (await client.careerProfiles()).data.items;
    const cookieProfileId = await readActiveCareerProfileCookie();
    const target =
      profiles.find((item) => item.id === cookieProfileId) ??
      profiles.find((item) => item.isPrimary) ??
      profiles[0];
    if (target) profile = (await client.careerProfile(target.id)).data;
  } catch (error) {
    unavailable =
      error instanceof HanaplyApiError
        ? error.envelope.error.message
        : 'Hanaply could not load your career profile.';
  }

  return (
    <div className="workspace-page career-page">
      <PageHeader
        actions={
          <LinkButton href="/dashboard/career" variant="secondary">
            Career profile
          </LinkButton>
        }
        description="Seven short steps. Each one saves before it advances, and every step can be skipped — nothing optional blocks you."
        eyebrow="Career intelligence"
        title="Career profile onboarding"
      />
      {profile && profile.completeness.missing.length > 0 ? (
        <Alert title="Onboarding does not have to be perfect" tone="info">
          {profile.completeness.missing.length} completeness{' '}
          {profile.completeness.missing.length === 1 ? 'item is' : 'items are'} still open. Optional
          answers never block you, and the review step explains what each gap costs in match
          quality.
        </Alert>
      ) : null}
      {unavailable ? (
        <Alert title="Onboarding is unavailable" tone="danger">
          {unavailable}
        </Alert>
      ) : (
        <OnboardingWizard
          onboardingStatus={me.profile.onboardingStatus}
          profile={profile}
          profileId={profile?.id ?? null}
          profileName={profile?.name ?? 'Primary search'}
        />
      )}
    </div>
  );
}
