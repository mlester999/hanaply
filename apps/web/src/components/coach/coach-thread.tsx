import type { CoachConversationDetail } from '@hanaply/contracts';
import { Card } from '@hanaply/ui';
import { MessageSquareText } from 'lucide-react';

import type { CoachEvidenceEntry } from '@/components/coach/coach-facts';
import { CoachMessageRow } from '@/components/coach/coach-message';
import { SendMessagePanel } from '@/components/coach/send-message-panel';

export interface CoachThreadProps {
  detail: CoachConversationDetail;
  evidence: readonly CoachEvidenceEntry[];
  evidenceUnavailable: string | null;
  configured: boolean | null;
}

/**
 * One thread, in sequence order.
 *
 * Messages are rendered by sequence rather than by the order the API happened to
 * return them, so a reply can never appear above the message it answers. Every
 * assistant row carries its own facts and inferences with it, which is why the
 * thread — not a summary above it — is the place the distinction is made.
 */
export function CoachThread({
  detail,
  evidence,
  evidenceUnavailable,
  configured,
}: CoachThreadProps) {
  const messages = [...detail.messages].sort((left, right) => left.sequence - right.sequence);

  return (
    <>
      {messages.length === 0 ? (
        <Card className="coach-thread-empty">
          <h2>
            <MessageSquareText aria-hidden="true" size={20} /> This thread has no messages yet
          </h2>
          <p>
            Nothing has been written here, so there is nothing to show and no reply is waiting. Ask
            your first question below.
          </p>
          <p className="career-hint">
            Whatever you ask, the coach answers from the facts you confirmed in your truth ledger. A
            statement it cannot support is not quietly softened — it is dropped, and what remains is
            shown with the confirmed facts behind it.
          </p>
        </Card>
      ) : (
        <ol aria-label="Coach thread messages" className="coach-thread">
          {messages.map((message) => (
            <CoachMessageRow
              evidence={evidence}
              evidenceUnavailable={evidenceUnavailable}
              key={message.id}
              message={message}
            />
          ))}
        </ol>
      )}

      <SendMessagePanel
        careerProfileId={detail.conversation.careerProfileId}
        configured={configured}
        conversationId={detail.conversation.id}
      />
    </>
  );
}
