import { Alert } from '@hanaply/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Terms' };

export default function TermsPage() {
  return (
    <section className="legal-page page-section">
      <div className="legal-container">
        <span className="h-eyebrow">Terms</span>
        <h1>Terms foundation</h1>
        <Alert title="Owner review required" tone="warning">
          This engineering draft is not a binding agreement. Approved terms are required before
          public registration opens.
        </Alert>
        <h2>User review remains required</h2>
        <p>
          Hanaply will help prepare application materials but will not automatically submit job
          applications during the initial product phases.
        </p>
        <h2>Truthful information</h2>
        <p>
          Users remain responsible for reviewing their profile facts, generated materials, and
          application instructions before submission.
        </p>
        <h2>Service availability</h2>
        <p>
          Plan limits, support commitments, billing terms, cancellation rules, and dispute language
          must be approved before launch.
        </p>
      </div>
    </section>
  );
}
