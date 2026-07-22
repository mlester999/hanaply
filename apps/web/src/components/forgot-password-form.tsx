'use client';

import { Alert, Button, FormField, Input } from '@hanaply/ui';
import Link from 'next/link';
import { useActionState } from 'react';

import {
  forgotPasswordAction,
  type ForgotPasswordState,
} from '@/app/(auth)/forgot-password/actions';

const initialState: ForgotPasswordState = { status: 'idle', message: null };

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(forgotPasswordAction, initialState);
  return (
    <form action={action} className="auth-form" noValidate>
      {state.message ? (
        <Alert
          aria-live="polite"
          title={state.status === 'success' ? 'Check your email' : 'Request not completed'}
          tone={state.status === 'success' ? 'success' : 'danger'}
        >
          {state.message}
        </Alert>
      ) : null}
      <FormField id="recoveryEmail" label="Email address" required>
        <Input
          autoComplete="email"
          id="recoveryEmail"
          inputMode="email"
          maxLength={254}
          name="email"
          required
          type="email"
        />
      </FormField>
      <Button block loading={pending} type="submit">
        Send Reset Instructions
      </Button>
      <p className="auth-form-footnote">
        Remembered your password? <Link href="/login">Return to sign in</Link>
      </p>
    </form>
  );
}
