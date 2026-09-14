'use client';

import type { AiStatus } from '@hanaply/contracts';
import { Button, Card } from '@hanaply/ui';
import { Bot, FileSignature, ShieldCheck, Sparkles } from 'lucide-react';
import { useState } from 'react';

import { generateApplicationPackAction } from '@/app/(customer)/dashboard/packs/actions';
import { ApplicationFeedback } from '@/components/application/application-feedback';
import { useApplicationAction } from '@/components/application/use-application-action';
import { summarisePackGeneration } from '@/lib/ai';

/** The body's `generator` values. `auto` prefers the AI path and falls back. */
type GeneratorChoice = 'deterministic' | 'auto';

export interface GeneratePackPanelProps {
  packId: string;
  jobId: string;
  artifactCount: number;
  /** How many confirmed facts the pack was allowed to draw on when it was created. */
  evidenceFactCount: number;
  /** The AI status the API reported, or null when that read failed. */
  aiStatus: AiStatus | null;
  /** Why the status read failed, when it did. */
  aiStatusUnavailable: string | null;
}

/**
 * Generates the pack artifacts, and says which path wrote them.
 *
 * The two paths are not interchangeable. The deterministic generator composes
 * each artifact from confirmed facts through a fixed template and no model is
 * involved; the AI path is a model writing prose that the truth gate checks
 * before anything is stored. The panel therefore asks which one to use, states
 * what that choice means before the button is pressed, and reports which one
 * actually ran afterwards — from the response, never from the request.
 *
 * The choice defaults to deterministic: opting into a model writing prose about
 * your career is a decision the member makes, not one the interface makes for
 * them.
 */
export function GeneratePackPanel({
  packId,
  jobId,
  artifactCount,
  evidenceFactCount,
  aiStatus,
  aiStatusUnavailable,
}: GeneratePackPanelProps) {
  const generate = useApplicationAction(generateApplicationPackAction);
  const [generator, setGenerator] = useState<GeneratorChoice>('deterministic');

  if (evidenceFactCount === 0) {
    return (
      <Card className="application-next-step">
        <div className="application-section-heading">
          <FileSignature aria-hidden="true" size={20} />
          <div>
            <h2>Write the application material</h2>
            <p>
              Hanaply can only write what your confirmed facts support, and this pack was created
              before you had confirmed any.
            </p>
          </div>
        </div>
        <p className="application-explainer">
          Confirm the experience, skills, and achievements you want your applications to lead with.
          Extraction from a resume can only propose — nothing becomes usable evidence until you
          confirm it yourself.
        </p>
        <div className="application-card-actions">
          <Button
            disabled
            leadingIcon={<FileSignature aria-hidden="true" size={16} />}
            type="button"
          >
            Generate artifacts
          </Button>
          <a className="application-link" href="/dashboard/career/facts">
            Open your facts ledger
          </a>
        </div>
      </Card>
    );
  }

  const aiConfigured = aiStatus === null ? null : aiStatus.configured;
  const aiAvailable = aiConfigured !== false;
  const lastGeneration =
    generate.state.packAi === null ? null : summarisePackGeneration(generate.state.packAi);

  return (
    <Card className="application-next-step">
      <div className="application-section-heading">
        <FileSignature aria-hidden="true" size={20} />
        <div>
          <h2>
            {artifactCount === 0 ? 'Write the application material' : 'Regenerate the material'}
          </h2>
          <p>
            {artifactCount === 0
              ? 'Hanaply writes a tailored resume, cover letter, requirement map, strategy, recruiter message, and interview preparation from the career facts you confirmed.'
              : 'Regenerating replaces each artifact with a new version built from your current confirmed facts. Earlier versions are kept, not overwritten.'}
          </p>
        </div>
      </div>

      <fieldset className="application-generator">
        <legend>Which path writes the artifacts</legend>

        <label className="application-generator-option" htmlFor="pack-generator-deterministic">
          {/*
            The label needs its own text node. The nested strong and small elements
            read as description to a screen reader rather than as the control name,
            which is why the accessibility rule rejected the markup without it.
          */}
          <span className="h-sr-only">Deterministic generation</span>
          <input
            checked={generator === 'deterministic'}
            id="pack-generator-deterministic"
            name="generator"
            onChange={() => {
              setGenerator('deterministic');
            }}
            type="radio"
            value="deterministic"
          />
          <span>
            <strong>Deterministic</strong>
            <small>
              Hanaply’s generator composes each artifact from your confirmed facts through a fixed
              template. No model writes any of this text.
            </small>
          </span>
        </label>

        <label className="application-generator-option" htmlFor="pack-generator-auto">
          <span className="h-sr-only">AI-assisted generation</span>
          <input
            checked={generator === 'auto'}
            disabled={!aiAvailable}
            id="pack-generator-auto"
            name="generator"
            onChange={() => {
              setGenerator('auto');
            }}
            type="radio"
            value="auto"
          />
          <span>
            <strong>AI (auto)</strong>
            <small>
              {aiAvailable
                ? 'A model writes the artifacts and the truth gate checks every claim against your confirmed facts before anything is stored. If no provider answers, Hanaply falls back to the deterministic generator.'
                : 'Not available in this deployment: no model may write here, so only the deterministic path can run.'}
            </small>
          </span>
        </label>
      </fieldset>

      {aiConfigured === false ? (
        <p className="application-explainer">
          <Bot aria-hidden="true" size={16} /> AI generation is not configured, so the AI path is
          unavailable and only the deterministic generator can run.{' '}
          {aiStatus?.reason ?? 'The API reported no reason for it, so none is claimed here.'} The
          artifacts themselves are unaffected: they are written from the same confirmed facts either
          way.
        </p>
      ) : null}

      {aiConfigured === null ? (
        <p className="application-explainer">
          <Bot aria-hidden="true" size={16} /> Hanaply could not read whether AI generation is
          configured. {aiStatusUnavailable ?? ''} Both options stay available, and whichever path
          actually runs is reported from the response rather than assumed from this page.
        </p>
      ) : null}

      {generator === 'deterministic' ? (
        <p className="application-explainer">
          <ShieldCheck aria-hidden="true" size={16} /> This is not a model writing prose. Every
          statement is drawn from one of the {evidenceFactCount} confirmed{' '}
          {evidenceFactCount === 1 ? 'fact' : 'facts'} this pack was frozen with, and each artifact
          lists the exact facts it used. Where a job requirement is not supported by your evidence,
          the artifact says so instead of claiming experience you do not have.
        </p>
      ) : (
        <p className="application-explainer">
          <ShieldCheck aria-hidden="true" size={16} /> On this path a model writes the prose, and
          the artifacts are not a fixed template. It is held to the same limit: every claim is
          checked against the {evidenceFactCount} confirmed{' '}
          {evidenceFactCount === 1 ? 'fact' : 'facts'} this pack was frozen with, and anything the
          truth gate cannot support is kept out rather than softened. The response states which path
          ran, and this panel repeats it below.
        </p>
      )}

      <form onSubmit={generate.onSubmit}>
        <input name="packId" type="hidden" value={packId} />
        <input name="jobId" type="hidden" value={jobId} />
        <input name="generator" type="hidden" value={generator} />
        <div className="application-card-actions">
          <Button
            leadingIcon={<Sparkles aria-hidden="true" size={16} />}
            loading={generate.pending}
            type="submit"
          >
            {artifactCount === 0 ? 'Generate artifacts' : 'Generate a new version'}
          </Button>
          <a className="application-link" href="/dashboard/career/facts">
            Review your confirmed facts
          </a>
        </div>
      </form>

      <ApplicationFeedback
        errorTitle="Artifacts not generated"
        refusedNote={
          <>
            Nothing was written and nothing was replaced. This is a refusal from the server, not a
            fault in the page.
          </>
        }
        state={generate.state}
        successTitle="Artifacts written"
      />

      {lastGeneration === null ? null : (
        <div className="application-generation-path" role="status">
          <p>
            <strong>{lastGeneration.headline}.</strong> {lastGeneration.detail}
          </p>
          {lastGeneration.skipped.length > 0 ? (
            <>
              <p>
                {lastGeneration.skipped.length} requested{' '}
                {lastGeneration.skipped.length === 1 ? 'kind' : 'kinds'} did not come from the
                model:
              </p>
              <ul>
                {lastGeneration.skipped.map((entry) => (
                  <li key={entry}>{entry}</li>
                ))}
              </ul>
            </>
          ) : null}
          <p className="career-hint">
            Reported from the response to the generation you just ran, which is the only place the
            path is stated. Hanaply does not store the generation path with the pack, so this line
            is not shown again after you reload the page — the artifacts themselves are unchanged.
          </p>
        </div>
      )}
    </Card>
  );
}
