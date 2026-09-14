'use client';

import { Button, Card, FormField, Input } from '@hanaply/ui';
import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

import { openCoachConversationAction } from '@/app/(customer)/dashboard/coach/actions';
import { CoachFeedback } from '@/components/coach/coach-feedback';
import { useCoachAction } from '@/components/coach/use-coach-action';
import { coachTopicLabel, coachTopics } from '@/lib/ai';

export interface NewThreadPanelProps {
  /** Whether a model may answer in a new thread; null when the status is unreadable. */
  configured: boolean | null;
}

/**
 * Opens a coach thread.
 *
 * A thread can be opened whether or not a provider is configured, because the
 * thread itself is stored either way and the product does not hide a surface
 * just because generation is switched off. The panel says what will happen in
 * each case instead of letting the member find out from a silent thread.
 */
export function NewThreadPanel({ configured }: NewThreadPanelProps) {
  const router = useRouter();
  const open = useCoachAction(openCoachConversationAction, {
    onSuccess: (state) => {
      if (state.conversationId !== null) router.push(`/dashboard/coach/${state.conversationId}`);
    },
  });

  return (
    <Card className="coach-new-thread">
      <div className="application-section-heading">
        <Plus aria-hidden="true" size={20} />
        <div>
          <h2>Open a thread</h2>
          <p>
            A thread keeps one topic together — a role you are targeting, a resume question, or an
            interview you are preparing for.
          </p>
        </div>
      </div>

      <p className="application-explainer">
        Hanaply links a new thread to your primary career profile, which is where the coach’s
        admissible evidence comes from. If you have no career profile, the coach will say so in the
        thread rather than assert anything about you.
      </p>

      {configured === false ? (
        <p className="application-explainer">
          AI generation is not configured in this deployment. You can still open a thread and write
          in it: your messages are saved, and the thread states plainly that no model reply was
          written. The rest of Hanaply is unaffected.
        </p>
      ) : null}

      <form onSubmit={open.onSubmit}>
        <div className="coach-new-thread-fields">
          <FormField
            hint="Optional. Leave it blank and Hanaply names the thread after its topic."
            id="coach-thread-title"
            label="Thread title"
          >
            <Input
              autoComplete="off"
              id="coach-thread-title"
              maxLength={160}
              name="title"
              placeholder="Preparing for the staff engineer loop"
              type="text"
            />
          </FormField>

          <FormField
            hint="The topic keeps the thread’s framing, not its answers."
            id="coach-thread-topic"
            label="Topic"
          >
            <select
              className="h-input h-select"
              defaultValue="general"
              id="coach-thread-topic"
              name="topic"
            >
              {coachTopics.map((topic) => (
                <option key={topic} value={topic}>
                  {coachTopicLabel(topic)}
                </option>
              ))}
            </select>
          </FormField>
        </div>

        <div className="application-card-actions">
          <Button loading={open.pending} type="submit">
            Open the thread
          </Button>
          <Link className="application-link" href="/dashboard/career">
            Review your career profile first
          </Link>
        </div>
      </form>

      <CoachFeedback
        errorTitle="Thread not opened"
        state={open.state}
        successTitle="Thread opened"
      />
    </Card>
  );
}
