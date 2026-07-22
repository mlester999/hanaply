import { Alert } from '@hanaply/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Privacy' };

export default function PrivacyPage() {
  return (
    <section className="legal-page page-section">
      <div className="legal-container">
        <span className="h-eyebrow">Privacy</span>
        <h1>Privacy foundation</h1>
        <Alert title="Owner review required" tone="warning">
          This page is a product and engineering draft. It is not a final legal privacy notice.
        </Alert>
        <h2>Data minimization</h2>
        <p>
          Hanaply is designed to collect only the profile, preference, and application information
          needed to provide the selected service. Sensitive documents stay private by default.
        </p>
        <h2>Access boundaries</h2>
        <p>
          User data is isolated with database Row Level Security, server-side authorization, and
          explicit administrator permissions. Service credentials never belong in browser code.
        </p>
        <h2>Retention and deletion</h2>
        <p>
          Final retention, account deletion, export, and regulatory language must be approved before
          public launch.
        </p>
      </div>
    </section>
  );
}
