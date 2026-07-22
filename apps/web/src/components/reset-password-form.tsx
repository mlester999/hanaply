'use client';

import { Alert, Button, FormField, Input } from '@hanaply/ui';
import { useActionState } from 'react';

import { resetPasswordAction, type ResetPasswordState } from '@/app/(auth)/reset-password/actions';

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
  return (
    <form action={action} className="auth-form" noValidate>
      {state.message ? (
        <Alert aria-live="polite" title="Password was not changed" tone="danger">
          {state.message}
        </Alert>
      ) : null}
      <FormField
        error={firstError(state.fieldErrors, 'password')}
        hint="Use at least 10 characters with a letter and a number."
        id="newPassword"
        label="New password"
        required
      >
        <Input
          aria-describedby={
            firstError(state.fieldErrors, 'password') ? 'newPassword-error' : undefined
          }
          aria-invalid={Boolean(firstError(state.fieldErrors, 'password'))}
          autoComplete="new-password"
          id="newPassword"
          maxLength={128}
          minLength={10}
          name="password"
          required
          type="password"
        />
      </FormField>
      <FormField
        error={firstError(state.fieldErrors, 'passwordConfirmation')}
        id="newPasswordConfirmation"
        label="Confirm new password"
        required
      >
        <Input
          aria-describedby={
            firstError(state.fieldErrors, 'passwordConfirmation')
              ? 'newPasswordConfirmation-error'
              : undefined
          }
          aria-invalid={Boolean(firstError(state.fieldErrors, 'passwordConfirmation'))}
          autoComplete="new-password"
          id="newPasswordConfirmation"
          maxLength={128}
          name="passwordConfirmation"
          required
          type="password"
        />
      </FormField>
      <Button block loading={pending} type="submit">
        Save New Password
      </Button>
    </form>
  );
}
