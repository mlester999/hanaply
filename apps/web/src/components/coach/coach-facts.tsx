import type { CoachReplyFact } from '@hanaply/contracts';
import { ShieldCheck } from 'lucide-react';

/**
 * One confirmed career fact, resolved for display.
 *
 * The statement comes from the member's own confirmed ledger
 * (`confirmedCareerEvidence`). When that read fails the entry is absent rather
 * than guessed: the identifier is still shown and labelled as unresolved, so a
 * cited fact is never silently dropped and never replaced with invented text.
 */
export interface CoachEvidenceEntry {
  factId: string;
  statement: string;
}

export interface CoachFactsProps {
  facts: readonly CoachReplyFact[];
  evidence: readonly CoachEvidenceEntry[];
  /** Why the ledger read failed, when it did. */
  evidenceUnavailable: string | null;
}

/**
 * The confirmed evidence behind one assistant message.
 *
 * A fact is only ever shown with the confirmed facts it cites. These are the
 * member's own statements, read back from the truth ledger — Hanaply is not
 * paraphrasing them here and the model did not write them.
 */
export function CoachFacts({ facts, evidence, evidenceUnavailable }: CoachFactsProps) {
  if (facts.length === 0) return null;
  const statements = new Map(evidence.map((entry) => [entry.factId, entry.statement]));

  return (
    <section aria-label="Confirmed facts behind this reply" className="coach-facts">
      <h4 className="coach-facts-heading">
        <ShieldCheck aria-hidden="true" size={16} />
        Stated as fact, with the confirmed evidence behind it
      </h4>
      {evidenceUnavailable === null ? null : (
        <p className="coach-facts-unavailable">
          Hanaply could not read your truth ledger for this thread, so the cited facts are shown as
          identifiers only. {evidenceUnavailable}
        </p>
      )}
      <ul className="coach-fact-list">
        {facts.map((fact, index) => (
          <li className="coach-fact" key={`${index}-${fact.statement.slice(0, 24)}`}>
            <p className="coach-fact-statement">{fact.statement}</p>
            <div className="coach-fact-evidence">
              <span className="coach-fact-evidence-label">
                Confirmed {fact.evidenceFactIds.length === 1 ? 'fact cited' : 'facts cited'} (
                {fact.evidenceFactIds.length})
              </span>
              <ul>
                {fact.evidenceFactIds.map((factId) => {
                  const statement = statements.get(factId);
                  return statement === undefined ? (
                    <li className="coach-fact-unresolved" key={factId}>
                      <code>{factId}</code>
                      <span>
                        {evidenceUnavailable === null
                          ? 'This identifier is not in the confirmed facts Hanaply read back, so its statement is not shown.'
                          : 'The statement for this identifier could not be read.'}
                      </span>
                    </li>
                  ) : (
                    <li key={factId}>
                      <code>{factId}</code>
                      <span>{statement}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
