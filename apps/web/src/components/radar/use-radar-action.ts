'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type SubmitEvent } from 'react';

import type { RadarActionState } from '@/lib/radar-action';

const emptyRadarActionState: RadarActionState = {
  status: 'idle',
  message: null,
  fieldErrors: {},
};

export type RadarServerAction = (
  previous: RadarActionState,
  formData: FormData,
) => Promise<RadarActionState>;

export interface RadarActionOptions {
  /** Runs after a successful mutation, for example to close a disclosure. */
  onSuccess?: (state: RadarActionState) => void;
}

/**
 * One mutation surface for every radar form, mirroring `useCareerAction`.
 *
 * Server actions are called directly inside a transition instead of through
 * `useActionState` so a form can react to success — closing the feedback menu,
 * for instance — and so a refused save keeps the values the member submitted.
 * A successful mutation refreshes the server components, which is what makes
 * the feed, the saved list, and the detail page agree again.
 */
export function useRadarAction(action: RadarServerAction, options: RadarActionOptions = {}) {
  const router = useRouter();
  const [state, setState] = useState<RadarActionState>(emptyRadarActionState);
  const [pending, startTransition] = useTransition();
  const { onSuccess } = options;

  function submit(formData: FormData) {
    startTransition(async () => {
      try {
        const result = await action(emptyRadarActionState, formData);
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
