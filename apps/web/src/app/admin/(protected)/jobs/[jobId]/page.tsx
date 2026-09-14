import { HanaplyApiError, type AdminJobDetail } from '@hanaply/contracts';
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  Table,
  TableCell,
  TableHeaderCell,
} from '@hanaply/ui';
import { Briefcase, CircleSlash } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { AdminJobStatusControl } from '@/components/admin-job-status-control';
import {
  count,
  country,
  dateOnly,
  EMPTY_VALUE,
  jobStatusTone,
  label,
  score,
  signalEntries,
  text,
  timestamp,
} from '@/lib/admin-jobs-format';
import { createAuthenticatedApiClient, requireAdminPermission } from '@/lib/session';

export const metadata: Metadata = { title: 'Job Record' };

function salaryText(
  min: number | null,
  max: number | null,
  currency: string | null,
  period: string | null,
): string {
  if (min === null && max === null) return EMPTY_VALUE;
  const unit = currency ?? 'PHP';
  const format = (value: number) => (value / 100).toLocaleString('en-PH');
  const range =
    min !== null && max !== null
      ? `${format(min)} – ${format(max)}`
      : min !== null
        ? `from ${format(min)}`
        : `up to ${format(max ?? 0)}`;
  return `${unit} ${range}${period ? ` per ${period.replace('ly', '')}` : ''}`;
}

export default async function AdminJobDetailPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = await params;
  const { admin, session } = await requireAdminPermission('jobs.read');
  let job: AdminJobDetail;
  try {
    job = (await createAuthenticatedApiClient(session).adminJob(jobId)).data;
  } catch (error) {
    if (error instanceof HanaplyApiError && error.status === 404) notFound();
    throw error;
  }
  const canModerate = admin.permissions.includes('jobs.moderate');
  return (
    <div className="workspace-page">
      <PageHeader
        actions={
          <div className="admin-heading-actions">
            <Badge tone={jobStatusTone(job.status)}>{label(job.status)}</Badge>
            <Badge tone="neutral">
              {count(job.sourceCount)} source{job.sourceCount === 1 ? '' : 's'}
            </Badge>
          </div>
        }
        description="The full internal record: normalized fields, content fingerprint, provenance from every provider, and duplication candidates."
        eyebrow="Job operations"
        title={job.title}
      />
      <Card className="admin-detail-card">
        <div className="admin-detail-heading">
          <Briefcase aria-hidden="true" size={22} />
          <h2>Canonical identity</h2>
        </div>
        <dl>
          <div>
            <dt>Company</dt>
            <dd>{text(job.companyName)}</dd>
          </div>
          <div>
            <dt>Normalized title</dt>
            <dd className="admin-source-mono">{text(job.normalizedTitle)}</dd>
          </div>
          <div>
            <dt>Dedup key</dt>
            <dd className="admin-source-mono">{text(job.dedupKey)}</dd>
          </div>
          <div>
            <dt>Content fingerprint</dt>
            <dd className="admin-source-mono">{text(job.contentFingerprint)}</dd>
          </div>
          <div>
            <dt>Job id</dt>
            <dd className="admin-source-mono">{job.id}</dd>
          </div>
        </dl>
      </Card>
      <div className="admin-detail-grid">
        <Card className="admin-detail-card">
          <div className="admin-detail-heading">
            <h2>Classification</h2>
          </div>
          <dl>
            <div>
              <dt>Employment type</dt>
              <dd>{label(job.employmentType)}</dd>
            </div>
            <div>
              <dt>Seniority</dt>
              <dd>{text(job.seniority)}</dd>
            </div>
            <div>
              <dt>Remote state</dt>
              <dd>{label(job.remoteState)}</dd>
            </div>
            <div>
              <dt>Philippines posting</dt>
              <dd>{job.isPhilippines ? 'Yes' : 'No'}</dd>
            </div>
            <div>
              <dt>International posting</dt>
              <dd>{job.isInternational ? 'Yes' : 'No'}</dd>
            </div>
            <div>
              <dt>Skills</dt>
              <dd>{job.skills.length > 0 ? job.skills.join(', ') : EMPTY_VALUE}</dd>
            </div>
          </dl>
        </Card>
        <Card className="admin-detail-card">
          <div className="admin-detail-heading">
            <h2>Location and compensation</h2>
          </div>
          <dl>
            <div>
              <dt>Location as written</dt>
              <dd>{text(job.locationRaw)}</dd>
            </div>
            <div>
              <dt>City</dt>
              <dd>{text(job.city)}</dd>
            </div>
            <div>
              <dt>Region</dt>
              <dd>{text(job.region)}</dd>
            </div>
            <div>
              <dt>Country</dt>
              <dd>{country(job.countryCode)}</dd>
            </div>
            <div>
              <dt>Salary</dt>
              <dd>
                {salaryText(
                  job.salaryMinMinor,
                  job.salaryMaxMinor,
                  job.salaryCurrency,
                  job.salaryPeriod,
                )}
                {job.salaryMinMinor === null && job.salaryMaxMinor === null ? null : (
                  <small className="admin-table-secondary">
                    {job.salaryIsEstimate
                      ? 'Estimated, not stated by the provider'
                      : 'Stated by the provider'}
                  </small>
                )}
              </dd>
            </div>
          </dl>
        </Card>
        <Card className="admin-detail-card">
          <div className="admin-detail-heading">
            <h2>Freshness</h2>
          </div>
          <dl>
            <div>
              <dt>Posted</dt>
              <dd>{timestamp(job.postedAt)}</dd>
            </div>
            <div>
              <dt>Expires</dt>
              <dd>{timestamp(job.expiresAt)}</dd>
            </div>
            <div>
              <dt>First seen</dt>
              <dd>{timestamp(job.firstSeenAt)}</dd>
            </div>
            <div>
              <dt>Last seen</dt>
              <dd>{timestamp(job.lastSeenAt)}</dd>
            </div>
            <div>
              <dt>Last verified</dt>
              <dd>{timestamp(job.lastVerifiedAt)}</dd>
            </div>
          </dl>
        </Card>
        <Card className="admin-detail-card">
          <div className="admin-detail-heading">
            <h2>Stored excerpt</h2>
          </div>
          <p className="admin-prewrap">{text(job.excerpt)}</p>
        </Card>
      </div>
      <details className="admin-job-description">
        <summary>
          Full description ({job.description.length.toLocaleString('en-PH')} characters)
        </summary>
        <pre className="admin-job-description-body">{text(job.description)}</pre>
      </details>
      <div className="admin-detail-grid">
        <Card className="admin-detail-card">
          <div className="admin-detail-heading">
            <h2>Requirements</h2>
          </div>
          {job.requirements.length === 0 ? (
            <p>No requirement was extracted from this posting.</p>
          ) : (
            <ul className="admin-job-list">
              {job.requirements.map((requirement, index) => (
                <li key={`${String(index)}-${requirement}`}>{requirement}</li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="admin-detail-card">
          <div className="admin-detail-heading">
            <h2>Preferred qualifications</h2>
          </div>
          {job.preferredQualifications.length === 0 ? (
            <p>No preferred qualification was extracted from this posting.</p>
          ) : (
            <ul className="admin-job-list">
              {job.preferredQualifications.map((qualification, index) => (
                <li key={`${String(index)}-${qualification}`}>{qualification}</li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <Card className="admin-detail-card">
        <div className="admin-detail-heading">
          <h2>Source provenance</h2>
        </div>
        {job.sources.length === 0 ? (
          <EmptyState
            description="This job has no source record, which means nothing currently attributes it to a provider."
            eyebrow="Provenance"
            icon={<CircleSlash aria-hidden="true" size={23} />}
            title="No source records"
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <TableHeaderCell>Provider</TableHeaderCell>
                <TableHeaderCell>Source job id</TableHeaderCell>
                <TableHeaderCell>URL</TableHeaderCell>
                <TableHeaderCell>Record status</TableHeaderCell>
                <TableHeaderCell>Primary</TableHeaderCell>
                <TableHeaderCell>Payload checksum</TableHeaderCell>
                <TableHeaderCell>Last seen</TableHeaderCell>
              </tr>
            </thead>
            <tbody>
              {job.sources.map((source) => (
                <tr key={source.sourceRecordId}>
                  <TableCell>
                    <strong>{source.displayName}</strong>
                    <small className="admin-table-secondary">{source.sourceCode}</small>
                  </TableCell>
                  <TableCell className="admin-source-mono">{source.sourceJobId}</TableCell>
                  <TableCell>
                    <a
                      className="admin-source-terms"
                      href={source.sourceUrl}
                      rel="noreferrer noopener"
                      target="_blank"
                    >
                      Open posting
                    </a>
                  </TableCell>
                  <TableCell>
                    <Badge tone={source.status === 'active' ? 'success' : 'warning'}>
                      {label(source.status)}
                    </Badge>
                  </TableCell>
                  <TableCell>{source.isPrimary ? 'Primary' : EMPTY_VALUE}</TableCell>
                  <TableCell className="admin-source-mono">{source.payloadChecksum}</TableCell>
                  <TableCell>{dateOnly(source.lastSeenAt)}</TableCell>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <Card className="admin-detail-card">
        <div className="admin-detail-heading">
          <h2>Duplication candidates</h2>
        </div>
        {job.duplicateCandidates.length === 0 ? (
          <p>No near-duplicate pair names this job.</p>
        ) : (
          <ul className="admin-dedup-signals">
            {job.duplicateCandidates.map((candidate) => (
              <li key={candidate.id}>
                <div className="admin-dedup-signal-heading">
                  <strong>Score {score(candidate.score)}</strong>
                  <Badge tone={candidate.resolution ? 'neutral' : 'warning'}>
                    {candidate.resolution ? label(candidate.resolution) : 'Open'}
                  </Badge>
                </div>
                <p className="admin-table-secondary">
                  Other record:{' '}
                  <Link href={`/admin/jobs/${candidate.otherJobId}`}>{candidate.otherJobId}</Link> ·
                  created {timestamp(candidate.createdAt)}
                </p>
                {signalEntries(candidate.signals).length === 0 ? (
                  <p>No signal was recorded for this pair.</p>
                ) : (
                  <dl className="admin-signal-list">
                    {signalEntries(candidate.signals).map((signal) => (
                      <div key={signal.key}>
                        <dt>{signal.key}</dt>
                        <dd>{signal.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <AdminJobStatusControl canModerate={canModerate} job={job} />
    </div>
  );
}
