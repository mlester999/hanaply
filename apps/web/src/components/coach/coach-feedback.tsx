'use client';

import { Alert } from '@hanaply/ui';

import type { CoachActionState } from '@/lib/coach-action';

export interface CoachFeedbackProps {
  state: CoachActionState;
  successTitle: string;
  errorTitle: string;
  className?: string;
}

/**
 * The single polite live region both coach forms render their result into.
 *
 * `Alert` already carries `role="status"` (or `role="alert"` for a danger tone)
 * and the mutation is announced here rather than only rendered visually, so a
 * screen reader hears that a message was sent and whether a reply was written.
 */
export function CoachFeedback({ state, successTitle, errorTitle, className }: CoachFeedbackProps) {
  if (!state.message) return null;
  return (
    <Alert
      aria-live="polite"
      className={className}
      title={state.status === 'success' ? successTitle : errorTitle}
      tone={state.status === 'success' ? 'success' : 'danger'}
    >
      {state.message}
    </Alert>
  );
}
