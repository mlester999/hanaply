import { Alert, Badge, Card, PageHeader } from '@hanaply/ui';
import { MonitorSmartphone, Settings2 } from 'lucide-react';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Admin Settings' };

export default function AdminSettingsPage() {
  return (
    <div className="workspace-page">
      <PageHeader
        actions={<Badge tone="neutral">Read-only foundation</Badge>}
        description="Platform and feature configuration exists in the database but has no mutation UI in Phase 0."
        eyebrow="Hanaply administration"
        title="Platform Settings"
      />
      <Alert title="Changes are disabled" tone="warning">
        Future writes require dedicated permission checks, validation, and append-only audit events.
      </Alert>
      <div className="settings-grid">
        <Card className="settings-card">
          <MonitorSmartphone aria-hidden="true" size={22} />
          <h2>Platform lifecycle</h2>
          <p>Web starts active. iOS and Android remain explicitly planned.</p>
        </Card>
        <Card className="settings-card">
          <Settings2 aria-hidden="true" size={22} />
          <h2>Feature flags</h2>
          <p>Future product modules start disabled and use deterministic targeting rules.</p>
        </Card>
      </div>
    </div>
  );
}
