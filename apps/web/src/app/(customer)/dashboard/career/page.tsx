import { HanaplyApiError, type CareerProfileDirectory } from '@hanaply/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  LinkButton,
  PageHeader,
  Tooltip,
} from '@hanaply/ui';
import { Compass, FileText, FolderTree, ListChecks, Plus, Target } from 'lucide-react';
import type { Metadata } from 'next';

import { CareerCompletenessMeter } from '@/components/career/career-completeness';
import { NewCareerProfileDialog } from '@/components/career/new-career-profile-dialog';
import {
  optionLabel,
  profileStatusLabel,
  careerLevelOptions,
  workArrangementOptions,
} from '@/lib/career';
import { createAuthenticatedApiClient, requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Career Profile' };

export default async function CareerDirectoryPage() {
  const { session } = await requireUser();
  let directory: CareerProfileDirectory | null = null;
  let unavailable: string | null = null;
  try {
    directory = (await createAuthenticatedApiClient(session).careerProfiles()).data;
  } catch (error) {
    unavailable =
      error instanceof HanaplyApiError
        ? error.envelope.error.message
        : 'Hanaply could not load your career profiles.';
  }

  const profiles = directory?.items ?? [];
  const limit = directory?.limits.careerProfileLimit ?? 0;
  const subCareerLimit = directory?.limits.subCareerLimitPerProfile ?? 0;
  const limitReached = directory !== null && profiles.length >= limit;
  const remaining = Math.max(limit - profiles.length, 0);

  return (
    <div className="workspace-page career-page">
      <PageHeader
        actions={
          directory === null ? undefined : limitReached ? (
            <Tooltip
              label={`Your plan allows ${limit} active ${limit === 1 ? 'profile' : 'profiles'}. Archive or delete one to create another.`}
            >
              <span className="career-tooltip-target">
                <Button disabled leadingIcon={<Plus aria-hidden="true" size={18} />} type="button">
                  New profile
                </Button>
              </span>
            </Tooltip>
          ) : (
            <NewCareerProfileDialog remaining={remaining} />
          )
        }
        description="The Career Intelligence Profile is the single source of truth every match and generated document must cite."
        eyebrow="Career intelligence"
        title="Career profile"
      />

      {unavailable ? (
        <Alert title="Career profiles are unavailable" tone="danger">
          {unavailable}
        </Alert>
      ) : null}

      {directory === null ? null : profiles.length === 0 ? (
        <>
          {limit === 0 ? (
            <Alert title="Your current plan does not include a career profile" tone="warning">
              A career profile can be created once your plan allows one. Opening onboarding shows
              the exact message the service returns for this account.
            </Alert>
          ) : null}
          <EmptyState
            action={<LinkButton href="/dashboard/onboarding">Start onboarding</LinkButton>}
            description="No career profile exists yet. Onboarding records your current situation, target roles, skills, experience, education, links, and summary, then shows exactly what is still missing."
            eyebrow="Nothing recorded yet"
            icon={<Compass aria-hidden="true" size={24} />}
            title="Build the profile your applications can trust"
          />
        </>
      ) : (
        <>
          <div className="career-summary-grid">
            <Card className="career-summary-card">
              <Target aria-hidden="true" size={22} />
              <span>Profiles used</span>
              <strong>
                {profiles.length} of {limit}
              </strong>
              <small>Active, draft, and archived profiles all count toward the limit.</small>
            </Card>
            <Card className="career-summary-card">
              <FolderTree aria-hidden="true" size={22} />
              <span>Sub-careers per profile</span>
              <strong>{subCareerLimit}</strong>
              <small>Each sub-career searches its own direction inside one profile.</small>
            </Card>
            <Card className="career-summary-card">
              <FileText aria-hidden="true" size={22} />
              <span>Documents</span>
              <strong>Library</strong>
              <LinkButton href="/dashboard/career/documents" size="sm" variant="secondary">
                Open documents
              </LinkButton>
            </Card>
          </div>

          {limitReached ? (
            <Alert title="Plan limit reached" tone="warning">
              Your plan allows {limit} active {limit === 1 ? 'profile' : 'profiles'} and all of them
              are in use. Archive or delete a profile before creating another one.
            </Alert>
          ) : null}

          <ul className="career-profile-grid">
            {profiles.map((profile) => (
              <li key={profile.id}>
                <Card className="career-profile-card">
                  <div className="career-profile-heading">
                    <div>
                      <h2>{profile.name}</h2>
                      <div className="career-badge-row">
                        {profile.isPrimary ? <Badge tone="brand">Primary</Badge> : null}
                        <Badge tone={profile.status === 'active' ? 'success' : 'neutral'}>
                          {profileStatusLabel(profile.status)}
                        </Badge>
                      </div>
                    </div>
                    <span className="career-profile-percent">{profile.completenessPercent}%</span>
                  </div>
                  <CareerCompletenessMeter
                    label={`${profile.name} completeness`}
                    percent={profile.completenessPercent}
                  />
                  <dl className="career-profile-facts">
                    <div>
                      <dt>Headline</dt>
                      <dd>{profile.headline ?? 'Not recorded'}</dd>
                    </div>
                    <div>
                      <dt>Current role</dt>
                      <dd>{profile.currentRoleTitle ?? 'Not recorded'}</dd>
                    </div>
                    <div>
                      <dt>Career level</dt>
                      <dd>
                        {optionLabel(careerLevelOptions, profile.careerLevel) ?? 'Not recorded'}
                      </dd>
                    </div>
                    <div>
                      <dt>Years of experience</dt>
                      <dd>{profile.yearsExperience ?? 'Not recorded'}</dd>
                    </div>
                    <div>
                      <dt>Work arrangement</dt>
                      <dd>
                        {optionLabel(workArrangementOptions, profile.preferredWorkArrangement) ??
                          'Not recorded'}
                      </dd>
                    </div>
                    <div>
                      <dt>Target roles</dt>
                      <dd>
                        {profile.targetRoleTitles.length > 0
                          ? profile.targetRoleTitles.join(', ')
                          : 'None recorded'}
                      </dd>
                    </div>
                  </dl>
                  <div className="career-card-actions">
                    <LinkButton
                      href={`/dashboard/career/${profile.id}`}
                      size="sm"
                      variant="secondary"
                    >
                      Open profile
                    </LinkButton>
                    <LinkButton
                      href={`/dashboard/career/${profile.id}/facts`}
                      size="sm"
                      variant="quiet"
                    >
                      <ListChecks aria-hidden="true" size={16} /> Truth ledger
                    </LinkButton>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
