'use client';

import { Alert, Button, FormField } from '@hanaply/ui';
import { useActionState, useState } from 'react';

import { resetPasswordAction, type ResetPasswordState } from '@/app/(auth)/reset-password/actions';
import { PasswordInput, PasswordRequirements } from '@/components/password-input';

const initialState: ResetPasswordState = {
  status: 'idle',
  message: null,
  fieldErrors: {},
};

function firstError(
  errors: Readonly<Record<string, readonly string[]>>,
  field: string,
): string | undefined {
  return errors[field]?.[0];
}

export function ResetPasswordForm() {
  const [state, action, pending] = useActionState(resetPasswordAction, initialState);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const requirementsVisible = password.length > 0 || confirmation.length > 0;
  return (
    <form action={action} className="auth-form" noValidate>
      {state.message ? (
        <Alert aria-live="polite" title="Password was not changed" tone="danger">
          {state.message}
        </Alert>
      ) : null}
      <FormField
        error={firstError(state.fieldErrors, 'password')}
        id="newPassword"
        label="New password"
        required
      >
        <PasswordInput
          aria-describedby={
            [
              firstError(state.fieldErrors, 'password') ? 'newPassword-error' : null,
              requirementsVisible ? 'newPassword-requirements' : null,
            ]
              .filter(Boolean)
              .join(' ') || undefined
          }
          aria-invalid={Boolean(firstError(state.fieldErrors, 'password'))}
          autoComplete="new-password"
          fieldLabel="New password"
          id="newPassword"
          maxLength={128}
          minLength={10}
          name="password"
          onChange={(event) => {
            setPassword(event.currentTarget.value);
          }}
          required
        />
      </FormField>
      <FormField
        error={firstError(state.fieldErrors, 'passwordConfirmation')}
        id="newPasswordConfirmation"
        label="Confirm new password"
        required
      >
        <PasswordInput
          aria-describedby={
            [
              firstError(state.fieldErrors, 'passwordConfirmation')
                ? 'newPasswordConfirmation-error'
                : null,
              requirementsVisible ? 'newPassword-requirements' : null,
            ]
              .filter(Boolean)
              .join(' ') || undefined
          }
          aria-invalid={Boolean(firstError(state.fieldErrors, 'passwordConfirmation'))}
          autoComplete="new-password"
          fieldLabel="Confirm new password"
          id="newPasswordConfirmation"
          maxLength={128}
          name="passwordConfirmation"
          onChange={(event) => {
            setConfirmation(event.currentTarget.value);
          }}
          required
        />
      </FormField>
      <PasswordRequirements
        confirmation={confirmation}
        id="newPassword-requirements"
        password={password}
        showMatch
      />
      <Button block loading={pending} type="submit">
        Save new password
      </Button>
    </form>
  );
}
