import type { AdminJobSource } from '@hanaply/contracts';
import { Alert, Badge, Card, EmptyState, PageHeader } from '@hanaply/ui';
import { Cable, CircleCheck, ExternalLink, TriangleAlert } from 'lucide-react';
import type { Metadata } from 'next';

import { AdminJobSourceActions } from '@/components/admin-job-source-actions';
import { count, interval, label, sourceStatusTone, text, timestamp } from '@/lib/admin-jobs-format';
import { createAuthenticatedApiClient, requireAdminPermission } from '@/lib/session';

export const metadata: Metadata = { title: 'Job Sources' };

function credentialState(source: AdminJobSource): {
  tone: 'success' | 'warning' | 'neutral';
  copy: string;
} {
  if (!source.requiresCredentials) {
    return { tone: 'neutral', copy: 'Not required' };
  }
  if (source.credentialConfigured === true) {
    return { tone: 'success', copy: 'Secret confirmed present' };
  }
  if (source.credentialConfigured === false) {
    return { tone: 'warning', copy: 'No variable named yet' };
  }
  // credentialConfigured is null whenever the variable name is known but the
  // secret itself can only be observed by the worker process, never the database.
  return {
    tone: 'neutral',
    copy: `Cannot be determined from the browser. The worker reads ${source.credentialEnvVar ?? 'the named environment variable'} at scan time.`,
  };
}

export default async function AdminJobSourcesPage() {
  const { admin, session } = await requireAdminPermission('job_sources.read');
  const result = await createAuthenticatedApiClient(session).adminJobSources();
  const canManage = admin.permissions.includes('job_sources.manage');
  return (
    <div className="workspace-page">
      <PageHeader
        actions={<Badge tone="neutral">{result.data.items.length} providers</Badge>}
        description="Every provider in the ingestion catalogue with its credential requirement, attribution terms, cadence, health, and due state. Directory evaluated at the time shown below."
        eyebrow="Job operations"
        title="Job Sources"
      />
      <Alert title="Catalogued at" tone="info">
        The directory was evaluated at {timestamp(result.data.evaluatedAt)}. Health values change as
        the worker runs, so reload before acting on a stale reading.
      </Alert>
      {result.data.items.length === 0 ? (
        <EmptyState
          description="No provider has been catalogued in this environment yet."
          eyebrow="Provider catalogue"
          icon={<Cable aria-hidden="true" size={23} />}
          title="No job sources"
        />
      ) : (
        <div className="admin-source-list">
          {result.data.items.map((source) => {
            const credential = credentialState(source);
            return (
              <Card className="admin-source-card" key={source.id}>
                <div className="admin-source-summary">
                  <div className="admin-detail-heading">
                    <Cable aria-hidden="true" size={22} />
                    <div>
                      <h2>{source.displayName}</h2>
                      <p className="admin-source-code">{source.code}</p>
                    </div>
                  </div>
                  <div className="admin-source-badges">
                    <Badge tone={sourceStatusTone(source.status)}>{label(source.status)}</Badge>
                    <Badge tone="neutral">{label(source.sourceKind)}</Badge>
                    <Badge tone={source.due ? 'brand' : 'neutral'}>
                      {source.due ? 'Due for a scan' : 'Not due'}
                    </Badge>
                    {source.circuitOpenUntil ? <Badge tone="danger">Circuit open</Badge> : null}
                  </div>
                </div>
                <dl className="admin-source-facts">
                  <div>
                    <dt>Base URL</dt>
                    <dd className="admin-source-mono">{text(source.baseUrl)}</dd>
                  </div>
                  <div>
                    <dt>Credentials</dt>
                    <dd>
                      <Badge tone={credential.tone}>{credential.copy}</Badge>
                      {source.requiresCredentials ? (
                        <small className="admin-table-secondary">
                          Variable name: {text(source.credentialEnvVar)}
                        </small>
                      ) : null}
                    </dd>
                  </div>
                  <div>
                    <dt>Attribution</dt>
                    <dd>
                      {text(source.attribution)}
                      {source.termsUrl ? (
                        <>
                          {' '}
                          <a
                            className="admin-source-terms"
                            href={source.termsUrl}
                            rel="noreferrer noopener"
                            target="_blank"
                          >
                            Terms
                            <ExternalLink aria-hidden="true" size={14} />
                          </a>
                        </>
                      ) : (
                        <small className="admin-table-secondary">No terms link recorded.</small>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Minimum scan interval</dt>
                    <dd>
                      {interval(source.minScanIntervalMinutes)}
                      <small className="admin-table-secondary">
                        {count(source.requestsPerMinute)} requests/min · batch{' '}
                        {count(source.batchSize)}
                      </small>
                    </dd>
                  </div>
                  <div>
                    <dt>Source records</dt>
                    <dd>
                      {count(source.jobCount)}
                      <small className="admin-table-secondary">
                        {count(source.totalJobsIngested)} ingested all time
                      </small>
                    </dd>
                  </div>
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
                    <dt>Consecutive failures</dt>
                    <dd>
                      {count(source.consecutiveFailures)}
                      <small className="admin-table-secondary">
                        Circuit open until: {timestamp(source.circuitOpenUntil)}
                      </small>
                    </dd>
                  </div>
                </dl>
                {source.lastErrorCode ? (
                  <Alert
                    icon={<TriangleAlert aria-hidden="true" size={18} />}
                    title="Most recent failure"
                    tone="warning"
                  >
                    The last scan reported {source.lastErrorCode}. Consecutive failures:{' '}
                    {count(source.consecutiveFailures)}.
                  </Alert>
                ) : (
                  <Alert
                    icon={<CircleCheck aria-hidden="true" size={18} />}
                    title="No recorded failure"
                    tone="success"
                  >
                    No error code is stored for this provider.
                  </Alert>
                )}
                <AdminJobSourceActions canManage={canManage} source={source} />
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
