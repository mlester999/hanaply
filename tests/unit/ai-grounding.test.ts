import { describe, expect, it } from 'vitest';

import {
  buildEvidenceIndex,
  extractClaims,
  extractNamedEntityPhrases,
  findScoreLikeFields,
  gateGeneratedOutput,
  normalizeText,
  splitSentences,
  toTaskResult,
  truthGateFromGrounding,
  type AiResponseMetadata,
  type GroundingReport,
} from '@hanaply/ai';

import {
  admissibleFactIds,
  automationFactId,
  confirmedFacts,
  educationFactId,
  groundingContext,
  groundedOpportunityReport,
  metricFactId,
  onboardingFactId,
  unconfirmedFact,
  unconfirmedFactId,
} from './fixtures/ai-fixtures.js';

const meta: AiResponseMetadata = {
  requestId: 'req-grounding',
  provider: 'fake',
  model: 'hanaply-fake-1',
  promptVersion: 'ai-v1',
  latencyMs: 3,
  attempts: 1,
  usage: { inputTokens: 10, outputTokens: 10, estimatedCostMinorUsd: null },
  finishReason: 'stop',
  structuredOutputMode: 'json_schema',
  repaired: false,
};

function gate(value: unknown, task: 'opportunity_analysis' | 'application_artifact' | 'coaching') {
  return gateGeneratedOutput({ value, context: groundingContext(), task });
}

function rejectionFor(report: GroundingReport, code: string): boolean {
  return report.rejections.some((rejection) => rejection.code === code);
}

describe('the evidence index', () => {
  it('admits declared facts and excludes a fact the model was not given', () => {
    const context = groundingContext({ facts: [...confirmedFacts(), unconfirmedFact()] });
    const index = buildEvidenceIndex({
      ...context,
      deterministic: { ...context.deterministic, admissibleFactIds },
    });

    expect(index.factIds.has(automationFactId)).toBe(true);
    expect(index.factIds.has(unconfirmedFactId)).toBe(false);
  });
  it('indexes confirmed figures and rejects a figure that is not in the evidence', () => {
    const index = buildEvidenceIndex(groundingContext());

    expect(index.numbers.has('20')).toBe(true);
    expect(index.numbers.has('40')).toBe(true);
    expect(index.numbers.has('9000000')).toBe(true);
    expect(index.numbers.has('777')).toBe(false);
  });

  it('never lets a fictional employer look evidenced', () => {
    const index = buildEvidenceIndex(groundingContext());

    expect(index.unigrams.has('northstar')).toBe(true);
    expect(index.unigrams.has('globex')).toBe(false);
  });
});

describe('the truth gate on opportunity analysis', () => {
  it('passes a fully grounded report and records what it verified', () => {
    const decision = gate(groundedOpportunityReport(), 'opportunity_analysis');

    expect(decision.accepted).toBe(true);
    expect(decision.value).not.toBeNull();
    expect(decision.report.status).toBe('passed');
    expect(decision.report.rejections).toHaveLength(0);
    expect(decision.report.verifiedFactIds).toContain(automationFactId);
    expect(decision.report.verifiedFactIds).toContain(onboardingFactId);
    expect(decision.report.numericClaimsChecked).toBeGreaterThan(0);
    expect(decision.report.entityClaimsChecked).toBeGreaterThan(0);
    expect(decision.report.experienceClaimsChecked).toBeGreaterThan(0);
    expect(decision.report.claims.every((claim) => claim.status === 'supported')).toBe(true);
  });

  it('drops an invented metric from an advice field and reports it per claim', () => {
    const report = groundedOpportunityReport();
    const mutated = {
      ...report,
      whyInteresting: ['This role could raise your compensation by 45% within a year.'],
    };
    const decision = gate(mutated, 'opportunity_analysis');

    expect(decision.accepted).toBe(true);
    expect(decision.report.status).toBe('partial');
    expect(decision.report.rejections).toHaveLength(0);
    const dropped = decision.report.claims.filter((claim) => claim.status === 'dropped');
    expect(dropped.some((claim) => claim.kind === 'numeric' && claim.text === '45')).toBe(true);
    expect(dropped.every((claim) => claim.reason !== null)).toBe(true);
  });

  it('rejects an invented metric asserted in an evidence field', () => {
    const decision = gate(
      {
        ...groundedOpportunityReport(),
        gaps: ['You already reduced onboarding handling time by 45% at Northstar Systems.'],
      },
      'opportunity_analysis',
    );

    expect(decision.accepted).toBe(false);
    expect(decision.value).toBeNull();
    expect(decision.report.status).toBe('rejected');
    expect(rejectionFor(decision.report, 'numeric')).toBe(true);
    expect(decision.report.unsupportedClaimIds.some((id) => id.includes('45'))).toBe(true);
  });

  it('rejects an invented employer', () => {
    const decision = gate(
      {
        ...groundedOpportunityReport(),
        gaps: ['No confirmed fact evidences your work at Globex Corporation.'],
      },
      'opportunity_analysis',
    );

    expect(decision.accepted).toBe(false);
    expect(rejectionFor(decision.report, 'entity')).toBe(true);
    expect(
      decision.report.rejections.some((rejection) => rejection.detail.includes('globex')),
    ).toBe(true);
  });

  it('rejects an invented certification and an invented school', () => {
    const certification = gate(
      {
        ...groundedOpportunityReport(),
        gaps: ['Your AWS Certified Solutions Architect credential is not confirmed.'],
      },
      'opportunity_analysis',
    );
    expect(certification.accepted).toBe(false);
    expect(rejectionFor(certification.report, 'entity')).toBe(true);

    const school = gate(
      {
        ...groundedOpportunityReport(),
        gaps: ['Your degree from De La Salle University is not on your record.'],
      },
      'opportunity_analysis',
    );
    expect(school.accepted).toBe(false);
    expect(rejectionFor(school.report, 'entity')).toBe(true);
  });

  it('rejects an uncited first-person experience claim', () => {
    const decision = gate(
      {
        ...groundedOpportunityReport(),
        gaps: ['I managed a team of eleven engineers across three time zones.'],
      },
      'opportunity_analysis',
    );

    expect(decision.accepted).toBe(false);
    expect(rejectionFor(decision.report, 'experience')).toBe(true);
    expect(
      decision.report.rejections.some((rejection) =>
        rejection.detail.includes('first-person experience'),
      ),
    ).toBe(true);
  });

  it('accepts advice in a strategy field but not an assertion in a claim field', () => {
    const advice = gate(
      {
        ...groundedOpportunityReport(),
        applicationStrategy: [
          'I would lead with the onboarding rebuild rather than a summary of it.',
          'Describe the automation work as delivered rather than studied.',
        ],
      },
      'opportunity_analysis',
    );
    expect(advice.accepted).toBe(true);
    expect(advice.report.status).toBe('passed');
    expect(advice.report.rejections).toHaveLength(0);

    const assertion = gate(
      {
        ...groundedOpportunityReport(),
        strongestEvidence: [
          {
            factId: automationFactId,
            insight: 'I led a team of nine engineers across four countries.',
          },
        ],
      },
      'opportunity_analysis',
    );
    expect(assertion.accepted).toBe(false);
    expect(rejectionFor(assertion.report, 'experience')).toBe(true);
  });

  it('accepts a first-person claim that quotes a confirmed fact verbatim', () => {
    const decision = gate(
      {
        ...groundedOpportunityReport(),
        gaps: ['I built automation workflows with n8n and TypeScript at Northstar Systems.'],
      },
      'opportunity_analysis',
    );

    expect(decision.accepted).toBe(true);
    expect(decision.report.status).toBe('passed');
  });

  it('rejects a citation to a fact that was not supplied to the model', () => {
    const decision = gate(
      {
        ...groundedOpportunityReport(),
        strongestEvidence: [
          { factId: unconfirmedFactId, insight: 'This is not admissible evidence.' },
        ],
      },
      'opportunity_analysis',
    );

    expect(decision.accepted).toBe(false);
    expect(decision.value).toBeNull();
    expect(rejectionFor(decision.report, 'fact_citation')).toBe(true);
    expect(decision.report.unsupportedClaimIds).toContain(`fact_citation:${unconfirmedFactId}`);
    expect(decision.report.verifiedFactIds).not.toContain(unconfirmedFactId);
  });

  it('rejects a response that chooses its own verdict', () => {
    const report = groundedOpportunityReport();
    const decision = gate(
      { ...report, verdict: { restatesMatchVerdict: false, summary: 'This is a weak match.' } },
      'opportunity_analysis',
    );

    expect(decision.accepted).toBe(false);
    expect(rejectionFor(decision.report, 'label')).toBe(true);
  });

  it('rejects a response that carries its own score or confidence', () => {
    const withScore = gate({ ...groundedOpportunityReport(), score: 91 }, 'opportunity_analysis');
    expect(withScore.accepted).toBe(false);
    expect(rejectionFor(withScore.report, 'numeric')).toBe(true);

    const withConfidence = gate(
      { ...groundedOpportunityReport(), confidence: 'high' },
      'opportunity_analysis',
    );
    expect(withConfidence.accepted).toBe(false);
    expect(rejectionFor(withConfidence.report, 'numeric')).toBe(true);
  });

  it('rejects a response that is not an object at all', () => {
    const decision = gateGeneratedOutput({
      value: 'a fluent paragraph that is not an object',
      context: groundingContext(),
      task: 'opportunity_analysis',
    });

    expect(decision.accepted).toBe(false);
    expect(decision.report.status).toBe('rejected');
    expect(decision.report.rejections[0]?.code).toBe('label');
  });
});

describe('the truth gate on a partially grounded response', () => {
  const artifact = {
    kind: 'cover_letter',
    title: 'Cover letter',
    sections: [
      {
        heading: 'Opening',
        paragraphs: [
          'Built automation workflows with n8n and TypeScript at Northstar Systems.',
          'Globex Corporation headcount grew to 777 that year.',
        ],
      },
    ],
    evidenceFactIds: [automationFactId],
  };

  it('drops exactly the unsupported claim and keeps the rest of the draft', () => {
    const decision = gate(artifact, 'application_artifact');

    expect(decision.accepted).toBe(true);
    expect(decision.value).not.toBeNull();
    expect(decision.report.status).toBe('partial');

    const value = decision.value as typeof artifact;
    expect(value.sections[0]?.paragraphs).toHaveLength(1);
    expect(value.sections[0]?.paragraphs[0]).toContain('n8n');
    expect(value.sections[0]?.paragraphs[0]).not.toContain('Globex');
    expect(value.evidenceFactIds).toEqual([automationFactId]);
  });
  it('reports every claim it checked, with the dropped one marked', () => {
    const decision = gate(artifact, 'application_artifact');
    const dropped = decision.report.claims.filter((claim) => claim.status === 'dropped');
    const supported = decision.report.claims.filter((claim) => claim.status === 'supported');

    expect(dropped.length).toBeGreaterThan(0);
    expect(supported.length).toBeGreaterThan(0);
    expect(dropped.every((claim) => claim.reason !== null)).toBe(true);
    expect(dropped.some((claim) => claim.path.startsWith('$.sections[0]'))).toBe(true);
    expect(dropped.some((claim) => claim.kind === 'entity')).toBe(true);
  });

  it('reports the same evaluation through the database-shaped summary', () => {
    const decision = gate(artifact, 'application_artifact');
    const summary = truthGateFromGrounding(decision.report);

    expect(summary.status).toBe('needs_review');
    expect(summary.verifiedFactIds).toEqual([automationFactId]);
    expect(summary.unsupportedClaimIds.length).toBeGreaterThan(0);
  });

  it('refuses an artifact whose evidence list cites a fact that was not admitted', () => {
    const decision = gate(
      { ...artifact, evidenceFactIds: [automationFactId, unconfirmedFactId] },
      'application_artifact',
    );

    expect(decision.accepted).toBe(false);
    expect(decision.value).toBeNull();
    expect(rejectionFor(decision.report, 'fact_citation')).toBe(true);
  });

  it('revalidates the cleaned value and refuses a draft left with no evidence', () => {
    const decision = gate({ ...artifact, evidenceFactIds: [] }, 'application_artifact');
    expect(decision.accepted).toBe(false);
    expect(rejectionFor(decision.report, 'fact_citation')).toBe(true);

    const result = toTaskResult({
      decision,
      schema: { safeParse: () => ({ success: true, data: {} }) },
      meta,
      provider: 'fake',
      requestId: 'req-grounding',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('schema_invalid');
    expect(result.error.retryable).toBe(false);
  });
});

describe('the truth gate on coaching', () => {
  const coaching = {
    facts: [
      {
        statement: 'You have confirmed automation work with n8n and TypeScript.',
        evidenceFactIds: [automationFactId, onboardingFactId],
      },
    ],
    suggestions: [
      {
        kind: 'inference',
        statement: 'You could lead with the onboarding rebuild in a cover letter.',
        rationale: 'It is the fact that is closest to the posting requirement.',
      },
    ],
    questionsToConfirm: ['Do you have any SaaS operations experience?'],
    nextSteps: ['Confirm any certification before it is used in an application.'],
  };

  it('passes a response that keeps facts and inferences apart', () => {
    const decision = gate(coaching, 'coaching');

    expect(decision.accepted).toBe(true);
    expect(decision.report.status).toBe('passed');
    expect(decision.report.verifiedFactIds).toContain(automationFactId);
  });

  it('rejects a fact whose only citation is not admissible', () => {
    const decision = gate(
      {
        ...coaching,
        facts: [{ statement: 'You are AWS certified.', evidenceFactIds: [unconfirmedFactId] }],
      },
      'coaching',
    );

    expect(decision.accepted).toBe(false);
    expect(rejectionFor(decision.report, 'fact_citation')).toBe(true);
  });

  it('rejects an uncited statement in the facts channel', () => {
    const decision = gate(
      {
        ...coaching,
        facts: [
          { statement: 'You have five years of leadership experience.', evidenceFactIds: [] },
        ],
      },
      'coaching',
    );

    expect(decision.accepted).toBe(false);
    expect(
      decision.report.rejections.some((rejection) =>
        rejection.detail.includes('it is an inference and belongs in suggestions'),
      ),
    ).toBe(true);
  });

  it('rejects a suggestion that is not labelled as inference', () => {
    const decision = gate(
      {
        ...coaching,
        suggestions: [
          { kind: 'fact', statement: 'You are ready for a senior role.', rationale: 'Because.' },
        ],
      },
      'coaching',
    );

    expect(decision.accepted).toBe(false);
    expect(decision.report.rejections.some((rejection) => rejection.path.endsWith('.kind'))).toBe(
      true,
    );
  });

  it('rejects a missing channel rather than treating it as empty', () => {
    const decision = gate(
      { facts: coaching.facts, questionsToConfirm: [], nextSteps: [] },
      'coaching',
    );

    expect(decision.accepted).toBe(false);
    expect(decision.report.rejections.some((rejection) => rejection.path === '$.suggestions')).toBe(
      true,
    );
  });
});

describe('claim extraction', () => {
  const index = buildEvidenceIndex(groundingContext());

  it('finds every figure in a sentence and marks the unsupported ones', () => {
    const claims = extractClaims(
      'You have 3 years of experience and the posting asks for 11 years.',
      index,
    );
    const numbers = claims.filter((claim) => claim.kind === 'numeric');

    expect(numbers.map((claim) => claim.text)).toEqual(['3', '11']);
    expect(numbers.find((claim) => claim.text === '3')?.status).toBe('supported');
    expect(numbers.find((claim) => claim.text === '11')?.status).toBe('rejected');
  });

  it('treats a spelled-out duration as a claim', () => {
    const claims = extractClaims('You bring three years of operations leadership.', index);
    expect(claims.some((claim) => claim.kind === 'experience')).toBe(true);
  });

  it('ignores a four-digit year, which is a date rather than a claim', () => {
    const claims = extractClaims('The team shipped this in 2019 and it is still in use.', index);
    expect(claims.filter((claim) => claim.kind === 'numeric')).toHaveLength(0);
  });

  it('extracts named entity phrases and skips ordinary sentence openers', () => {
    const phrases = extractNamedEntityPhrases(
      'Consider Acme Rocket Labs, which is not Northstar Systems.',
    );
    expect(phrases).toContain('Acme Rocket Labs');
    expect(phrases).toContain('Northstar Systems.');
    expect(phrases.some((phrase) => phrase.startsWith('Consider'))).toBe(false);

    // A lone capitalised word is a sentence opener or a heading, not a name, so
    // a heading such as "Opening" can never be rejected as an invented employer.
    expect(extractNamedEntityPhrases('Opening')).toEqual([]);
    expect(extractNamedEntityPhrases('However this is fine.')).toEqual([]);
  });

  it('detects score-like fields at any depth without flagging the verdict boolean', () => {
    expect(findScoreLikeFields({ nested: { list: [{ matchScore: 88 }] } })).toEqual([
      '$.nested.list[0].matchScore',
    ]);
    expect(findScoreLikeFields({ verdict: { restatesMatchVerdict: true } })).toEqual([]);
  });

  it('normalizes and splits text deterministically', () => {
    expect(normalizeText('TypeScript  and  Node.js!')).toBe('typescript and node.js');
    expect(normalizeText('Cebú')).toBe('cebu');
    expect(splitSentences('One. Two! Three?')).toEqual(['One.', 'Two!', 'Three?']);
    expect(splitSentences('')).toEqual([]);
  });

  it('never cites a fact identifier as if it were a figure', () => {
    const claims = extractClaims(
      `Your automation work is confirmed by fact ${metricFactId} in the ledger.`,
      index,
    );
    expect(claims.filter((claim) => claim.kind === 'numeric')).toHaveLength(0);
  });

  it('keeps a grounded education statement admissible', () => {
    const decision = gate(
      {
        ...groundedOpportunityReport(),
        strongestEvidence: [
          {
            factId: educationFactId,
            insight: 'Your confirmed BS Computer Science is from University of the Philippines.',
          },
        ],
      },
      'opportunity_analysis',
    );
    expect(decision.accepted).toBe(true);
  });
});
