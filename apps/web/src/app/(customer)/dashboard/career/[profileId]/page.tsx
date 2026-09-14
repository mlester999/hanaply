import { HanaplyApiError, type CareerProfileDetail } from '@hanaply/contracts';
import { Alert, Badge, Card, EmptyState, LinkButton, PageHeader } from '@hanaply/ui';
import { FileText, ListChecks } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import {
  CareerCompletenessMeter,
  CareerMissingList,
} from '@/components/career/career-completeness';
import { CareerProfileActions } from '@/components/career/career-profile-actions';
import { CareerProfileSettingsForm } from '@/components/career/career-profile-settings-form';
import {
  CareerRecordSection,
  type CareerRecordItem,
} from '@/components/career/career-record-section';
import {
  careerLevelOptions,
  employmentTypeOptions,
  formatIsoDate,
  formatMonthRange,
  formatSalary,
  humanise,
  linkKindOptions,
  optionLabel,
  proficiencyOptions,
  profileStatusLabel,
  skillKindOptions,
  workArrangementOptions,
} from '@/lib/career';
import { createAuthenticatedApiClient, requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Career Profile Detail' };

function meta(...values: readonly (string | number | null | undefined)[]): string[] {
  const parts: string[] = [];
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text !== '') parts.push(text);
  }
  return parts;
}

function yearRange(
  startYear: number | null,
  endYear: number | null,
  isCurrent: boolean,
): string | null {
  if (startYear === null && endYear === null) return null;
  const start = startYear === null ? 'Unknown start' : String(startYear);
  if (isCurrent) return `${start} — Present`;
  return endYear === null ? start : `${start} — ${endYear}`;
}

export default async function CareerProfileDetailPage({
  params,
}: {
  params: Promise<{ profileId: string }>;
}) {
  const { profileId } = await params;
  const { session } = await requireUser();

  let profile: CareerProfileDetail | null = null;
  let unavailable: string | null = null;
  try {
    profile = (await createAuthenticatedApiClient(session).careerProfile(profileId)).data;
  } catch (error) {
    if (error instanceof HanaplyApiError && error.status === 404) notFound();
    unavailable =
      error instanceof HanaplyApiError
        ? error.envelope.error.message
        : 'Hanaply could not load this career profile.';
  }

  if (!profile) {
    return (
      <div className="workspace-page career-page">
        <PageHeader eyebrow="Career intelligence" title="Career profile" />
        <Alert title="This career profile is unavailable" tone="danger">
          {unavailable ?? 'The profile could not be loaded.'}
        </Alert>
        <LinkButton href="/dashboard/career" variant="secondary">
          Back to career profiles
        </LinkButton>
      </div>
    );
  }

  const facts = profile.factCounts;
  const employmentItems = profile.employment.map((record): CareerRecordItem => {
    const companyUrl = record.companyUrl;
    return {
      record: { kind: 'employment', value: record },
      title: `${record.roleTitle} · ${record.companyName}`,
      meta: meta(
        formatMonthRange(record.startDate, record.endDate, record.isCurrent),
        optionLabel(employmentTypeOptions, record.employmentType),
        optionLabel(workArrangementOptions, record.workArrangement),
        record.location,
        record.countryCode,
        record.industry,
      ),
      detail: record.summary,
      tags: [...record.highlights, ...record.skills],
      ...(companyUrl ? { href: companyUrl } : {}),
    };
  });
  const subCareerItems = profile.subCareers.map((record): CareerRecordItem => ({
    record: { kind: 'sub_career', value: record },
    title: record.name,
    meta: meta(`Priority ${record.priority}`),
    detail: record.focus,
    tags: record.keywords,
  }));
  const projectItems = profile.projects.map((record): CareerRecordItem => {
    const link = record.projectUrl ?? record.repositoryUrl;
    return {
      record: { kind: 'project', value: record },
      title: record.name,
      meta: meta(
        record.roleTitle,
        formatIsoDate(record.startDate),
        formatIsoDate(record.endDate),
        record.isFeatured ? 'Featured' : null,
      ),
      detail: record.description,
      tags: [...record.highlights, ...record.skills],
      ...(link ? { href: link } : {}),
    };
  });
  const educationItems = profile.education.map((record): CareerRecordItem => ({
    record: { kind: 'education', value: record },
    title: record.institution,
    meta: meta(
      record.degree,
      record.fieldOfStudy,
      yearRange(record.startYear, record.endYear, record.isCurrent),
      record.grade,
    ),
    detail: record.description,
    tags: [],
  }));
  const certificationItems = profile.certifications.map((record): CareerRecordItem => {
    const credentialUrl = record.credentialUrl;
    return {
      record: { kind: 'certification', value: record },
      title: record.name,
      meta: meta(
        record.issuer,
        record.issuedOn ? `Issued ${formatIsoDate(record.issuedOn) ?? record.issuedOn}` : null,
        record.expiresOn ? `Expires ${formatIsoDate(record.expiresOn) ?? record.expiresOn}` : null,
        record.credentialId,
      ),
      detail: null,
      tags: [],
      ...(credentialUrl ? { href: credentialUrl } : {}),
    };
  });
  const linkItems = profile.links.map((record): CareerRecordItem => ({
    record: { kind: 'link', value: record },
    title:
      record.label ?? optionLabel(linkKindOptions, record.linkKind) ?? humanise(record.linkKind),
    meta: meta(optionLabel(linkKindOptions, record.linkKind), record.url),
    detail: null,
    tags: [],
    href: record.url,
  }));
  const skillItems = profile.skills.map((record): CareerRecordItem => ({
    record: { kind: 'skill', value: record },
    title: record.name,
    meta: meta(
      optionLabel(skillKindOptions, record.skillKind),
      optionLabel(proficiencyOptions, record.proficiency),
      record.yearsExperience === null ? null : `${record.yearsExperience} years`,
      record.lastUsedYear === null ? null : `Last used ${record.lastUsedYear}`,
      record.isPrimary ? 'Primary skill' : null,
    ),
    detail: null,
    tags: [],
  }));

  return (
    <div className="workspace-page career-page">
      <PageHeader
        actions={
          <>
            <LinkButton href={`/dashboard/career/${profile.id}/facts`} variant="secondary">
              <ListChecks aria-hidden="true" size={18} /> Truth ledger
            </LinkButton>
            <LinkButton href="/dashboard/career/documents" variant="quiet">
              <FileText aria-hidden="true" size={18} /> Documents
            </LinkButton>
          </>
        }
        description={profile.headline ?? 'No headline recorded yet.'}
        eyebrow="Career intelligence"
        title={profile.name}
      />

      <div className="career-badge-row">
        {profile.isPrimary ? <Badge tone="brand">Primary</Badge> : null}
        <Badge tone={profile.status === 'active' ? 'success' : 'neutral'}>
          {profileStatusLabel(profile.status)}
        </Badge>
        <Badge tone="neutral">Version {profile.version}</Badge>
      </div>

      <Card
        aria-labelledby="career-completeness-title"
        className="career-section-card"
        role="region"
      >
        <div className="career-section-heading">
          <div>
            <span className="h-eyebrow">Completeness</span>
            <h2 id="career-completeness-title">
              {profile.completeness.percent}% of the profile is complete
            </h2>
            <p>
              Ten items are worth ten points each. Every missing item below states what it costs in
              match quality.
            </p>
          </div>
        </div>
        <CareerCompletenessMeter
          label={`${profile.name} completeness`}
          percent={profile.completeness.percent}
        />
        <CareerMissingList missing={profile.completeness.missing} />
        <dl className="career-count-list">
          <div>
            <dt>Employment entries</dt>
            <dd>{profile.completeness.counts.employment}</dd>
          </div>
          <div>
            <dt>Skills</dt>
            <dd>{profile.completeness.counts.skills}</dd>
          </div>
          <div>
            <dt>Education entries</dt>
            <dd>{profile.completeness.counts.education}</dd>
          </div>
          <div>
            <dt>Links</dt>
            <dd>{profile.completeness.counts.links}</dd>
          </div>
          <div>
            <dt>Confirmed facts</dt>
            <dd>{profile.completeness.counts.confirmedFacts}</dd>
          </div>
        </dl>
        <div className="career-card-actions">
          <LinkButton href={`/dashboard/career/${profile.id}/facts`} size="sm" variant="secondary">
            Review {facts.candidate} {facts.candidate === 1 ? 'claim' : 'claims'} awaiting a
            decision
          </LinkButton>
        </div>
      </Card>

      <div className="career-fact-strip">
        <Card className="career-summary-card">
          <span>Confirmed</span>
          <strong>{facts.confirmed}</strong>
          <small>Only confirmed facts may be cited by generated material.</small>
        </Card>
        <Card className="career-summary-card">
          <span>Needs review</span>
          <strong>{facts.candidate}</strong>
          <small>Extracted or inferred claims waiting for your decision.</small>
        </Card>
        <Card className="career-summary-card">
          <span>Rejected</span>
          <strong>{facts.rejected}</strong>
          <small>Claims you refused. They are kept so nothing is silently re-added.</small>
        </Card>
      </div>

      <CareerRecordSection
        idPrefix="career-sub-careers"
        items={subCareerItems}
        kind="sub_career"
        profileId={profile.id}
      />
      <CareerRecordSection
        idPrefix="career-employment"
        items={employmentItems}
        kind="employment"
        profileId={profile.id}
      />
      <CareerRecordSection
        idPrefix="career-projects"
        items={projectItems}
        kind="project"
        profileId={profile.id}
      />
      <CareerRecordSection
        idPrefix="career-education"
        items={educationItems}
        kind="education"
        profileId={profile.id}
      />
      <CareerRecordSection
        idPrefix="career-certifications"
        items={certificationItems}
        kind="certification"
        profileId={profile.id}
      />
      <CareerRecordSection
        idPrefix="career-links"
        items={linkItems}
        kind="link"
        profileId={profile.id}
      />
      <CareerRecordSection
        idPrefix="career-skills"
        items={skillItems}
        kind="skill"
        profileId={profile.id}
      />

      <Card
        aria-labelledby="career-preferences-title"
        className="career-section-card"
        role="region"
      >
        <div className="career-section-heading">
          <div>
            <span className="h-eyebrow">Preferences</span>
            <h2 id="career-preferences-title">Preferences recorded on this profile</h2>
          </div>
        </div>
        <dl className="career-profile-facts">
          <div>
            <dt>Career level</dt>
            <dd>{optionLabel(careerLevelOptions, profile.careerLevel) ?? 'Not recorded'}</dd>
          </div>
          <div>
            <dt>Availability</dt>
            <dd>{profile.availability ? humanise(profile.availability) : 'Not recorded'}</dd>
          </div>
          <div>
            <dt>Salary expectation</dt>
            <dd>{formatSalary(profile.salaryExpectation) ?? 'Not recorded'}</dd>
          </div>
          <div>
            <dt>Open to international roles</dt>
            <dd>{profile.openToInternational ? 'Yes' : 'No'}</dd>
          </div>
          <div>
            <dt>Open to relocation</dt>
            <dd>{profile.openToRelocation ? 'Yes' : 'No'}</dd>
          </div>
          <div>
            <dt>Career goals</dt>
            <dd>{profile.careerGoals ?? 'Not recorded'}</dd>
          </div>
        </dl>
      </Card>

      <CareerProfileSettingsForm profile={profile} />

      <Card aria-labelledby="career-lifecycle-title" className="career-section-card" role="region">
        <div className="career-section-heading">
          <div>
            <span className="h-eyebrow">Lifecycle</span>
            <h2 id="career-lifecycle-title">Status, primary profile, and deletion</h2>
            <p>
              A profile is created as a draft, becomes active when you are ready, and can be
              archived without deleting its records.
            </p>
          </div>
        </div>
        <CareerProfileActions profile={profile} />
      </Card>

      {profile.employment.length === 0 && profile.skills.length === 0 ? (
        <EmptyState
          action={<LinkButton href="/dashboard/onboarding">Continue onboarding</LinkButton>}
          description="This profile has no employment or skills yet. Onboarding records them step by step and can be skipped at any point."
          eyebrow="Next step"
          title="Add the evidence behind your experience"
        />
      ) : null}
    </div>
  );
}
