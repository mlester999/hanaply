import { accountStatusSchema } from '@hanaply/contracts';
import {
  Badge,
  EmptyState,
  LinkButton,
  PageHeader,
  Table,
  TableCell,
  TableHeaderCell,
} from '@hanaply/ui';
import { Search, UsersRound } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { createAuthenticatedApiClient, requireAdminPermission } from '@/lib/session';

export const metadata: Metadata = { title: 'User Directory' };

interface DirectorySearchParams {
  search?: string;
  verification?: string;
  accountStatus?: string;
  createdFrom?: string;
  createdTo?: string;
  page?: string;
}

function startOfDay(value: string | undefined): string | undefined {
  return value && /^\d{4}-\d{2}-\d{2}$/u.test(value) ? `${value}T00:00:00.000Z` : undefined;
}

function endOfDay(value: string | undefined): string | undefined {
  return value && /^\d{4}-\d{2}-\d{2}$/u.test(value) ? `${value}T23:59:59.999Z` : undefined;
}

function statusTone(status: string): 'success' | 'warning' | 'danger' | 'neutral' {
  if (status === 'active') return 'success';
  if (status === 'suspended') return 'warning';
  if (status === 'disabled') return 'danger';
  return 'neutral';
}

function pageHref(values: DirectorySearchParams, page: number): string {
  const query = new URLSearchParams();
  const filters = [
    ['search', values.search],
    ['verification', values.verification],
    ['accountStatus', values.accountStatus],
    ['createdFrom', values.createdFrom],
    ['createdTo', values.createdTo],
  ] as const;
  for (const [key, value] of filters) {
    if (value) query.set(key, value);
  }
  query.set('page', String(page));
  return `/admin/users?${query.toString()}`;
}

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<DirectorySearchParams>;
}) {
  const values = await searchParams;
  const { session } = await requireAdminPermission('users.read');
  const verification = ['verified', 'unverified'].includes(values.verification ?? '')
    ? (values.verification as 'verified' | 'unverified')
    : 'all';
  const accountStatus = accountStatusSchema.safeParse(values.accountStatus);
  const requestedPage = Number.parseInt(values.page ?? '1', 10);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const result = await createAuthenticatedApiClient(session).adminUsers({
    verification,
    page,
    pageSize: 25,
    ...(values.search?.trim() ? { search: values.search.trim() } : {}),
    ...(accountStatus.success ? { accountStatus: accountStatus.data } : {}),
    ...(startOfDay(values.createdFrom) ? { createdFrom: startOfDay(values.createdFrom) } : {}),
    ...(endOfDay(values.createdTo) ? { createdTo: endOfDay(values.createdTo) } : {}),
  });

  return (
    <div className="workspace-page">
      <PageHeader
        actions={<Badge tone="neutral">{result.data.pagination.total} matching users</Badge>}
        description="Search verified identity data and application account state without exposing authentication secrets."
        eyebrow="Hanaply administration"
        title="User Directory"
      />
      <form action="/admin/users" className="admin-filter-panel" method="get">
        <label className="admin-search-field" htmlFor="adminUserSearch">
          <span>Search</span>
          <div>
            <Search aria-hidden="true" size={18} />
            <input
              defaultValue={values.search ?? ''}
              id="adminUserSearch"
              maxLength={120}
              name="search"
              placeholder="Email or name"
              type="search"
            />
          </div>
        </label>
        <label htmlFor="verificationFilter">
          <span>Verification</span>
          <select defaultValue={verification} id="verificationFilter" name="verification">
            <option value="all">All</option>
            <option value="verified">Verified</option>
            <option value="unverified">Unverified</option>
          </select>
        </label>
        <label htmlFor="accountStatusFilter">
          <span>Account status</span>
          <select
            defaultValue={accountStatus.success ? accountStatus.data : ''}
            id="accountStatusFilter"
            name="accountStatus"
          >
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="disabled">Disabled</option>
            <option value="pending_deletion">Pending deletion</option>
          </select>
        </label>
        <label htmlFor="createdFromFilter">
          <span>Created from</span>
          <input
            defaultValue={values.createdFrom ?? ''}
            id="createdFromFilter"
            name="createdFrom"
            type="date"
          />
        </label>
        <label htmlFor="createdToFilter">
          <span>Created to</span>
          <input
            defaultValue={values.createdTo ?? ''}
            id="createdToFilter"
            name="createdTo"
            type="date"
          />
        </label>
        <button className="h-button h-button--primary h-button--md" type="submit">
          Apply Filters
        </button>
      </form>
      {result.data.items.length === 0 ? (
        <EmptyState
          description="No user matched the selected search and account filters."
          eyebrow="No results"
          icon={<UsersRound aria-hidden="true" size={23} />}
          title="No matching users"
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <TableHeaderCell>User</TableHeaderCell>
              <TableHeaderCell>Verification</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Subscription</TableHeaderCell>
              <TableHeaderCell>Created</TableHeaderCell>
              <TableHeaderCell>Action</TableHeaderCell>
            </tr>
          </thead>
          <tbody>
            {result.data.items.map((user) => (
              <tr key={user.userId}>
                <TableCell>
                  <strong>
                    {user.displayName ??
                      ([user.firstName, user.lastName].filter(Boolean).join(' ') || 'Unnamed user')}
                  </strong>
                  <small className="admin-table-secondary">
                    {user.email ?? 'Email unavailable'}
                  </small>
                </TableCell>
                <TableCell>
                  <Badge tone={user.emailVerified ? 'success' : 'warning'}>
                    {user.emailVerified ? 'Verified' : 'Unverified'}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge tone={statusTone(user.accountStatus)}>
                    {user.accountStatus.replaceAll('_', ' ')}
                  </Badge>
                </TableCell>
                <TableCell>{user.subscriptionPlanCode ?? 'None'}</TableCell>
                <TableCell>{new Date(user.createdAt).toLocaleDateString('en-PH')}</TableCell>
                <TableCell>
                  <Link href={`/admin/users/${user.userId}`}>View details</Link>
                </TableCell>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <nav aria-label="User directory pagination" className="admin-pagination">
        {result.data.pagination.page > 1 ? (
          <LinkButton
            href={pageHref(values, result.data.pagination.page - 1)}
            size="sm"
            variant="secondary"
          >
            Previous
          </LinkButton>
        ) : (
          <span />
        )}
        <span>
          Page {result.data.pagination.page} of {Math.max(result.data.pagination.totalPages, 1)}
        </span>
        {result.data.pagination.page < result.data.pagination.totalPages ? (
          <LinkButton
            href={pageHref(values, result.data.pagination.page + 1)}
            size="sm"
            variant="secondary"
          >
            Next
          </LinkButton>
        ) : (
          <span />
        )}
      </nav>
    </div>
  );
}
