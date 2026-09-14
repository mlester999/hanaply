import { HanaplyApiError, type AiStatus, type ApplicationPackDetail } from '@hanaply/contracts';
import { Alert, Badge, Card, LinkButton, PageHeader } from '@hanaply/ui';
import { ArrowLeft, ExternalLink, FileWarning, ListChecks, PackageOpen, Radar } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ApplicationUnavailable } from '@/components/application/application-unavailable';
import { GeneratePackPanel } from '@/components/application/generate-pack-panel';
import { PackArtifactCard } from '@/components/application/pack-artifact';
import {
  packFailureExplanation,
  packStatusExplanation,
  packStatusLabel,
  packStatusTone,
  sortedArtifacts,
} from '@/lib/application';
import { applicationErrorMessage } from '@/lib/application-action';
import { formatAbsoluteTimestamp, isUuid, locationDisplay, relativeFromIso } from '@/lib/radar';
import { createAuthenticatedApiClient, requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Application Pack' };

/**
 * Why a pack with no artifacts looks the way it does. The stored status decides
 * the sentence: "still generating" and "marked Ready but empty" are different
 * situations, and neither is filled in with invented text.
 */
function noArtifactExplanation(status: string): string {
  switch (status) {
    case 'queued':
      return 'This pack is queued and nothing has been drafted for it yet. An artifact appears here only once it has been written and checked against your confirmed facts, so nothing is listed as a placeholder in the meantime. Reload this page to see artifacts as they arrive.';
    case 'generating':
      return 'Generation is in progress and no artifact has been stored yet. An artifact appears here only once it is written and checked against your confirmed facts, so nothing is listed as a placeholder in the meantime. Reload this page to see artifacts as they arrive.';
    case 'ready':
      return 'The API reports this pack as Ready and returns no artifacts for it. There is nothing to show, and this page does not fill the gap with text the API did not return.';
    case 'archived':
      return 'This pack is archived and holds no artifacts.';
    default:
      return 'The API returned no artifacts for this pack. Nothing is shown as a placeholder, and the stored status above is repeated exactly as it was reported.';
  }
}

function NoArtifactsYet({ detail }: { detail: ApplicationPackDetail }) {
  const failed = detail.status === 'failed';
  return (
    <Card className="application-artifact-empty-state">
      <h2>
        {failed ? (
          <>
            <FileWarning aria-hidden="true" size={20} /> This pack stopped before writing an
            artifact
          </>
        ) : (
          <>
            <PackageOpen aria-hidden="true" size={20} /> No artifacts are stored yet
          </>
        )}
      </h2>
      {failed ? (
        <>
          <p>{packFailureExplanation(detail.errorCode)}</p>
          <p className="application-pack-code">
            Failure code: {detail.errorCode ?? 'none recorded'}
          </p>
          <p className="career-hint">
            Requesting the pack again is done from the opportunity page. Hanaply keeps one pack per
            opportunity and career profile, so asking again returns this same pack rather than
            starting a second generation or spending another of your monthly packs.
          </p>
        </>
      ) : (
        <p className="career-hint">{noArtifactExplanation(detail.status)}</p>
      )}
      <div className="application-card-actions">
        <LinkButton href={`/dashboard/radar/${detail.jobId}`} variant="secondary">
          <Radar aria-hidden="true" size={18} /> Open the opportunity
        </LinkButton>
      </div>
    </Card>
  );
}

export default async function ApplicationPackPage({
  params,
}: {
  params: Promise<{ packId: string }>;
}) {
  const { packId } = await params;
  if (!isUuid(packId)) notFound();

  const { session } = await requireUser();
  const client = createAuthenticatedApiClient(session);

  let detail: ApplicationPackDetail | null = null;
  let unavailable: string | null = null;
  try {
    detail = (await client.applicationPack(packId)).data;
  } catch (error) {
    if (error instanceof HanaplyApiError && error.status === 404) notFound();
    unavailable = applicationErrorMessage(error, 'Hanaply could not load this Application Pack.');
  }

  // Whether the AI path may run is a separate read from the pack itself, and it
  // fails separately: an unreadable status is reported as unreadable and the
  // panel falls back to the deterministic path rather than pretending either
  // answer. The pack page is never taken down by it.
  let aiStatus: AiStatus | null = null;
  let aiStatusUnavailable: string | null = null;
  if (detail !== null) {
    try {
      aiStatus = (await client.aiStatus()).data.status;
    } catch (error) {
      aiStatusUnavailable = applicationErrorMessage(
        error,
        'Hanaply could not read whether AI generation is configured.',
      );
    }
  }

  if (detail === null) {
    return (
      <div className="workspace-page application-page">
        <PageHeader eyebrow="Application Packs" title="Application Pack" />
        <ApplicationUnavailable
          message={unavailable ?? 'This Application Pack could not be loaded.'}
          title="This Application Pack is unavailable"
        />
      </div>
    );
  }

  const artifacts = sortedArtifacts(detail.artifacts);
  const cited = detail.evidenceFactIds.length;
  const created = formatAbsoluteTimestamp(detail.createdAt);
  const createdRelative = relativeFromIso(detail.createdAt, new Date(), 'Created');
  const generated = formatAbsoluteTimestamp(detail.generatedAt);
  const location = locationDisplay(detail.job);

  return (
    <div className="workspace-page application-page">
      <div className="application-detail-nav">
        <LinkButton href="/dashboard/packs" size="sm" variant="quiet">
          <ArrowLeft aria-hidden="true" size={16} /> All Application Packs
        </LinkButton>
      </div>

      <header className="application-detail-header">
        <div className="application-detail-heading">
          <div className="application-detail-title">
            <span className="h-eyebrow">Application Pack</span>
            <h1>{detail.job.title}</h1>
            <p className="application-detail-company">{detail.job.companyName}</p>
          </div>
          <div className="application-detail-badges">
            <Badge tone={packStatusTone(detail.status)}>{packStatusLabel(detail.status)}</Badge>
            <span>{artifacts.length === 1 ? '1 artifact' : `${artifacts.length} artifacts`}</span>
          </div>
        </div>

        <p className="application-detail-status">{packStatusExplanation(detail.status)}</p>

        <GeneratePackPanel
          aiStatus={aiStatus}
          aiStatusUnavailable={aiStatusUnavailable}
          artifactCount={artifacts.length}
          evidenceFactCount={cited}
          jobId={detail.jobId}
          packId={detail.id}
        />

        <dl className="application-detail-facts">
          <div>
            <dt>Created</dt>
            <dd>
              <span title={createdRelative?.title ?? undefined}>
                {created ?? 'The API did not report a creation time'}
              </span>
              {createdRelative === null ? null : <small>{createdRelative.label}</small>}
            </dd>
          </div>
          <div>
            <dt>Generation finished</dt>
            <dd>
              {generated ?? 'Not finished yet'}
              <small>
                {detail.generatedAt === null
                  ? 'The API reports no completion time for this pack.'
                  : 'The time the API recorded for the finished pack.'}
              </small>
            </dd>
          </div>
          <div>
            <dt>Opportunity</dt>
            <dd>
              {location ?? 'Location not published'}
              <span>
                {detail.job.remoteState === 'unspecified'
                  ? 'Work setup not stated'
                  : detail.job.remoteState}
              </span>
            </dd>
          </div>
          <div>
            <dt>Stored versions</dt>
            <dd>
              Pack version {detail.version}
              <span>Model: {detail.modelVersion ?? 'not recorded'}</span>
              <span>Prompt: {detail.promptVersion ?? 'not recorded'}</span>
            </dd>
          </div>
        </dl>

        <div className="application-detail-actions">
          <a
            className="h-button h-button--primary h-button--md"
            href={detail.applyUrl}
            rel="noopener noreferrer"
            target="_blank"
          >
            <ExternalLink aria-hidden="true" size={16} />
            <span>Open the original posting</span>
          </a>
          <LinkButton href={`/dashboard/radar/${detail.jobId}`} variant="secondary">
            <Radar aria-hidden="true" size={18} /> View the opportunity
          </LinkButton>
        </div>
      </header>

      <Card className="application-evidence">
        <div className="application-section-heading">
          <ListChecks aria-hidden="true" size={20} />
          <div>
            <h2>Evidence behind this pack</h2>
            <p>Which of your own confirmed facts the artifacts were allowed to use.</p>
          </div>
        </div>
        <p className="application-evidence-count">
          <strong>{cited}</strong>
          <span>
            {cited === 1
              ? 'confirmed career fact backs this pack'
              : 'confirmed career facts back this pack'}
          </span>
        </p>
        <p className="application-explainer">
          Every statement in these artifacts is drawn from career facts you confirmed yourself in
          your truth ledger. Hanaply did not invent experience, employers, dates, metrics, or
          qualifications on your behalf, and an artifact that could not be supported by a confirmed
          fact is held back by the truth gate rather than filled in with a plausible guess.
        </p>
        <p className="application-explainer">
          This is a statement about where the wording came from, not a promise about the result: the
          truth gate checks that each artifact only cites confirmed facts, and it does not have
          anyone else verify the content. A pack keeps the evidence list it was created with, so
          facts you confirm later do not rewrite it.
        </p>
        <div className="application-card-actions">
          <LinkButton
            href={`/dashboard/career/${detail.careerProfileId}/facts`}
            variant="secondary"
          >
            <ListChecks aria-hidden="true" size={18} /> Open the truth ledger
          </LinkButton>
        </div>
      </Card>

      {detail.status === 'failed' ? (
        <Alert title="This pack failed" tone="warning">
          {packFailureExplanation(detail.errorCode)}{' '}
          {detail.errorCode === null
            ? 'No failure code is stored for it.'
            : `Failure code: ${detail.errorCode}.`}{' '}
          Artifacts already written before the failure are still listed below and keep their own
          truth-gate results.
        </Alert>
      ) : null}

      {artifacts.length === 0 ? (
        <NoArtifactsYet detail={detail} />
      ) : (
        <section aria-label="Pack artifacts" className="application-artifact-section">
          <div className="application-section-heading">
            <PackageOpen aria-hidden="true" size={20} />
            <div>
              <h2>Artifacts</h2>
              <p>
                Each one is shown with the truth-gate result the API stored for it. Copy or download
                the plain text and use it wherever you apply.
              </p>
            </div>
          </div>
          <ul className="application-artifact-list">
            {artifacts.map((artifact) => (
              <li key={artifact.id}>
                <PackArtifactCard artifact={artifact} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
