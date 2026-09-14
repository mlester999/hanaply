'use client';

import { Badge, Button, Card, FormField, LinkButton } from '@hanaply/ui';
import { CalendarClock, KanbanSquare } from 'lucide-react';

import { trackApplicationAction } from '@/app/(customer)/dashboard/applications/actions';
import { ApplicationFeedback } from '@/components/application/application-feedback';
import { useApplicationAction } from '@/components/application/use-application-action';
import {
  applicationStageDescriptions,
  applicationStageLabel,
  applicationStageOrder,
  applicationStageTone,
  type TrackerStage,
} from '@/lib/application';

export interface TrackedApplicationSummary {
  id: string;
  stage: TrackerStage;
}

export interface TrackApplicationPanelProps {
  jobId: string;
  careerProfileId: string | null;
  /** The tracker row the API already reports for this opportunity, if any. */
  tracked: TrackedApplicationSummary | null;
}

/**
 * Starting and seeing tracking for one opportunity.
 *
 * Tracking is a separate record from saving: nothing here claims that saving an
 * opportunity tracks it. Once a row exists, the board owns every later change,
 * so this panel links to it rather than duplicating the controls.
 */
export function TrackApplicationPanel({
  jobId,
  careerProfileId,
  tracked,
}: TrackApplicationPanelProps) {
  const track = useApplicationAction(trackApplicationAction);

  return (
    <Card className="application-track-panel">
      <div className="application-section-heading">
        <KanbanSquare aria-hidden="true" size={20} />
        <div>
          <h2>Application tracker</h2>
          <p>The pipeline record for this opportunity: its stage, notes, and full history.</p>
        </div>
      </div>

      {tracked === null ? (
        <>
          <p className="application-explainer">
            Saving an opportunity keeps it on your radar; tracking it starts the pipeline record.
            Choose the stage it is in now, and every later change is appended to its timeline. The
            tracker holds one record per opportunity.
          </p>
          <form onSubmit={track.onSubmit}>
            <input name="jobId" type="hidden" value={jobId} />
            {careerProfileId === null ? null : (
              <input name="careerProfileId" type="hidden" value={careerProfileId} />
            )}
            <FormField
              hint="You can move it to any other stage later from the tracker."
              id="track-application-stage"
              label="Stage to start from"
            >
              <select
                className="h-input"
                defaultValue="saved"
                id="track-application-stage"
                name="stage"
              >
                {applicationStageOrder.map((stage) => (
                  <option key={stage} value={stage}>
                    {applicationStageLabel(stage)}
                  </option>
                ))}
              </select>
            </FormField>
            <div className="application-card-actions">
              <Button
                leadingIcon={<CalendarClock aria-hidden="true" size={16} />}
                loading={track.pending}
                type="submit"
              >
                Add to the tracker
              </Button>
              <LinkButton href="/dashboard/applications" variant="quiet">
                Open the tracker
              </LinkButton>
            </div>
          </form>
        </>
      ) : (
        <>
          <div className="application-existing-pack">
            <Badge tone={applicationStageTone(tracked.stage)}>
              {applicationStageLabel(tracked.stage)}
            </Badge>
            <span>{applicationStageDescriptions[tracked.stage]}</span>
          </div>
          <p className="application-explainer">
            This opportunity is already tracked. Stage changes, notes, and the appended history are
            managed from the tracker so there is only one place a stage can be changed.
          </p>
          <div className="application-card-actions">
            <LinkButton href="/dashboard/applications">
              <KanbanSquare aria-hidden="true" size={18} /> Open the tracker board
            </LinkButton>
            <LinkButton href={`/dashboard/applications/${tracked.id}`} variant="secondary">
              View the timeline
            </LinkButton>
          </div>
        </>
      )}

      <ApplicationFeedback
        errorTitle="Tracking not started"
        state={track.state}
        successTitle="Tracker updated"
      />
    </Card>
  );
}
