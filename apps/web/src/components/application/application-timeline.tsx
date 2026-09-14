import type { ApplicationTimeline } from '@hanaply/contracts';
import { Badge, Card } from '@hanaply/ui';
import { History } from 'lucide-react';

import { applicationStageLabel, applicationStageTone } from '@/lib/application';
import { formatAbsoluteTimestamp, relativeFromIso } from '@/lib/radar';

export interface ApplicationTimelineViewProps {
  timeline: ApplicationTimeline;
  now: Date;
}

const eventTypeLabels: Readonly<Record<string, string>> = {
  'application.tracked': 'Tracking started',
  'application.stage_changed': 'Stage changed',
};

function eventTitle(event: ApplicationTimeline['events'][number]): string {
  const label = eventTypeLabels[event.eventType] ?? event.eventType.replaceAll(/[._]/gu, ' ');
  if (event.previousStage !== null && event.newStage !== null) {
    return `${label}: ${applicationStageLabel(event.previousStage)} → ${applicationStageLabel(event.newStage)}`;
  }
  if (event.newStage !== null) {
    return `${label}: ${applicationStageLabel(event.newStage)}`;
  }
  return label;
}

/**
 * The append-only history. Nothing on this page can edit or remove an event;
 * the list is exactly what the API returned, in the order it returned it.
 */
export function ApplicationTimelineView({ timeline, now }: ApplicationTimelineViewProps) {
  return (
    <Card className="application-timeline">
      <div className="application-section-heading">
        <History aria-hidden="true" size={20} />
        <div>
          <h2>History</h2>
          <p>
            {timeline.events.length === 1
              ? 'One recorded event, oldest first.'
              : `${timeline.events.length} recorded events, oldest first.`}{' '}
            Entries are appended and never rewritten.
          </p>
        </div>
      </div>

      {timeline.events.length === 0 ? (
        <p className="application-timeline-empty">
          The API returned no events for this application. The record exists, and entries appear
          here as they are appended — this page does not fill the gap with a reconstructed history.
        </p>
      ) : (
        <ol className="application-timeline-list">
          {timeline.events.map((event) => {
            const absolute = formatAbsoluteTimestamp(event.occurredAt);
            const relative = relativeFromIso(event.occurredAt, now, 'Recorded');
            return (
              <li key={event.id}>
                <div className="application-timeline-marker" aria-hidden="true" />
                <div className="application-timeline-entry">
                  <div className="application-timeline-heading">
                    <strong>{eventTitle(event)}</strong>
                    {event.newStage === null ? null : (
                      <Badge tone={applicationStageTone(event.newStage)}>
                        {applicationStageLabel(event.newStage)}
                      </Badge>
                    )}
                  </div>
                  <p className="application-timeline-when" title={relative?.title ?? undefined}>
                    {absolute ?? 'The API did not report a time for this event'}
                    {relative === null ? '' : ` · ${relative.label}`}
                  </p>
                  {event.note === null ? null : (
                    <p className="application-timeline-note">{event.note}</p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
