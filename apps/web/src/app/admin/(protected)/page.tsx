import { Badge, EmptyState, PageHeader } from '@hanaply/ui';
import { LayoutDashboard, ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Admin Overview' };

export default function AdminPage() {
  return (
    <div className="workspace-page">
      <PageHeader
        actions={<Badge tone="success">Server protected</Badge>}
        description="Administrative modules will appear only when their underlying services are operational."
        eyebrow="Hanaply administration"
        title="Overview"
      />
      <EmptyState
        description={
          <>
            <p>
              No user totals, revenue, payment queues, job counts, or AI usage are displayed because
              those systems are not operational in Phase 0.
            </p>
            <div className="empty-trust-row">
              <ShieldCheck aria-hidden="true" size={18} />
              <span>Navigation visibility never replaces API and database permission checks.</span>
            </div>
          </>
        }
        eyebrow="No operational metrics"
        icon={<LayoutDashboard aria-hidden="true" size={24} />}
        title="The admin shell is ready without invented activity."
      />
    </div>
  );
}
