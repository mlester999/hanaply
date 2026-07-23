'use client';

import { Alert, Button, FormField } from '@hanaply/ui';
import { useActionState, useState } from 'react';

import { logout } from '@/app/actions/auth';
import {
  changePasswordAction,
  revokeOtherSessionsAction,
  type SecurityActionState,
} from '@/app/(customer)/dashboard/settings/security/actions';
import { PasswordInput, PasswordRequirements } from '@/components/password-input';

const initialState: SecurityActionState = { status: 'idle', message: null };

export function PasswordChangeForm() {
  const [state, action, pending] = useActionState(changePasswordAction, initialState);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const requirementsVisible = password.length > 0 || confirmation.length > 0;
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
        <PasswordInput
          autoComplete="current-password"
          fieldLabel="Current password"
          id="currentPassword"
          maxLength={128}
          name="currentPassword"
          required
        />
      </FormField>
      <div className="settings-form-grid">
        <FormField id="securityNewPassword" label="New password" required>
          <PasswordInput
            aria-describedby={requirementsVisible ? 'securityPassword-requirements' : undefined}
            autoComplete="new-password"
            fieldLabel="New password"
            id="securityNewPassword"
            maxLength={128}
            minLength={10}
            name="password"
            onChange={(event) => {
              setPassword(event.currentTarget.value);
            }}
            required
          />
        </FormField>
        <FormField id="securityPasswordConfirmation" label="Confirm new password" required>
          <PasswordInput
            aria-describedby={requirementsVisible ? 'securityPassword-requirements' : undefined}
            autoComplete="new-password"
            fieldLabel="Confirm new password"
            id="securityPasswordConfirmation"
            maxLength={128}
            name="passwordConfirmation"
            onChange={(event) => {
              setConfirmation(event.currentTarget.value);
            }}
            required
          />
        </FormField>
      </div>
      <PasswordRequirements
        confirmation={confirmation}
        id="securityPassword-requirements"
        password={password}
        showMatch
      />
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
