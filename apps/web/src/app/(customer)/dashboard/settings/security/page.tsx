import { Alert, Badge, Card, PageHeader } from '@hanaply/ui';
import { Clock3, Laptop, ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';

import { PasswordChangeForm, SessionActions } from '@/components/security-settings';
import { createAuthenticatedApiClient, requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Security Settings' };

function formatDate(value: string | null): string {
  if (!value) return 'Not recorded';
  return new Intl.DateTimeFormat('en-PH', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Manila',
  }).format(new Date(value));
}

export default async function SecuritySettingsPage() {
  const { session, me } = await requireUser();
  const sessions = await createAuthenticatedApiClient(session).sessions();
  return (
    <div className="workspace-page">
      <PageHeader
        actions={<Badge tone="success">Email verified</Badge>}
        description="Manage your password and the session information Supabase safely exposes."
        eyebrow="Account settings"
        title="Security"
      />
      <div className="security-summary-grid">
        <Card className="settings-card">
          <ShieldCheck aria-hidden="true" size={22} />
          <h2>Email verification</h2>
          <p>{me.profile.emailVerifiedAt ? 'Verified' : 'Verification required'}</p>
        </Card>
        <Card className="settings-card">
          <Clock3 aria-hidden="true" size={22} />
          <h2>Last password change</h2>
          <p>{formatDate(me.profile.lastPasswordChangedAt)}</p>
        </Card>
      </div>
      <section className="settings-section">
        <div className="settings-section-heading">
          <h2>Change password</h2>
          <p>A password change also revokes every other refresh session.</p>
        </div>
        <PasswordChangeForm />
      </section>
      <section className="settings-section">
        <div className="settings-section-heading">
          <h2>Sessions</h2>
          <p>This is safe session metadata, not full device management.</p>
        </div>
        {sessions.data.length > 0 ? (
          <div className="session-list">
            {sessions.data.map((item) => (
              <article className="session-row" key={item.id}>
                <Laptop aria-hidden="true" size={20} />
                <div>
                  <strong>{item.current ? 'This session' : 'Another session'}</strong>
                  <span>{item.userAgent ?? 'Device details unavailable'}</span>
                  <small>Last seen {formatDate(item.lastSeenAt)}</small>
                </div>
                {item.current ? <Badge tone="success">Current</Badge> : null}
              </article>
            ))}
          </div>
        ) : (
          <Alert title="Session list unavailable" tone="info">
            No active session metadata was returned. Your current session is still checked on every
            protected API request.
          </Alert>
        )}
        <SessionActions />
      </section>
      <Alert title="Multi-factor authentication" tone="info">
        MFA is not enabled in Phase 1. No MFA enrollment or protection is claimed yet.
      </Alert>
    </div>
  );
}
