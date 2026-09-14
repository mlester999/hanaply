import { HanaplyApiError, type JobDetail } from '@hanaply/contracts';
import { Card, LinkButton, PageHeader } from '@hanaply/ui';
import { ArrowLeft, SearchX } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { JobIntelligence, JobOriginalPosting } from '@/components/radar/job-intelligence';
import { OpportunityHeader } from '@/components/radar/opportunity-header';
import { radarErrorMessage } from '@/lib/radar-action';
import { isUuid } from '@/lib/radar';
import { createAuthenticatedApiClient, requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Opportunity' };

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
  const requestedProfileId =
    values.careerProfileId !== undefined && isUuid(values.careerProfileId)
      ? values.careerProfileId
      : undefined;

  let detail: JobDetail | null = null;
  let unavailable: string | null = null;
  try {
    detail = (
      await createAuthenticatedApiClient(session).jobDetail(
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

      <JobIntelligence careerProfileId={detail.careerProfileId} detail={detail} />

      <JobOriginalPosting detail={detail} />
    </div>
  );
}
