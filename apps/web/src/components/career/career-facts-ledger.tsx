'use client';

import type { CareerFact } from '@hanaply/contracts';
import { Alert, Badge, Button, Card, FormField, Input, Textarea } from '@hanaply/ui';
import { Check, PencilLine, Plus, RotateCcw, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import {
  decideCareerFactAction,
  recordCareerFactAction,
} from '@/app/(customer)/dashboard/career/actions';
import { CareerFeedback } from '@/components/career/career-feedback';
import { useCareerAction } from '@/components/career/use-career-action';
import {
  factCategoryOptions,
  factEvidenceSnippet,
  factMetricLabel,
  factSourceLabel,
  formatTimestamp,
  humanise,
} from '@/lib/career';

function sourceTone(source: string): 'brand' | 'success' | 'warning' | 'neutral' {
  if (source === 'user_entered') return 'success';
  if (source === 'resume_extraction') return 'brand';
  if (source === 'ai_inference') return 'warning';
  return 'neutral';
}

function confidenceLabel(confidence: number | null): string | null {
  if (confidence === null) return null;
  return `${Math.round(confidence * 100)}% extractor confidence`;
}

function DecisionForm({
  profileId,
  factId,
  decision,
  label,
  statement,
  metricValue,
  metricUnit,
  variant,
  leadingIcon,
}: {
  profileId: string;
  factId: string;
  decision: 'confirm' | 'reject' | 'correct';
  label: string;
  statement: string | null;
  metricValue: string;
  metricUnit: string;
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger';
  leadingIcon: ReactNode;
}) {
  const { state, onSubmit, pending } = useCareerAction(decideCareerFactAction);
  return (
    <form className="career-fact-decision" onSubmit={onSubmit}>
      <input name="profileId" type="hidden" value={profileId} />
      <input name="factId" type="hidden" value={factId} />
      <input name="decision" type="hidden" value={decision} />
      <input name="statement" type="hidden" value={statement ?? ''} />
      <input name="metricValue" type="hidden" value={metricValue} />
      <input name="metricUnit" type="hidden" value={metricUnit} />
      <Button
        leadingIcon={leadingIcon}
        loading={pending}
        size="sm"
        type="submit"
        variant={variant ?? 'secondary'}
      >
        {label}
      </Button>
      <span aria-live="polite" className="career-inline-note">
        {state.status === 'error' ? state.message : state.status === 'success' ? state.message : ''}
      </span>
    </form>
  );
}

function CandidateFactRow({ profileId, fact }: { profileId: string; fact: CareerFact }) {
  const [correcting, setCorrecting] = useState(false);
  const evidence = factEvidenceSnippet(fact.evidence);
  const evidenceKind = fact.evidence.kind;
  const { state, onSubmit, pending } = useCareerAction(decideCareerFactAction);

  return (
    <li className="career-fact-row">
      <div className="career-fact-heading">
        <div className="career-badge-row">
          <Badge tone={sourceTone(fact.source)}>{factSourceLabel(fact.source)}</Badge>
          <Badge tone="neutral">{humanise(fact.category)}</Badge>
          {confidenceLabel(fact.confidence) ? (
            <span className="career-hint">{confidenceLabel(fact.confidence)}</span>
          ) : null}
        </div>
        <p className="career-fact-statement">{fact.statement}</p>
        {factMetricLabel(fact) ? (
          <p className="career-fact-metric">Recorded metric: {factMetricLabel(fact)}</p>
        ) : null}
        {evidence ? (
          <blockquote className="career-fact-evidence">
            {evidence}
            {typeof evidenceKind === 'string' ? (
              <cite>Source: {humanise(evidenceKind)}</cite>
            ) : null}
          </blockquote>
        ) : (
          <p className="career-hint">
            No evidence snippet is attached to this proposal. Confirm it only if it is accurate.
          </p>
        )}
        <p className="career-hint">
          This is a proposal, not a fact. Nothing may cite it until you confirm it.
        </p>
      </div>
      <div className="career-fact-controls">
        <DecisionForm
          decision="confirm"
          factId={fact.id}
          label="Confirm"
          leadingIcon={<Check aria-hidden="true" size={16} />}
          metricUnit={fact.metricUnit ?? ''}
          metricValue={fact.metricValue === null ? '' : String(fact.metricValue)}
          profileId={profileId}
          statement={fact.statement}
          variant="primary"
        />
        <Button
          aria-expanded={correcting}
          leadingIcon={<PencilLine aria-hidden="true" size={16} />}
          onClick={() => {
            setCorrecting(!correcting);
          }}
          size="sm"
          type="button"
          variant="secondary"
        >
          Correct
        </Button>
        <DecisionForm
          decision="reject"
          factId={fact.id}
          label="Reject"
          leadingIcon={<X aria-hidden="true" size={16} />}
          metricUnit=""
          metricValue=""
          profileId={profileId}
          statement={null}
          variant="quiet"
        />
      </div>
      {correcting ? (
        <form className="career-fact-correct" onSubmit={onSubmit}>
          <input name="profileId" type="hidden" value={profileId} />
          <input name="factId" type="hidden" value={fact.id} />
          <input name="decision" type="hidden" value="correct" />
          <FormField
            hint="Correcting replaces this proposal with your wording and confirms it."
            id={`careerFactCorrect-${fact.id}`}
            label="Corrected claim"
            required
          >
            <Textarea
              defaultValue={fact.statement}
              id={`careerFactCorrect-${fact.id}`}
              maxLength={500}
              name="statement"
              required
              rows={3}
            />
          </FormField>
          <div className="career-form-grid">
            <FormField id={`careerFactValue-${fact.id}`} label="Metric value">
              <Input
                defaultValue={fact.metricValue === null ? '' : String(fact.metricValue)}
                id={`careerFactValue-${fact.id}`}
                name="metricValue"
                step="any"
                type="number"
              />
            </FormField>
            <FormField
              hint="A number needs a unit, and a unit needs a number."
              id={`careerFactUnit-${fact.id}`}
              label="Metric unit"
            >
              <Input
                defaultValue={fact.metricUnit ?? ''}
                id={`careerFactUnit-${fact.id}`}
                maxLength={40}
                name="metricUnit"
              />
            </FormField>
          </div>
          <CareerFeedback
            errorTitle="Correction not saved"
            state={state}
            successTitle="Correction saved"
          />
          <div className="career-form-actions">
            <Button loading={pending} type="submit">
              Save correction
            </Button>
          </div>
        </form>
      ) : null}
    </li>
  );
}

export interface CareerFactsLedgerProps {
  profileId: string;
  profileName: string;
  candidate: readonly CareerFact[];
  confirmed: readonly CareerFact[];
  rejected: readonly CareerFact[];
}

export function CareerFactsLedger({
  profileId,
  profileName,
  candidate,
  confirmed,
  rejected,
}: CareerFactsLedgerProps) {
  const addFact = useCareerAction(recordCareerFactAction);

  return (
    <div className="career-ledger">
      <Alert title="Only confirmed facts may be cited" tone="info">
        Anything extracted from a document or inferred by Hanaply arrives as a proposal. Generated
        material may only quote claims you confirmed here, and a number is only quoted with the unit
        you gave it.
      </Alert>

      <Card aria-labelledby="career-ledger-add-title" className="career-section-card" role="region">
        <div className="career-section-heading">
          <div>
            <span className="h-eyebrow">Your own input</span>
            <h2 id="career-ledger-add-title">Add a fact yourself</h2>
            <p>
              Claims you write here are recorded as confirmed evidence for {profileName}, because
              you are the source.
            </p>
          </div>
        </div>
        <form className="career-form" onSubmit={addFact.onSubmit}>
          <input name="profileId" type="hidden" value={profileId} />
          <div className="career-form-grid">
            <FormField
              error={addFact.state.fieldErrors.category?.[0]}
              id="careerFactCategory"
              label="Category"
              required
            >
              <select
                className="h-input"
                defaultValue="achievement"
                id="careerFactCategory"
                name="category"
              >
                {factCategoryOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField
              error={addFact.state.fieldErrors.metricValue?.[0]}
              hint="Optional. Both the number and the unit are required together."
              id="careerFactMetricValue"
              label="Metric value"
            >
              <Input id="careerFactMetricValue" name="metricValue" step="any" type="number" />
            </FormField>
            <FormField
              error={addFact.state.fieldErrors.metricUnit?.[0]}
              hint="For example percent, users, or PHP."
              id="careerFactMetricUnit"
              label="Metric unit"
            >
              <Input id="careerFactMetricUnit" maxLength={40} name="metricUnit" />
            </FormField>
          </div>
          <FormField
            error={addFact.state.fieldErrors.statement?.[0]}
            hint="One verifiable claim, between 3 and 500 characters."
            id="careerFactStatement"
            label="Claim"
            required
          >
            <Textarea id="careerFactStatement" maxLength={500} name="statement" required rows={3} />
          </FormField>
          <CareerFeedback
            errorTitle="Claim not recorded"
            state={addFact.state}
            successTitle="Claim recorded"
          />
          <div className="career-form-actions">
            <Button
              leadingIcon={<Plus aria-hidden="true" size={18} />}
              loading={addFact.pending}
              type="submit"
            >
              Record claim
            </Button>
          </div>
        </form>
      </Card>

      <Card
        aria-labelledby="career-ledger-review-title"
        className="career-section-card"
        role="region"
      >
        <div className="career-section-heading">
          <div>
            <span className="h-eyebrow">Needs review</span>
            <h2 id="career-ledger-review-title">
              {candidate.length} {candidate.length === 1 ? 'proposal' : 'proposals'} awaiting your
              decision
            </h2>
          </div>
        </div>
        {candidate.length === 0 ? (
          <p className="career-section-empty">
            No proposals are waiting. Extracted resume content appears here for confirmation.
          </p>
        ) : (
          <ul className="career-fact-list">
            {candidate.map((fact) => (
              <CandidateFactRow fact={fact} key={fact.id} profileId={profileId} />
            ))}
          </ul>
        )}
      </Card>

      <Card
        aria-labelledby="career-ledger-confirmed-title"
        className="career-section-card"
        role="region"
      >
        <div className="career-section-heading">
          <div>
            <span className="h-eyebrow">Confirmed</span>
            <h2 id="career-ledger-confirmed-title">
              {confirmed.length} confirmed {confirmed.length === 1 ? 'fact' : 'facts'}
            </h2>
            <p>These are the only claims generation features may cite for this profile.</p>
          </div>
        </div>
        {confirmed.length === 0 ? (
          <p className="career-section-empty">
            No confirmed facts yet. Confirm a proposal or add a claim of your own.
          </p>
        ) : (
          <ul className="career-fact-list">
            {confirmed.map((fact) => (
              <li className="career-fact-row" key={fact.id}>
                <div className="career-fact-heading">
                  <div className="career-badge-row">
                    <Badge tone={sourceTone(fact.source)}>{factSourceLabel(fact.source)}</Badge>
                    <Badge tone="neutral">{humanise(fact.category)}</Badge>
                    {factMetricLabel(fact) ? (
                      <Badge tone="success">{factMetricLabel(fact)}</Badge>
                    ) : null}
                  </div>
                  <p className="career-fact-statement">{fact.statement}</p>
                  <p className="career-hint">
                    Confirmed {formatTimestamp(fact.confirmedAt) ?? 'without a recorded timestamp'}
                  </p>
                </div>
                <div className="career-fact-controls">
                  <DecisionForm
                    decision="reject"
                    factId={fact.id}
                    label="Reject instead"
                    leadingIcon={<X aria-hidden="true" size={16} />}
                    metricUnit=""
                    metricValue=""
                    profileId={profileId}
                    statement={null}
                    variant="quiet"
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        aria-labelledby="career-ledger-rejected-title"
        className="career-section-card"
        role="region"
      >
        <div className="career-section-heading">
          <div>
            <span className="h-eyebrow">Rejected</span>
            <h2 id="career-ledger-rejected-title">
              {rejected.length} rejected {rejected.length === 1 ? 'claim' : 'claims'}
            </h2>
            <p>Rejected claims stay visible so nothing is silently re-added later.</p>
          </div>
        </div>
        {rejected.length === 0 ? (
          <p className="career-section-empty">No claims have been rejected.</p>
        ) : (
          <ul className="career-fact-list">
            {rejected.map((fact) => (
              <li className="career-fact-row" key={fact.id}>
                <div className="career-fact-heading">
                  <div className="career-badge-row">
                    <Badge tone={sourceTone(fact.source)}>{factSourceLabel(fact.source)}</Badge>
                    <Badge tone="danger">Rejected</Badge>
                  </div>
                  <p className="career-fact-statement">{fact.statement}</p>
                </div>
                <div className="career-fact-controls">
                  <DecisionForm
                    decision="confirm"
                    factId={fact.id}
                    label="Confirm instead"
                    leadingIcon={<RotateCcw aria-hidden="true" size={16} />}
                    metricUnit={fact.metricUnit ?? ''}
                    metricValue={fact.metricValue === null ? '' : String(fact.metricValue)}
                    profileId={profileId}
                    statement={fact.statement}
                    variant="secondary"
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
