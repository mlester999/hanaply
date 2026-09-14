import { Card, LinkButton } from '@hanaply/ui';
import { Radar, SearchX } from 'lucide-react';
import type { ReactNode } from 'react';

export interface ApplicationUnavailableProps {
  title: string;
  message: string;
  hint?: ReactNode;
}

/**
 * The explicit "unavailable" panel these surfaces show when the API cannot be
 * reached. Nothing is rendered from a cached or assumed copy: a pack count or a
 * pipeline stage that may be stale would be worse than saying so.
 */
export function ApplicationUnavailable({ title, message, hint }: ApplicationUnavailableProps) {
  return (
    <Card className="application-unavailable">
      <h2>
        <SearchX aria-hidden="true" size={20} /> {title}
      </h2>
      <p>{message}</p>
      <p className="career-hint">
        {hint ??
          'Nothing is shown from a cached copy, because a stale pack or pipeline stage would be worse than no answer. Reload the page to try again; your career profile and saved opportunities are unaffected.'}
      </p>
      <div className="application-card-actions">
        <LinkButton href="/dashboard/radar" variant="secondary">
          <Radar aria-hidden="true" size={18} /> Back to the job radar
        </LinkButton>
      </div>
    </Card>
  );
}
