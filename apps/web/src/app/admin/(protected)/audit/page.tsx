import {
  Badge,
  EmptyState,
  LinkButton,
  PageHeader,
  Table,
  TableCell,
  TableHeaderCell,
} from '@hanaply/ui';
import { ClipboardList, Search } from 'lucide-react';
import type { Metadata } from 'next';

import { createAuthenticatedApiClient, requireAdminPermission } from '@/lib/session';

export const metadata: Metadata = { title: 'Audit Events' };

interface AuditSearchParams {
  actorUserId?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  requestId?: string;
  occurredFrom?: string;
  occurredTo?: string;
  page?: string;
}

function validUuid(value: string | undefined): string | undefined {
  return value &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
    ? value
    : undefined;
}

function dateBoundary(value: string | undefined, end: boolean): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return undefined;
  return `${value}T${end ? '23:59:59.999' : '00:00:00.000'}Z`;
}

function pageHref(values: AuditSearchParams, page: number): string {
  const query = new URLSearchParams();
  const filters = [
    ['actorUserId', values.actorUserId],
    ['action', values.action],
    ['targetType', values.targetType],
    ['targetId', values.targetId],
    ['requestId', values.requestId],
    ['occurredFrom', values.occurredFrom],
    ['occurredTo', values.occurredTo],
  ] as const;
  for (const [key, value] of filters) {
    if (value) query.set(key, value);
  }
  query.set('page', String(page));
  return `/admin/audit?${query.toString()}`;
}

function safeContext(value: Readonly<Record<string, unknown>>): string {
  const entries = Object.entries(value);
  if (entries.length === 0) return 'None';
  return entries
    .slice(0, 4)
    .map(([key, item]) => `${key}: ${Array.isArray(item) ? item.join(', ') : String(item)}`)
    .join(' · ');
}

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<AuditSearchParams>;
}) {
  const values = await searchParams;
  const { session } = await requireAdminPermission('audit.read');
  const requestedPage = Number.parseInt(values.page ?? '1', 10);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const actorUserId = validUuid(values.actorUserId);
  const targetId = validUuid(values.targetId);
  const requestId = validUuid(values.requestId);
  const occurredFrom = dateBoundary(values.occurredFrom, false);
  const occurredTo = dateBoundary(values.occurredTo, true);
  const result = await createAuthenticatedApiClient(session).adminAudit({
    page,
    pageSize: 25,
    ...(actorUserId ? { actorUserId } : {}),
    ...(values.action?.trim() ? { action: values.action.trim() } : {}),
    ...(values.targetType?.trim() ? { targetType: values.targetType.trim() } : {}),
    ...(targetId ? { targetId } : {}),
    ...(requestId ? { requestId } : {}),
    ...(occurredFrom ? { occurredFrom } : {}),
    ...(occurredTo ? { occurredTo } : {}),
  });
  return (
    <div className="workspace-page">
      <PageHeader
        actions={<Badge tone="neutral">{result.data.pagination.total} matching events</Badge>}
        description="Inspect append-only operational events with sensitive keys redacted at the API boundary."
        eyebrow="Hanaply administration"
        title="Audit Events"
      />
      <form
        action="/admin/audit"
        className="admin-filter-panel admin-filter-panel--audit"
        method="get"
      >
        <label className="admin-search-field" htmlFor="auditAction">
          <span>Action</span>
          <div>
            <Search aria-hidden="true" size={18} />
            <input
              defaultValue={values.action ?? ''}
              id="auditAction"
              maxLength={120}
              name="action"
              placeholder="user.account_suspended"
            />
          </div>
        </label>
        <label htmlFor="auditActor">
          <span>Actor user ID</span>
          <input defaultValue={values.actorUserId ?? ''} id="auditActor" name="actorUserId" />
        </label>
        <label htmlFor="auditTargetType">
          <span>Target type</span>
          <input
            defaultValue={values.targetType ?? ''}
            id="auditTargetType"
            maxLength={80}
            name="targetType"
          />
        </label>
        <label htmlFor="auditTargetId">
          <span>Target ID</span>
          <input defaultValue={values.targetId ?? ''} id="auditTargetId" name="targetId" />
        </label>
        <label htmlFor="auditRequestId">
          <span>Request ID</span>
          <input defaultValue={values.requestId ?? ''} id="auditRequestId" name="requestId" />
        </label>
        <label htmlFor="auditFrom">
          <span>From</span>
          <input
            defaultValue={values.occurredFrom ?? ''}
            id="auditFrom"
            name="occurredFrom"
            type="date"
          />
        </label>
        <label htmlFor="auditTo">
          <span>To</span>
          <input
            defaultValue={values.occurredTo ?? ''}
            id="auditTo"
            name="occurredTo"
            type="date"
          />
        </label>
        <button className="h-button h-button--primary h-button--md" type="submit">
          Apply Filters
        </button>
      </form>
      {result.data.items.length === 0 ? (
        <EmptyState
          description="No safe audit event matched these filters."
          eyebrow="No results"
          icon={<ClipboardList aria-hidden="true" size={23} />}
          title="No matching audit events"
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <TableHeaderCell>Time</TableHeaderCell>
              <TableHeaderCell>Action</TableHeaderCell>
              <TableHeaderCell>Actor</TableHeaderCell>
              <TableHeaderCell>Target</TableHeaderCell>
              <TableHeaderCell>Safe context</TableHeaderCell>
              <TableHeaderCell>Request ID</TableHeaderCell>
            </tr>
          </thead>
          <tbody>
            {result.data.items.map((event) => (
              <tr key={event.id}>
                <TableCell>{new Date(event.createdAt).toLocaleString('en-PH')}</TableCell>
                <TableCell>
                  <strong>{event.action}</strong>
                </TableCell>
                <TableCell>{event.actorUserId ?? event.actorType}</TableCell>
                <TableCell>
                  {event.targetType}
                  <small className="admin-table-secondary">
                    {event.targetId ?? 'No target ID'}
                  </small>
                </TableCell>
                <TableCell className="admin-audit-context">{safeContext(event.metadata)}</TableCell>
                <TableCell>{event.requestId ?? 'Not recorded'}</TableCell>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <nav aria-label="Audit pagination" className="admin-pagination">
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
