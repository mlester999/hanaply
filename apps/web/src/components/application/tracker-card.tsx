'use client';

import type { ApplicationTrackerItem } from '@hanaply/contracts';
import { Badge, Button, Card, FormField, LinkButton } from '@hanaply/ui';
import {
  ArrowRight,
  CalendarClock,
  ChevronDown,
  ExternalLink,
  FileClock,
  MapPin,
  StickyNote,
} from 'lucide-react';
import { useRef, useState, type SubmitEvent } from 'react';

import {
  setApplicationStageAction,
  trackApplicationAction,
} from '@/app/(customer)/dashboard/applications/actions';
import { ApplicationFeedback } from '@/components/application/application-feedback';
import { useApplicationAction } from '@/components/application/use-application-action';
import {
  applicationStageDescriptions,
  applicationStageLabel,
  applicationStageOrder,
  applicationStageTone,
  nextApplicationStage,
  remoteStateLabel,
} from '@/lib/application';

export interface TrackerCardLabels {
  /** Absolute timestamps, formatted by the server so no client clock is read. */
  stageChanged: string | null;
  applied: string | null;
  nextAction: string | null;
}

export interface TrackerCardProps {
  item: ApplicationTrackerItem;
  labels: TrackerCardLabels;
}

/**
 * One tracked application.
 *
 * Both stage controls send the version the member was looking at, so a change
 * made in another session is refused rather than overwritten; `expectedVersion`
 * is never omitted and never guessed at. The notes form cannot do that — the
 * tracking endpoint takes no version — so the card says so beside the controls
 * rather than implying a check that does not happen.
 */
export function TrackerCard({ item, labels }: TrackerCardProps) {
  const stageMenu = useRef<HTMLDetailsElement>(null);
  const notesMenu = useRef<HTMLDetailsElement>(null);
  const [dateError, setDateError] = useState<string | null>(null);
  const [notesError, setNotesError] = useState<string | null>(null);
  const next = nextApplicationStage(item.stage);

  const advance = useApplicationAction(setApplicationStageAction);
  const move = useApplicationAction(setApplicationStageAction, {
    onSuccess: () => {
      if (stageMenu.current) stageMenu.current.open = false;
    },
  });
  const notes = useApplicationAction(trackApplicationAction, {
    onSuccess: () => {
      if (notesMenu.current) notesMenu.current.open = false;
    },
  });

  /**
   * The `datetime-local` control has no timezone, so its wall-clock value is
   * turned into an instant here, in the browser that is displaying it. The
   * server refuses anything that arrives without a zone.
   */
  function onSubmitNotes(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const raw = formData.get('nextActionAt');
    if (typeof raw === 'string' && raw.trim() !== '') {
      const instant = new Date(raw);
      if (Number.isNaN(instant.getTime())) {
        setDateError('Enter a valid date and time, or leave the field empty.');
        return;
      }
      formData.set('nextActionAt', instant.toISOString());
    }
    const noteValue = formData.get('nextActionNote');
    if (typeof noteValue === 'string' && noteValue.trim().length > 300) {
      setNotesError('Keep the next action note under 300 characters.');
      return;
    }
    setDateError(null);
    setNotesError(null);
    notes.submit(formData);
  }

  return (
    <Card className="application-tracker-card">
      <div className="application-tracker-heading">
        <div className="application-tracker-title">
          <h3>{item.jobTitle}</h3>
          <p>{item.companyName}</p>
        </div>
        <Badge tone={applicationStageTone(item.stage)}>{applicationStageLabel(item.stage)}</Badge>
      </div>

      <p className="application-tracker-location">
        <MapPin aria-hidden="true" size={15} />
        {item.locationRaw ?? 'Location not published'} · {remoteStateLabel(item.remoteState)}
      </p>

      <dl className="application-tracker-meta">
        <div>
          <dt>Stage changed</dt>
          <dd>{labels.stageChanged ?? 'Not recorded'}</dd>
        </div>
        <div>
          <dt>Applied</dt>
          <dd>{labels.applied ?? 'No application date recorded yet'}</dd>
        </div>
        <div>
          <dt>Next action</dt>
          <dd>
            {labels.nextAction ?? 'Nothing scheduled'}
            {item.nextActionNote === null ? null : <small>{item.nextActionNote}</small>}
          </dd>
        </div>
      </dl>

      {item.notes === null ? null : <p className="application-tracker-notes">{item.notes}</p>}

      <div className="application-card-actions">
        {next === null ? (
          <span className="application-tracker-terminal">
            {applicationStageLabel(item.stage)} is a closing stage; there is no automatic next step.
          </span>
        ) : (
          <form onSubmit={advance.onSubmit}>
            <input name="applicationId" type="hidden" value={item.id} />
            <input name="jobId" type="hidden" value={item.jobId} />
            <input name="stage" type="hidden" value={next} />
            <input name="expectedVersion" type="hidden" value={item.version} />
            <Button
              leadingIcon={<ArrowRight aria-hidden="true" size={16} />}
              loading={advance.pending}
              type="submit"
              variant="secondary"
            >
              Move to {applicationStageLabel(next)}
            </Button>
          </form>
        )}
        <LinkButton href={`/dashboard/applications/${item.id}`} variant="secondary">
          <FileClock aria-hidden="true" size={16} /> Timeline
        </LinkButton>
        <LinkButton href={`/dashboard/radar/${item.jobId}`} variant="quiet">
          Opportunity
        </LinkButton>
        <a
          className="h-button h-button--quiet h-button--md"
          href={item.applyUrl}
          rel="noopener noreferrer"
          target="_blank"
        >
          <ExternalLink aria-hidden="true" size={16} />
          <span>Original posting</span>
        </a>
      </div>

      <details className="application-disclosure" ref={stageMenu}>
        <summary>
          <span className="application-disclosure-trigger">
            <ChevronDown aria-hidden="true" size={15} /> Move to another stage
          </span>
        </summary>
        <form className="application-disclosure-body" onSubmit={move.onSubmit}>
          <input name="applicationId" type="hidden" value={item.id} />
          <input name="jobId" type="hidden" value={item.jobId} />
          <input name="expectedVersion" type="hidden" value={item.version} />
          <FormField
            hint="Every stage is listed. Choosing the stage it is already in records nothing."
            id={`application-stage-${item.id}`}
            label="Stage"
          >
            <select
              className="h-input"
              defaultValue={next ?? item.stage}
              id={`application-stage-${item.id}`}
              name="stage"
            >
              {applicationStageOrder.map((stage) => (
                <option key={stage} value={stage}>
                  {applicationStageLabel(stage)}
                  {stage === item.stage ? ' · current' : ''}
                </option>
              ))}
            </select>
          </FormField>
          <FormField
            hint="Optional. It is appended to the timeline beside the stage change."
            id={`application-stage-note-${item.id}`}
            label="Note for this change"
          >
            <input
              className="h-input"
              id={`application-stage-note-${item.id}`}
              maxLength={1000}
              name="note"
              type="text"
            />
          </FormField>
          <p className="application-disclosure-note">
            {applicationStageDescriptions[item.stage]} It is here now.
          </p>
          <div className="application-card-actions">
            <Button loading={move.pending} type="submit">
              Save the new stage
            </Button>
          </div>
        </form>
      </details>

      <details className="application-disclosure" ref={notesMenu}>
        <summary>
          <span className="application-disclosure-trigger">
            <StickyNote aria-hidden="true" size={15} /> Notes and next action
          </span>
        </summary>
        <form className="application-disclosure-body" onSubmit={onSubmitNotes}>
          <input name="applicationId" type="hidden" value={item.id} />
          <input name="jobId" type="hidden" value={item.jobId} />
          <FormField
            hint="Up to 4000 characters. Saving text in this box replaces the notes stored on this application; an empty box leaves them exactly as they are."
            id={`application-notes-${item.id}`}
            label="Notes"
          >
            <textarea
              className="h-input h-textarea"
              defaultValue={item.notes ?? ''}
              id={`application-notes-${item.id}`}
              maxLength={4000}
              name="notes"
              rows={4}
            />
          </FormField>
          <FormField
            hint="Leave this empty to keep the next action already scheduled. A next action is cleared automatically when the application moves to Offer, Rejected, Withdrawn, or Archived, because Hanaply does not clear it from this form."
            id={`application-next-action-${item.id}`}
            label="Reschedule the next action"
          >
            <input
              aria-describedby={
                dateError === null ? undefined : `application-next-action-error-${item.id}`
              }
              className="h-input"
              id={`application-next-action-${item.id}`}
              name="nextActionAt"
              type="datetime-local"
            />
          </FormField>
          {dateError === null ? null : (
            <p
              className="h-field-error"
              id={`application-next-action-error-${item.id}`}
              role="alert"
            >
              {dateError}
            </p>
          )}
          <FormField
            hint="Up to 300 characters. Leave it empty to keep the note already stored."
            id={`application-next-action-note-${item.id}`}
            label="Next action note"
          >
            <input
              className="h-input"
              defaultValue={item.nextActionNote ?? ''}
              id={`application-next-action-note-${item.id}`}
              maxLength={300}
              name="nextActionNote"
              type="text"
            />
          </FormField>
          {notesError === null ? null : (
            <p className="h-field-error" role="alert">
              {notesError}
            </p>
          )}
          <p className="application-disclosure-note">
            Saving notes never changes the stage. Unlike the stage controls above, this save carries
            no version check, because the tracking endpoint does not accept one — the stage is
            re-read from the record when it is written, so a stage moved elsewhere is kept. A
            scheduled next action is cleared automatically when the application moves to Offer,
            Rejected, Withdrawn, or Archived.
          </p>
          <div className="application-card-actions">
            <Button
              leadingIcon={<CalendarClock aria-hidden="true" size={16} />}
              loading={notes.pending}
              type="submit"
            >
              Save notes and next action
            </Button>
          </div>
        </form>
      </details>

      <ApplicationFeedback
        className="application-card-feedback"
        errorTitle="Stage not changed"
        state={advance.state}
        successTitle="Stage updated"
      />
      <ApplicationFeedback
        className="application-card-feedback"
        errorTitle="Stage not changed"
        state={move.state}
        successTitle="Stage updated"
      />
      <ApplicationFeedback
        className="application-card-feedback"
        errorTitle="Application not updated"
        state={notes.state}
        successTitle="Application updated"
      />
    </Card>
  );
}
