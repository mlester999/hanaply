'use client';

import { Button, Card } from '@hanaply/ui';
import { FileSignature, ShieldCheck, Sparkles } from 'lucide-react';

import { generateApplicationPackAction } from '@/app/(customer)/dashboard/packs/actions';
import { ApplicationFeedback } from '@/components/application/application-feedback';
import { useApplicationAction } from '@/components/application/use-application-action';

export interface GeneratePackPanelProps {
  packId: string;
  jobId: string;
  artifactCount: number;
  /** How many confirmed facts the pack was allowed to draw on when it was created. */
  evidenceFactCount: number;
}

/**
 * Generates the pack artifacts.
 *
 * The copy is deliberately narrow about what generation is. It is not a model
 * writing a resume: Hanaply composes each artifact from career facts the member
 * confirmed themselves, and the database refuses to store an artifact that cites
 * anything else. The panel says that plainly, states the evidence count the pack
 * was frozen with, and never implies more was written than the response returns.
 */
export function GeneratePackPanel({
  packId,
  jobId,
  artifactCount,
  evidenceFactCount,
}: GeneratePackPanelProps) {
  const generate = useApplicationAction(generateApplicationPackAction);

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
              ? 'Hanaply composes a tailored resume, cover letter, requirement map, strategy, recruiter message, and interview preparation from the career facts you confirmed.'
              : 'Regenerating replaces each artifact with a new version built from your current confirmed facts. Earlier versions are kept, not overwritten.'}
          </p>
        </div>
      </div>

      <p className="application-explainer">
        <ShieldCheck aria-hidden="true" size={16} /> This is not a model writing prose. Every
        statement is drawn from one of the {evidenceFactCount} confirmed{' '}
        {evidenceFactCount === 1 ? 'fact' : 'facts'} this pack was frozen with, and each artifact
        lists the exact facts it used. Where a job requirement is not supported by your evidence,
        the artifact says so instead of claiming experience you do not have.
      </p>

      <form onSubmit={generate.onSubmit}>
        <input name="packId" type="hidden" value={packId} />
        <input name="jobId" type="hidden" value={jobId} />
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
    </Card>
  );
}
