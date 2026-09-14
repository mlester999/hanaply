'use client';

import type { CareerProfileDetail } from '@hanaply/contracts';
import { Alert, Badge, Button, Card, FormField, Input } from '@hanaply/ui';
import { ArrowRight, Check, SkipForward } from 'lucide-react';

import {
  saveLinksSummaryAction,
  saveSituationAction,
  saveTargetRolesAction,
} from '@/app/(customer)/dashboard/onboarding/actions';
import {
  CareerCompletenessMeter,
  CareerMissingList,
} from '@/components/career/career-completeness';
import { CareerFeedback } from '@/components/career/career-feedback';
import { ChipListField } from '@/components/career/chip-list-field';
import {
  CareerRecordDeleteForm,
  CareerRecordEditor,
} from '@/components/career/career-record-editor';
import { SummaryField } from '@/components/career/summary-field';
import { useCareerAction } from '@/components/career/use-career-action';
import {
  careerLevelOptions,
  employmentTypeOptions,
  formatMonthRange,
  humanise,
  optionLabel,
  proficiencyOptions,
  skillKindOptions,
  workArrangementOptions,
} from '@/lib/career';
import type { CareerRecord } from '@/lib/career-records';

export interface OnboardingStepProps {
  profileId: string | null;
  profileName: string;
  profile: CareerProfileDetail | null;
  onAdvance: () => void;
}

function StepFooter({
  label,
  onSkip,
  pending,
}: {
  label: string;
  onSkip: () => void;
  pending?: boolean;
}) {
  return (
    <div className="career-step-footer">
      <Button
        leadingIcon={<ArrowRight aria-hidden="true" size={18} />}
        loading={pending ?? false}
        type="submit"
      >
        {label}
      </Button>
      <Button
        leadingIcon={<SkipForward aria-hidden="true" size={18} />}
        onClick={onSkip}
        type="button"
        variant="quiet"
      >
        Skip for now
      </Button>
    </div>
  );
}

function ProfileRequired() {
  return (
    <Alert title="A career profile is needed first" tone="warning">
      Go back to step 1 and use Create my career profile. Nothing in this step can be saved until a
      profile exists.
    </Alert>
  );
}

/** One item per line, joined for display. */
function joined(values: readonly (string | number | null | undefined)[]): string {
  const parts: string[] = [];
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text !== '') parts.push(text);
  }
  return parts.join(' · ');
}

export function SituationStep({ profileId, profileName, profile, onAdvance }: OnboardingStepProps) {
  const { state, onSubmit, pending } = useCareerAction(saveSituationAction, {
    onSuccess: onAdvance,
  });
  return (
    <form className="career-form" onSubmit={onSubmit}>
      <input name="profileId" type="hidden" value={profileId ?? ''} />
      <input name="profileName" type="hidden" value={profileName} />
      <div className="career-form-grid">
        <FormField
          error={state.fieldErrors.currentRoleTitle?.[0]}
          hint="The title you hold today, or the one you most recently held."
          id="onboardingCurrentRole"
          label="Current role title"
        >
          <Input
            defaultValue={profile?.currentRoleTitle ?? ''}
            id="onboardingCurrentRole"
            maxLength={160}
            name="currentRoleTitle"
            placeholder="Example: Customer Support Specialist"
          />
        </FormField>
        <FormField
          error={state.fieldErrors.careerLevel?.[0]}
          id="onboardingCareerLevel"
          label="Career level"
        >
          <select
            className="h-input"
            defaultValue={profile?.careerLevel ?? ''}
            id="onboardingCareerLevel"
            name="careerLevel"
          >
            <option value="">Not set</option>
            {careerLevelOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </FormField>
        <FormField
          error={state.fieldErrors.yearsExperience?.[0]}
          hint="Between 0 and 80. Fractions are allowed."
          id="onboardingYears"
          label="Years of experience"
        >
          <Input
            defaultValue={
              profile?.yearsExperience === null ? '' : String(profile?.yearsExperience ?? '')
            }
            id="onboardingYears"
            max={80}
            min={0}
            name="yearsExperience"
            step={0.5}
            type="number"
          />
        </FormField>
      </div>
      <CareerFeedback
        errorTitle="Current situation not saved"
        state={state}
        successTitle="Current situation saved"
      />
      <StepFooter label="Save and continue" onSkip={onAdvance} pending={pending} />
    </form>
  );
}

export function TargetsStep({ profileId, profileName, profile, onAdvance }: OnboardingStepProps) {
  const { state, onSubmit, pending } = useCareerAction(saveTargetRolesAction, {
    onSuccess: onAdvance,
  });
  return (
    <form className="career-form" onSubmit={onSubmit}>
      <input name="profileId" type="hidden" value={profileId ?? ''} />
      <input name="profileName" type="hidden" value={profileName} />
      <div className="career-form-grid">
        <ChipListField
          emptyMessage="No target roles yet. Matching needs at least one."
          id="onboardingTargetRoles"
          initialValues={profile?.targetRoleTitles ?? []}
          label="Target role titles"
          maxItems={15}
          maxLength={120}
          name="targetRoleTitles"
          placeholder="Example: Support Team Lead"
        />
        <ChipListField
          emptyMessage="No excluded roles yet."
          hint="Roles that must never be matched. Up to 15."
          id="onboardingExcludedRoles"
          initialValues={profile?.excludedRoleTitles ?? []}
          label="Roles you do not want"
          maxItems={15}
          maxLength={120}
          name="excludedRoleTitles"
          placeholder="Example: Night shift agent"
        />
      </div>

      <fieldset className="career-choice-group">
        <legend className="h-label">Preferred employment types</legend>
        <div className="career-choice-options">
          {employmentTypeOptions.map((option) => (
            <label className="career-choice" key={option.value}>
              <input
                defaultChecked={profile?.preferredEmploymentTypes.includes(option.value) ?? false}
                name="preferredEmploymentTypes"
                type="checkbox"
                value={option.value}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="career-choice-group">
        <legend className="h-label">Preferred work arrangement</legend>
        <div className="career-choice-options">
          {workArrangementOptions.map((option) => (
            <label className="career-choice" key={option.value}>
              <input
                defaultChecked={profile?.preferredWorkArrangement === option.value}
                name="preferredWorkArrangement"
                type="radio"
                value={option.value}
              />
              <span>{option.label}</span>
            </label>
          ))}
          <label className="career-choice">
            <input
              defaultChecked={(profile?.preferredWorkArrangement ?? null) === null}
              name="preferredWorkArrangement"
              type="radio"
              value=""
            />
            <span>No preference recorded</span>
          </label>
        </div>
      </fieldset>

      <div className="career-choice-options">
        <label className="career-choice">
          <input
            defaultChecked={profile?.openToInternational ?? false}
            name="openToInternational"
            type="checkbox"
          />
          <span>Open to international roles</span>
        </label>
        <label className="career-choice">
          <input
            defaultChecked={profile?.openToRelocation ?? false}
            name="openToRelocation"
            type="checkbox"
          />
          <span>Open to relocation</span>
        </label>
      </div>

      <ChipListField
        emptyMessage="No preferred locations yet."
        hint="Up to 20 locations. A remote preference does not need one."
        id="onboardingLocations"
        initialValues={profile?.preferredLocations ?? []}
        label="Preferred locations"
        maxItems={20}
        maxLength={120}
        name="preferredLocations"
        placeholder="Example: Metro Manila"
      />

      <CareerFeedback
        errorTitle="Target roles not saved"
        state={state}
        successTitle="Target roles saved"
      />
      <StepFooter label="Save and continue" onSkip={onAdvance} pending={pending} />
    </form>
  );
}

export function SkillsStep({ profileId, profile, onAdvance }: OnboardingStepProps) {
  const skills = profile?.skills ?? [];
  return (
    <div className="career-step-body">
      <p className="career-hint">
        Add one skill at a time. Five or more skills complete this part of the profile. Each entry
        is saved before you continue.
      </p>
      {profileId === null ? (
        <ProfileRequired />
      ) : (
        <Card className="career-inline-card">
          <CareerRecordEditor
            idPrefix="onboarding-skill-new"
            kind="skill"
            profileId={profileId}
            variant="inline"
          />
        </Card>
      )}
      {skills.length === 0 ? (
        <p className="career-section-empty">No skills recorded yet.</p>
      ) : (
        <ul className="career-record-list">
          {skills.map((skill) => {
            const record: CareerRecord = { kind: 'skill', value: skill };
            return (
              <li key={skill.id}>
                <div className="career-record-heading">
                  <div>
                    <h3>{skill.name}</h3>
                    <p className="career-record-meta">
                      {joined([
                        optionLabel(skillKindOptions, skill.skillKind),
                        optionLabel(proficiencyOptions, skill.proficiency),
                        skill.isPrimary ? 'Primary skill' : null,
                      ])}
                    </p>
                  </div>
                  <div className="career-record-controls">
                    {profileId === null ? null : (
                      <>
                        <CareerRecordEditor
                          idPrefix={`onboarding-skill-${skill.id}`}
                          kind="skill"
                          profileId={profileId}
                          record={record}
                        />
                        <CareerRecordDeleteForm
                          kind="skill"
                          label={skill.name}
                          profileId={profileId}
                          recordId={skill.id}
                        />
                      </>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div className="career-step-footer">
        <Button
          leadingIcon={<ArrowRight aria-hidden="true" size={18} />}
          onClick={onAdvance}
          type="button"
        >
          Continue
        </Button>
        <Button
          leadingIcon={<SkipForward aria-hidden="true" size={18} />}
          onClick={onAdvance}
          type="button"
          variant="quiet"
        >
          Skip for now
        </Button>
      </div>
    </div>
  );
}

export function ExperienceStep({ profileId, profile, onAdvance }: OnboardingStepProps) {
  const employment = profile?.employment ?? [];
  return (
    <div className="career-step-body">
      <p className="career-hint">
        Add each role separately. This is the evidence generated material may cite, so it must match
        the documents you will submit.
      </p>
      {profileId === null ? (
        <ProfileRequired />
      ) : (
        <Card className="career-inline-card">
          <CareerRecordEditor
            idPrefix="onboarding-employment-new"
            kind="employment"
            profileId={profileId}
            variant="inline"
          />
        </Card>
      )}
      {employment.length === 0 ? (
        <p className="career-section-empty">No employment entries recorded yet.</p>
      ) : (
        <ul className="career-record-list">
          {employment.map((entry) => {
            const record: CareerRecord = { kind: 'employment', value: entry };
            return (
              <li key={entry.id}>
                <div className="career-record-heading">
                  <div>
                    <h3>
                      {entry.roleTitle} · {entry.companyName}
                    </h3>
                    <p className="career-record-meta">
                      {joined([
                        formatMonthRange(entry.startDate, entry.endDate, entry.isCurrent),
                        optionLabel(employmentTypeOptions, entry.employmentType),
                        optionLabel(workArrangementOptions, entry.workArrangement),
                        entry.location,
                      ])}
                    </p>
                  </div>
                  <div className="career-record-controls">
                    {profileId === null ? null : (
                      <>
                        <CareerRecordEditor
                          idPrefix={`onboarding-employment-${entry.id}`}
                          kind="employment"
                          profileId={profileId}
                          record={record}
                        />
                        <CareerRecordDeleteForm
                          kind="employment"
                          label={`${entry.roleTitle} at ${entry.companyName}`}
                          profileId={profileId}
                          recordId={entry.id}
                        />
                      </>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div className="career-step-footer">
        <Button
          leadingIcon={<ArrowRight aria-hidden="true" size={18} />}
          onClick={onAdvance}
          type="button"
        >
          Continue
        </Button>
        <Button
          leadingIcon={<SkipForward aria-hidden="true" size={18} />}
          onClick={onAdvance}
          type="button"
          variant="quiet"
        >
          Skip for now
        </Button>
      </div>
    </div>
  );
}

export function EducationStep({ profileId, profile, onAdvance }: OnboardingStepProps) {
  const education = profile?.education ?? [];
  const certifications = profile?.certifications ?? [];
  return (
    <div className="career-step-body">
      <h3 className="career-step-subheading">Education</h3>
      {profileId === null ? (
        <ProfileRequired />
      ) : (
        <Card className="career-inline-card">
          <CareerRecordEditor
            idPrefix="onboarding-education-new"
            kind="education"
            profileId={profileId}
            variant="inline"
          />
        </Card>
      )}
      {education.length === 0 ? (
        <p className="career-section-empty">No education entries recorded yet.</p>
      ) : (
        <ul className="career-record-list">
          {education.map((entry) => {
            const record: CareerRecord = { kind: 'education', value: entry };
            return (
              <li key={entry.id}>
                <div className="career-record-heading">
                  <div>
                    <h3>{entry.institution}</h3>
                    <p className="career-record-meta">
                      {joined([
                        entry.degree,
                        entry.fieldOfStudy,
                        entry.endYear === null ? null : String(entry.endYear),
                        entry.isCurrent ? 'Currently studying' : null,
                      ])}
                    </p>
                  </div>
                  <div className="career-record-controls">
                    {profileId === null ? null : (
                      <>
                        <CareerRecordEditor
                          idPrefix={`onboarding-education-${entry.id}`}
                          kind="education"
                          profileId={profileId}
                          record={record}
                        />
                        <CareerRecordDeleteForm
                          kind="education"
                          label={entry.institution}
                          profileId={profileId}
                          recordId={entry.id}
                        />
                      </>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <h3 className="career-step-subheading">Certifications</h3>
      {profileId === null ? null : (
        <Card className="career-inline-card">
          <CareerRecordEditor
            idPrefix="onboarding-certification-new"
            kind="certification"
            profileId={profileId}
            variant="inline"
          />
        </Card>
      )}
      {certifications.length === 0 ? (
        <p className="career-section-empty">No certifications recorded yet.</p>
      ) : (
        <ul className="career-record-list">
          {certifications.map((entry) => {
            const record: CareerRecord = { kind: 'certification', value: entry };
            return (
              <li key={entry.id}>
                <div className="career-record-heading">
                  <div>
                    <h3>{entry.name}</h3>
                    <p className="career-record-meta">
                      {joined([entry.issuer, entry.issuedOn, entry.expiresOn])}
                    </p>
                  </div>
                  <div className="career-record-controls">
                    {profileId === null ? null : (
                      <>
                        <CareerRecordEditor
                          idPrefix={`onboarding-certification-${entry.id}`}
                          kind="certification"
                          profileId={profileId}
                          record={record}
                        />
                        <CareerRecordDeleteForm
                          kind="certification"
                          label={entry.name}
                          profileId={profileId}
                          recordId={entry.id}
                        />
                      </>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="career-step-footer">
        <Button
          leadingIcon={<ArrowRight aria-hidden="true" size={18} />}
          onClick={onAdvance}
          type="button"
        >
          Continue
        </Button>
        <Button
          leadingIcon={<SkipForward aria-hidden="true" size={18} />}
          onClick={onAdvance}
          type="button"
          variant="quiet"
        >
          Skip for now
        </Button>
      </div>
    </div>
  );
}

export function LinksSummaryStep({
  profileId,
  profileName,
  profile,
  onAdvance,
}: OnboardingStepProps) {
  const { state, onSubmit, pending } = useCareerAction(saveLinksSummaryAction, {
    onSuccess: onAdvance,
  });
  const links = profile?.links ?? [];
  return (
    <div className="career-step-body">
      <form className="career-form" onSubmit={onSubmit}>
        <input name="profileId" type="hidden" value={profileId ?? ''} />
        <input name="profileName" type="hidden" value={profileName} />
        <SummaryField
          defaultValue={profile?.summary ?? ''}
          hint="Eighty characters or more gives match analysis real context."
          id="onboardingSummary"
          label="Professional summary"
          name="summary"
        />
        <FormField
          hint="What the next role should move you toward."
          id="onboardingGoals"
          label="Career goals"
        >
          <textarea
            className="h-input h-textarea"
            defaultValue={profile?.careerGoals ?? ''}
            id="onboardingGoals"
            maxLength={2000}
            name="careerGoals"
            rows={4}
          />
        </FormField>
        <CareerFeedback errorTitle="Summary not saved" state={state} successTitle="Summary saved" />
        <StepFooter label="Save and continue" onSkip={onAdvance} pending={pending} />
      </form>

      <h3 className="career-step-subheading">Links</h3>
      {profileId === null ? (
        <ProfileRequired />
      ) : (
        <Card className="career-inline-card">
          <CareerRecordEditor
            idPrefix="onboarding-link-new"
            kind="link"
            profileId={profileId}
            variant="inline"
          />
        </Card>
      )}
      {links.length === 0 ? (
        <p className="career-section-empty">
          No links recorded yet. One GitHub, LinkedIn, or portfolio link counts as citable evidence.
        </p>
      ) : (
        <ul className="career-record-list">
          {links.map((entry) => {
            const record: CareerRecord = { kind: 'link', value: entry };
            return (
              <li key={entry.id}>
                <div className="career-record-heading">
                  <div>
                    <h3>{entry.label ?? humanise(entry.linkKind)}</h3>
                    <p className="career-record-meta">{entry.url}</p>
                  </div>
                  <div className="career-record-controls">
                    {profileId === null ? null : (
                      <>
                        <CareerRecordEditor
                          idPrefix={`onboarding-link-${entry.id}`}
                          kind="link"
                          profileId={profileId}
                          record={record}
                        />
                        <CareerRecordDeleteForm
                          kind="link"
                          label={entry.label ?? entry.url}
                          profileId={profileId}
                          recordId={entry.id}
                        />
                      </>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function ReviewStep({
  profile,
  onboardingStatus,
  onFinish,
  pending,
  onBack,
}: {
  profile: CareerProfileDetail | null;
  onboardingStatus: 'not_started' | 'in_progress' | 'complete';
  onFinish: () => void;
  pending: boolean;
  onBack: () => void;
}) {
  if (!profile) {
    return (
      <div className="career-step-body">
        <ProfileRequired />
      </div>
    );
  }
  const counts = profile.completeness.counts;
  return (
    <div className="career-step-body">
      <div className="career-review-meter">
        <CareerCompletenessMeter
          label={`${profile.name} completeness`}
          percent={profile.completeness.percent}
        />
      </div>
      <dl className="career-count-list">
        <div>
          <dt>Employment entries</dt>
          <dd>{counts.employment}</dd>
        </div>
        <div>
          <dt>Skills</dt>
          <dd>{counts.skills}</dd>
        </div>
        <div>
          <dt>Education entries</dt>
          <dd>{counts.education}</dd>
        </div>
        <div>
          <dt>Links</dt>
          <dd>{counts.links}</dd>
        </div>
        <div>
          <dt>Confirmed facts</dt>
          <dd>{counts.confirmedFacts}</dd>
        </div>
      </dl>
      <h3 className="career-step-subheading">What is still missing, and what it costs</h3>
      <CareerMissingList missing={profile.completeness.missing} />
      <div className="career-badge-row">
        <Badge tone={profile.completeness.missing.length === 0 ? 'success' : 'warning'}>
          {profile.completeness.missing.length === 0
            ? 'Nothing is missing'
            : `${profile.completeness.missing.length} items still open`}
        </Badge>
        <span className="career-hint">
          Optional items never block you. You can finish now and complete them later from the career
          profile.
        </span>
      </div>
      {onboardingStatus === 'complete' ? (
        <Alert title="Onboarding is already complete" tone="info">
          Completed onboarding cannot be reopened. Every step remains editable from the career
          profile and the truth ledger.
        </Alert>
      ) : null}
      <div className="career-step-footer">
        <Button
          leadingIcon={<Check aria-hidden="true" size={18} />}
          loading={pending}
          onClick={onFinish}
          type="button"
          variant="primary"
        >
          Finish onboarding
        </Button>
        <Button onClick={onBack} type="button" variant="quiet">
          Back to links and summary
        </Button>
      </div>
    </div>
  );
}
