'use client';

import { Alert, Button } from '@hanaply/ui';
import { useRouter } from 'next/navigation';

import type { ApplicationActionState } from '@/lib/application-action';

export interface ApplicationFeedbackProps {
  state: ApplicationActionState;
  successTitle: string;
  errorTitle: string;
  className?: string;
}

/**
 * The single polite live region every pack and tracker form renders its result
 * into.
 *
 * A stale-version conflict gets its own non-destructive treatment: the message
 * says the change was not saved and a refresh control is offered, rather than
 * any attempt to replay the write on top of newer data.
 */
export function ApplicationFeedback({
  state,
  successTitle,
  errorTitle,
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
  const tone = success ? 'success' : state.conflict ? 'warning' : 'danger';
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
    </Alert>
  );
}
