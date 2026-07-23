import { Alert, Card, LinkButton } from '@hanaply/ui';
import { BookOpen, LifeBuoy, ShieldQuestion } from 'lucide-react';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Help' };

export default function HelpPage() {
  return (
    <section className="page-section">
      <div className="page-container page-container--narrow">
        <header className="left-heading">
          <span className="h-eyebrow">Help center</span>
          <h1>Clear answers as you get started.</h1>
          <p>Learn what is available today and what is coming next.</p>
        </header>
        <Alert title="Direct support is coming soon" tone="info">
          A monitored support channel will be available before public launch.
        </Alert>
        <div className="help-grid">
          <Card className="help-card">
            <BookOpen aria-hidden="true" size={23} />
            <h2>Getting started</h2>
            <p>Create your account now. Guided career profile setup is part of the next release.</p>
          </Card>
          <Card className="help-card">
            <ShieldQuestion aria-hidden="true" size={23} />
            <h2>Privacy and security</h2>
            <p>Learn how Hanaply approaches account protection and responsible career data use.</p>
            <LinkButton href="/security" size="sm" variant="secondary">
              View security
            </LinkButton>
          </Card>
          <Card className="help-card">
            <LifeBuoy aria-hidden="true" size={23} />
            <h2>Account access</h2>
            <p>Use password recovery if you cannot access your account.</p>
          </Card>
        </div>
      </div>
    </section>
  );
}
