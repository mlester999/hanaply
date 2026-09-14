import {
  HanaplyApiError,
  type AiDeterministicMatch,
  type JobDetail,
  type OpportunityAnalysisResponse,
} from '@hanaply/contracts';
import { Card, LinkButton, PageHeader } from '@hanaply/ui';
import { ArrowLeft, SearchX } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import {
  CreatePackPanel,
  type ExistingPackSummary,
} from '@/components/application/create-pack-panel';
import {
  TrackApplicationPanel,
  type TrackedApplicationSummary,
} from '@/components/application/track-application-panel';
import { JobIntelligence, JobOriginalPosting } from '@/components/radar/job-intelligence';
import { OpportunityAnalysis } from '@/components/radar/opportunity-analysis';
import { OpportunityHeader } from '@/components/radar/opportunity-header';
import { radarErrorMessage } from '@/lib/radar-action';
import { isUuid } from '@/lib/radar';
import { createAuthenticatedApiClient, requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Opportunity' };

interface OpportunityAdditions {
  /** The pack the API already reports for this opportunity, if there is one. */
  existingPack: ExistingPackSummary | null;
  /** The tracker row the API already reports for this opportunity, if any. */
  tracked: TrackedApplicationSummary | null;
  /** The stored AI analysis read, or null when there is nothing to read. */
  analysis: OpportunityAnalysisResponse | null;
  /** Why the analysis read failed, when it did. */
  analysisUnavailable: string | null;
}

/**
 * The stored analysis, read without throwing.
 *
 * A failed read here is not a failed page: the AI panel says the analysis could
 * not be read and points at the deterministic intelligence above it. Catching at
 * the call rather than inspecting a settled rejection keeps the API's own
 * sentence, which is the only place the real reason is stated.
 */
async function readStoredAnalysis(
  client: ReturnType<typeof createAuthenticatedApiClient>,
  jobId: string,
): Promise<{ analysis: OpportunityAnalysisResponse | null; unavailable: string | null }> {
  try {
    return { analysis: (await client.storedOpportunityAnalysis(jobId)).data, unavailable: null };
  } catch (error) {
    return {
      analysis: null,
      unavailable: radarErrorMessage(
        error,
        'Hanaply could not read the stored AI analysis for this opportunity.',
      ),
    };
  }
}

/**
 * The pack and tracker panels are enhancements on this page: reading either
 * directory can fail without taking the opportunity down. A failed read leaves
 * the panel in its "nothing found yet" state, and both write paths are
 * idempotent per opportunity, so a wrong guess can never duplicate a pack or a
 * tracker row.
 */
async function readOpportunityAdditions(
  client: ReturnType<typeof createAuthenticatedApiClient>,
  detail: JobDetail,
): Promise<OpportunityAdditions> {
  const [packsResult, trackerResult, analysisResult] = await Promise.allSettled([
    client.applicationPacks(),
    client.applicationTracker(),
    readStoredAnalysis(client, detail.id),
  ]);

  let existingPack: ExistingPackSummary | null = null;
  if (packsResult.status === 'fulfilled') {
    const forJob = packsResult.value.data.items.filter((item) => item.jobId === detail.id);
    const match =
      forJob.find((item) => item.careerProfileId === detail.careerProfileId) ?? forJob[0] ?? null;
    if (match !== null) {
      existingPack = {
        id: match.id,
        status: match.status,
        artifactCount: match.artifactCount,
      };
    }
  }

  let tracked: TrackedApplicationSummary | null = null;
  if (trackerResult.status === 'fulfilled') {
    const row = trackerResult.value.data.items.find((item) => item.jobId === detail.id) ?? null;
    if (row !== null) tracked = { id: row.id, stage: row.stage };
  }

  // This third read never rejects: it resolves to its own failure state, so the
  // page needs no untyped settled-rejection to render the degraded panel.
  const analysisRead = analysisResult.status === 'fulfilled' ? analysisResult.value : null;

  return {
    existingPack,
    tracked,
    analysis: analysisRead?.analysis ?? null,
    analysisUnavailable: analysisRead?.unavailable ?? null,
  };
}

/** The stored match, quoted into the shape the AI panel shows beside a report. */
function deterministicMatchFrom(detail: JobDetail): AiDeterministicMatch | null {
  if (detail.match === null) return null;
  return {
    score: detail.match.score,
    verdict: detail.match.verdict,
    confidence: detail.match.confidence,
    modelVersion: detail.match.modelVersion,
    recommendedAction: detail.match.recommendedAction,
  };
}

export default async function OpportunityDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ jobId: string }>;
  searchParams: Promise<{ careerProfileId?: string }>;
}) {
  const { jobId } = await params;
  const values = await searchParams;
  if (!isUuid(jobId)) notFound();

  const { session } = await requireUser();
  const client = createAuthenticatedApiClient(session);
  const requestedProfileId =
    values.careerProfileId !== undefined && isUuid(values.careerProfileId)
      ? values.careerProfileId
      : undefined;

  let detail: JobDetail | null = null;
  let unavailable: string | null = null;
  try {
    detail = (
      await client.jobDetail(
        jobId,
        requestedProfileId === undefined ? undefined : { careerProfileId: requestedProfileId },
      )
    ).data;
  } catch (error) {
    if (error instanceof HanaplyApiError && error.status === 404) notFound();
    unavailable = radarErrorMessage(error, 'Hanaply could not load this opportunity.');
  }

  if (detail === null) {
    return (
      <div className="workspace-page radar-page">
        <PageHeader eyebrow="Career radar" title="Opportunity" />
        <Card className="radar-unavailable">
          <h2>
            <SearchX aria-hidden="true" size={20} /> This opportunity is unavailable
          </h2>
          <p>{unavailable ?? 'The opportunity could not be loaded.'}</p>
          <div className="radar-note-actions">
            <LinkButton href="/dashboard/radar" variant="secondary">
              <ArrowLeft aria-hidden="true" size={16} /> Back to the radar
            </LinkButton>
          </div>
        </Card>
      </div>
    );
  }

  const additions = await readOpportunityAdditions(client, detail);

  return (
    <div className="workspace-page radar-page">
      <div className="radar-detail-nav">
        <LinkButton href="/dashboard/radar" size="sm" variant="quiet">
          <ArrowLeft aria-hidden="true" size={16} /> Back to the radar
        </LinkButton>
      </div>

      <OpportunityHeader
        careerProfileId={detail.careerProfileId}
        detail={detail}
        now={new Date()}
      />

      <JobIntelligence
        careerProfileId={detail.careerProfileId}
        detail={detail}
        packAction={
          <CreatePackPanel
            careerProfileId={detail.careerProfileId}
            existingPack={additions.existingPack}
            jobId={detail.id}
          />
        }
      />

      <OpportunityAnalysis
        analysis={additions.analysis}
        careerProfileId={detail.careerProfileId}
        fallbackMatch={deterministicMatchFrom(detail)}
        jobId={detail.id}
        unavailable={additions.analysisUnavailable}
      />

      <TrackApplicationPanel
        careerProfileId={detail.careerProfileId}
        jobId={detail.id}
        tracked={additions.tracked}
      />

      <JobOriginalPosting detail={detail} />
    </div>
  );
}
