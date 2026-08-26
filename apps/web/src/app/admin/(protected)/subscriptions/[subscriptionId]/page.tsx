import { HanaplyApiError } from '@hanaply/contracts';
import { Alert, Badge, Card, PageHeader, Table, TableCell, TableHeaderCell } from '@hanaply/ui';
import { CalendarClock, KeyRound, UserRound } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { SubscriptionCorrectionForm } from '@/components/subscription-correction-form';
import { createAuthenticatedApiClient, requireAdminPermission } from '@/lib/session';

export const metadata: Metadata = { title: 'Subscription Detail' };

function showDate(value: string | null) {
  return value
    ? new Date(value).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })
    : 'No fixed end';
}

function tone(status: string) {
  if (status === 'active') return 'success' as const;
  if (status === 'pending_activation' || status === 'grace_period') return 'warning' as const;
  if (status === 'reversed' || status === 'suspended') return 'danger' as const;
  return 'neutral' as const;
}

export default async function AdminSubscriptionDetailPage({
  params,
}: {
  params: Promise<{ subscriptionId: string }>;
}) {
  const { subscriptionId } = await params;
  const { session, admin } = await requireAdminPermission('subscriptions.read');
  const client = createAuthenticatedApiClient(session);
  let subscription;
  try {
    subscription = (await client.adminSubscription(subscriptionId)).data;
  } catch (error) {
    if (error instanceof HanaplyApiError && error.status === 404) notFound();
    throw error;
  }
  const audit = admin.permissions.includes('audit.read')
    ? await client
        .adminAudit({ targetId: subscriptionId, page: 1, pageSize: 25 })
        .then((result) => result.data.items)
        .catch(() => [])
    : [];
  const accessActive = subscription.entitlements.subscriptionStatus === 'active';
  return (
    <div className="workspace-page">
      <PageHeader
        actions={
          <Badge tone={tone(subscription.status)}>{subscription.status.replaceAll('_', ' ')}</Badge>
        }
        description="Authoritative subscription record, evaluated entitlements, and append-only lifecycle history."
        eyebrow="Access operations"
        title={subscription.planCode.replaceAll('_', ' ')}
      />
      <div className="admin-detail-grid subscription-detail-grid">
        <Card className="admin-detail-card">
          <div className="admin-detail-heading">
            <CalendarClock aria-hidden="true" size={22} />
            <h2>Access window</h2>
          </div>
          <dl>
            <div>
              <dt>Subscription ID</dt>
              <dd className="payment-checksum">{subscription.id}</dd>
            </div>
            <div>
              <dt>Starts</dt>
              <dd>{showDate(subscription.startsAt)}</dd>
            </div>
            <div>
              <dt>Ends</dt>
              <dd>{showDate(subscription.endsAt)}</dd>
            </div>
            <div>
              <dt>Billing</dt>
              <dd>{subscription.billingPeriod}</dd>
            </div>
            <div>
              <dt>Tier</dt>
              <dd>{subscription.tierCode}</dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>{subscription.source.replaceAll('_', ' ')}</dd>
            </div>
            <div>
              <dt>Version</dt>
              <dd>v{subscription.version}</dd>
            </div>
            <div>
              <dt>Updated</dt>
              <dd>{showDate(subscription.updatedAt)}</dd>
            </div>
          </dl>
        </Card>
        <Card className="admin-detail-card">
          <div className="admin-detail-heading">
            <UserRound aria-hidden="true" size={22} />
            <h2>Customer</h2>
          </div>
          <dl>
            <div>
              <dt>User ID</dt>
              <dd className="payment-checksum">{subscription.userId}</dd>
            </div>
            <div>
              <dt>Directory</dt>
              <dd>
                {admin.permissions.includes('users.read') ? (
                  <Link href={`/admin/users/${subscription.userId}`}>Open user record</Link>
                ) : (
                  'User directory permission required'
                )}
              </dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{showDate(subscription.createdAt)}</dd>
            </div>
          </dl>
        </Card>
        <Card className="admin-detail-card">
          <div className="admin-detail-heading">
            <KeyRound aria-hidden="true" size={22} />
            <h2>Evaluated entitlements</h2>
          </div>
          <dl>
            <div>
              <dt>Access evaluation</dt>
              <dd>
                <Badge tone={accessActive ? 'success' : 'neutral'}>
                  {accessActive ? 'Active' : 'Inactive'}
                </Badge>
              </dd>
            </div>
            <div>
              <dt>Valid from</dt>
              <dd>{showDate(subscription.entitlements.validFrom)}</dd>
            </div>
            <div>
              <dt>Valid until</dt>
              <dd>{showDate(subscription.entitlements.validUntil)}</dd>
            </div>
            {Object.entries(subscription.entitlements.entitlements).map(([key, value]) => (
              <div key={key}>
                <dt>{key.replaceAll('_', ' ')}</dt>
                <dd>{String(value)}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>
      {admin.permissions.includes('subscriptions.manage') ? (
        <SubscriptionCorrectionForm
          canRestoreReversed={admin.permissions.includes('security.manage')}
          subscription={subscription}
        />
      ) : (
        <Alert title="Read-only subscription" tone="info">
          Subscription management permission is required for a controlled correction.
        </Alert>
      )}
      <Card className="payment-review-timeline-card">
        <h2>Append-only subscription history</h2>
        <ol className="activation-timeline">
          {subscription.events.map((event) => (
            <li key={event.id}>
              <span />
              <div>
                <strong>{event.eventType.replaceAll('.', ' ').replaceAll('_', ' ')}</strong>
                <time dateTime={event.createdAt}>{showDate(event.createdAt)}</time>
                <p>Effective {showDate(event.effectiveAt)}</p>
                {event.reason ? <p>{event.reason}</p> : null}
              </div>
            </li>
          ))}
        </ol>
      </Card>
      {admin.permissions.includes('audit.read') ? (
        <section className="admin-payment-history">
          <h2>Related audit events</h2>
          {audit.length ? (
            <Table>
              <thead>
                <tr>
                  <TableHeaderCell>Action</TableHeaderCell>
                  <TableHeaderCell>Actor</TableHeaderCell>
                  <TableHeaderCell>Request</TableHeaderCell>
                  <TableHeaderCell>Created</TableHeaderCell>
                </tr>
              </thead>
              <tbody>
                {audit.map((event) => (
                  <tr key={event.id}>
                    <TableCell>{event.action}</TableCell>
                    <TableCell>{event.actorUserId ?? event.actorType}</TableCell>
                    <TableCell>{event.requestId ?? 'None'}</TableCell>
                    <TableCell>{showDate(event.createdAt)}</TableCell>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <p>No related audit event is available.</p>
          )}
        </section>
      ) : null}
    </div>
  );
}
