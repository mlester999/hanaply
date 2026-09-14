import type { ApplicationTracker } from '@hanaply/contracts';
import { Badge, Card, EmptyState, LinkButton } from '@hanaply/ui';
import { KanbanSquare, Radar } from 'lucide-react';

import { TrackerCard } from '@/components/application/tracker-card';
import {
  applicationStageDescriptions,
  applicationStageLabel,
  applicationStageOrder,
  applicationStageTone,
} from '@/lib/application';
import { formatAbsoluteTimestamp } from '@/lib/radar';

export interface TrackerBoardProps {
  tracker: ApplicationTracker;
}

/**
 * The pipeline board: one section per stage, in the order a hiring process runs,
 * each with the count the API reported and the tracked applications in it.
 *
 * `counts` omits stages that hold nothing, and the tracker response is not
 * paginated, so an absent key falls back to the number of rows shown here —
 * the same set, counted rather than reported.
 */
export function TrackerBoard({ tracker }: TrackerBoardProps) {
  if (tracker.items.length === 0) {
    return (
      <EmptyState
        action={
          <div className="application-empty-actions">
            <LinkButton href="/dashboard/radar">
              <Radar aria-hidden="true" size={18} /> Open the job radar
            </LinkButton>
          </div>
        }
        description={
          <>
            <p>
              Nothing is tracked yet. Tracking starts from an opportunity on the radar: open one,
              save it if you want to keep it, and use Add to the tracker with the stage it is in.
              From then on, every stage change, note, and scheduled next action is recorded here,
              and each record keeps an append-only history.
            </p>
            <p>
              Saving an opportunity is not the same as applying to it. This board only ever shows a
              stage you set yourself, and it never invents a stage for an opportunity you have not
              started tracking.
            </p>
          </>
        }
        eyebrow="Nothing tracked yet"
        icon={<KanbanSquare aria-hidden="true" size={23} />}
        title="Your tracker is empty"
      />
    );
  }

  const evaluated = formatAbsoluteTimestamp(tracker.evaluatedAt);

  return (
    <section aria-label="Application pipeline" className="application-board-section">
      <p className="application-board-note">
        {tracker.items.length === 1
          ? 'One tracked application.'
          : `${tracker.items.length} tracked applications.`}
        {evaluated === null ? '' : ` Counted ${evaluated}.`} The stage counts are the API&apos;s
        own; each stage control below sends the version it was rendered with, so a change made
        elsewhere is reported rather than overwritten.
      </p>
      <div className="application-board">
        {applicationStageOrder.map((stage) => {
          const items = tracker.items.filter((item) => item.stage === stage);
          const reported = tracker.counts[stage];
          const count = reported ?? items.length;
          return (
            <Card className={`application-board-column is-${stage}`} key={stage}>
              <div className="application-board-heading">
                <div>
                  <h3>{applicationStageLabel(stage)}</h3>
                  <p>{applicationStageDescriptions[stage]}</p>
                </div>
                <Badge tone={applicationStageTone(stage)}>
                  {count === 1 ? '1 application' : `${count} applications`}
                </Badge>
              </div>
              {items.length === 0 ? (
                <p className="application-board-empty">No tracked application is at this stage.</p>
              ) : (
                <ul className="application-board-list">
                  {items.map((item) => (
                    <li key={item.id}>
                      <TrackerCard
                        item={item}
                        labels={{
                          stageChanged: formatAbsoluteTimestamp(item.stageChangedAt),
                          applied: formatAbsoluteTimestamp(item.appliedAt),
                          nextAction: formatAbsoluteTimestamp(item.nextActionAt),
                        }}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          );
        })}
      </div>
    </section>
  );
}
