import { HanaplyApiError, type AdminPaymentMethodDetail } from '@hanaply/contracts';
import {
  Badge,
  Card,
  LinkButton,
  PageHeader,
  Table,
  TableCell,
  TableHeaderCell,
} from '@hanaply/ui';
import Image from 'next/image';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { PaymentMethodActions } from '@/components/payment-method-actions';
import { PreviewDialog } from '@/components/preview-dialog';
import { createAuthenticatedApiClient, requireAdminPermission } from '@/lib/session';

export const metadata: Metadata = { title: 'Payment Method Detail' };

export default async function PaymentMethodDetailPage({
  params,
}: {
  params: Promise<{ paymentMethodId: string }>;
}) {
  const { paymentMethodId } = await params;
  const { session, admin } = await requireAdminPermission('payment_methods.read');
  let method: AdminPaymentMethodDetail;
  try {
    method = (await createAuthenticatedApiClient(session).adminPaymentMethod(paymentMethodId)).data;
  } catch (error) {
    if (error instanceof HanaplyApiError && error.status === 404) notFound();
    throw error;
  }
  const qrImage = method.qrCodeUrl ? (
    <Image
      alt={`Private QR preview for ${method.displayName}`}
      className="admin-payment-qr-image"
      height={640}
      src={method.qrCodeUrl}
      unoptimized
      width={640}
    />
  ) : null;
  return (
    <div className="workspace-page">
      <PageHeader
        actions={
          admin.permissions.includes('payment_methods.manage') && !method.archivedAt ? (
            <LinkButton href={`/admin/payment-methods/${method.id}/edit`}>Edit Method</LinkButton>
          ) : (
            <Badge tone="neutral">Read only</Badge>
          )
        }
        description="Review customer-facing instructions, private operational state, QR configuration, and immutable version history."
        eyebrow="Payment operations"
        title={method.displayName}
      />
      <div className="admin-detail-grid">
        <Card className="admin-detail-card">
          <div className="admin-detail-heading">
            <h2>Customer configuration</h2>
          </div>
          <dl>
            <div>
              <dt>Status</dt>
              <dd>
                <Badge
                  tone={method.archivedAt ? 'neutral' : method.enabled ? 'success' : 'warning'}
                >
                  {method.archivedAt ? 'Archived' : method.enabled ? 'Enabled' : 'Disabled'}
                </Badge>
              </dd>
            </div>
            <div>
              <dt>Type</dt>
              <dd>{method.methodType.replaceAll('_', ' ')}</dd>
            </div>
            <div>
              <dt>Account holder</dt>
              <dd>{method.accountHolderName ?? 'Not set'}</dd>
            </div>
            <div>
              <dt>Account identifier</dt>
              <dd>{method.accountIdentifier ?? 'Not set'}</dd>
            </div>
            <div>
              <dt>Bank</dt>
              <dd>{method.bankName ?? 'Not set'}</dd>
            </div>
            <div>
              <dt>Public instructions</dt>
              <dd className="admin-payment-prewrap">{method.publicInstructions}</dd>
            </div>
            <div>
              <dt>Public notes</dt>
              <dd>{method.publicNotes ?? 'None'}</dd>
            </div>
          </dl>
        </Card>
        <Card className="admin-detail-card">
          <div className="admin-detail-heading">
            <h2>Operations</h2>
          </div>
          <dl>
            <div>
              <dt>Version</dt>
              <dd>v{method.version}</dd>
            </div>
            <div>
              <dt>Display order</dt>
              <dd>{method.displayOrder}</dd>
            </div>
            <div>
              <dt>QR version</dt>
              <dd>{method.qrCodeVersion || 'None'}</dd>
            </div>
            <div>
              <dt>Minimum</dt>
              <dd>
                {method.minimumAmountMinor
                  ? `₱${(method.minimumAmountMinor / 100).toLocaleString('en-PH')}`
                  : 'None'}
              </dd>
            </div>
            <div>
              <dt>Maximum</dt>
              <dd>
                {method.maximumAmountMinor
                  ? `₱${(method.maximumAmountMinor / 100).toLocaleString('en-PH')}`
                  : 'None'}
              </dd>
            </div>
            <div>
              <dt>Private notes</dt>
              <dd className="admin-payment-prewrap">{method.privateNotes ?? 'None'}</dd>
            </div>
          </dl>
          {qrImage ? (
            <div className="admin-payment-qr">
              <h3>Private QR preview</h3>
              {qrImage}
              <PreviewDialog description="Large permissioned QR preview." title="payment method QR">
                {qrImage}
              </PreviewDialog>
            </div>
          ) : null}
        </Card>
      </div>
      {admin.permissions.includes('payment_methods.manage') ? (
        <PaymentMethodActions method={method} />
      ) : null}
      <section className="admin-payment-history">
        <h2>Version history</h2>
        <Table>
          <thead>
            <tr>
              <TableHeaderCell>Version</TableHeaderCell>
              <TableHeaderCell>Change</TableHeaderCell>
              <TableHeaderCell>Changed by</TableHeaderCell>
              <TableHeaderCell>Created</TableHeaderCell>
            </tr>
          </thead>
          <tbody>
            {method.versions.map((version) => (
              <tr key={version.id}>
                <TableCell>v{version.version}</TableCell>
                <TableCell>{version.changeType.replaceAll('_', ' ')}</TableCell>
                <TableCell>{version.changedBy ?? 'System'}</TableCell>
                <TableCell>{new Date(version.createdAt).toLocaleString('en-PH')}</TableCell>
              </tr>
            ))}
          </tbody>
        </Table>
      </section>
    </div>
  );
}
