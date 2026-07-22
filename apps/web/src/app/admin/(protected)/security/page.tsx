import { Alert, Badge, Card, PageHeader } from '@hanaply/ui';
import { DatabaseZap, KeyRound, MailCheck, ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';

import { createAuthenticatedApiClient, requireAdminPermission } from '@/lib/session';

export const metadata: Metadata = { title: 'Admin Security' };

export default async function AdminSecurityPage() {
  const { session } = await requireAdminPermission('security.manage');
  const result = await createAuthenticatedApiClient(session).adminSecurity();
  const status = result.data;
  return (
    <div className="workspace-page">
      <PageHeader
        actions={<Badge tone="success">Secret-safe diagnostics</Badge>}
        description="Configuration posture is shown as status only. Keys, tokens, and secret values are never returned."
        eyebrow="Hanaply administration"
        title="Security"
      />
      {status.bootstrap.enabled ? (
        <Alert title="Admin bootstrap is enabled" tone="warning">
          Disable the bootstrap gate immediately after the reviewed first-Super-Admin operation.
        </Alert>
      ) : (
        <Alert title="Admin bootstrap is disabled" tone="success">
          No first-administrator grant can run without an explicit environment change.
        </Alert>
      )}
      <div className="admin-security-grid">
        <Card className="admin-security-card">
          <ShieldCheck aria-hidden="true" size={23} />
          <h2>Authentication</h2>
          <dl>
            <div>
              <dt>Provider</dt>
              <dd>Supabase Auth</dd>
            </div>
            <div>
              <dt>Bearer-only API</dt>
              <dd>Enforced</dd>
            </div>
            <div>
              <dt>Session database check</dt>
              <dd>Enforced</dd>
            </div>
          </dl>
        </Card>
        <Card className="admin-security-card">
          <MailCheck aria-hidden="true" size={23} />
          <h2>Email</h2>
          <dl>
            <div>
              <dt>Provider mode</dt>
              <dd>{status.email.provider}</dd>
            </div>
            <div>
              <dt>Live delivery</dt>
              <dd>{status.email.liveDeliveryEnabled ? 'Enabled' : 'Disabled'}</dd>
            </div>
            <div>
              <dt>Secrets displayed</dt>
              <dd>Never</dd>
            </div>
          </dl>
        </Card>
        <Card className="admin-security-card">
          <DatabaseZap aria-hidden="true" size={23} />
          <h2>Database authorization</h2>
          <dl>
            <div>
              <dt>RLS enforcement</dt>
              <dd>Database</dd>
            </div>
            <div>
              <dt>Validation gate</dt>
              <dd>Local and CI</dd>
            </div>
            <div>
              <dt>Admin operations</dt>
              <dd>Permission-checked RPCs</dd>
            </div>
          </dl>
        </Card>
        <Card className="admin-security-card">
          <KeyRound aria-hidden="true" size={23} />
          <h2>Password recovery</h2>
          <dl>
            <div>
              <dt>Recovery flow</dt>
              <dd>Enabled</dd>
            </div>
            <div>
              <dt>Token logging</dt>
              <dd>Disabled</dd>
            </div>
            <div>
              <dt>MFA</dt>
              <dd>Not enabled in Phase 1</dd>
            </div>
          </dl>
        </Card>
      </div>
      <Alert title="Validation scope" tone="info">
        The RLS label means the repository requires database tests in local validation and CI. It is
        not a claim that the current hosted project was inspected from this page.
      </Alert>
    </div>
  );
}
