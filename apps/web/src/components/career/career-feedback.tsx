import { Alert } from '@hanaply/ui';

import type { CareerActionState } from '@/lib/career-action';

export interface CareerFeedbackProps {
  state: CareerActionState;
  successTitle: string;
  errorTitle: string;
}

/** The single polite live region every career form renders its result into. */
export function CareerFeedback({ state, successTitle, errorTitle }: CareerFeedbackProps) {
  if (!state.message) return null;
  return (
    <Alert
      aria-live="polite"
      title={state.status === 'success' ? successTitle : errorTitle}
      tone={state.status === 'success' ? 'success' : 'danger'}
    >
      {state.message}
    </Alert>
  );
}

export interface CareerFieldErrorProps {
  state: CareerActionState;
  field: string;
  id: string;
}

/** Field-level messages returned by the contract schemas. */
export function CareerFieldError({ state, field, id }: CareerFieldErrorProps) {
  const message = state.fieldErrors[field]?.[0];
  if (!message) return null;
  return (
    <div className="h-field-error" id={id} role="alert">
      {message}
    </div>
  );
}
