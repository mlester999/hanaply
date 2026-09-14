import type { JobDetail } from '@hanaply/contracts';
import { Alert, Badge, Card, LinkButton, Table, TableCell, TableHeaderCell } from '@hanaply/ui';
import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FileText,
  Info,
  ListChecks,
  ShieldAlert,
  Sparkles,
  ThumbsUp,
} from 'lucide-react';

import { humanise } from '@/lib/career';

type ProfileCompleteness = 'thin' | 'partial' | 'solid';
type JobDetailQuality = 'thin' | 'partial' | 'detailed';

interface DataQuality {
  profileCompleteness: ProfileCompleteness | null;
  jobDetail: JobDetailQuality | null;
  unknowns: readonly string[];
}

function isProfileCompleteness(value: unknown): value is ProfileCompleteness {
  return value === 'thin' || value === 'partial' || value === 'solid';
}

function isJobDetailQuality(value: unknown): value is JobDetailQuality {
  return value === 'thin' || value === 'partial' || value === 'detailed';
}

/** Reads the stored data-quality record without trusting its shape. */
function readDataQuality(record: Readonly<Record<string, unknown>>): DataQuality {
  const profile = record.profileCompleteness;
  const job = record.jobDetail;
  const unknowns = record.unknowns;
  return {
    profileCompleteness: isProfileCompleteness(profile) ? profile : null,
    jobDetail: isJobDetailQuality(job) ? job : null,
    unknowns: Array.isArray(unknowns)
      ? unknowns.filter((entry): entry is string => typeof entry === 'string')
      : [],
  };
}

function strengthTone(score: number | null): string {
  if (score === null) return 'is-unknown';
  if (score >= 75) return 'is-strong';
  if (score >= 55) return 'is-moderate';
  return 'is-weak';
}

function RequirementStatusBadge({ status }: { status: string }) {
  if (status === 'met') return <Badge tone="success">Met</Badge>;
  if (status === 'partially_met') return <Badge tone="brand">Partially met</Badge>;
  if (status === 'unmet') return <Badge tone="warning">Not met yet</Badge>;
  return <Badge tone="neutral">Unknown</Badge>;
}

function UnanalysedPanel() {
  return (
    <Card className="radar-unanalysed">
      <h2>
        <Info aria-hidden="true" size={20} /> This opportunity has not been analysed yet
      </h2>
      <p>
        Analysis happens after the radar scans your career profile. When a posting arrives it is
        matched against the target roles, skills, seniority, location, and compensation recorded on
        your profile, and that result is stored beside the opportunity. Until that scan runs there
        is no score, no verdict, and no confidence for this posting — so none is shown here rather
        than a placeholder number.
      </p>
      <p>
        The original posting below is complete and unchanged. Saving the opportunity or recording
        feedback works now and also tells the ranking what you think of it.
      </p>
      <div className="radar-note-actions">
        <LinkButton href="/dashboard/career" variant="secondary">
          Review your career profile
        </LinkButton>
      </div>
    </Card>
  );
}

export interface JobIntelligenceProps {
  detail: JobDetail;
  careerProfileId: string | null;
}

/**
 * The intelligence-first body of an opportunity: why it fits, where it falls
 * short, how the score was built, and what the member should do next.
 */
export function JobIntelligence({ detail, careerProfileId }: JobIntelligenceProps) {
  const match = detail.match;
  if (!match) return <UnanalysedPanel />;

  const quality = readDataQuality(match.dataQuality);
  const profileHref = careerProfileId
    ? `/dashboard/career/${careerProfileId}`
    : '/dashboard/career';
  const thinProfile = quality.profileCompleteness === 'thin';

  return (
    <>
      <Card className="radar-section-card">
        <div className="radar-section-heading">
          <ThumbsUp aria-hidden="true" size={20} />
          <div>
            <h2>Why this fits</h2>
            <p>The signals the ranking actually found evidence for on your career profile.</p>
          </div>
        </div>
        {match.strengths.length === 0 ? (
          <p className="career-section-empty">
            The ranking stored no strengths for this opportunity, so there is nothing to claim here.
            That is itself a signal: check the gaps and the requirements mapping below.
          </p>
        ) : (
          <ul className="radar-reason-list radar-reason-list--positive">
            {match.strengths.map((strength, index) => (
              <li key={`${index}-${String(strength)}`}>
                <CheckCircle2 aria-hidden="true" size={17} />
                <span>{String(strength)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="radar-section-card">
        <div className="radar-section-heading">
          <ListChecks aria-hidden="true" size={20} />
          <div>
            <h2>Where you fall short</h2>
            <p>Each item is something you can act on before applying, not a rejection.</p>
          </div>
        </div>
        {match.gaps.length === 0 ? (
          <p className="career-section-empty">
            The ranking recorded no gaps between this posting and your profile. Confirm that against
            the requirements mapping before relying on it.
          </p>
        ) : (
          <ul className="radar-reason-list radar-reason-list--gap">
            {match.gaps.map((gap, index) => (
              <li key={`${index}-${String(gap)}`}>
                <AlertTriangle aria-hidden="true" size={17} />
                <span>{String(gap)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {match.blockers.length > 0 ? (
        <Card className="radar-section-card radar-blocker-card">
          <div className="radar-section-heading">
            <AlertOctagon aria-hidden="true" size={20} />
            <div>
              <h2>Blockers</h2>
              <p>
                A blocker is a hard rule on this account or this posting, which is why the verdict
                is <strong>{humanise(match.verdict).toLowerCase()}</strong> rather than a
                score-driven one.
              </p>
            </div>
          </div>
          <ul className="radar-blocker-list">
            {match.blockers.map((blocker, index) => (
              <li key={`${index}-${String(blocker)}`}>{String(blocker)}</li>
            ))}
          </ul>
          <p className="radar-blocker-note">
            Nothing is hidden here: the score stays visible above, and the blocker explains why the
            recommendation does not follow from it alone.
          </p>
        </Card>
      ) : null}

      <Card className="radar-section-card">
        <div className="radar-section-heading">
          <ShieldAlert aria-hidden="true" size={20} />
          <div>
            <h2>Possible rejection risks</h2>
            <p>Reasons a recruiter or an automated screen might pass on this application.</p>
          </div>
        </div>
        {match.rejectionRisks.length === 0 ? (
          <p className="career-section-empty">
            The ranking recorded no specific rejection risk for this opportunity.
          </p>
        ) : (
          <ul className="radar-risk-list">
            {match.rejectionRisks.map((risk, index) => (
              <li key={`${index}-${String(risk)}`}>{String(risk)}</li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="radar-section-card">
        <div className="radar-section-heading">
          <Sparkles aria-hidden="true" size={20} />
          <div>
            <h2>Match breakdown</h2>
            <p>
              Each dimension is scored on its own evidence, weighted, and then summed into the
              total.
            </p>
          </div>
        </div>
        {match.dimensions.length === 0 ? (
          <p className="career-section-empty">
            This stored result carries no dimension breakdown, so the total cannot be explained from
            it. Re-analysing the opportunity will record one.
          </p>
        ) : (
          <>
            <Table className="radar-dimension-table">
              <thead>
                <tr>
                  <TableHeaderCell>Dimension</TableHeaderCell>
                  <TableHeaderCell>Weight</TableHeaderCell>
                  <TableHeaderCell>Score</TableHeaderCell>
                  <TableHeaderCell>Contribution</TableHeaderCell>
                  <TableHeaderCell>What it found</TableHeaderCell>
                </tr>
              </thead>
              <tbody>
                {match.dimensions.map((dimension) => (
                  <tr key={dimension.key}>
                    <TableCell>
                      <strong>{dimension.label}</strong>
                    </TableCell>
                    <TableCell>{dimension.weight}</TableCell>
                    <TableCell>
                      {dimension.score === null ? (
                        <span className="radar-dimension-unknown">Not enough data</span>
                      ) : (
                        <span className={`radar-dimension-score ${strengthTone(dimension.score)}`}>
                          {dimension.score}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{dimension.contribution}</TableCell>
                    <TableCell className="radar-dimension-detail">{dimension.detail}</TableCell>
                  </tr>
                ))}
              </tbody>
            </Table>
            <p className="radar-explainer">
              A dimension with no data contributes nothing to the total and is left out of the
              weighted score rather than counted as zero, so the total is never inflated by a
              dimension Hanaply could not assess. The contribution column shows exactly what each
              dimension added; a dimension marked “Not enough data” added nothing.
            </p>
          </>
        )}
      </Card>

      <Card className="radar-section-card">
        <div className="radar-section-heading">
          <ListChecks aria-hidden="true" size={20} />
          <div>
            <h2>Requirements mapping</h2>
            <p>Every requirement the ranking compared against your profile, and what it found.</p>
          </div>
        </div>
        {match.requirementMapping.length === 0 ? (
          <p className="career-section-empty">
            The posting listed no requirements that could be mapped, so nothing is claimed here.
          </p>
        ) : (
          <ul className="radar-requirement-list">
            {match.requirementMapping.map((requirement, index) => (
              <li
                className={
                  requirement.status === 'unmet'
                    ? 'radar-requirement radar-requirement--unmet'
                    : 'radar-requirement'
                }
                key={`${index}-${requirement.requirement}`}
              >
                <div className="radar-requirement-heading">
                  <RequirementStatusBadge status={requirement.status} />
                  <p>{requirement.requirement}</p>
                </div>
                {requirement.matchedSkills.length > 0 ? (
                  <ul className="radar-skill-list radar-skill-list--matched">
                    {requirement.matchedSkills.map((skill) => (
                      <li key={skill}>{skill}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="radar-requirement-note">
                    No skill on your profile was matched to this requirement.
                  </p>
                )}
                <p className="radar-requirement-evidence">
                  {requirement.evidence ??
                    'No evidence sentence was stored for this requirement, so nothing is asserted about it.'}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="radar-section-card">
        <div className="radar-section-heading">
          <FileText aria-hidden="true" size={20} />
          <div>
            <h2>Data quality</h2>
            <p>How much evidence stood behind this score when it was computed.</p>
          </div>
        </div>
        <dl className="radar-quality-list">
          <div>
            <dt>Career profile completeness at analysis time</dt>
            <dd>
              {quality.profileCompleteness === null
                ? 'Not recorded in this stored result'
                : humanise(quality.profileCompleteness)}
            </dd>
          </div>
          <div>
            <dt>Posting detail at analysis time</dt>
            <dd>
              {quality.jobDetail === null
                ? 'Not recorded in this stored result'
                : humanise(quality.jobDetail)}
            </dd>
          </div>
          <div>
            <dt>Dimensions with no usable data</dt>
            <dd>
              {quality.unknowns.length === 0
                ? 'None — every dimension had evidence'
                : quality.unknowns.join(', ')}
            </dd>
          </div>
        </dl>
        <p className="radar-explainer">
          The stored confidence on this opportunity is {humanise(match.confidence).toLowerCase()},
          which is derived from these two quality readings. A high score computed from a thin
          profile is still low confidence, so the two are always shown together.
        </p>
        {thinProfile || quality.profileCompleteness === 'partial' ? (
          <Alert title="More profile evidence raises the confidence of every score" tone="info">
            This result was computed from a {quality.profileCompleteness ?? 'thin'} profile. Adding
            confirmed facts, skills, and history lets the ranking score more dimensions and report
            higher confidence on the same posting.
          </Alert>
        ) : null}
        <div className="radar-note-actions">
          <LinkButton href={profileHref} variant="secondary">
            Open the career profile behind this match
          </LinkButton>
        </div>
      </Card>

      <Card className="radar-section-card radar-next-step">
        <div className="radar-section-heading">
          <Sparkles aria-hidden="true" size={20} />
          <div>
            <h2>Recommended next step</h2>
            <p>The advice stored with this match result.</p>
          </div>
        </div>
        <p className="radar-next-step-action">{match.recommendedAction}</p>
        <p className="radar-explainer">
          <strong>Application Pack — coming next.</strong> A pack that drafts a tailored resume,
          cover letter, and screening answers from your confirmed evidence is not available yet. It
          is described here so you know what is planned; there is no button because there is nothing
          to open. Until it ships, apply on the original source and keep your truth ledger up to
          date.
        </p>
      </Card>
    </>
  );
}

export interface JobOriginalPostingProps {
  detail: JobDetail;
}

/** Section 10: the untouched posting and its provenance. */
export function JobOriginalPosting({ detail }: JobOriginalPostingProps) {
  return (
    <Card className="radar-section-card">
      <div className="radar-section-heading">
        <FileText aria-hidden="true" size={20} />
        <div>
          <h2>Original posting</h2>
          <p>Reproduced from the source so you can read it exactly as published.</p>
        </div>
      </div>

      <details className="radar-description">
        <summary>Read the full job description</summary>
        <div className="radar-description-body">
          {detail.description
            .split(/\n{2,}/u)
            .map((paragraph) => paragraph.trim())
            .filter((paragraph) => paragraph !== '')
            .map((paragraph, index) => (
              <p key={`${index}-${paragraph.slice(0, 24)}`}>{paragraph}</p>
            ))}
        </div>
      </details>

      <div className="radar-posting-columns">
        <section aria-labelledby="radar-requirements-title">
          <h3 id="radar-requirements-title">Requirements</h3>
          {detail.requirements.length === 0 ? (
            <p className="career-section-empty">
              The source did not publish a requirements list for this posting, so none is shown.
            </p>
          ) : (
            <ul className="radar-posting-list">
              {detail.requirements.map((requirement) => (
                <li key={requirement}>{requirement}</li>
              ))}
            </ul>
          )}
        </section>
        <section aria-labelledby="radar-preferred-title">
          <h3 id="radar-preferred-title">Preferred qualifications</h3>
          {detail.preferredQualifications.length === 0 ? (
            <p className="career-section-empty">
              The source did not publish preferred qualifications for this posting.
            </p>
          ) : (
            <ul className="radar-posting-list">
              {detail.preferredQualifications.map((qualification) => (
                <li key={qualification}>{qualification}</li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section aria-labelledby="radar-sources-title" className="radar-sources">
        <h3 id="radar-sources-title">
          Sources {detail.sources.length > 0 ? `(${detail.sources.length})` : ''}
        </h3>
        {detail.sources.length === 0 ? (
          <p className="career-section-empty">
            No source record is attached to this opportunity, so there is nothing to attribute.
          </p>
        ) : (
          <ul className="radar-source-list">
            {detail.sources.map((source) => (
              <li key={`${source.sourceCode}-${source.sourceUrl}`}>
                <div>
                  <strong>
                    {source.displayName}
                    {source.isPrimary ? ' · primary source' : ''}
                  </strong>
                  <p className="radar-source-attribution">{source.attribution}</p>
                  <p className="radar-source-meta">
                    {source.status === 'active'
                      ? 'Currently listed'
                      : source.status === 'stale'
                        ? 'Not re-verified recently'
                        : 'Removed by the source'}
                  </p>
                </div>
                <a
                  className="radar-source-link"
                  href={source.sourceUrl}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  <ExternalLink aria-hidden="true" size={15} /> Open this listing
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Card>
  );
}
