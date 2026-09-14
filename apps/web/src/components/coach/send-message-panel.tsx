'use client';

import { Button, Card, FormField, Textarea } from '@hanaply/ui';
import { Send } from 'lucide-react';
import { useRef } from 'react';

import { sendCoachMessageAction } from '@/app/(customer)/dashboard/coach/actions';
import { CoachFeedback } from '@/components/coach/coach-feedback';
import { useCoachAction } from '@/components/coach/use-coach-action';

export interface SendMessagePanelProps {
  conversationId: string;
  /**
   * Whether a model may write here: true, false, or null when the status could
   * not be read. Null is not treated as either answer.
   */
  configured: boolean | null;
  /** The profile the thread is linked to, or null when it is linked to none. */
  careerProfileId: string | null;
}

/**
 * Sends one message to the coach.
 *
 * The form states what will happen before it happens rather than after: with no
 * provider configured the message is still saved and the thread says plainly why
 * no reply was written, and with no career profile linked the coach has no
 * admissible evidence and may not assert anything about the member.
 */
export function SendMessagePanel({
  conversationId,
  configured,
  careerProfileId,
}: SendMessagePanelProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const send = useCoachAction(sendCoachMessageAction, {
    onSuccess: (state) => {
      if (state.status === 'success') formRef.current?.reset();
    },
  });

  return (
    <Card className="coach-send-panel">
      <div className="application-section-heading">
        <Send aria-hidden="true" size={20} />
        <div>
          <h2>Ask the coach</h2>
          <p>
            Write in your own words. The reply may only state what your confirmed facts support, and
            anything it infers instead is labelled as an inference.
          </p>
        </div>
      </div>

      {careerProfileId === null ? (
        <p className="application-explainer">
          This thread is not linked to a career profile, so the coach has no confirmed evidence to
          work from. Your message will be saved and the thread will say why no grounded reply was
          written. Open a new thread to have one linked to your profile.
        </p>
      ) : null}

      {configured === false ? (
        <p className="application-explainer">
          AI generation is not configured in this deployment, so no model will write a reply. Your
          message is still saved in this thread and Hanaply says so in place of a reply rather than
          leaving the thread silent. Everything deterministic in Hanaply is unaffected.
        </p>
      ) : null}

      {configured === null ? (
        <p className="application-explainer">
          Hanaply could not read whether AI generation is configured. Send the message anyway: if no
          provider answers, your message is still stored and the thread reports exactly what
          happened.
        </p>
      ) : null}

      <form onSubmit={send.onSubmit} ref={formRef}>
        <input name="conversationId" type="hidden" value={conversationId} />
        <FormField
          hint="Up to 8,000 characters. Hanaply stores your message whether or not a reply can be written."
          id="coach-message-body"
          label="Your message"
          required
        >
          <Textarea
            className="coach-message-input"
            id="coach-message-body"
            maxLength={8_000}
            name="body"
            placeholder="What should I emphasise for this role?"
            required
            rows={5}
          />
        </FormField>
        <div className="application-card-actions">
          <Button
            leadingIcon={<Send aria-hidden="true" size={16} />}
            loading={send.pending}
            type="submit"
          >
            Send message
          </Button>
        </div>
      </form>

      <CoachFeedback errorTitle="Message not sent" state={send.state} successTitle="Message sent" />
    </Card>
  );
}
