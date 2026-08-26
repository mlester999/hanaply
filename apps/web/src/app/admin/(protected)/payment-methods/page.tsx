import {
  Badge,
  EmptyState,
  LinkButton,
  PageHeader,
  Table,
  TableCell,
  TableHeaderCell,
} from '@hanaply/ui';
import { WalletCards } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { createAuthenticatedApiClient, requireAdminPermission } from '@/lib/session';

export const metadata: Metadata = { title: 'Payment Methods' };

export default async function PaymentMethodsPage() {
  const { session, admin } = await requireAdminPermission('payment_methods.read');
  const methods = (await createAuthenticatedApiClient(session).adminPaymentMethods()).data;
  return (
    <div className="workspace-page">
      <PageHeader
        actions={
          admin.permissions.includes('payment_methods.manage') ? (
            <LinkButton href="/admin/payment-methods/new">New Method</LinkButton>
          ) : (
            <Badge tone="neutral">Read only</Badge>
          )
        }
        description="Manage versioned customer instructions and private QR images without changing historical payment snapshots."
        eyebrow="Payment operations"
        title="Payment Methods"
      />
      {methods.length === 0 ? (
        <EmptyState
          action={
            admin.permissions.includes('payment_methods.manage') ? (
              <LinkButton href="/admin/payment-methods/new">Create First Method</LinkButton>
            ) : undefined
          }
          description="No manual payment method has been configured."
          eyebrow="Empty configuration"
          icon={<WalletCards aria-hidden="true" size={24} />}
          title="No payment methods"
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <TableHeaderCell>Method</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Limits</TableHeaderCell>
              <TableHeaderCell>QR</TableHeaderCell>
              <TableHeaderCell>Version</TableHeaderCell>
              <TableHeaderCell>Action</TableHeaderCell>
            </tr>
          </thead>
          <tbody>
            {methods.map((method) => (
              <tr key={method.id}>
                <TableCell>
                  <strong>{method.displayName}</strong>
                  <small className="admin-table-secondary">
                    {method.methodType.replaceAll('_', ' ')}
                  </small>
                </TableCell>
                <TableCell>
                  <Badge
                    tone={method.archivedAt ? 'neutral' : method.enabled ? 'success' : 'warning'}
                  >
                    {method.archivedAt ? 'Archived' : method.enabled ? 'Enabled' : 'Disabled'}
                  </Badge>
                </TableCell>
                <TableCell>
                  {method.minimumAmountMinor
                    ? `₱${(method.minimumAmountMinor / 100).toLocaleString('en-PH')}`
                    : 'No minimum'}
                  <small className="admin-table-secondary">
                    {method.maximumAmountMinor
                      ? `Up to ₱${(method.maximumAmountMinor / 100).toLocaleString('en-PH')}`
                      : 'No maximum'}
                  </small>
                </TableCell>
                <TableCell>{method.qrCodeVersion > 0 ? 'Configured' : 'None'}</TableCell>
                <TableCell>v{method.version}</TableCell>
                <TableCell>
                  <Link href={`/admin/payment-methods/${method.id}`}>View details</Link>
                </TableCell>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
