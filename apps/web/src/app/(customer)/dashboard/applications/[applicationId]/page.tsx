import {
  HanaplyApiError,
  type ApplicationTimeline,
  type ApplicationTrackerItem,
} from '@hanaply/contracts';
import { Alert, Badge, Card, LinkButton, PageHeader } from '@hanaply/ui';
import { ArrowLeft, ExternalLink, KanbanSquare, MapPin, Radar } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ApplicationTimelineView } from '@/components/application/application-timeline';
import { ApplicationUnavailable } from '@/components/application/application-unavailable';
import { applicationStageLabel, applicationStageTone, remoteStateLabel } from '@/lib/application';
import { applicationErrorMessage } from '@/lib/application-action';
import { formatAbsoluteTimestamp, isUuid } from '@/lib/radar';
import { createAuthenticatedApiClient, requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Application timeline' };

export default async function ApplicationTimelinePage({
  params,
}: {
  params: Promise<{ applicationId: string }>;
}) {
  const { applicationId } = await params;
  if (!isUuid(applicationId)) notFound();

  const { session } = await requireUser();
  const client = createAuthenticatedApiClient(session);

  let timeline: ApplicationTimeline | null = null;
  let unavailable: string | null = null;
  try {
    timeline = (await client.applicationTimeline(applicationId)).data;
  } catch (error) {
    if (error instanceof HanaplyApiError && error.status === 404) notFound();
    unavailable = applicationErrorMessage(error, 'Hanaply could not load this application.');
  }

  // The opportunity's own title, company, and posting link live on the board
  // response, not on the timeline, so they are read separately. Failing to read
  // them leaves the history intact rather than failing the page.
  let item: ApplicationTrackerItem | null = null;
  try {
    const tracker = (await client.applicationTracker()).data;
    item = tracker.items.find((entry) => entry.id === applicationId) ?? null;
  } catch {
    item = null;
  }

  if (timeline === null) {
    return (
      <div className="workspace-page application-page">
        <PageHeader eyebrow="Application tracker" title="Tracked application" />
        <ApplicationUnavailable
          message={unavailable ?? 'This application could not be loaded.'}
          title="This application is unavailable"
        />
      </div>
    );
  }

  const application = timeline.application;
  const stageChanged = formatAbsoluteTimestamp(application.stageChangedAt);
  const applied = formatAbsoluteTimestamp(application.appliedAt);
  const nextAction = formatAbsoluteTimestamp(application.nextActionAt);

  return (
    <div className="workspace-page application-page">
      <div className="application-detail-nav">
        <LinkButton href="/dashboard/applications" size="sm" variant="quiet">
          <ArrowLeft aria-hidden="true" size={16} /> Back to the board
        </LinkButton>
      </div>

      <header className="application-detail-header">
        <div className="application-detail-heading">
          <div className="application-detail-title">
            <span className="h-eyebrow">Tracked application</span>
            <h1>{item === null ? 'Application history' : item.jobTitle}</h1>
            <p className="application-detail-company">
              {item === null ? 'Company not returned for this record' : item.companyName}
            </p>
          </div>
          <div className="application-detail-badges">
            <Badge tone={applicationStageTone(application.stage)}>
              {applicationStageLabel(application.stage)}
            </Badge>
          </div>
        </div>

        {item === null ? (
          <Alert title="The board did not return this record" tone="warning">
            The history below is complete, but the opportunity&apos;s title, company, and posting
            link could not be read from the tracker board just now. They are left out rather than
            guessed at.
          </Alert>
        ) : (
          <p className="application-tracker-location">
            <MapPin aria-hidden="true" size={15} />
            {item.locationRaw ?? 'Location not published'} · {remoteStateLabel(item.remoteState)}
          </p>
        )}

        <dl className="application-detail-facts">
          <div>
            <dt>Stage changed</dt>
            <dd>{stageChanged ?? 'Not recorded'}</dd>
          </div>
          <div>
            <dt>Applied</dt>
            <dd>
              {applied ?? 'No application date recorded yet'}
              <small>
                Hanaply records this the first time the application reaches Applied, Interviewing,
                Offer, or Rejected.
              </small>
            </dd>
          </div>
          <div>
            <dt>Next action</dt>
            <dd>
              {nextAction ?? 'Nothing scheduled'}
              {application.nextActionNote === null ? null : (
                <small>{application.nextActionNote}</small>
              )}
            </dd>
          </div>
          <div>
            <dt>Version</dt>
            <dd>
              {application.version}
              <small>Every write sends this version, so a stale change is refused.</small>
            </dd>
          </div>
        </dl>

        {application.notes === null ? null : (
          <Card className="application-notes-card">
            <h2>Your notes</h2>
            <p>{application.notes}</p>
          </Card>
        )}

        {application.outcomeNote === null ? null : (
          <Card className="application-notes-card">
            <h2>Outcome note</h2>
            <p>{application.outcomeNote}</p>
          </Card>
        )}

        <div className="application-detail-actions">
          <LinkButton href={`/dashboard/radar/${application.jobId}`} variant="secondary">
            <Radar aria-hidden="true" size={18} /> View the opportunity
          </LinkButton>
          {item === null ? null : (
            <a
              className="h-button h-button--secondary h-button--md"
              href={item.applyUrl}
              rel="noopener noreferrer"
              target="_blank"
            >
              <ExternalLink aria-hidden="true" size={16} />
              <span>Open the original posting</span>
            </a>
          )}
          <LinkButton href="/dashboard/applications" variant="quiet">
            <KanbanSquare aria-hidden="true" size={18} /> Back to the board
          </LinkButton>
        </div>
      </header>

      <ApplicationTimelineView now={new Date()} timeline={timeline} />
    </div>
  );
}
