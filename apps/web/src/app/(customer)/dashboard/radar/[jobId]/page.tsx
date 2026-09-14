import { HanaplyApiError, type JobDetail } from '@hanaply/contracts';
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
  const [packsResult, trackerResult] = await Promise.allSettled([
    client.applicationPacks(),
    client.applicationTracker(),
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

  return { existingPack, tracked };
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

      <TrackApplicationPanel
        careerProfileId={detail.careerProfileId}
        jobId={detail.id}
        tracked={additions.tracked}
      />

      <JobOriginalPosting detail={detail} />
    </div>
  );
}
