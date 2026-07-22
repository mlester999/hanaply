'use client';

import { Alert, Button, FormField, Input } from '@hanaply/ui';
import { useActionState, useEffect, useState } from 'react';

import {
  resendVerificationAction,
  type VerificationResendState,
} from '@/app/(auth)/verify-email/actions';

const initialVerificationResendState: VerificationResendState = {
  status: 'idle',
  message: null,
  retryAfterSeconds: 0,
};

export function VerificationResendForm() {
  const [state, action, pending] = useActionState(
    resendVerificationAction,
    initialVerificationResendState,
  );
  const [cooldown, setCooldown] = useState(0);
  useEffect(() => {
    if (state.retryAfterSeconds <= 0) return;
    let remaining = state.retryAfterSeconds;
    const startTimer = window.setTimeout(() => {
      setCooldown(remaining);
    }, 0);
    const countdownTimer = window.setInterval(() => {
      remaining = Math.max(remaining - 1, 0);
      setCooldown(remaining);
      if (remaining === 0) window.clearInterval(countdownTimer);
    }, 1_000);
    return () => {
      window.clearTimeout(startTimer);
      window.clearInterval(countdownTimer);
    };
  }, [state.retryAfterSeconds]);

  return (
    <form action={action} className="auth-form" noValidate>
      {state.message ? (
        <Alert
          aria-live="polite"
          title={state.status === 'success' ? 'Verification email requested' : 'Request not sent'}
          tone={state.status === 'success' ? 'success' : 'danger'}
        >
          {state.message}
        </Alert>
      ) : null}
      <FormField id="verificationEmail" label="Email address" required>
        <Input
          autoComplete="email"
          id="verificationEmail"
          inputMode="email"
          name="email"
          required
          type="email"
        />
      </FormField>
      <Button block disabled={cooldown > 0} loading={pending} type="submit" variant="secondary">
        {cooldown > 0 ? `Resend available in ${cooldown}s` : 'Resend Verification Email'}
      </Button>
    </form>
  );
}
