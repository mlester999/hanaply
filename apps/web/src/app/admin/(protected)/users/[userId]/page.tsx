import { HanaplyApiError } from '@hanaply/contracts';
import {
  Alert,
  Badge,
  Card,
  LinkButton,
  PageHeader,
  Table,
  TableCell,
  TableHeaderCell,
} from '@hanaply/ui';
import { ShieldCheck, UserRound } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { AdminUserActions } from '@/components/admin-user-actions';
import { createAuthenticatedApiClient, requireAdminPermission } from '@/lib/session';

export const metadata: Metadata = { title: 'User Detail' };

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString('en-PH') : 'Not recorded';
}

function label(value: string): string {
  return value.replaceAll('_', ' ');
}

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  const { session, admin } = await requireAdminPermission('users.read');
  let result;
  try {
    result = await createAuthenticatedApiClient(session).adminUser(userId);
  } catch (error) {
    if (error instanceof HanaplyApiError && error.status === 404) notFound();
    throw error;
  }
  const user = result.data;
  const name =
    user.displayName ??
    ([user.firstName, user.lastName].filter(Boolean).join(' ') || 'Unnamed user');
  return (
    <div className="workspace-page">
      <PageHeader
        actions={
          <>
            <Badge tone={user.emailVerified ? 'success' : 'warning'}>
              {user.emailVerified ? 'Verified' : 'Unverified'}
            </Badge>
            <Badge tone={user.accountStatus === 'active' ? 'success' : 'warning'}>
              {label(user.accountStatus)}
            </Badge>
          </>
        }
        description={user.email ?? 'Email unavailable'}
        eyebrow="User directory"
        title={name}
      />
      <div className="admin-detail-grid">
        <Card className="admin-detail-card">
          <div className="admin-detail-heading">
            <UserRound aria-hidden="true" size={22} />
            <h2>Profile</h2>
          </div>
          <dl>
            <div>
              <dt>User ID</dt>
              <dd>{user.userId}</dd>
            </div>
            <div>
              <dt>First name</dt>
              <dd>{user.firstName ?? 'Not provided'}</dd>
            </div>
            <div>
              <dt>Last name</dt>
              <dd>{user.lastName ?? 'Not provided'}</dd>
            </div>
            <div>
              <dt>Country</dt>
              <dd>{user.countryCode}</dd>
            </div>
            <div>
              <dt>Locale</dt>
              <dd>{user.locale}</dd>
            </div>
            <div>
              <dt>Timezone</dt>
              <dd>{user.timezone}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{formatDate(user.createdAt)}</dd>
            </div>
            <div>
              <dt>Updated</dt>
              <dd>{formatDate(user.updatedAt)}</dd>
            </div>
          </dl>
        </Card>
        <Card className="admin-detail-card">
          <div className="admin-detail-heading">
            <ShieldCheck aria-hidden="true" size={22} />
            <h2>Access</h2>
          </div>
          <dl>
            <div>
              <dt>Account status</dt>
              <dd>{label(user.accountStatus)}</dd>
            </div>
            <div>
              <dt>Email verified</dt>
              <dd>{formatDate(user.emailVerifiedAt)}</dd>
            </div>
            <div>
              <dt>Subscription</dt>
              <dd>{user.subscriptionStatus ?? 'inactive'}</dd>
            </div>
            <div>
              <dt>Plan</dt>
              <dd>{user.subscriptionPlanCode ?? 'None'}</dd>
            </div>
            <div>
              <dt>Admin membership</dt>
              <dd>{user.adminMembershipStatus ?? 'None'}</dd>
            </div>
            <div>
              <dt>Admin roles</dt>
              <dd>{user.adminRoles.length > 0 ? user.adminRoles.map(label).join(', ') : 'None'}</dd>
            </div>
          </dl>
        </Card>
      </div>
      <section className="settings-section">
        <div className="settings-section-heading">
          <span className="h-eyebrow">Sensitive operations</span>
          <h2>Account controls</h2>
          <p>
            Every action requires confirmation, a reason, API permission, and database permission.
          </p>
        </div>
        <AdminUserActions
          accountStatus={user.accountStatus}
          canManageSecurity={admin.permissions.includes('security.manage')}
          canManageUsers={admin.permissions.includes('users.manage')}
          isCurrentAdministrator={admin.userId === user.userId}
          userId={user.userId}
        />
      </section>
      <section className="settings-section">
        <div className="settings-section-heading">
          <span className="h-eyebrow">Audit trail</span>
          <h2>Recent related events</h2>
        </div>
        {!user.auditVisible ? (
          <Alert title="Audit permission required" tone="info">
            Your role can inspect this user, but it cannot read audit records.
          </Alert>
        ) : user.recentAuditEvents.length === 0 ? (
          <Alert title="No related events" tone="info">
            No safe audit event currently targets this user.
          </Alert>
        ) : (
          <Table>
            <thead>
              <tr>
                <TableHeaderCell>Time</TableHeaderCell>
                <TableHeaderCell>Action</TableHeaderCell>
                <TableHeaderCell>Actor</TableHeaderCell>
                <TableHeaderCell>Request ID</TableHeaderCell>
              </tr>
            </thead>
            <tbody>
              {user.recentAuditEvents.map((event) => (
                <tr key={event.id}>
                  <TableCell>{formatDate(event.createdAt)}</TableCell>
                  <TableCell>{event.action}</TableCell>
                  <TableCell>{event.actorUserId ?? event.actorType}</TableCell>
                  <TableCell>{event.requestId ?? 'Not recorded'}</TableCell>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
      <LinkButton href="/admin/users" variant="secondary">
        Back to User Directory
      </LinkButton>
    </div>
  );
}
