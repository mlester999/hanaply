'use client';

import { Alert, Button, FormField, Input } from '@hanaply/ui';
import { LockKeyhole } from 'lucide-react';
import Link from 'next/link';
import { useActionState, useEffect } from 'react';

import { loginAction, type LoginState } from '@/app/(auth)/login/actions';
import { PasswordInput } from '@/components/password-input';

const initialState: LoginState = { status: 'idle', message: null };

export function LoginForm({ nextPath, admin = false }: { nextPath?: string; admin?: boolean }) {
  const [state, action, pending] = useActionState(loginAction, initialState);
  useEffect(() => {
    if (state.status === 'redirect' && state.redirectTo) {
      window.location.replace(state.redirectTo);
    }
  }, [state]);
  return (
    <form action={action} className="auth-form" noValidate>
      <input name="next" type="hidden" value={nextPath ?? (admin ? '/admin' : '/dashboard')} />
      <input name="intent" type="hidden" value={admin ? 'admin' : 'customer'} />
      {state.status === 'error' && state.message ? (
        <Alert title="Sign in was not completed" tone="danger">
          {state.message}
        </Alert>
      ) : null}
      <FormField id="email" label="Email address" required>
        <Input
          autoComplete="email"
          id="email"
          name="email"
          placeholder="you@example.com"
          required
          type="email"
        />
      </FormField>
      <FormField id="password" label="Password" required>
        <PasswordInput
          autoComplete="current-password"
          fieldLabel="Password"
          id="password"
          name="password"
          required
        />
      </FormField>
      <Button
        block
        leadingIcon={<LockKeyhole aria-hidden="true" size={18} />}
        loading={pending}
        type="submit"
      >
        {admin ? 'Continue to Admin' : 'Sign in'}
      </Button>
      {!admin ? (
        <div className="auth-form-links">
          <Link href="/forgot-password">Forgot password?</Link>
          <Link href="/register">Create an account</Link>
        </div>
      ) : null}
    </form>
  );
}
