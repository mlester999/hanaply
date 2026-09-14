import { Alert, Card, LinkButton } from '@hanaply/ui';
import { Activity, Radar, Save, SearchX, Sparkles } from 'lucide-react';

export interface RadarStatTotals {
  /** Every opportunity matching the current filters, from the response's pagination. */
  total: number;
  /** Opportunities whose stored match verdict is `strong_match`. */
  strongMatches: number;
  /** Opportunities in the radar with no stored match result at all. */
  unanalysed: number;
}

export interface RadarStatStripProps {
  totals: RadarStatTotals | null;
  unavailable: string | null;
}

/**
 * The three counts the radar can actually prove: the filtered total, the strong
 * matches, and the opportunities with no analysis yet. Each is a separate API
 * count, never an extrapolation from the page of results on screen.
 */
export function RadarStatStrip({ totals, unavailable }: RadarStatStripProps) {
  if (unavailable !== null || totals === null) {
    return (
      <Alert title="Radar counts are unavailable" tone="warning">
        {unavailable ??
          'Hanaply could not read the radar counts, so no totals are shown rather than a number that may be stale.'}
      </Alert>
    );
  }
  return (
    <div className="radar-stat-strip">
      <Card className="radar-stat-card">
        <Radar aria-hidden="true" size={22} />
        <span>Opportunities</span>
        <strong>{totals.total}</strong>
        <small>Active opportunities matching the filters currently applied.</small>
      </Card>
      <Card className="radar-stat-card">
        <Sparkles aria-hidden="true" size={22} />
        <span>Strong matches</span>
        <strong>{totals.strongMatches}</strong>
        <small>
          Every analysed opportunity the ranking scored as a strong match, with the confidence shown
          on each card.
        </small>
      </Card>
      <Card className="radar-stat-card">
        <Activity aria-hidden="true" size={22} />
        <span>Not analysed yet</span>
        <strong>{totals.unanalysed}</strong>
        <small>
          Waiting for the radar to scan your career profile. They carry no score until that happens.
        </small>
      </Card>
    </div>
  );
}

export function RadarUnavailable({ message }: { message: string }) {
  return (
    <Card className="radar-unavailable">
      <h2>
        <SearchX aria-hidden="true" size={20} /> The opportunity feed is unavailable
      </h2>
      <p>{message}</p>
      <p className="career-hint">
        Nothing is shown from a cached copy, because a stale opportunity or score would be worse
        than no answer. Reload the page to try again; your saved opportunities and feedback are
        unaffected.
      </p>
      <div className="radar-note-actions">
        <LinkButton href="/dashboard/career" variant="secondary">
          Review your career profile
        </LinkButton>
      </div>
    </Card>
  );
}

export function RadarSavedNote({ savedCount }: { savedCount: number }) {
  return (
    <Card className="radar-note-card">
      <h2>
        <Save aria-hidden="true" size={18} /> Saving is not applying
      </h2>
      <p>
        {savedCount === 0
          ? 'Nothing is saved in this view yet.'
          : `${savedCount} saved ${savedCount === 1 ? 'opportunity' : 'opportunities'} in this view.`}{' '}
        Saving keeps an opportunity here and records the interest signal the ranking learns from; it
        does not create an application. Tracking is separate: open an opportunity and use Add to the
        tracker to start a pipeline record, and every stage change from there is appended to that
        record&apos;s history. This page deliberately shows no stage you cannot actually set.
      </p>
      <div className="radar-note-actions">
        <LinkButton href="/dashboard/applications" variant="secondary">
          Open the application tracker
        </LinkButton>
        <LinkButton href="/dashboard/radar" variant="quiet">
          Back to the full radar
        </LinkButton>
      </div>
    </Card>
  );
}

export interface RadarIgnoredFiltersProps {
  invalidKeys: readonly string[];
}

/** A link the API could not honour is reported, never silently dropped. */
export function RadarIgnoredFilters({ invalidKeys }: RadarIgnoredFiltersProps) {
  if (invalidKeys.length === 0) return null;
  return (
    <Alert title="Some filters in this link were ignored" tone="warning">
      The opportunity service does not accept these filter values, so they were left out of the
      request instead of failing it: {invalidKeys.join(', ')}. Clear or correct them below to filter
      again.
    </Alert>
  );
}
