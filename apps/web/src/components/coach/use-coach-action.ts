'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type SubmitEvent } from 'react';

import { idleCoachActionState, type CoachActionState } from '@/lib/coach-action';

export type CoachServerAction = (
  previous: CoachActionState,
  formData: FormData,
) => Promise<CoachActionState>;

export interface CoachActionOptions {
  /** Runs after a successful mutation, for example to open the new thread. */
  onSuccess?: (state: CoachActionState) => void;
}

/**
 * One mutation surface for both coach forms, mirroring `useRadarAction`.
 *
 * Server actions are called directly inside a transition rather than through
 * `useActionState`, so a form can react to success — opening the thread that was
 * just created, for instance — and so a refused message keeps the text the
 * member typed. A successful mutation refreshes the server components, which is
 * what makes the thread show the reply that was just written.
 */
export function useCoachAction(action: CoachServerAction, options: CoachActionOptions = {}) {
  const router = useRouter();
  const [state, setState] = useState<CoachActionState>(idleCoachActionState);
  const [pending, startTransition] = useTransition();
  const { onSuccess } = options;

  function submit(formData: FormData) {
    startTransition(async () => {
      try {
        const result = await action(idleCoachActionState, formData);
        setState(result);
        if (result.status === 'success') {
          if (onSuccess) onSuccess(result);
          router.refresh();
        }
      } catch {
        setState({
          status: 'error',
          message: 'The request could not be completed. Reload the page and try again.',
          fieldErrors: {},
          conversationId: null,
        });
      }
    });
  }

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    submit(new FormData(event.currentTarget));
  }

  return { state, submit, onSubmit, pending };
}
