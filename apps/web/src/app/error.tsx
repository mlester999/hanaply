'use client';

import { Button, LinkButton } from '@hanaply/ui';
import { CircleAlert } from 'lucide-react';
import { useEffect } from 'react';

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('A safe client boundary caught a rendering error', { digest: error.digest });
  }, [error.digest]);

  return (
    <main className="status-page" id="main-content">
      <CircleAlert aria-hidden="true" size={36} />
      <span className="h-eyebrow">Something needs attention</span>
      <h1>This page could not be loaded safely.</h1>
      <p>Try again. If the issue continues, check service readiness before repeating the action.</p>
      <div className="status-actions">
        <Button onClick={reset}>Try Again</Button>
        <LinkButton href="/" variant="secondary">
          Return Home
        </LinkButton>
      </div>
    </main>
  );
}
