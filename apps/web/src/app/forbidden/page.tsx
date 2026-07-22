import { LinkButton } from '@hanaply/ui';
import { ShieldX } from 'lucide-react';

export default function ForbiddenPage() {
  return (
    <main className="status-page" id="main-content" tabIndex={-1}>
      <ShieldX aria-hidden="true" size={36} />
      <span className="h-eyebrow">Access denied</span>
      <h1>This area requires explicit administrator permission.</h1>
      <p>A normal authenticated account is never treated as an administrator.</p>
      <LinkButton href="/dashboard" variant="secondary">
        Return to Dashboard
      </LinkButton>
    </main>
  );
}
