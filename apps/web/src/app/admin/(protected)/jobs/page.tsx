import { jobStatusSchema } from '@hanaply/contracts';
import {
  Badge,
  EmptyState,
  LinkButton,
  PageHeader,
  Table,
  TableCell,
  TableHeaderCell,
} from '@hanaply/ui';
import { Briefcase, Search } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { count, country, dateOnly, jobStatusTone, label, text } from '@/lib/admin-jobs-format';
import { createAuthenticatedApiClient, requireAdminPermission } from '@/lib/session';

export const metadata: Metadata = { title: 'Job Records' };

interface JobDirectorySearchParams {
  search?: string;
  status?: string;
  page?: string;
}

const PAGE_SIZE = 25;

function pageHref(values: JobDirectorySearchParams, page: number): string {
  const query = new URLSearchParams();
  if (values.search) query.set('search', values.search);
  if (values.status) query.set('status', values.status);
  query.set('page', String(page));
  return `/admin/jobs?${query.toString()}`;
}

export default async function AdminJobsPage({
  searchParams,
}: {
  searchParams: Promise<JobDirectorySearchParams>;
}) {
  const values = await searchParams;
  const { session } = await requireAdminPermission('jobs.read');
  const status = jobStatusSchema.safeParse(values.status);
  const requestedPage = Number.parseInt(values.page ?? '1', 10);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const search = values.search?.trim() ?? '';
  const result = await createAuthenticatedApiClient(session).adminJobs({
    page,
    pageSize: PAGE_SIZE,
    ...(search ? { search } : {}),
    ...(status.success ? { status: status.data } : {}),
  });
  const totalPages = Math.max(Math.ceil(result.data.total / result.data.pageSize), 1);
  const currentPage = Math.floor(result.data.pageOffset / result.data.pageSize) + 1;
  return (
    <div className="workspace-page">
      <PageHeader
        actions={<Badge tone="brand">{count(result.data.total)} matching jobs</Badge>}
        description="The internal view of the canonical job table, including titles, companies, and deduplication keys that are never exposed on a customer feed."
        eyebrow="Job operations"
        title="Job Records"
      />
      <form
        action="/admin/jobs"
        className="admin-filter-panel admin-filter-panel--jobs"
        method="get"
      >
        <label className="admin-search-field" htmlFor="adminJobSearch">
          <span>Search</span>
          <div>
            <Search aria-hidden="true" size={18} />
            <input
              defaultValue={search}
              id="adminJobSearch"
              maxLength={120}
              name="search"
              placeholder="Title or company"
              type="search"
            />
          </div>
        </label>
        <label htmlFor="adminJobStatus">
          <span>Status</span>
          <select
            defaultValue={status.success ? status.data : ''}
            id="adminJobStatus"
            name="status"
          >
            <option value="">All</option>
            {jobStatusSchema.options.map((option) => (
              <option key={option} value={option}>
                {label(option)}
              </option>
            ))}
          </select>
        </label>
        <button className="h-button h-button--primary h-button--md" type="submit">
          Apply Filters
        </button>
      </form>
      {result.data.items.length === 0 ? (
        <EmptyState
          description={
            search || status.success
              ? 'No canonical job matched the current search and status filters.'
              : 'The canonical job table is empty. Connect and scan a provider to populate it.'
          }
          eyebrow="Job directory"
          icon={<Briefcase aria-hidden="true" size={23} />}
          title="No matching jobs"
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <TableHeaderCell>Title</TableHeaderCell>
              <TableHeaderCell>Company</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Remote</TableHeaderCell>
              <TableHeaderCell>Country</TableHeaderCell>
              <TableHeaderCell>Sources</TableHeaderCell>
              <TableHeaderCell>Posted</TableHeaderCell>
              <TableHeaderCell>First seen</TableHeaderCell>
            </tr>
          </thead>
          <tbody>
            {result.data.items.map((job) => (
              <tr className="admin-clickable-row" key={job.id}>
                <TableCell>
                  {/*
                    The anchor covers the whole row through CSS so a click anywhere
                    in the row opens the detail page, while the accessible name
                    stays the job title.
                  */}
                  <Link className="admin-row-link" href={`/admin/jobs/${job.id}`}>
                    {job.title}
                  </Link>
                  <small className="admin-table-secondary">{job.dedupKey}</small>
                </TableCell>
                <TableCell>{text(job.companyName)}</TableCell>
                <TableCell>
                  <Badge tone={jobStatusTone(job.status)}>{label(job.status)}</Badge>
                </TableCell>
                <TableCell>{label(job.remoteState)}</TableCell>
                <TableCell>{country(job.countryCode)}</TableCell>
                <TableCell>{count(job.sourceCount)}</TableCell>
                <TableCell>{dateOnly(job.postedAt)}</TableCell>
                <TableCell>{dateOnly(job.firstSeenAt)}</TableCell>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <nav aria-label="Job directory pagination" className="admin-pagination">
        {currentPage > 1 ? (
          <LinkButton href={pageHref(values, currentPage - 1)} size="sm" variant="secondary">
            Previous
          </LinkButton>
        ) : (
          <span />
        )}
        <span>
          Page {currentPage} of {totalPages} · {count(result.data.total)} jobs
        </span>
        {currentPage < totalPages ? (
          <LinkButton href={pageHref(values, currentPage + 1)} size="sm" variant="secondary">
            Next
          </LinkButton>
        ) : (
          <span />
        )}
      </nav>
    </div>
  );
}
