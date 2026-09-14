import type { AdminIngestionHealth } from '@hanaply/contracts';
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  PageHeader,
  Table,
  TableCell,
  TableHeaderCell,
} from '@hanaply/ui';
import {
  Activity,
  Boxes,
  Briefcase,
  Building2,
  CopyCheck,
  Layers,
  TriangleAlert,
} from 'lucide-react';
import type { Metadata } from 'next';

import {
  count,
  duration,
  EMPTY_VALUE,
  label,
  runStatusTone,
  sourceStatusTone,
  text,
  timestamp,
} from '@/lib/admin-jobs-format';
import { createAuthenticatedApiClient, requireAdminPermission } from '@/lib/session';

export const metadata: Metadata = { title: 'Ingestion Health' };

type SourceHealth = AdminIngestionHealth['sources'][number];
type RecentRun = AdminIngestionHealth['recentRuns'][number];

function RunRow({
  sourceCode,
  startedAt,
  status,
  durationMs,
  createdCount,
  errorCode,
}: {
  sourceCode: string;
  startedAt: string;
  status: RecentRun['status'];
  durationMs: number | null;
  createdCount: number;
  errorCode: string | null;
}) {
  const needsAttention = status === 'failed' || status === 'partial';
  return (
    <tr className={needsAttention ? `admin-run-row admin-run-row--${status}` : 'admin-run-row'}>
      <TableCell>
        <strong className="admin-source-mono">{sourceCode}</strong>
      </TableCell>
      <TableCell>
        <Badge tone={runStatusTone(status)}>{label(status)}</Badge>
      </TableCell>
      <TableCell>{timestamp(startedAt)}</TableCell>
      <TableCell>{duration(durationMs)}</TableCell>
      <TableCell>{count(createdCount)}</TableCell>
      <TableCell>
        {errorCode ? (
          <span className="admin-run-error">
            <TriangleAlert aria-hidden="true" size={14} />
            {errorCode}
          </span>
        ) : (
          EMPTY_VALUE
        )}
      </TableCell>
    </tr>
  );
}

function ProviderHealthCard({ source }: { source: SourceHealth }) {
  return (
    <Card className="admin-source-card">
      <div className="admin-source-summary">
        <div className="admin-detail-heading">
          <Activity aria-hidden="true" size={22} />
          <div>
            <h2>{source.displayName}</h2>
            <p className="admin-source-code">{source.sourceCode}</p>
          </div>
        </div>
        <div className="admin-source-badges">
          <Badge tone={sourceStatusTone(source.status)}>{label(source.status)}</Badge>
          {source.consecutiveFailures > 0 ? (
            <Badge tone="danger">{count(source.consecutiveFailures)} consecutive failures</Badge>
          ) : null}
        </div>
      </div>
      <dl className="admin-source-facts">
        <div>
          <dt>Last success</dt>
          <dd>{timestamp(source.lastSuccessAt)}</dd>
        </div>
        <div>
          <dt>Last failure</dt>
          <dd>
            {timestamp(source.lastFailureAt)}
            <small className="admin-table-secondary">
              Error code: {text(source.lastErrorCode)}
            </small>
          </dd>
        </div>
        <div>
          <dt>Circuit open until</dt>
          <dd>{timestamp(source.circuitOpenUntil)}</dd>
        </div>
        <div>
          <dt>Ingested all time</dt>
          <dd>{count(source.totalJobsIngested)}</dd>
        </div>
      </dl>
      <h3 className="admin-section-subheading">Five most recent runs</h3>
      {source.recentRuns.length === 0 ? (
        <p className="admin-run-empty">No ingestion run has been recorded for this provider.</p>
      ) : (
        <div className="admin-run-list">
          {source.recentRuns.map((run) => (
            <div
              className={
                run.status === 'failed' || run.status === 'partial'
                  ? `admin-run-item admin-run-item--${run.status}`
                  : 'admin-run-item'
              }
              key={run.id}
            >
              <div className="admin-run-item-heading">
                <Badge tone={runStatusTone(run.status)}>{label(run.status)}</Badge>
                <span>{label(run.trigger)}</span>
                <time dateTime={run.startedAt}>{timestamp(run.startedAt)}</time>
              </div>
              <dl className="admin-run-item-facts">
                <div>
                  <dt>Duration</dt>
                  <dd>{duration(run.durationMs)}</dd>
                </div>
                <div>
                  <dt>Fetched</dt>
                  <dd>{count(run.fetchedCount)}</dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>{count(run.createdCount)}</dd>
                </div>
                <div>
                  <dt>Updated</dt>
                  <dd>{count(run.updatedCount)}</dd>
                </div>
                <div>
                  <dt>Merged</dt>
                  <dd>{count(run.mergedCount)}</dd>
                </div>
                <div>
                  <dt>Skipped</dt>
                  <dd>{count(run.skippedCount)}</dd>
                </div>
                <div>
                  <dt>Rejected</dt>
                  <dd>{count(run.rejectedCount)}</dd>
                </div>
                <div>
                  <dt>Error code</dt>
                  <dd>{text(run.errorCode)}</dd>
                </div>
              </dl>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export default async function AdminIngestionPage() {
  const { session } = await requireAdminPermission('job_sources.read');
  const result = await createAuthenticatedApiClient(session).adminIngestionHealth({ runLimit: 25 });
  const { totals, sources, recentRuns } = result.data;
  return (
    <div className="workspace-page">
      <PageHeader
        actions={<Badge tone="neutral">{count(recentRuns.length)} recent runs</Badge>}
        description="Provider health, the last runs across the whole ingestion fleet, and the canonical job totals. Evaluated at the time shown in each section."
        eyebrow="Job operations"
        title="Ingestion Health"
      />
      <section
        aria-label="Canonical job totals"
        className="admin-metric-grid admin-metric-grid--six"
      >
        <Card className="admin-metric-card">
          <Briefcase aria-hidden="true" size={22} />
          <span>Active jobs</span>
          <strong>{count(totals.activeJobs)}</strong>
        </Card>
        <Card className="admin-metric-card">
          <Layers aria-hidden="true" size={22} />
          <span>Stale jobs</span>
          <strong>{count(totals.staleJobs)}</strong>
        </Card>
        <Card className="admin-metric-card">
          <TriangleAlert aria-hidden="true" size={22} />
          <span>Expired jobs</span>
          <strong>{count(totals.expiredJobs)}</strong>
        </Card>
        <Card className="admin-metric-card">
          <Building2 aria-hidden="true" size={22} />
          <span>Companies</span>
          <strong>{count(totals.companies)}</strong>
        </Card>
        <Card className="admin-metric-card">
          <Boxes aria-hidden="true" size={22} />
          <span>Source records</span>
          <strong>{count(totals.sourceRecords)}</strong>
        </Card>
        <Card className="admin-metric-card">
          <CopyCheck aria-hidden="true" size={22} />
          <span>Open dedup candidates</span>
          <strong>{count(totals.openDeduplicationCandidates)}</strong>
        </Card>
      </section>
      <Alert title="What a partial run means" tone="warning">
        A partial run means some postings were rejected by validation or a write failed partway
        through, and the fetched, created, updated, merged, skipped, and rejected counts on that run
        show exactly how many of each.
      </Alert>
      <Card className="admin-detail-card">
        <div className="admin-detail-heading">
          <Activity aria-hidden="true" size={22} />
          <h2>Recent runs across all providers</h2>
        </div>
        <p className="admin-section-copy">
          The newest {count(recentRuns.length)} runs recorded by the worker, evaluated at{' '}
          {timestamp(result.data.evaluatedAt)}. Failed and partial runs are highlighted.
        </p>
        {recentRuns.length === 0 ? (
          <EmptyState
            description="The worker has not recorded an ingestion run in this environment yet."
            eyebrow="Ingestion runs"
            icon={<Activity aria-hidden="true" size={23} />}
            title="No runs recorded"
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <TableHeaderCell>Source</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Started</TableHeaderCell>
                <TableHeaderCell>Duration</TableHeaderCell>
                <TableHeaderCell>Created</TableHeaderCell>
                <TableHeaderCell>Error code</TableHeaderCell>
              </tr>
            </thead>
            <tbody>
              {recentRuns.map((run) => (
                <RunRow
                  createdCount={run.createdCount}
                  durationMs={run.durationMs}
                  errorCode={run.errorCode}
                  key={run.id}
                  sourceCode={run.sourceCode}
                  startedAt={run.startedAt}
                  status={run.status}
                />
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <section aria-label="Provider health" className="admin-source-list">
        {sources.length === 0 ? (
          <EmptyState
            description="No provider is catalogued, so there is no health to report."
            eyebrow="Provider health"
            icon={<Activity aria-hidden="true" size={23} />}
            title="No providers"
          />
        ) : (
          sources.map((source) => <ProviderHealthCard key={source.sourceId} source={source} />)
        )}
      </section>
    </div>
  );
}
