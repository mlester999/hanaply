'use client';

import { Alert, Button, FormField, Input } from '@hanaply/ui';
import { LockKeyhole } from 'lucide-react';
import Link from 'next/link';
import { useActionState } from 'react';

import { loginAction, type LoginState } from '@/app/(auth)/login/actions';

const initialState: LoginState = { status: 'idle', message: null };

export function LoginForm({ nextPath, admin = false }: { nextPath?: string; admin?: boolean }) {
  const [state, action, pending] = useActionState(loginAction, initialState);
  return (
    <form action={action} className="auth-form" noValidate>
      <input name="next" type="hidden" value={nextPath ?? (admin ? '/admin' : '/dashboard')} />
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
        <Input
          autoComplete="current-password"
          id="password"
          name="password"
          required
          type="password"
        />
      </FormField>
      <Button
        block
        leadingIcon={<LockKeyhole aria-hidden="true" size={18} />}
        loading={pending}
        type="submit"
      >
        {admin ? 'Continue to Admin' : 'Sign In Securely'}
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
