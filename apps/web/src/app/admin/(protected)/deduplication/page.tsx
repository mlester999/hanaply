import { Badge, Card, EmptyState, LinkButton, PageHeader } from '@hanaply/ui';
import { CopyCheck } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { AdminDedupActions } from '@/components/admin-dedup-actions';
import { count, label, score, signalEntries, timestamp } from '@/lib/admin-jobs-format';
import { createAuthenticatedApiClient, requireAdminPermission } from '@/lib/session';

export const metadata: Metadata = { title: 'Deduplication' };

interface DedupSearchParams {
  includeResolved?: string;
  page?: string;
}

const PAGE_SIZE = 25;

function pageHref(values: DedupSearchParams, page: number): string {
  const query = new URLSearchParams();
  if (values.includeResolved === 'true') query.set('includeResolved', 'true');
  query.set('page', String(page));
  return `/admin/deduplication?${query.toString()}`;
}

export default async function AdminDeduplicationPage({
  searchParams,
}: {
  searchParams: Promise<DedupSearchParams>;
}) {
  const values = await searchParams;
  const { admin, session } = await requireAdminPermission('jobs.moderate');
  const includeResolved = values.includeResolved === 'true';
  const requestedPage = Number.parseInt(values.page ?? '1', 10);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const result = await createAuthenticatedApiClient(session).adminDedupCandidates({
    includeResolved,
    page,
    pageSize: PAGE_SIZE,
  });
  // The queue reports how many pairs are open, not how many match the filter, so
  // Next is offered only while a full page came back. That never fabricates a
  // total the API did not return.
  const mayHaveNextPage = result.data.items.length === PAGE_SIZE;
  return (
    <div className="workspace-page">
      <PageHeader
        actions={
          <div className="admin-heading-actions">
            <Badge tone={result.data.openCount > 0 ? 'warning' : 'success'}>
              {count(result.data.openCount)} open
            </Badge>
            <Badge tone="neutral">{count(result.data.items.length)} on this page</Badge>
          </div>
        }
        description="Near-duplicate pairs the matching pipeline could not settle on its own. Each decision requires a written reason and is written to the audit trail with your identity."
        eyebrow="Job operations"
        title="Deduplication Review"
      />
      <form
        action="/admin/deduplication"
        className="admin-filter-panel admin-filter-panel--dedup"
        method="get"
      >
        <label htmlFor="includeResolved">
          <span>Resolved pairs</span>
          <select
            defaultValue={includeResolved ? 'true' : 'false'}
            id="includeResolved"
            name="includeResolved"
          >
            <option value="false">Open pairs only</option>
            <option value="true">Include resolved pairs</option>
          </select>
        </label>
        <button className="h-button h-button--primary h-button--md" type="submit">
          Apply Filter
        </button>
      </form>
      <p className="admin-section-copy">
        The queue was evaluated at {timestamp(result.data.evaluatedAt)}.
      </p>
      {result.data.items.length === 0 ? (
        <EmptyState
          description={
            includeResolved
              ? 'No duplication candidate has been recorded for this environment.'
              : 'Nothing is waiting for a decision. Enable the resolved filter to review past decisions.'
          }
          eyebrow="Review queue"
          icon={<CopyCheck aria-hidden="true" size={23} />}
          title={includeResolved ? 'No candidates' : 'No open candidates'}
        />
      ) : (
        <ul className="admin-dedup-list">
          {result.data.items.map((candidate) => (
            <li key={candidate.id}>
              <Card className="admin-dedup-card">
                <div className="admin-dedup-heading">
                  <div>
                    <h2>Similarity score {score(candidate.score)}</h2>
                    <p className="admin-table-secondary">
                      Created {timestamp(candidate.createdAt)}
                      {candidate.resolvedAt
                        ? ` · resolved ${timestamp(candidate.resolvedAt)}`
                        : ' · awaiting a decision'}
                    </p>
                  </div>
                  <Badge tone={candidate.resolution ? 'neutral' : 'warning'}>
                    {candidate.resolution ? label(candidate.resolution) : 'Open'}
                  </Badge>
                </div>
                <div className="admin-dedup-pair">
                  <div className="admin-dedup-side">
                    <span className="admin-dedup-side-label">Surviving record</span>
                    <strong>
                      <Link href={`/admin/jobs/${candidate.jobId}`}>{candidate.jobTitle}</Link>
                    </strong>
                    <small className="admin-table-secondary">{candidate.jobCompany}</small>
                  </div>
                  <div className="admin-dedup-side admin-dedup-side--duplicate">
                    <span className="admin-dedup-side-label">Duplicate record</span>
                    <strong>
                      <Link href={`/admin/jobs/${candidate.duplicateJobId}`}>
                        {candidate.duplicateTitle}
                      </Link>
                    </strong>
                    <small className="admin-table-secondary">
                      {candidate.duplicateCompany} · {count(candidate.duplicateSourceCount)} source
                      {candidate.duplicateSourceCount === 1 ? '' : 's'}
                    </small>
                  </div>
                </div>
                <div className="admin-dedup-signals">
                  <h3 className="admin-section-subheading">Signals</h3>
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
                </div>
                <AdminDedupActions
                  canResolve={admin.permissions.includes('jobs.moderate')}
                  candidate={candidate}
                />
              </Card>
            </li>
          ))}
        </ul>
      )}
      <nav aria-label="Deduplication pagination" className="admin-pagination">
        {page > 1 ? (
          <LinkButton href={pageHref(values, page - 1)} size="sm" variant="secondary">
            Previous
          </LinkButton>
        ) : (
          <span />
        )}
        <span>Page {page}</span>
        {mayHaveNextPage ? (
          <LinkButton href={pageHref(values, page + 1)} size="sm" variant="secondary">
            Next
          </LinkButton>
        ) : (
          <span />
        )}
      </nav>
    </div>
  );
}
