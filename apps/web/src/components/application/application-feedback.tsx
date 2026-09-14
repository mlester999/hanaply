'use client';

import { Alert, Button } from '@hanaply/ui';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';

import type { ApplicationActionState } from '@/lib/application-action';

export interface ApplicationFeedbackProps {
  state: ApplicationActionState;
  successTitle: string;
  errorTitle: string;
  /**
   * Shown under a plan or entitlement refusal, so the API's sentence reads as a
   * decision the member can act on rather than as a fault in the page.
   */
  refusedNote?: ReactNode;
  className?: string;
}

/**
 * The single polite live region every pack and tracker form renders its result
 * into.
 *
 * Two outcomes get special treatment. A stale-version conflict says the change
 * was not saved and offers a refresh rather than replaying the write on top of
 * newer data. A plan refusal keeps the API's own sentence verbatim and is styled
 * as a limit, not a crash.
 */
export function ApplicationFeedback({
  state,
  successTitle,
  errorTitle,
  refusedNote,
  className,
}: ApplicationFeedbackProps) {
  const router = useRouter();
  if (!state.message) return null;
  const success = state.status === 'success';
  const title = state.conflict
    ? 'This application changed elsewhere'
    : success
      ? successTitle
      : errorTitle;
  const tone = success ? 'success' : state.conflict || state.refused ? 'warning' : 'danger';
  return (
    <Alert aria-live="polite" className={className} title={title} tone={tone}>
      {state.message}
      {state.conflict ? (
        <div className="application-conflict">
          <Button
            onClick={() => {
              router.refresh();
            }}
            size="sm"
            variant="secondary"
          >
            Refresh the latest
          </Button>
        </div>
      ) : null}
      {state.refused && refusedNote ? (
        <div className="application-refusal">{refusedNote}</div>
      ) : null}
    </Alert>
  );
}
