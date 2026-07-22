import { Badge, EmptyState, PageHeader } from '@hanaply/ui';
import { Radar, ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Career Radar' };

export default function DashboardPage() {
  return (
    <div className="workspace-page">
      <PageHeader
        actions={<Badge tone="neutral">Foundation mode</Badge>}
        description="Your protected workspace is ready for the Career Intelligence Profile in Phase 3."
        eyebrow="Customer dashboard"
        title="Career Radar"
      />
      <EmptyState
        description={
          <>
            <p>
              No career profile, job signal, or match result is shown because discovery and matching
              are not operational in Phase 0.
            </p>
            <div className="empty-trust-row">
              <ShieldCheck aria-hidden="true" size={18} />
              <span>
                Your account boundary is active. Product data will remain server-authoritative.
              </span>
            </div>
          </>
        }
        eyebrow="No radar configured"
        icon={<Radar aria-hidden="true" size={24} />}
        title="Your career radar starts with verified facts."
      />
    </div>
  );
}
