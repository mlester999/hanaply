'use client';

import { Alert, Button } from '@hanaply/ui';
import { useActionState } from 'react';

import {
  type NotificationFormState,
  updateNotificationPreferencesAction,
} from '@/app/(customer)/dashboard/settings/notifications/actions';

const initialState: NotificationFormState = { status: 'idle', message: null };

export interface NotificationSettingsValue {
  productUpdates: boolean;
  marketingEmails: boolean;
  jobAlerts: boolean;
  dailyDigest: boolean;
  instantAlerts: boolean;
  weeklyStrategy: boolean;
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
}

/** Which opportunity notifications the evaluated plan actually includes. */
export interface NotificationPlanInclusions {
  jobAlerts: boolean;
  dailyDigest: boolean;
  instantAlerts: boolean;
  weeklyStrategy: boolean;
}

/**
 * A toggle the plan does not include stays enabled on purpose. The API is the
 * authority on entitlements, so the control is offered and the requirement is
 * stated next to it: saving it on returns the API's own refusal, which is more
 * useful than a control that silently does nothing.
 */
function planRequirement(included: boolean, requirement: string) {
  return (
    <small className={included ? 'preference-note' : 'preference-note preference-note--upgrade'}>
      {included
        ? `${requirement} It is included in your current plan.`
        : `${requirement} Your current plan does not include it yet, so saving it on is refused with the plan message.`}
    </small>
  );
}

export function NotificationSettingsForm({
  value,
  plan,
}: {
  value: NotificationSettingsValue;
  plan: NotificationPlanInclusions;
}) {
  const [state, action, pending] = useActionState(
    updateNotificationPreferencesAction,
    initialState,
  );
  return (
    <form action={action} className="settings-form">
      {state.message ? (
        <Alert
          aria-live="polite"
          title={state.status === 'success' ? 'Preferences saved' : 'Preferences not saved'}
          tone={state.status === 'success' ? 'success' : 'danger'}
        >
          {state.message}
        </Alert>
      ) : null}
      <fieldset className="preference-list">
        <legend>Email categories</legend>
        <label className="preference-row preference-row--locked" htmlFor="securityEmails">
          <span className="h-sr-only">Authentication and security emails</span>
          <span>
            <strong>Authentication and security</strong>
            <small>Password, verification, and security-critical account messages.</small>
          </span>
          <input checked disabled id="securityEmails" readOnly type="checkbox" />
        </label>
        <label className="preference-row" htmlFor="productUpdates">
          <span className="h-sr-only">Product update emails</span>
          <span>
            <strong>Product updates</strong>
            <small>Occasional updates about Hanaply capabilities and account access.</small>
          </span>
          <input
            defaultChecked={value.productUpdates}
            id="productUpdates"
            name="productUpdates"
            type="checkbox"
          />
        </label>
        <label className="preference-row" htmlFor="marketingEmails">
          <span className="h-sr-only">Marketing emails</span>
          <span>
            <strong>Marketing emails</strong>
            <small>Optional campaigns and owner-approved announcements.</small>
          </span>
          <input
            defaultChecked={value.marketingEmails}
            id="marketingEmails"
            name="marketingEmails"
            type="checkbox"
          />
        </label>
        <label className="preference-row" htmlFor="jobAlerts">
          <span className="h-sr-only">Job alert emails</span>
          <span>
            <strong>Job alerts</strong>
            <small>
              High-scoring matches from a scan, sent as one message per alert window. Nothing is
              queued unless you turn this on and your plan includes job alerts.
            </small>
            {planRequirement(plan.jobAlerts, 'Job alerts are included with Plus and Pro.')}
          </span>
          <input defaultChecked={value.jobAlerts} id="jobAlerts" name="jobAlerts" type="checkbox" />
        </label>
        <label className="preference-row" htmlFor="dailyDigest">
          <span className="h-sr-only">Daily digest emails</span>
          <span>
            <strong>Daily digest</strong>
            <small>
              One message a day with your strongest matches, your saved jobs, and your active
              applications.
            </small>
            {planRequirement(plan.dailyDigest, 'The daily digest is included with Plus and Pro.')}
          </span>
          <input
            defaultChecked={value.dailyDigest}
            id="dailyDigest"
            name="dailyDigest"
            type="checkbox"
          />
        </label>
        <label className="preference-row" htmlFor="instantAlerts">
          <span className="h-sr-only">Instant alert emails</span>
          <span>
            <strong>Instant alerts</strong>
            <small>
              Send as soon as a scan finds a strong match instead of waiting for a digest.
            </small>
            {planRequirement(plan.instantAlerts, 'Instant alerts require the Pro plan.')}
          </span>
          <input
            defaultChecked={value.instantAlerts}
            id="instantAlerts"
            name="instantAlerts"
            type="checkbox"
          />
        </label>
        <label className="preference-row" htmlFor="weeklyStrategy">
          <span className="h-sr-only">Weekly strategy emails</span>
          <span>
            <strong>Weekly strategy</strong>
            <small>A weekly summary of how your search is progressing and what to try next.</small>
            {planRequirement(
              plan.weeklyStrategy,
              'The weekly strategy summary requires the Pro plan.',
            )}
          </span>
          <input
            defaultChecked={value.weeklyStrategy}
            id="weeklyStrategy"
            name="weeklyStrategy"
            type="checkbox"
          />
        </label>
      </fieldset>
      <div className="preference-row preference-row--hours">
        <span>
          <strong>Quiet hours</strong>
          <small>
            Non-urgent alerts are held during these local hours (Asia/Manila). Leave both blank to
            turn quiet hours off.
          </small>
        </span>
        <span className="preference-hours">
          <label htmlFor="quietHoursStart">From</label>
          <input
            defaultValue={value.quietHoursStart ?? ''}
            id="quietHoursStart"
            inputMode="numeric"
            max={23}
            min={0}
            name="quietHoursStart"
            placeholder="22"
            type="number"
          />
          <label htmlFor="quietHoursEnd">To</label>
          <input
            defaultValue={value.quietHoursEnd ?? ''}
            id="quietHoursEnd"
            inputMode="numeric"
            max={23}
            min={0}
            name="quietHoursEnd"
            placeholder="6"
            type="number"
          />
        </span>
      </div>
      <div className="settings-form-actions">
        <Button loading={pending} type="submit">
          Save Preferences
        </Button>
      </div>
    </form>
  );
}
