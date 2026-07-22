import { Badge, Card, PageHeader } from '@hanaply/ui';
import { Activity, ShieldCheck, UserCheck, UserRoundX, UsersRound } from 'lucide-react';
import type { Metadata } from 'next';

import { createAuthenticatedApiClient, requireAdminPermission } from '@/lib/session';

export const metadata: Metadata = { title: 'Admin Overview' };

const metrics = [
  { key: 'registeredUsers', label: 'Registered users', icon: UsersRound },
  { key: 'verifiedUsers', label: 'Verified users', icon: UserCheck },
  { key: 'suspendedUsers', label: 'Suspended users', icon: UserRoundX },
  { key: 'activeAdministrators', label: 'Active administrators', icon: ShieldCheck },
  { key: 'authenticationEventsLast24Hours', label: 'Auth events, last 24 hours', icon: Activity },
] as const;

export default async function AdminPage() {
  const { session } = await requireAdminPermission('users.read');
  const result = await createAuthenticatedApiClient(session).adminOverview();
  return (
    <div className="workspace-page">
      <PageHeader
        actions={<Badge tone="success">Live database counts</Badge>}
        description="Operational identity totals are calculated from Supabase Auth and Hanaply account records."
        eyebrow="Hanaply administration"
        title="Overview"
      />
      <div className="admin-metric-grid">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <Card className="admin-metric-card" key={metric.key}>
              <Icon aria-hidden="true" size={22} />
              <strong>{result.data[metric.key].toLocaleString('en-PH')}</strong>
              <span>{metric.label}</span>
            </Card>
          );
        })}
      </div>
      <Card className="admin-system-card">
        <ShieldCheck aria-hidden="true" size={23} />
        <div>
          <span className="h-eyebrow">System status</span>
          <h2>Identity operations are available.</h2>
          <p>
            This page reports only Phase 1 account and authentication facts. Payments, jobs, AI, and
            product analytics remain intentionally absent.
          </p>
          <small>Evaluated {new Date(result.data.evaluatedAt).toLocaleString('en-PH')}</small>
        </div>
      </Card>
    </div>
  );
}
