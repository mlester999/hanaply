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
}

export function NotificationSettingsForm({ value }: { value: NotificationSettingsValue }) {
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
        <label className="preference-row preference-row--future" htmlFor="futureJobAlerts">
          <span className="h-sr-only">Future job alert emails</span>
          <span>
            <strong>Job alerts</strong>
            <small>Coming in a future phase. No job-alert delivery is active.</small>
          </span>
          <input disabled id="futureJobAlerts" type="checkbox" />
        </label>
        <label className="preference-row preference-row--future" htmlFor="futureDailyDigest">
          <span className="h-sr-only">Future daily digest emails</span>
          <span>
            <strong>Daily digest</strong>
            <small>Coming in a future phase. No digest delivery is active.</small>
          </span>
          <input disabled id="futureDailyDigest" type="checkbox" />
        </label>
      </fieldset>
      <div className="settings-form-actions">
        <Button loading={pending} type="submit">
          Save Preferences
        </Button>
      </div>
    </form>
  );
}
