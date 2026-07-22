import { LinkButton } from '@hanaply/ui';
import { CirclePause } from 'lucide-react';

export default function AccountSuspendedPage() {
  return (
    <main className="status-page" id="main-content">
      <CirclePause aria-hidden="true" size={36} />
      <span className="h-eyebrow">Account access paused</span>
      <h1>Your account is currently suspended.</h1>
      <p>
        Protected services remain unavailable until an authorized administrator restores access.
      </p>
      <LinkButton href="/help" variant="secondary">
        View Help
      </LinkButton>
    </main>
  );
}
