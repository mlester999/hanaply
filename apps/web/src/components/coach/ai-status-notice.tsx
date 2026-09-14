import type { AiStatus } from '@hanaply/contracts';
import { Alert, Badge, Card, LinkButton } from '@hanaply/ui';
import { Bot, MessagesSquare, ShieldCheck } from 'lucide-react';

import {
  aiCapabilityRows,
  aiCapabilitySentence,
  aiStateLabels,
  aiStateTone,
  providerLabel,
} from '@/lib/ai';

export type AiStatusVariant = 'page' | 'thread' | 'settings';

export interface AiStatusNoticeProps {
  /**
   * The status the API reported, or null when the read failed. Null is not
   * treated as "unconfigured": the two say different things and both are shown.
   */
  status: AiStatus | null;
  /** Why the status read failed, when it did. */
  unavailable?: string | null;
  /**
   * `page` always renders the notice (the coach index).
   * `thread` renders it only when there is something the member must know —
   *   the status could not be read, or generation is not available.
   * `settings` renders the compact card used in the account settings grid.
   */
  variant?: AiStatusVariant;
}

/**
 * The honest AI status indicator.
 *
 * It exists so that "AI is not configured" is a sentence on the page rather than
 * an absence the member has to infer from missing features. When generation is
 * unavailable it states the API's own reason and lists the deterministic work
 * that still runs, because that list is the whole point: the product does not
 * stop when a provider is not wired up.
 */
export function AiStatusNotice({
  status,
  unavailable = null,
  variant = 'page',
}: AiStatusNoticeProps) {
  if (status === null) {
    if (variant === 'settings') {
      return (
        <Card className="settings-card ai-status-card">
          <Bot aria-hidden="true" size={22} />
          <h2>AI and the coach</h2>
          <p>
            {unavailable ??
              'Hanaply could not read whether AI generation is configured in this deployment.'}
          </p>
          <p className="ai-status-footnote">
            Nothing here is assumed: an unreadable status is reported as unreadable rather than as
            available or unavailable.
          </p>
          <LinkButton href="/dashboard/coach" size="sm" variant="secondary">
            Open the coach
          </LinkButton>
        </Card>
      );
    }
    return (
      <Alert
        className="ai-status-notice"
        title="Hanaply could not read whether AI generation is configured"
        tone="warning"
      >
        <p>
          {unavailable ??
            'The status request did not answer, so Hanaply cannot say whether a model may write anything in this deployment right now.'}
        </p>
        <p>
          This is a read failure, not a statement that AI is switched off. Everything deterministic
          — your match results, the opportunity brief, your Application Packs, and your insights —
          is unaffected and is shown with its own evidence.
        </p>
      </Alert>
    );
  }

  if (variant === 'settings') {
    return (
      <Card className="settings-card ai-status-card">
        <Bot aria-hidden="true" size={22} />
        <h2>AI and the coach</h2>
        <p className="ai-status-card-state">
          <Badge tone={aiStateTone(status.state)}>{aiStateLabels[status.state]}</Badge>
        </p>
        <p>
          {status.configured
            ? `Provider ${providerLabel(status.provider)}${status.model === null ? '' : `, model ${status.model}`}. Every statement a model writes is checked against your confirmed facts before it is stored.`
            : (status.reason ??
              'AI generation is not configured in this deployment, and Hanaply did not report a reason.')}
        </p>
        <p className="ai-status-footnote">
          Hanaply never presents deterministic output as model-written, and never presents model
          output as a fact about you.
        </p>
        <LinkButton href="/dashboard/coach" size="sm" variant="secondary">
          Open the coach
        </LinkButton>
      </Card>
    );
  }

  if (variant === 'thread' && status.configured) return null;

  const rows = aiCapabilityRows(status);

  return (
    <Card className="ai-status-notice" role="status">
      <div className="ai-status-heading">
        <Bot aria-hidden="true" size={22} />
        <div>
          <h2>{aiStateLabels[status.state]}</h2>
          <p>
            {status.configured
              ? `Provider ${providerLabel(status.provider)}${status.model === null ? '' : `, model ${status.model}`}. Generated text is checked against your confirmed facts by the truth gate before it is stored.`
              : (status.reason ??
                'AI generation is not configured in this deployment, and Hanaply did not report a reason.')}
          </p>
        </div>
        <Badge tone={aiStateTone(status.state)}>
          {status.configured ? 'Available' : 'Not configured'}
        </Badge>
      </div>

      {status.configured ? (
        <p className="ai-status-footnote">
          A model may write a reply or an analysis; it may not originate a fact about you. Anything
          the truth gate cannot support is dropped before it is stored, and every claim behind what
          remains is listed with it.
        </p>
      ) : (
        <>
          <p className="ai-status-footnote">
            Nothing is hidden here and nothing is faked in its place. The coach surface stays in the
            product, and it says plainly which parts of it a model cannot write right now.
          </p>

          <h3>What still works</h3>
          <ul className="ai-status-alternatives">
            {status.deterministicAlternatives.map((alternative) => (
              <li key={alternative}>
                <ShieldCheck aria-hidden="true" size={16} />
                <span>{alternative}</span>
              </li>
            ))}
          </ul>

          <h3>Who writes each part right now</h3>
          <dl className="ai-status-capabilities">
            {rows.map((row) => (
              <div key={row.key}>
                <dt>{row.label}</dt>
                <dd>
                  <Badge tone={row.capability === 'ai' ? 'brand' : 'neutral'}>
                    {row.capability === 'ai' ? 'A model may write this' : 'Hanaply’s engine'}
                  </Badge>
                  <span>{aiCapabilitySentence(row.capability)}</span>
                </dd>
              </div>
            ))}
          </dl>

          <div className="ai-status-actions">
            <LinkButton href="/dashboard/radar" size="sm" variant="secondary">
              Open the opportunity briefs
            </LinkButton>
            <LinkButton href="/dashboard/packs" size="sm" variant="secondary">
              <MessagesSquare aria-hidden="true" size={16} /> Application Packs
            </LinkButton>
          </div>
        </>
      )}
    </Card>
  );
}
