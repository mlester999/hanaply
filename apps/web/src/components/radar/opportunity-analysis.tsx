import type { AiDeterministicMatch, OpportunityAnalysisResponse } from '@hanaply/contracts';
import { Alert, Badge, Card } from '@hanaply/ui';
import {
  AlertOctagon,
  AlertTriangle,
  Ban,
  BrainCircuit,
  Compass,
  Eye,
  FileText,
  Info,
  ListChecks,
  Sparkles,
  Target,
} from 'lucide-react';

import { OpportunityAnalysisActions } from '@/components/radar/opportunity-analysis-actions';
import {
  groundingTone,
  providerLabel,
  summariseGrounding,
  summariseProvenance,
  unavailableReason,
} from '@/lib/ai';
import { formatAbsoluteTimestamp, matchConfidenceLabel, matchVerdictLabel } from '@/lib/radar';

export interface OpportunityAnalysisProps {
  jobId: string;
  /** The career profile the match on this page belongs to. */
  careerProfileId: string | null;
  /** The stored analysis read, or null when that read failed. */
  analysis: OpportunityAnalysisResponse | null;
  /** Why the read failed, when it did. */
  unavailable: string | null;
  /**
   * The stored match from this page's own opportunity read, quoted rather than
   * recomputed. It is what the panel falls back to when nothing generated text.
   */
  fallbackMatch: AiDeterministicMatch | null;
}

interface StringListProps {
  id: string;
  title: string;
  items: readonly string[];
  /** What it means when the list is empty. Never an empty box. */
  emptyNote: string;
  className?: string;
}

function StringList({ id, title, items, emptyNote, className }: StringListProps) {
  return (
    <section aria-labelledby={id} className={className ?? 'ai-analysis-section'}>
      <h3 id={id}>{title}</h3>
      {items.length === 0 ? (
        <p className="career-section-empty">{emptyNote}</p>
      ) : (
        <ul className="ai-analysis-list">
          {items.map((item, index) => (
            <li key={`${index}-${item.slice(0, 24)}`}>{item}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The matching engine's own numbers, kept visually separate from anything a
 * model wrote.
 *
 * Score and confidence reach this component only through
 * `OpportunityAnalysisResponse.deterministicMatch`, which the API copies from
 * `@hanaply/matching`. Nothing in the generated report is presented as a score.
 */
function DeterministicMatch({
  match,
  careerProfileId,
  note,
}: {
  match: AiDeterministicMatch;
  careerProfileId: string | null;
  note: string;
}) {
  return (
    <section
      aria-labelledby="ai-analysis-deterministic-heading"
      className="ai-analysis-deterministic"
    >
      <h3 id="ai-analysis-deterministic-heading">
        <Target aria-hidden="true" size={16} /> Score and confidence — from Hanaply’s matching
        engine
      </h3>
      <dl className="ai-analysis-facts">
        <div>
          <dt>Score</dt>
          <dd>{match.score}</dd>
        </div>
        <div>
          <dt>Verdict</dt>
          <dd>{matchVerdictLabel(match.verdict)}</dd>
        </div>
        <div>
          <dt>Confidence</dt>
          <dd>{matchConfidenceLabel(match.confidence)}</dd>
        </div>
        <div>
          <dt>Matching model</dt>
          <dd>{match.modelVersion}</dd>
        </div>
      </dl>
      <p className="ai-analysis-next-action">
        <strong>Recommended action:</strong> {match.recommendedAction}
      </p>
      <p className="ai-analysis-footnote">
        {note} No model produced these numbers and no model can change them; they come from the
        stored match result computed by <code>@hanaply/matching</code>.
        {careerProfileId === null
          ? ''
          : ' They were computed for the career profile this opportunity page was opened with.'}
      </p>
    </section>
  );
}

/**
 * The grounded AI analysis for one opportunity.
 *
 * Three states are rendered explicitly, and none of them is an empty box: a
 * model-written report with its grounding and provenance, a response whose
 * report is null (with the API's reason and the deterministic match), and a
 * read that failed outright. The report is only ever shown when the response
 * says a model wrote it — `analysis` alone is not enough, because provenance is
 * what makes the label honest.
 */
export function OpportunityAnalysis({
  jobId,
  careerProfileId,
  analysis,
  unavailable,
  fallbackMatch,
}: OpportunityAnalysisProps) {
  const generated = analysis?.analysis != null && analysis.provenance.generated;
  const report = generated && analysis !== null ? analysis.analysis : null;
  const provenance =
    analysis === null ? null : summariseProvenance(analysis.provenance, 'This analysis');
  const grounding = analysis === null ? null : summariseGrounding(analysis.grounding);
  const profileMismatch =
    analysis !== null && careerProfileId !== null && analysis.careerProfileId !== careerProfileId;
  const generatedAt = analysis === null ? null : formatAbsoluteTimestamp(analysis.generatedAt);

  return (
    <Card className="radar-section-card ai-analysis">
      <div className="radar-section-heading">
        <BrainCircuit aria-hidden="true" size={20} />
        <div>
          <h2>AI analysis</h2>
          <p>
            A grounded reading of this opportunity: what the evidence supports, what it does not,
            and what not to claim. It sits below the deterministic intelligence, and it never
            replaces it.
          </p>
        </div>
        <Badge tone={report === null ? 'warning' : 'brand'}>
          {report === null ? 'No model report' : 'Model-written'}
        </Badge>
      </div>

      <OpportunityAnalysisActions
        careerProfileId={careerProfileId}
        hasGeneratedAnalysis={report !== null}
        jobId={jobId}
      />

      {profileMismatch ? (
        <Alert title="This analysis belongs to a different career profile" tone="info">
          The stored analysis was written for career profile{' '}
          {analysis?.careerProfileId ?? 'another profile'}, while this page is showing the match for{' '}
          {careerProfileId ?? 'a different profile'}. Nothing is merged: run the analysis here to
          write one for the profile you are looking at.
        </Alert>
      ) : null}

      {analysis === null ? (
        <Alert
          className="ai-analysis-unavailable"
          title="Hanaply could not read the stored analysis"
          tone="warning"
        >
          <p>
            {unavailable ??
              'The stored analysis could not be read, so Hanaply cannot say whether one exists.'}
          </p>
          <p>
            This is a read failure, not a statement about the analysis itself. The deterministic
            intelligence above is unaffected and is what to use.
          </p>
        </Alert>
      ) : null}

      {analysis !== null && report === null ? (
        <>
          <Alert
            className="ai-analysis-unavailable"
            title="AI is unavailable for this opportunity"
            tone="warning"
          >
            <p>{unavailableReason(analysis.provenance)}</p>
            {analysis.refusal === null ? null : <p>{analysis.refusal}</p>}
            <p>
              No model-written report is shown, because there is none. The deterministic
              intelligence above — the score, the verdict, the strengths, the gaps, the blockers,
              and the requirements mapping — is what still works, and it is unchanged.
            </p>
            {grounding !== null && grounding.totalClaims > 0 ? (
              <p>
                <Badge tone={groundingTone(analysis.grounding.status)}>
                  {grounding.statusLabel}
                </Badge>{' '}
                {grounding.sentence}
              </p>
            ) : null}
          </Alert>

          {analysis.deterministicMatch === null ? (
            fallbackMatch === null ? (
              <p className="career-section-empty">
                This opportunity has no stored match result yet, so there is no deterministic
                analysis for the model to have worked from either. Hanaply does not ask a model to
                invent a score.
              </p>
            ) : (
              <DeterministicMatch
                careerProfileId={careerProfileId}
                match={fallbackMatch}
                note="This is the match result this page already loaded."
              />
            )
          ) : (
            <DeterministicMatch
              careerProfileId={careerProfileId}
              match={analysis.deterministicMatch}
              note="This is the match result the analysis response quoted back."
            />
          )}
        </>
      ) : null}

      {report !== null && analysis !== null ? (
        <>
          <section aria-labelledby="ai-analysis-verdict-heading" className="ai-analysis-verdict">
            <h3 id="ai-analysis-verdict-heading">
              <Sparkles aria-hidden="true" size={16} /> Verdict commentary
            </h3>
            <p className="ai-analysis-verdict-body">{report.verdict.summary}</p>
            <p className="ai-analysis-footnote">
              {report.verdict.restatesMatchVerdict
                ? 'The report restates the matching engine’s verdict rather than deriving its own, which is the only thing it is allowed to do with a verdict.'
                : 'The report does not claim to restate the matching engine’s verdict, so treat this as commentary on the opportunity rather than as the stored verdict.'}
            </p>
          </section>

          <StringList
            emptyNote="The analysis listed nothing here."
            id="ai-analysis-why-heading"
            items={report.whyInteresting}
            title="Why it is interesting"
          />

          <section aria-labelledby="ai-analysis-evidence-heading" className="ai-analysis-section">
            <h3 id="ai-analysis-evidence-heading">Strongest evidence</h3>
            {report.strongestEvidence.length === 0 ? (
              <p className="career-section-empty">
                The analysis cited no specific confirmed fact as evidence for this opportunity.
              </p>
            ) : (
              <ul className="ai-analysis-evidence">
                {report.strongestEvidence.map((entry, index) => (
                  <li key={`${index}-${entry.factId}`}>
                    <p>{entry.insight}</p>
                    <p className="ai-analysis-evidence-fact">
                      Cited confirmed fact <code>{entry.factId}</code>
                      {careerProfileId === null
                        ? null
                        : ' — open your truth ledger to read the statement behind it'}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            {careerProfileId === null ? null : (
              <p className="ai-analysis-footnote">
                The identifiers above are confirmed facts from your own ledger; their statements are
                not reproduced here, so nothing is paraphrased on the model’s behalf.
              </p>
            )}
          </section>

          <StringList
            emptyNote="The analysis named no transferable strength."
            id="ai-analysis-transferable-heading"
            items={report.transferableStrengths}
            title="Transferable strengths"
          />
          <StringList
            className="ai-analysis-section ai-analysis-section--gap"
            emptyNote="The analysis recorded no gaps."
            id="ai-analysis-gaps-heading"
            items={report.gaps}
            title="Gaps"
          />
          <StringList
            className="ai-analysis-section ai-analysis-section--blocker"
            emptyNote="The analysis recorded no hard blockers."
            id="ai-analysis-blockers-heading"
            items={report.hardBlockers}
            title="Hard blockers"
          />
          <StringList
            className="ai-analysis-section ai-analysis-section--risk"
            emptyNote="The analysis recorded no specific rejection risks."
            id="ai-analysis-risks-heading"
            items={report.rejectionRisks}
            title="Rejection risks"
          />

          <section
            aria-labelledby="ai-analysis-not-claim-heading"
            className="ai-analysis-not-claim"
          >
            <h3 id="ai-analysis-not-claim-heading">
              <Ban aria-hidden="true" size={18} /> What not to claim
            </h3>
            <p className="ai-analysis-not-claim-lead">
              Do not put any of these in a resume, a cover letter, a recruiter message, or an
              interview answer. They are the claims this analysis says your confirmed facts do not
              support — asserting one is how an application becomes a misrepresentation.
            </p>
            {report.whatNotToClaim.length === 0 ? (
              <p className="career-section-empty">
                The analysis flagged nothing as unsupported. That is a statement about this report,
                not a licence to claim anything: your confirmed facts are still the limit, and the
                truth ledger is where they are listed.
              </p>
            ) : (
              <ul className="ai-analysis-not-claim-list">
                {report.whatNotToClaim.map((item, index) => (
                  <li key={`${index}-${item.slice(0, 24)}`}>{item}</li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="ai-analysis-next-heading" className="ai-analysis-section">
            <h3 id="ai-analysis-next-heading">
              <Compass aria-hidden="true" size={16} /> Recommended next action
            </h3>
            <p className="ai-analysis-next-action">{report.recommendedNextAction}</p>
          </section>

          <StringList
            emptyNote="The analysis listed no application strategy."
            id="ai-analysis-application-heading"
            items={report.applicationStrategy}
            title="Application strategy"
          />
          <StringList
            emptyNote="The analysis listed no interview strategy."
            id="ai-analysis-interview-heading"
            items={report.interviewStrategy}
            title="Interview strategy"
          />
          <StringList
            className="ai-analysis-section ai-analysis-section--emphasis"
            emptyNote="The analysis listed nothing to emphasise."
            id="ai-analysis-emphasise-heading"
            items={report.whatToEmphasise}
            title="What to emphasise"
          />
          <StringList
            emptyNote="The analysis raised no salary or location concern."
            id="ai-analysis-salary-heading"
            items={report.salaryAndLocationConcerns}
            title="Salary and location concerns"
          />
          <StringList
            emptyNote="The analysis proposed no career direction."
            id="ai-analysis-direction-heading"
            items={report.careerDirection}
            title="Career direction"
          />

          {grounding !== null ? (
            <section
              aria-labelledby="ai-analysis-grounding-heading"
              className="ai-analysis-grounding"
            >
              <h3 id="ai-analysis-grounding-heading">
                <Eye aria-hidden="true" size={16} /> Grounding — what the truth gate did with it
              </h3>
              <p>
                <Badge tone={grounding.tone}>{grounding.statusLabel}</Badge>
              </p>
              <p>{grounding.sentence}</p>
              {grounding.refusedClaims.length === 0 ? (
                <p className="ai-analysis-footnote">
                  No claim was dropped or rejected, so every statement above survived the gate.
                </p>
              ) : (
                <ul className="ai-analysis-claims">
                  {grounding.refusedClaims.map((claim, index) => (
                    <li key={`${index}-${claim.path}`}>
                      <Badge tone={claim.status === 'rejected' ? 'danger' : 'warning'}>
                        {claim.status === 'rejected' ? 'Rejected' : 'Dropped'}
                      </Badge>
                      <code>{claim.path}</code>
                      <span>
                        {claim.text === '' ? 'No excerpt was recorded for this claim.' : claim.text}
                      </span>
                      <span className="ai-analysis-claim-reason">
                        {claim.reason ?? 'No reason was recorded.'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <dl className="ai-analysis-facts">
                <div>
                  <dt>Verified facts</dt>
                  <dd>{analysis.grounding.verifiedFactIds.length}</dd>
                </div>
                <div>
                  <dt>Admissible facts</dt>
                  <dd>{analysis.grounding.admissibleFactIds.length}</dd>
                </div>
                <div>
                  <dt>Numeric claims checked</dt>
                  <dd>{analysis.grounding.numericClaimsChecked}</dd>
                </div>
                <div>
                  <dt>Entity claims checked</dt>
                  <dd>{analysis.grounding.entityClaimsChecked}</dd>
                </div>
                <div>
                  <dt>Experience claims checked</dt>
                  <dd>{analysis.grounding.experienceClaimsChecked}</dd>
                </div>
                <div>
                  <dt>Unsupported claim ids</dt>
                  <dd>{analysis.grounding.unsupportedClaimIds.length}</dd>
                </div>
              </dl>
              {analysis.grounding.rejections.length > 0 ? (
                <details className="ai-analysis-rejections">
                  <summary>
                    {analysis.grounding.rejections.length}{' '}
                    {analysis.grounding.rejections.length === 1 ? 'rejection' : 'rejections'}{' '}
                    recorded
                  </summary>
                  <ul>
                    {analysis.grounding.rejections.map((rejection, index) => (
                      <li key={`${index}-${rejection.path}`}>
                        <code>{rejection.code}</code> <code>{rejection.path}</code>
                        <span>{rejection.detail}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </section>
          ) : null}

          {provenance !== null ? (
            <section
              aria-labelledby="ai-analysis-provenance-heading"
              className="ai-analysis-provenance"
            >
              <h3 id="ai-analysis-provenance-heading">
                <FileText aria-hidden="true" size={16} /> Provenance
              </h3>
              <p>
                <Badge tone={provenance.tone}>
                  {analysis.provenance.generated ? 'Model-written' : 'Not model-written'}
                </Badge>{' '}
                {provenance.headline}
              </p>
              <dl className="ai-analysis-facts">
                {provenance.details.map((detail) => {
                  const separator = detail.indexOf(':');
                  const term = separator === -1 ? detail : detail.slice(0, separator);
                  const value = separator === -1 ? '' : detail.slice(separator + 1).trim();
                  return (
                    <div key={detail}>
                      <dt>{term}</dt>
                      <dd>{value === '' ? 'Not reported' : value}</dd>
                    </div>
                  );
                })}
                <div>
                  <dt>Degraded</dt>
                  <dd>{analysis.provenance.degraded ? 'Yes' : 'No'}</dd>
                </div>
              </dl>
              {provenance.reason === null ? null : <p>{provenance.reason}</p>}
              <p className="ai-analysis-footnote">
                {analysis.cached
                  ? `This is the stored report${generatedAt === null ? '' : ` from ${generatedAt}`}, returned because your confirmed evidence and the match result have not changed.`
                  : `This report was generated for this request${generatedAt === null ? '' : ` at ${generatedAt}`}.`}{' '}
                It was written against your confirmed facts only; facts you change later do not
                rewrite it, and running the analysis again replaces it.
              </p>
            </section>
          ) : null}

          {analysis.deterministicMatch !== null ? (
            <DeterministicMatch
              careerProfileId={careerProfileId}
              match={analysis.deterministicMatch}
              note="Shown beside the report so the report can never be mistaken for the score."
            />
          ) : (
            <p className="career-section-empty">
              <Info aria-hidden="true" size={16} /> The analysis response carried no deterministic
              match, which means this opportunity has no stored match result. The commentary above
              was written without a score to restate, and no score is shown in its place.
            </p>
          )}
        </>
      ) : null}

      <p className="ai-analysis-footnote">
        <AlertTriangle aria-hidden="true" size={14} /> A model’s commentary is not evidence. Where
        this panel reports what you have done, the statement traces to a confirmed fact in your
        truth ledger; where it reports what might work, it is an inference about an opportunity and
        not a statement about you. Hanaply’s matching engine remains the only thing that scores
        anything.
      </p>

      <p className="ai-analysis-footnote">
        <AlertOctagon aria-hidden="true" size={14} /> Provider:{' '}
        {providerLabel(analysis?.provenance.provider ?? null)}. Hanaply never presents deterministic
        output as AI, and never presents AI output as a fact about you.
      </p>

      <p className="ai-analysis-footnote">
        <ListChecks aria-hidden="true" size={14} /> The deterministic sections above are the source
        of truth for this opportunity: score, verdict, confidence, requirements mapping, and the
        stored recommended action.
      </p>
    </Card>
  );
}
