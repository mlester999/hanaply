import { LinkButton } from '@hanaply/ui';
import { SearchX } from 'lucide-react';

export default function NotFoundPage() {
  return (
    <main className="status-page" id="main-content" tabIndex={-1}>
      <SearchX aria-hidden="true" size={36} />
      <span className="h-eyebrow">Page not found</span>
      <h1>This route is outside the current radar.</h1>
      <p>Check the address or return to the Hanaply landing page.</p>
      <LinkButton href="/">Return Home</LinkButton>
    </main>
  );
}
