'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type SubmitEvent } from 'react';

import type { CareerActionState } from '@/lib/career-action';

const emptyCareerActionState: CareerActionState = {
  status: 'idle',
  message: null,
  fieldErrors: {},
};

export type CareerServerAction = (
  previous: CareerActionState,
  formData: FormData,
) => Promise<CareerActionState>;

export interface CareerActionOptions {
  /** Runs after a successful mutation, for example to close a dialog or advance a step. */
  onSuccess?: (state: CareerActionState) => void;
}

/**
 * One mutation surface for every career form.
 *
 * Server actions are called directly inside a transition instead of through
 * `useActionState`, for two reasons: several of these forms must react to
 * success by closing a dialog or advancing a wizard step, and React resets an
 * uncontrolled form as soon as a function action is submitted. Submitting
 * through `onSubmit` keeps everything the owner typed when a save is refused;
 * forms that should clear themselves call `form.reset()` on success instead.
 */
export function useCareerAction(action: CareerServerAction, options: CareerActionOptions = {}) {
  const router = useRouter();
  const [state, setState] = useState<CareerActionState>(emptyCareerActionState);
  const [pending, startTransition] = useTransition();
  const { onSuccess } = options;

  function submit(formData: FormData) {
    startTransition(async () => {
      try {
        const result = await action(emptyCareerActionState, formData);
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
