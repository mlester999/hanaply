import { Alert } from '@hanaply/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Privacy' };

export default function PrivacyPage() {
  return (
    <section className="legal-page page-section">
      <div className="legal-container">
        <span className="h-eyebrow">Privacy</span>
        <h1>Privacy at Hanaply</h1>
        <Alert title="Privacy notice in review" tone="warning">
          This preview explains Hanaply’s intended privacy approach. Final legal terms will be
          published before public registration.
        </Alert>
        <h2>Data minimization</h2>
        <p>
          Hanaply is designed to collect only the profile, preference, and application information
          needed to provide the selected service. Sensitive documents stay private by default.
        </p>
        <h2>Access boundaries</h2>
        <p>
          Career information is private by default and access is limited to the account holder and
          specifically authorized support operations.
        </p>
        <h2>Retention and deletion</h2>
        <p>
          Final retention, account deletion, export, and regulatory details will be published before
          public launch.
        </p>
      </div>
    </section>
  );
}
