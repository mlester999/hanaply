'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type SubmitEvent } from 'react';

import { idleApplicationActionState, type ApplicationActionState } from '@/lib/application-action';

export type ApplicationServerAction = (
  previous: ApplicationActionState,
  formData: FormData,
) => Promise<ApplicationActionState>;

export interface ApplicationActionOptions {
  /** Runs after a successful mutation, for example to close a disclosure. */
  onSuccess?: (state: ApplicationActionState) => void;
}

/**
 * One mutation surface for every pack and tracker form, mirroring
 * `useRadarAction`.
 *
 * Server actions are called directly inside a transition rather than through
 * `useActionState` so a form can react to success — closing the stage menu, for
 * instance — and so a refused write keeps the values the member submitted. A
 * successful mutation refreshes the server components, which is what makes the
 * board, the timeline, and the pack list agree again.
 *
 * A stale version is not an error the member can fix by typing: the hook leaves
 * the message in place and the caller renders it as a non-destructive notice.
 */
export function useApplicationAction(
  action: ApplicationServerAction,
  options: ApplicationActionOptions = {},
) {
  const router = useRouter();
  const [state, setState] = useState<ApplicationActionState>(idleApplicationActionState);
  const [pending, startTransition] = useTransition();
  const { onSuccess } = options;

  function submit(formData: FormData) {
    startTransition(async () => {
      try {
        const result = await action(idleApplicationActionState, formData);
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
          conflict: false,
          refused: false,
          packId: null,
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
