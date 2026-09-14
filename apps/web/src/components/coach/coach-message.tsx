import type { CoachMessage } from '@hanaply/contracts';
import { Badge, Card } from '@hanaply/ui';
import { Bot, Info, Lightbulb, User } from 'lucide-react';

import { CoachFacts, type CoachEvidenceEntry } from '@/components/coach/coach-facts';
import { formatAbsoluteTimestamp } from '@/lib/radar';

export interface CoachMessageProps {
  message: CoachMessage;
  evidence: readonly CoachEvidenceEntry[];
  evidenceUnavailable: string | null;
}

/** The exact wording every inference is labelled with, on every surface. */
export const suggestionLabel = 'Suggestion — Hanaply’s inference, not a fact about you';

/**
 * One message in a thread.
 *
 * A member message and a coach reply are different markup and different styling,
 * not the same bubble with a different name in it: the reply separates what the
 * coach states as fact (with the confirmed facts behind each statement) from what
 * it infers, and an assistant row that carries neither is labelled as a notice
 * rather than as advice.
 */
export function CoachMessageRow({ message, evidence, evidenceUnavailable }: CoachMessageProps) {
  const posted = formatAbsoluteTimestamp(message.createdAt);
  const isUser = message.role === 'user';
  const isNotice = !isUser && message.facts.length === 0 && message.suggestions.length === 0;

  return (
    <li
      className={
        isUser ? 'coach-message coach-message--user' : 'coach-message coach-message--assistant'
      }
    >
      <Card className="coach-message-card">
        <div className="coach-message-head">
          <h3>
            {isUser ? (
              <>
                <User aria-hidden="true" size={16} /> You
              </>
            ) : (
              <>
                <Bot aria-hidden="true" size={16} /> Hanaply coach
              </>
            )}
          </h3>
          {isUser ? null : isNotice ? (
            <Badge tone="neutral">
              <Info aria-hidden="true" size={14} /> Notice, not a model reply
            </Badge>
          ) : (
            <Badge tone="brand">Model-written, truth-gated</Badge>
          )}
          <span className="coach-message-meta">
            <span className="visually-hidden">Message {message.sequence}. </span>
            {posted ?? 'Time not reported'}
          </span>
        </div>

        <p className="coach-message-body">{message.body}</p>

        {isNotice ? (
          <p className="coach-message-notice">
            This reply states no facts about you and offers no suggestions, so it is a notice from
            Hanaply rather than coaching. Nothing in it was written by a model.
          </p>
        ) : null}

        <CoachFacts
          evidence={evidence}
          evidenceUnavailable={evidenceUnavailable}
          facts={message.facts}
        />

        {message.suggestions.length > 0 ? (
          <section aria-label={suggestionLabel} className="coach-suggestions">
            <h4 className="coach-suggestions-heading">
              <Lightbulb aria-hidden="true" size={16} />
              {suggestionLabel}
            </h4>
            <p className="coach-suggestions-note">
              These are Hanaply’s inferences. They cite no confirmed fact because an inference is
              not a fact, and they are not evidence of anything you have done. Treat them as
              possibilities to consider, not as statements about you.
            </p>
            <ul className="coach-suggestion-list">
              {message.suggestions.map((suggestion, index) => (
                <li
                  className="coach-suggestion"
                  key={`${index}-${suggestion.statement.slice(0, 24)}`}
                >
                  <p className="coach-suggestion-statement">{suggestion.statement}</p>
                  <p className="coach-suggestion-rationale">
                    <strong>Why Hanaply suggests it:</strong> {suggestion.rationale}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {message.citedFactIds.length > 0 ? (
          <details className="coach-message-citations">
            <summary>
              {message.citedFactIds.length}{' '}
              {message.citedFactIds.length === 1 ? 'confirmed fact' : 'confirmed facts'} cited by
              this reply
            </summary>
            <ul>
              {message.citedFactIds.map((factId) => (
                <li key={factId}>
                  <code>{factId}</code>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </Card>
    </li>
  );
}
