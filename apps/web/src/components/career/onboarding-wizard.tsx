'use client';

import type { CareerProfileDetail } from '@hanaply/contracts';
import { Alert, Button, Card } from '@hanaply/ui';
import { Compass } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import {
  beginOnboardingAction,
  finishOnboardingAction,
} from '@/app/(customer)/dashboard/onboarding/actions';
import { CareerFeedback } from '@/components/career/career-feedback';
import {
  EducationStep,
  ExperienceStep,
  LinksSummaryStep,
  ReviewStep,
  SituationStep,
  SkillsStep,
  TargetsStep,
} from '@/components/career/onboarding-steps';
import { useCareerAction } from '@/components/career/use-career-action';

const steps = [
  {
    id: 'situation',
    title: 'Current situation',
    description: 'Where you are today: role title, career level, and total years of experience.',
  },
  {
    id: 'targets',
    title: 'Target roles',
    description: 'What to match, what to avoid, and where you are willing to work.',
  },
  {
    id: 'skills',
    title: 'Skills',
    description: 'The skills, tools, technologies, languages, and domains you want scored.',
  },
  {
    id: 'experience',
    title: 'Experience',
    description: 'Employment history, one role at a time, with dates and highlights.',
  },
  {
    id: 'education',
    title: 'Education and certifications',
    description: 'Degrees, fields of study, and credentials with their identifiers.',
  },
  {
    id: 'links',
    title: 'Links and summary',
    description: 'Public links, your professional summary, and your career goals.',
  },
  {
    id: 'review',
    title: 'Review',
    description: 'Completeness, what is missing, and what each gap costs in match quality.',
  },
] as const;

export interface OnboardingWizardProps {
  profileId: string | null;
  profileName: string;
  onboardingStatus: 'not_started' | 'in_progress' | 'complete';
  profile: CareerProfileDetail | null;
}

/**
 * Progressive onboarding. Every step saves through a server action before it
 * advances, every step can be skipped, and the whole flow is driven by data the
 * server read from the API, so a reload never loses progress.
 */
export function OnboardingWizard({
  profileId,
  profileName,
  onboardingStatus,
  profile,
}: OnboardingWizardProps) {
  const router = useRouter();
  const [stepIndex, setStepIndex] = useState(0);
  const begin = useCareerAction(beginOnboardingAction);
  const finish = useCareerAction(finishOnboardingAction);
  const lastIndex = steps.length - 1;
  const current = steps[stepIndex] ?? steps[0];
  const needsStart = profileId === null && onboardingStatus !== 'complete';

  // The first time the wizard is opened without a career profile, Hanaply
  // creates it and moves onboarding to in_progress. The state change stays on
  // the server, so the effect never sets React state itself.
  useEffect(() => {
    if (!needsStart) return;
    let cancelled = false;
    async function start() {
      await beginOnboardingAction();
      if (!cancelled) router.refresh();
    }
    void start();
    return () => {
      cancelled = true;
    };
  }, [needsStart, router]);

  function advance() {
    setStepIndex((index) => Math.min(index + 1, lastIndex));
  }

  function goTo(index: number) {
    setStepIndex(Math.min(Math.max(index, 0), lastIndex));
  }

  return (
    <div className="career-wizard">
      <Card className="career-step-indicator-card">
        <ol className="career-step-indicator">
          {steps.map((step, index) => (
            <li key={step.id}>
              <button
                aria-current={index === stepIndex ? 'step' : undefined}
                className={
                  index === stepIndex
                    ? 'career-step-button is-current'
                    : index < stepIndex
                      ? 'career-step-button is-complete'
                      : 'career-step-button'
                }
                onClick={() => {
                  goTo(index);
                }}
                type="button"
              >
                <span className="career-step-number">{index + 1}</span>
                <span className="career-step-label">{step.title}</span>
              </button>
            </li>
          ))}
        </ol>
        <p aria-live="polite" className="career-step-progress">
          Step {stepIndex + 1} of {steps.length}
        </p>
      </Card>

      <Card className="career-step-card">
        <div className="career-section-heading">
          <div>
            <span className="h-eyebrow">
              Step {stepIndex + 1} of {steps.length}
            </span>
            <h2>{current.title}</h2>
            <p>{current.description}</p>
          </div>
          {profile ? (
            <span className="career-profile-percent">{profile.completenessPercent}%</span>
          ) : null}
        </div>

        {needsStart ? (
          <Alert title="No career profile exists yet" tone="warning">
            Hanaply is creating your first career profile now. If that is refused — for example
            because your plan does not include one — the exact reason appears below.
            <form className="career-inline-form" onSubmit={begin.onSubmit}>
              <Button loading={begin.pending} type="submit" variant="secondary">
                Create my career profile
              </Button>
            </form>
            <CareerFeedback
              errorTitle="Profile not created"
              state={begin.state}
              successTitle="Profile created"
            />
          </Alert>
        ) : null}

        <div className="career-step-content">
          {current.id === 'situation' ? (
            <SituationStep
              onAdvance={advance}
              profile={profile}
              profileId={profileId}
              profileName={profileName}
            />
          ) : null}
          {current.id === 'targets' ? (
            <TargetsStep
              onAdvance={advance}
              profile={profile}
              profileId={profileId}
              profileName={profileName}
            />
          ) : null}
          {current.id === 'skills' ? (
            <SkillsStep
              onAdvance={advance}
              profile={profile}
              profileId={profileId}
              profileName={profileName}
            />
          ) : null}
          {current.id === 'experience' ? (
            <ExperienceStep
              onAdvance={advance}
              profile={profile}
              profileId={profileId}
              profileName={profileName}
            />
          ) : null}
          {current.id === 'education' ? (
            <EducationStep
              onAdvance={advance}
              profile={profile}
              profileId={profileId}
              profileName={profileName}
            />
          ) : null}
          {current.id === 'links' ? (
            <LinksSummaryStep
              onAdvance={advance}
              profile={profile}
              profileId={profileId}
              profileName={profileName}
            />
          ) : null}
          {current.id === 'review' ? (
            <ReviewStep
              onboardingStatus={onboardingStatus}
              onBack={() => {
                goTo(lastIndex - 1);
              }}
              onFinish={() => {
                const formData = new FormData();
                formData.set('status', 'complete');
                finish.submit(formData);
              }}
              pending={finish.pending}
              profile={profile}
            />
          ) : null}
        </div>

        {current.id === 'review' ? null : (
          <div className="career-step-nav">
            <Button
              disabled={stepIndex === 0}
              onClick={() => {
                goTo(stepIndex - 1);
              }}
              type="button"
              variant="quiet"
            >
              Back
            </Button>
            <span className="career-hint">
              <Compass aria-hidden="true" size={16} /> Every step can be skipped. Nothing optional
              blocks you.
            </span>
          </div>
        )}
        {current.id === 'review' ? (
          <CareerFeedback
            errorTitle="Onboarding not completed"
            state={finish.state}
            successTitle="Onboarding complete"
          />
        ) : null}
      </Card>
    </div>
  );
}
