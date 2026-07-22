import { Button, LinkButton } from '@hanaply/ui';
import { ShieldOff } from 'lucide-react';

import { logout } from '@/app/actions/auth';

export default function AccountUnavailablePage() {
  return (
    <main className="status-page" id="main-content" tabIndex={-1}>
      <ShieldOff aria-hidden="true" size={36} />
      <span className="h-eyebrow">Account unavailable</span>
      <h1>This account cannot access Hanaply.</h1>
      <p>
        Protected product services are unavailable for this account state. Contact support if you
        believe this is unexpected.
      </p>
      <div className="status-actions">
        <LinkButton href="/help" variant="secondary">
          View Help
        </LinkButton>
        <form action={logout}>
          <Button type="submit" variant="quiet">
            Sign Out
          </Button>
        </form>
      </div>
    </main>
  );
}
