'use client';

import type { JobDetail } from '@hanaply/contracts';
import { Badge, Button } from '@hanaply/ui';
import { Bookmark, BookmarkCheck, ChevronDown, Coins, ExternalLink } from 'lucide-react';
import { useRef } from 'react';

import {
  recordJobFeedbackAction,
  saveJobAction,
  unsaveJobAction,
} from '@/app/(customer)/dashboard/radar/actions';
import { RadarFeedback } from '@/components/radar/radar-feedback';
import { useRadarAction } from '@/components/radar/use-radar-action';
import { optionLabel } from '@/lib/career';
import {
  formatAbsoluteTimestamp,
  jobFeedbackEffects,
  jobFeedbackKinds,
  jobFeedbackLabel,
  locationDisplay,
  matchConfidenceLabel,
  matchVerdictLabel,
  opportunityFreshness,
  radarEmploymentTypeOptions,
  radarSeniorityOptions,
  salaryDisplay,
  verdictTone,
} from '@/lib/radar';

export interface OpportunityHeaderProps {
  detail: JobDetail;
  careerProfileId: string | null;
  now: Date;
}

function sourceStatusLabel(status: string): string {
  if (status === 'active') return 'Listed';
  if (status === 'removed') return 'Removed by the source';
  if (status === 'stale') return 'Not re-verified recently';
  return status;
}

/**
 * The detail header: identity, the stored verdict, and every action the member
 * can actually take on this opportunity.
 */
export function OpportunityHeader({ detail, careerProfileId, now }: OpportunityHeaderProps) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const save = useRadarAction(saveJobAction);
  const unsave = useRadarAction(unsaveJobAction);
  const feedback = useRadarAction(recordJobFeedbackAction, {
    onSuccess: () => {
      if (detailsRef.current) detailsRef.current.open = false;
    },
  });

  const match = detail.match;
  const salary = salaryDisplay(detail);
  const location = locationDisplay(detail);
  const freshness = opportunityFreshness(detail, now);
  const isSaved = detail.savedAt !== null;
  const savePending = save.pending || unsave.pending;
  const posted = formatAbsoluteTimestamp(detail.postedAt);
  const firstSeen = formatAbsoluteTimestamp(detail.firstSeenAt);
  const lastSeen = formatAbsoluteTimestamp(detail.lastSeenAt);
  const lastVerified = formatAbsoluteTimestamp(detail.lastVerifiedAt);
  const primarySource = detail.sources.find((source) => source.isPrimary) ?? detail.sources[0];

  return (
    <header className="radar-detail-header">
      <div className="radar-detail-heading">
        <div className="radar-detail-title">
          <span className="h-eyebrow">Opportunity</span>
          <h1>{detail.title}</h1>
          <p className="radar-detail-company">{detail.companyName}</p>
        </div>
        <div className="radar-detail-verdict">
          {match ? (
            <>
              <Badge tone={verdictTone(match.verdict)}>
                {matchVerdictLabel(match.verdict)} · {match.score}/100
              </Badge>
              <span>{matchConfidenceLabel(match.confidence)}</span>
            </>
          ) : (
            <>
              <Badge tone="neutral">Not analysed yet</Badge>
              <span>No score exists for this opportunity yet.</span>
            </>
          )}
        </div>
      </div>

      <dl className="radar-detail-facts">
        <div>
          <dt>Location</dt>
          <dd>
            {location ?? 'Not published'}
            {' · '}
            {detail.remoteState === 'unspecified' ? 'Work setup not stated' : detail.remoteState}
            {detail.isPhilippines ? ' · Philippines' : ''}
            {detail.isInternational && !detail.isPhilippines ? ' · International' : ''}
          </dd>
        </div>
        <div>
          <dt>Salary</dt>
          <dd>
            {salary ? (
              <>
                {salary.text}
                {salary.isEstimate ? <span className="radar-estimate">Estimate</span> : null}
                {salary.note === null ? null : <small>{salary.note}</small>}
              </>
            ) : (
              <span className="radar-muted-value">Salary not published</span>
            )}
          </dd>
        </div>
        <div>
          <dt>Employment type</dt>
          <dd>
            {optionLabel(radarEmploymentTypeOptions, detail.employmentType) ??
              detail.employmentType}
          </dd>
        </div>
        <div>
          <dt>Seniority</dt>
          <dd>{optionLabel(radarSeniorityOptions, detail.seniority) ?? detail.seniority}</dd>
        </div>
        <div>
          <dt>Experience asked for</dt>
          <dd>
            {detail.experienceYearsMin === null && detail.experienceYearsMax === null
              ? 'Not stated in the posting'
              : `${detail.experienceYearsMin ?? 0}–${detail.experienceYearsMax ?? 'any'} years`}
          </dd>
        </div>
        <div>
          <dt>Freshness</dt>
          <dd title={freshness.title}>{freshness.label}</dd>
        </div>
        <div>
          <dt>Posting history</dt>
          <dd>
            <span>First seen {firstSeen ?? 'not recorded'}</span>
            <span>Last seen {lastSeen ?? 'not recorded'}</span>
            <span>Posted {posted ?? 'not published by the source'}</span>
            <span>Last verified {lastVerified ?? 'not verified yet'}</span>
          </dd>
        </div>
        <div>
          <dt>Sources</dt>
          <dd>
            {detail.sourceCount === 1 ? 'One source' : `${detail.sourceCount} merged sources`}
            {primarySource ? (
              <span>
                Primary: {primarySource.displayName} · {sourceStatusLabel(primarySource.status)}
              </span>
            ) : (
              <span>No source record is attached to this opportunity.</span>
            )}
          </dd>
        </div>
      </dl>

      <div className="radar-detail-actions">
        {isSaved ? (
          <form onSubmit={unsave.onSubmit}>
            <input name="jobId" type="hidden" value={detail.id} />
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
            <input name="jobId" type="hidden" value={detail.id} />
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

        <a
          className="h-button h-button--primary h-button--md"
          href={detail.applyUrl}
          rel="noopener noreferrer"
          target="_blank"
        >
          <ExternalLink aria-hidden="true" size={16} />
          <span>Apply on the original source</span>
        </a>

        <details className="radar-feedback-menu" ref={detailsRef}>
          <summary aria-label={`Record feedback for ${detail.title}`}>
            <span className="radar-feedback-trigger">
              <Coins aria-hidden="true" size={16} />
              {detail.feedback === null ? 'Record feedback' : 'Change feedback'}
              <ChevronDown aria-hidden="true" size={14} />
            </span>
          </summary>
          <div className="radar-feedback-body">
            <p className="radar-feedback-intro">
              Feedback is how the radar learns. Each choice states what happens next. Current
              signal:{' '}
              {detail.feedback === null ? 'none recorded' : jobFeedbackLabel(detail.feedback)}.
            </p>
            {jobFeedbackKinds.map((kind) => (
              <form key={kind} onSubmit={feedback.onSubmit}>
                <input name="jobId" type="hidden" value={detail.id} />
                <input name="feedback" type="hidden" value={kind} />
                <input name="careerProfileId" type="hidden" value={careerProfileId ?? ''} />
                <button className="radar-feedback-option" disabled={feedback.pending} type="submit">
                  <strong>
                    {jobFeedbackLabel(kind)}
                    {detail.feedback === kind ? ' · current' : ''}
                  </strong>
                  <small>{jobFeedbackEffects[kind]}</small>
                </button>
              </form>
            ))}
          </div>
        </details>
      </div>

      <p className="radar-detail-source-link">
        Canonical posting: <span>{detail.canonicalUrl}</span>
      </p>

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
    </header>
  );
}
