'use client';

import { Alert, Button, FormField, Input } from '@hanaply/ui';
import { useActionState } from 'react';

import { logout } from '@/app/actions/auth';
import {
  changePasswordAction,
  revokeOtherSessionsAction,
  type SecurityActionState,
} from '@/app/(customer)/dashboard/settings/security/actions';

const initialState: SecurityActionState = { status: 'idle', message: null };

export function PasswordChangeForm() {
  const [state, action, pending] = useActionState(changePasswordAction, initialState);
  return (
    <form action={action} className="settings-form security-form" noValidate>
      {state.message ? (
        <Alert
          aria-live="polite"
          title={state.status === 'success' ? 'Security updated' : 'Password not changed'}
          tone={state.status === 'success' ? 'success' : 'danger'}
        >
          {state.message}
        </Alert>
      ) : null}
      <FormField id="currentPassword" label="Current password" required>
        <Input
          autoComplete="current-password"
          id="currentPassword"
          maxLength={128}
          name="currentPassword"
          required
          type="password"
        />
      </FormField>
      <div className="settings-form-grid">
        <FormField
          hint="At least 10 characters with a letter and number."
          id="securityNewPassword"
          label="New password"
          required
        >
          <Input
            autoComplete="new-password"
            id="securityNewPassword"
            maxLength={128}
            minLength={10}
            name="password"
            required
            type="password"
          />
        </FormField>
        <FormField id="securityPasswordConfirmation" label="Confirm new password" required>
          <Input
            autoComplete="new-password"
            id="securityPasswordConfirmation"
            maxLength={128}
            name="passwordConfirmation"
            required
            type="password"
          />
        </FormField>
      </div>
      <Button loading={pending} type="submit">
        Change Password
      </Button>
    </form>
  );
}

export function SessionActions() {
  const [state, action, pending] = useActionState(revokeOtherSessionsAction, initialState);
  return (
    <div className="session-actions-panel">
      {state.message ? (
        <Alert
          aria-live="polite"
          title={state.status === 'success' ? 'Sessions updated' : 'Sessions not updated'}
          tone={state.status === 'success' ? 'success' : 'danger'}
        >
          {state.message}
        </Alert>
      ) : null}
      <div className="session-action-buttons">
        <form action={action}>
          <Button loading={pending} type="submit" variant="secondary">
            Log Out Other Sessions
          </Button>
        </form>
        <form action={logout}>
          <Button type="submit" variant="quiet">
            Log Out This Session
          </Button>
        </form>
      </div>
    </div>
  );
}
