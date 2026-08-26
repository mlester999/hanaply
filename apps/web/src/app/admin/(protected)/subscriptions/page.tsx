import { subscriptionStatusSchema } from '@hanaply/contracts';
import {
  Badge,
  EmptyState,
  LinkButton,
  PageHeader,
  Table,
  TableCell,
  TableHeaderCell,
} from '@hanaply/ui';
import { Search, ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { createAuthenticatedApiClient, requireAdminPermission } from '@/lib/session';

export const metadata: Metadata = { title: 'Subscriptions' };

interface SubscriptionSearchParams {
  status?: string;
  planCode?: string;
  userSearch?: string;
  expiringBefore?: string;
  page?: string;
}

function tone(status: string) {
  if (status === 'active') return 'success' as const;
  if (status === 'pending_activation' || status === 'grace_period') return 'warning' as const;
  if (status === 'reversed' || status === 'suspended') return 'danger' as const;
  return 'neutral' as const;
}

function showDate(value: string | null) {
  return value
    ? new Date(value).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })
    : 'No fixed end';
}

function expiryTimestamp(value: string | undefined): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return undefined;
  const parsed = new Date(`${value}T23:59:59+08:00`);
  return Number.isNaN(parsed.valueOf()) ? undefined : parsed.toISOString();
}

function pageHref(values: SubscriptionSearchParams, page: number) {
  const query = new URLSearchParams();
  for (const key of ['status', 'planCode', 'userSearch', 'expiringBefore'] as const) {
    const value = values[key];
    if (value) query.set(key, value);
  }
  query.set('page', String(page));
  return `/admin/subscriptions?${query.toString()}`;
}

export default async function AdminSubscriptionsPage({
  searchParams,
}: {
  searchParams: Promise<SubscriptionSearchParams>;
}) {
  const values = await searchParams;
  const { session } = await requireAdminPermission('subscriptions.read');
  const client = createAuthenticatedApiClient(session);
  const requestedPage = Number.parseInt(values.page ?? '1', 10);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const status = subscriptionStatusSchema.safeParse(values.status);
  const expiringBefore = expiryTimestamp(values.expiringBefore);
  const [directory, plans] = await Promise.all([
    client.adminSubscriptions({
      page,
      pageSize: 25,
      ...(status.success ? { status: status.data } : {}),
      ...(values.planCode?.trim() ? { planCode: values.planCode.trim() } : {}),
      ...(values.userSearch?.trim() ? { userSearch: values.userSearch.trim() } : {}),
      ...(expiringBefore ? { expiringBefore } : {}),
    }),
    client.plans(),
  ]);
  return (
    <div className="workspace-page">
      <PageHeader
        actions={<Badge tone="brand">{directory.data.pagination.total} subscriptions</Badge>}
        description="Inspect authoritative access windows, lifecycle history, and controlled corrections."
        eyebrow="Access operations"
        title="Subscriptions"
      />
      <form
        action="/admin/subscriptions"
        className="admin-filter-panel admin-subscription-filter"
        method="get"
      >
        <label className="admin-search-field" htmlFor="subscriptionUserSearch">
          <span>User search</span>
          <div>
            <Search aria-hidden="true" size={18} />
            <input
              defaultValue={values.userSearch ?? ''}
              id="subscriptionUserSearch"
              maxLength={120}
              name="userSearch"
              placeholder="Email or name"
              type="search"
            />
          </div>
        </label>
        <label htmlFor="subscriptionStatus">
          <span>Status</span>
          <select
            defaultValue={status.success ? status.data : ''}
            id="subscriptionStatus"
            name="status"
          >
            <option value="">All</option>
            {subscriptionStatusSchema.options.map((option) => (
              <option key={option} value={option}>
                {option.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="subscriptionPlan">
          <span>Plan</span>
          <select defaultValue={values.planCode ?? ''} id="subscriptionPlan" name="planCode">
            <option value="">All</option>
            {plans.data.map((plan) => (
              <option key={plan.code} value={plan.code}>
                {plan.name} {plan.billingPeriod}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="subscriptionExpiry">
          <span>Ends on or before</span>
          <input
            defaultValue={values.expiringBefore ?? ''}
            id="subscriptionExpiry"
            name="expiringBefore"
            type="date"
          />
        </label>
        <button className="h-button h-button--primary h-button--md" type="submit">
          Apply Filters
        </button>
      </form>
      {directory.data.items.length === 0 ? (
        <EmptyState
          description="No subscription matched the current directory filters."
          eyebrow="Subscription directory"
          icon={<ShieldCheck aria-hidden="true" size={24} />}
          title="No matching subscriptions"
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <TableHeaderCell>Customer</TableHeaderCell>
              <TableHeaderCell>Plan</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Access window</TableHeaderCell>
              <TableHeaderCell>Source</TableHeaderCell>
              <TableHeaderCell>Version</TableHeaderCell>
              <TableHeaderCell>Action</TableHeaderCell>
            </tr>
          </thead>
          <tbody>
            {directory.data.items.map((subscription) => (
              <tr key={subscription.id}>
                <TableCell>
                  <strong>{subscription.userId.slice(0, 8)}</strong>
                  <small className="admin-table-secondary">{subscription.userId}</small>
                </TableCell>
                <TableCell>
                  <strong>{subscription.planCode.replaceAll('_', ' ')}</strong>
                  <small className="admin-table-secondary">{subscription.billingPeriod}</small>
                </TableCell>
                <TableCell>
                  <Badge tone={tone(subscription.status)}>
                    {subscription.status.replaceAll('_', ' ')}
                  </Badge>
                </TableCell>
                <TableCell>
                  {showDate(subscription.startsAt)}
                  <small className="admin-table-secondary">
                    to {showDate(subscription.endsAt)}
                  </small>
                </TableCell>
                <TableCell>{subscription.source.replaceAll('_', ' ')}</TableCell>
                <TableCell>v{subscription.version}</TableCell>
                <TableCell>
                  <Link href={`/admin/subscriptions/${subscription.id}`}>View details</Link>
                </TableCell>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <nav aria-label="Subscription pagination" className="admin-pagination">
        {directory.data.pagination.page > 1 ? (
          <LinkButton
            href={pageHref(values, directory.data.pagination.page - 1)}
            size="sm"
            variant="secondary"
          >
            Previous
          </LinkButton>
        ) : (
          <span />
        )}
        <span>
          Page {directory.data.pagination.page} of{' '}
          {Math.max(directory.data.pagination.totalPages, 1)}
        </span>
        {directory.data.pagination.page < directory.data.pagination.totalPages ? (
          <LinkButton
            href={pageHref(values, directory.data.pagination.page + 1)}
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
