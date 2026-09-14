'use client';

import type { JobRadarItem } from '@hanaply/contracts';
import { Badge, Button, Card } from '@hanaply/ui';
import {
  Bookmark,
  BookmarkCheck,
  Building2,
  CalendarClock,
  ChevronDown,
  Coins,
  Layers,
  MapPin,
  Sparkles,
} from 'lucide-react';
import Link from 'next/link';
import { useRef, type ReactNode } from 'react';

import {
  recordJobFeedbackAction,
  saveJobAction,
  unsaveJobAction,
} from '@/app/(customer)/dashboard/radar/actions';
import { RadarFeedback } from '@/components/radar/radar-feedback';
import { useRadarAction } from '@/components/radar/use-radar-action';
import { humanise, optionLabel } from '@/lib/career';
import {
  jobFeedbackEffects,
  jobFeedbackKinds,
  jobFeedbackLabel,
  locationDisplay,
  matchConfidenceLabel,
  matchVerdictLabel,
  opportunityFreshness,
  radarEmploymentTypeOptions,
  radarSeniorityOptions,
  radarSkillSplit,
  salaryDisplay,
  verdictTone,
  type RelativeTime,
} from '@/lib/radar';

const skillDisplayLimit = 6;

export interface OpportunityCardProps {
  item: JobRadarItem;
  /** Computed once on the server so every relative label on the page agrees. */
  now: Date;
  careerProfileId: string | null;
}

function MetaItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="radar-card-meta-item">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Freshness({ freshness }: { freshness: RelativeTime }) {
  return (
    <span className="radar-freshness" title={freshness.title}>
      <CalendarClock aria-hidden="true" size={14} />
      {freshness.label}
    </span>
  );
}

/**
 * One opportunity card. Everything shown here comes from the feed item: a score
 * is only rendered when the API returned one, and an unanalysed opportunity
 * says so instead of wearing the appearance of a low score.
 */
export function OpportunityCard({ item, now, careerProfileId }: OpportunityCardProps) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const save = useRadarAction(saveJobAction);
  const unsave = useRadarAction(unsaveJobAction);
  const feedback = useRadarAction(recordJobFeedbackAction, {
    onSuccess: () => {
      if (detailsRef.current) detailsRef.current.open = false;
    },
  });

  const freshness = opportunityFreshness(item, now);
  const salary = salaryDisplay(item);
  const location = locationDisplay(item);
  const skills = radarSkillSplit(item.skills, skillDisplayLimit);
  const match = item.match;
  const isSaved = item.savedAt !== null;
  const savePending = save.pending || unsave.pending;

  return (
    <Card className="radar-card">
      <div className="radar-card-heading">
        <div className="radar-card-title">
          <h3>
            <Link href={`/dashboard/radar/${item.id}`}>{item.title}</Link>
          </h3>
          <p className="radar-card-company">
            <Building2 aria-hidden="true" size={15} />
            {item.companyName}
          </p>
        </div>
        <div className="radar-card-verdict">
          {match ? (
            <>
              <Badge tone={verdictTone(match.verdict)}>
                {matchVerdictLabel(match.verdict)} · {match.score}/100
              </Badge>
              <span className="radar-confidence">{matchConfidenceLabel(match.confidence)}</span>
            </>
          ) : (
            <>
              <Badge tone="neutral">Not analysed yet</Badge>
              <span className="radar-confidence">No score exists for this opportunity yet.</span>
            </>
          )}
        </div>
      </div>

      <dl className="radar-card-meta">
        <MetaItem label="Location">
          {location ?? 'Not published'}
          <span className="radar-remote-state">
            {item.remoteState === 'unspecified'
              ? 'Work setup not stated'
              : humanise(item.remoteState)}
          </span>
        </MetaItem>
        <MetaItem label="Salary">
          {salary ? (
            <>
              {salary.text}
              {salary.isEstimate ? (
                <span className="radar-estimate" title={salary.note ?? undefined}>
                  Estimate
                </span>
              ) : null}
            </>
          ) : (
            <span className="radar-muted-value">Salary not published</span>
          )}
        </MetaItem>
        <MetaItem label="Employment type">
          {optionLabel(radarEmploymentTypeOptions, item.employmentType) ?? item.employmentType}
        </MetaItem>
        <MetaItem label="Seniority">
          {optionLabel(radarSeniorityOptions, item.seniority) ?? item.seniority}
        </MetaItem>
      </dl>

      <div className="radar-card-freshness">
        <Freshness freshness={freshness} />
        {item.sourceCount > 1 ? (
          <span
            className="radar-source-count"
            title="How many sources published this posting. Hanaply merges duplicates into one opportunity."
          >
            <Layers aria-hidden="true" size={14} />
            Seen on {item.sourceCount} sources
          </span>
        ) : null}
        {item.isInternational && !item.isPhilippines ? (
          <span className="radar-flag">
            <MapPin aria-hidden="true" size={14} /> International posting
          </span>
        ) : null}
      </div>

      {item.skills.length > 0 ? (
        <div className="radar-skills">
          <h4>Skills named in the posting</h4>
          <ul className="radar-skill-list">
            {skills.shown.map((skill) => (
              <li key={skill}>{skill}</li>
            ))}
          </ul>
          {skills.remaining > 0 ? (
            <p className="radar-skill-more">+{skills.remaining} more</p>
          ) : null}
        </div>
      ) : (
        <p className="career-hint">No skills were extracted from this posting.</p>
      )}

      {item.excerpt ? <p className="radar-card-excerpt">{item.excerpt}</p> : null}

      {match ? (
        <div className="radar-card-action-advice">
          <Sparkles aria-hidden="true" size={16} />
          <div>
            <strong>Recommended action</strong>
            <p>{match.recommendedAction}</p>
          </div>
        </div>
      ) : null}

      {item.feedback !== null ? (
        <p className="radar-card-signal">
          Your current signal: <strong>{jobFeedbackLabel(item.feedback)}</strong>
        </p>
      ) : null}

      <div className="radar-card-actions">
        {isSaved ? (
          <form onSubmit={unsave.onSubmit}>
            <input name="jobId" type="hidden" value={item.id} />
            <input name="careerProfileId" type="hidden" value={careerProfileId ?? ''} />
            <Button
              leadingIcon={<BookmarkCheck aria-hidden="true" size={16} />}
              loading={savePending}
              type="submit"
              variant="secondary"
            >
              Remove from saved
            </Button>
          </form>
        ) : (
          <form onSubmit={save.onSubmit}>
            <input name="jobId" type="hidden" value={item.id} />
            <input name="careerProfileId" type="hidden" value={careerProfileId ?? ''} />
            <Button
              leadingIcon={<Bookmark aria-hidden="true" size={16} />}
              loading={savePending}
              type="submit"
            >
              Save opportunity
            </Button>
          </form>
        )}

        <details className="radar-feedback-menu" ref={detailsRef}>
          <summary aria-label={`Record feedback for ${item.title}`}>
            <span className="radar-feedback-trigger">
              <Coins aria-hidden="true" size={16} />
              {item.feedback === null ? 'Record feedback' : 'Change feedback'}
              <ChevronDown aria-hidden="true" size={14} />
            </span>
          </summary>
          <div className="radar-feedback-body">
            <p className="radar-feedback-intro">
              Feedback is how the radar learns. Each choice states what happens next.
            </p>
            {jobFeedbackKinds.map((kind) => (
              <form key={kind} onSubmit={feedback.onSubmit}>
                <input name="jobId" type="hidden" value={item.id} />
                <input name="feedback" type="hidden" value={kind} />
                <input name="careerProfileId" type="hidden" value={careerProfileId ?? ''} />
                <button className="radar-feedback-option" disabled={feedback.pending} type="submit">
                  <strong>
                    {jobFeedbackLabel(kind)}
                    {item.feedback === kind ? ' · current' : ''}
                  </strong>
                  <small>{jobFeedbackEffects[kind]}</small>
                </button>
              </form>
            ))}
          </div>
        </details>
      </div>

      <RadarFeedback
        errorTitle="Feedback not recorded"
        state={feedback.state}
        successTitle="Feedback recorded"
      />
      <RadarFeedback
        errorTitle="Save state not changed"
        state={save.state.status === 'idle' ? unsave.state : save.state}
        successTitle="Saved opportunities updated"
      />
    </Card>
  );
}
