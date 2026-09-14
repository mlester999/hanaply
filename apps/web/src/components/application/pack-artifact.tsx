'use client';

import type { ApplicationArtifact } from '@hanaply/contracts';
import { Badge, Button, Card } from '@hanaply/ui';
import { Check, Copy, Download, FileWarning, ListChecks } from 'lucide-react';
import { useState } from 'react';

import {
  artifactKindDescription,
  artifactKindLabel,
  artifactSections,
  plainTextParagraphs,
  truthGateExplanation,
  truthGateStatusLabels,
  truthGateTone,
} from '@/lib/application';

/**
 * A text file built in the browser from the artifact's own `plainText`.
 *
 * Nothing else is offered because nothing else exists: the API returns plain
 * text, so the only honest export is that text as a `.txt` file.
 */
function downloadPlainText(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function artifactFilename(artifact: ApplicationArtifact): string {
  const style = artifact.style === null ? '' : `-${artifact.style.replaceAll(/\s+/gu, '-')}`;
  return `${artifact.kind.replaceAll('_', '-')}${style}-v${artifact.version}.txt`;
}

type ActionStatus = 'idle' | 'done' | 'failed';

export interface PackArtifactCardProps {
  artifact: ApplicationArtifact;
}

/**
 * One artifact, rendered by kind with its truth-gate result.
 *
 * The body is the stored plain text unless `content` matches a shape this
 * interface understands; an unfamiliar shape is never guessed at. The evidence
 * count beside it is the number of confirmed career facts the artifact cites,
 * which is what the truth gate actually checks.
 */
export function PackArtifactCard({ artifact }: PackArtifactCardProps) {
  const [copyStatus, setCopyStatus] = useState<ActionStatus>('idle');
  const [downloadStatus, setDownloadStatus] = useState<ActionStatus>('idle');
  const sections = artifactSections(artifact.content);
  const paragraphs = sections === null ? plainTextParagraphs(artifact.plainText) : [];
  const cited = artifact.evidenceFactIds.length;

  async function copy() {
    try {
      await navigator.clipboard.writeText(artifact.plainText);
      setCopyStatus('done');
    } catch {
      setCopyStatus('failed');
    }
  }

  return (
    <Card className="application-artifact">
      <div className="application-artifact-heading">
        <div>
          <span className="h-eyebrow">{artifactKindLabel(artifact.kind)}</span>
          <h3>{artifact.title}</h3>
          <p className="application-artifact-kind">{artifactKindDescription(artifact.kind)}</p>
        </div>
        <div className="application-artifact-badges">
          <Badge tone={truthGateTone(artifact.truthGateStatus)}>
            {truthGateStatusLabels[artifact.truthGateStatus]}
          </Badge>
          {artifact.style === null ? null : <Badge tone="neutral">Style: {artifact.style}</Badge>}
        </div>
      </div>

      <p className="application-artifact-gate">{truthGateExplanation(artifact.truthGateStatus)}</p>

      <p className="application-artifact-evidence">
        <ListChecks aria-hidden="true" size={16} />
        {cited === 0
          ? 'This artifact cites none of your confirmed career facts.'
          : `${cited} confirmed ${cited === 1 ? 'fact' : 'facts'} from your career profile support this artifact.`}
      </p>

      {sections === null ? (
        paragraphs.length === 0 ? (
          <p className="application-artifact-empty">
            <FileWarning aria-hidden="true" size={16} /> The API stored no readable text for this
            artifact yet.
          </p>
        ) : (
          <div className="application-artifact-body">
            {paragraphs.map((paragraph, index) => (
              <p key={`${index}-${paragraph.slice(0, 24)}`}>{paragraph}</p>
            ))}
          </div>
        )
      ) : (
        <>
          <div className="application-artifact-body application-artifact-body--sections">
            {sections.map((section, index) => (
              <section key={`${index}-${section.body.slice(0, 24)}`}>
                {section.heading === null ? null : <h4>{section.heading}</h4>}
                {plainTextParagraphs(section.body).map((paragraph, paragraphIndex) => (
                  <p key={`${paragraphIndex}-${paragraph.slice(0, 24)}`}>{paragraph}</p>
                ))}
              </section>
            ))}
          </div>
          <details className="application-artifact-plain">
            <summary>Read the stored plain text exactly as it is saved</summary>
            <pre>{artifact.plainText}</pre>
          </details>
        </>
      )}

      <div className="application-card-actions">
        <Button
          leadingIcon={<Copy aria-hidden="true" size={16} />}
          onClick={() => {
            void copy();
          }}
          size="sm"
          variant="secondary"
        >
          Copy
        </Button>
        <Button
          leadingIcon={<Download aria-hidden="true" size={16} />}
          onClick={() => {
            try {
              downloadPlainText(artifactFilename(artifact), artifact.plainText);
              setDownloadStatus('done');
            } catch {
              setDownloadStatus('failed');
            }
          }}
          size="sm"
          variant="secondary"
        >
          Download as text
        </Button>
      </div>

      <p aria-live="polite" className="application-artifact-status" role="status">
        {copyStatus === 'done' ? (
          <>
            <Check aria-hidden="true" size={15} /> Copied to your clipboard.
          </>
        ) : copyStatus === 'failed' ? (
          'Your browser did not allow clipboard access. Select the text above and copy it manually.'
        ) : downloadStatus === 'done' ? (
          <>
            <Check aria-hidden="true" size={15} /> Downloaded as a plain text file.
          </>
        ) : downloadStatus === 'failed' ? (
          'The text file could not be created in this browser.'
        ) : (
          ''
        )}
      </p>
    </Card>
  );
}
