import { paymentSubmissionStatusSchema } from '@hanaply/contracts';
import {
  Badge,
  EmptyState,
  LinkButton,
  PageHeader,
  Table,
  TableCell,
  TableHeaderCell,
} from '@hanaply/ui';
import { ReceiptText, Search } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { createAuthenticatedApiClient, requireAdminPermission } from '@/lib/session';

export const metadata: Metadata = { title: 'Payment Reviews' };

interface PaymentSearchParams {
  status?: string;
  billingPeriod?: string;
  paymentMethodId?: string;
  amount?: string;
  userSearch?: string;
  duplicateReference?: string;
  duplicateProof?: string;
  page?: string;
}

function tone(status: string) {
  if (status === 'approved') return 'success' as const;
  if (status === 'rejected' || status === 'reversed') return 'danger' as const;
  if (status === 'needs_information' || status === 'refunded') return 'warning' as const;
  if (status === 'submitted' || status === 'under_review' || status === 'resubmitted')
    return 'brand' as const;
  return 'neutral' as const;
}

function pageHref(values: PaymentSearchParams, page: number) {
  const query = new URLSearchParams();
  for (const key of [
    'status',
    'billingPeriod',
    'paymentMethodId',
    'amount',
    'userSearch',
    'duplicateReference',
    'duplicateProof',
  ] as const) {
    const value = values[key];
    if (value) query.set(key, value);
  }
  query.set('page', String(page));
  return `/admin/payments?${query.toString()}`;
}

export default async function AdminPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<PaymentSearchParams>;
}) {
  const values = await searchParams;
  const { session } = await requireAdminPermission('payments.read');
  const client = createAuthenticatedApiClient(session);
  const requestedPage = Number.parseInt(values.page ?? '1', 10);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const status = paymentSubmissionStatusSchema.safeParse(values.status);
  const amountPesos = values.amount ? Number(values.amount) : Number.NaN;
  const [queue, methods] = await Promise.all([
    client.adminPaymentSubmissions({
      page,
      pageSize: 25,
      ...(status.success ? { status: status.data } : {}),
      ...(values.billingPeriod === 'monthly' || values.billingPeriod === 'annual'
        ? { billingPeriod: values.billingPeriod }
        : {}),
      ...(values.paymentMethodId ? { paymentMethodId: values.paymentMethodId } : {}),
      ...(Number.isFinite(amountPesos) && amountPesos > 0
        ? { amountMinor: Math.round(amountPesos * 100) }
        : {}),
      ...(values.userSearch?.trim() ? { userSearch: values.userSearch.trim() } : {}),
      ...(values.duplicateReference === 'true' ? { duplicateReference: true } : {}),
      ...(values.duplicateProof === 'true' ? { duplicateProof: true } : {}),
    }),
    client.adminPaymentMethods(),
  ]);
  return (
    <div className="workspace-page">
      <PageHeader
        actions={<Badge tone="brand">{queue.data.pagination.total} matching payments</Badge>}
        description="Claim submitted payments, inspect private duplicate signals, and complete one controlled review action at a time."
        eyebrow="Payment operations"
        title="Payment Reviews"
      />
      <form
        action="/admin/payments"
        className="admin-filter-panel admin-payment-filter"
        method="get"
      >
        <label className="admin-search-field" htmlFor="paymentUserSearch">
          <span>User search</span>
          <div>
            <Search aria-hidden="true" size={18} />
            <input
              defaultValue={values.userSearch ?? ''}
              id="paymentUserSearch"
              maxLength={120}
              name="userSearch"
              placeholder="Email or name"
              type="search"
            />
          </div>
        </label>
        <label htmlFor="paymentStatus">
          <span>Status</span>
          <select defaultValue={status.success ? status.data : ''} id="paymentStatus" name="status">
            <option value="">All</option>
            {paymentSubmissionStatusSchema.options.map((option) => (
              <option key={option} value={option}>
                {option.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="paymentBilling">
          <span>Billing</span>
          <select
            defaultValue={values.billingPeriod ?? ''}
            id="paymentBilling"
            name="billingPeriod"
          >
            <option value="">All</option>
            <option value="monthly">Monthly</option>
            <option value="annual">Annual</option>
          </select>
        </label>
        <label htmlFor="paymentMethod">
          <span>Method</span>
          <select
            defaultValue={values.paymentMethodId ?? ''}
            id="paymentMethod"
            name="paymentMethodId"
          >
            <option value="">All</option>
            {methods.data.map((method) => (
              <option key={method.id} value={method.id}>
                {method.displayName}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="paymentAmount">
          <span>Exact amount</span>
          <input
            defaultValue={values.amount ?? ''}
            id="paymentAmount"
            min="0.01"
            name="amount"
            placeholder="PHP"
            step="0.01"
            type="number"
          />
        </label>
        <label htmlFor="duplicateReference">
          <span>Reference warning</span>
          <select
            defaultValue={values.duplicateReference ?? ''}
            id="duplicateReference"
            name="duplicateReference"
          >
            <option value="">All</option>
            <option value="true">Flagged only</option>
          </select>
        </label>
        <label htmlFor="duplicateProof">
          <span>Proof warning</span>
          <select
            defaultValue={values.duplicateProof ?? ''}
            id="duplicateProof"
            name="duplicateProof"
          >
            <option value="">All</option>
            <option value="true">Flagged only</option>
          </select>
        </label>
        <button className="h-button h-button--primary h-button--md" type="submit">
          Apply Filters
        </button>
      </form>
      {queue.data.items.length === 0 ? (
        <EmptyState
          description="No payment matched the current queue filters."
          eyebrow="Review queue"
          icon={<ReceiptText aria-hidden="true" size={24} />}
          title="No matching payments"
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <TableHeaderCell>User</TableHeaderCell>
              <TableHeaderCell>Payment</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Submitted</TableHeaderCell>
              <TableHeaderCell>Warnings</TableHeaderCell>
              <TableHeaderCell>Reviewer</TableHeaderCell>
              <TableHeaderCell>Action</TableHeaderCell>
            </tr>
          </thead>
          <tbody>
            {queue.data.items.map((payment) => (
              <tr key={payment.id}>
                <TableCell>
                  <strong>{payment.user.displayName ?? 'Unnamed user'}</strong>
                  <small className="admin-table-secondary">
                    {payment.user.email ?? payment.user.id}
                  </small>
                </TableCell>
                <TableCell>
                  <strong>₱{(payment.quotedAmountMinor / 100).toLocaleString('en-PH')}</strong>
                  <small className="admin-table-secondary">
                    {payment.planCode.replaceAll('_', ' ')} · {payment.paymentMethod.displayName}
                  </small>
                </TableCell>
                <TableCell>
                  <Badge tone={tone(payment.status)}>{payment.status.replaceAll('_', ' ')}</Badge>
                </TableCell>
                <TableCell>
                  {payment.submittedAt
                    ? new Date(payment.submittedAt).toLocaleString('en-PH')
                    : 'Draft'}
                </TableCell>
                <TableCell>
                  {payment.duplicateReference || payment.duplicateProof ? (
                    <Badge tone="warning">Review flags</Badge>
                  ) : (
                    'None'
                  )}
                </TableCell>
                <TableCell>{payment.reviewerId ?? 'Unclaimed'}</TableCell>
                <TableCell>
                  <Link href={`/admin/payments/${payment.id}`}>Review details</Link>
                </TableCell>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <nav aria-label="Payment review pagination" className="admin-pagination">
        {queue.data.pagination.page > 1 ? (
          <LinkButton
            href={pageHref(values, queue.data.pagination.page - 1)}
            size="sm"
            variant="secondary"
          >
            Previous
          </LinkButton>
        ) : (
          <span />
        )}
        <span>
          Page {queue.data.pagination.page} of {Math.max(queue.data.pagination.totalPages, 1)}
        </span>
        {queue.data.pagination.page < queue.data.pagination.totalPages ? (
          <LinkButton
            href={pageHref(values, queue.data.pagination.page + 1)}
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
