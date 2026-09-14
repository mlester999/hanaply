import { Alert } from '@hanaply/ui';

import type { RadarActionState } from '@/lib/radar-action';

export interface RadarFeedbackProps {
  state: RadarActionState;
  successTitle: string;
  errorTitle: string;
  /** Compact variant keeps a live region inside a card without reflowing it. */
  className?: string;
}

/** The single polite live region every radar form renders its result into. */
export function RadarFeedback({ state, successTitle, errorTitle, className }: RadarFeedbackProps) {
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
