import { Alert, Card, LinkButton } from '@hanaply/ui';
import { BookOpen, LifeBuoy, ShieldQuestion } from 'lucide-react';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Help' };

export default function HelpPage() {
  return (
    <section className="page-section">
      <div className="page-container page-container--narrow">
        <header className="left-heading">
          <span className="h-eyebrow">Help center foundation</span>
          <h1>Clear answers while Hanaply takes shape.</h1>
          <p>Live support operations are not enabled in Phase 0.</p>
        </header>
        <Alert title="Support channel pending" tone="info">
          The repository owner must configure a monitored support address before launch.
        </Alert>
        <div className="help-grid">
          <Card className="help-card">
            <BookOpen aria-hidden="true" size={23} />
            <h2>Getting started</h2>
            <p>Account onboarding and career profile setup arrive in the next product phases.</p>
          </Card>
          <Card className="help-card">
            <ShieldQuestion aria-hidden="true" size={23} />
            <h2>Privacy and security</h2>
            <p>Review the current architecture controls and owner-reviewed policy drafts.</p>
            <LinkButton href="/security" size="sm" variant="secondary">
              View security
            </LinkButton>
          </Card>
          <Card className="help-card">
            <LifeBuoy aria-hidden="true" size={23} />
            <h2>Account access</h2>
            <p>Password recovery UI is staged for Phase 1 and is not represented as operational.</p>
          </Card>
        </div>
      </div>
    </section>
  );
}
