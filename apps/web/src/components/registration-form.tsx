'use client';

import { Alert, Button, FormField, Input } from '@hanaply/ui';
import Link from 'next/link';
import { useActionState } from 'react';

import { registerAction, type RegistrationState } from '@/app/(auth)/register/actions';

const initialRegistrationState: RegistrationState = {
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

export function RegistrationForm() {
  const [state, action, pending] = useActionState(registerAction, initialRegistrationState);
  return (
    <form action={action} className="auth-form" noValidate>
      {state.status === 'error' && state.message ? (
        <Alert aria-live="polite" title="Registration was not completed" tone="danger">
          {state.message}
        </Alert>
      ) : null}
      <div className="auth-field-grid">
        <FormField
          error={firstError(state.fieldErrors, 'firstName')}
          id="firstName"
          label="First name"
          required
        >
          <Input
            aria-describedby={
              firstError(state.fieldErrors, 'firstName') ? 'firstName-error' : undefined
            }
            aria-invalid={Boolean(firstError(state.fieldErrors, 'firstName'))}
            autoComplete="given-name"
            id="firstName"
            maxLength={80}
            name="firstName"
            required
          />
        </FormField>
        <FormField
          error={firstError(state.fieldErrors, 'lastName')}
          id="lastName"
          label="Last name"
          required
        >
          <Input
            aria-describedby={
              firstError(state.fieldErrors, 'lastName') ? 'lastName-error' : undefined
            }
            aria-invalid={Boolean(firstError(state.fieldErrors, 'lastName'))}
            autoComplete="family-name"
            id="lastName"
            maxLength={80}
            name="lastName"
            required
          />
        </FormField>
      </div>
      <FormField
        error={firstError(state.fieldErrors, 'email')}
        id="registrationEmail"
        label="Email address"
        required
      >
        <Input
          aria-describedby={
            firstError(state.fieldErrors, 'email') ? 'registrationEmail-error' : undefined
          }
          aria-invalid={Boolean(firstError(state.fieldErrors, 'email'))}
          autoComplete="email"
          id="registrationEmail"
          inputMode="email"
          maxLength={254}
          name="email"
          required
          type="email"
        />
      </FormField>
      <FormField
        error={firstError(state.fieldErrors, 'password')}
        hint="Use at least 10 characters with a letter and a number."
        id="registrationPassword"
        label="Password"
        required
      >
        <Input
          aria-describedby={
            firstError(state.fieldErrors, 'password') ? 'registrationPassword-error' : undefined
          }
          aria-invalid={Boolean(firstError(state.fieldErrors, 'password'))}
          autoComplete="new-password"
          id="registrationPassword"
          maxLength={128}
          minLength={10}
          name="password"
          required
          type="password"
        />
      </FormField>
      <FormField
        error={firstError(state.fieldErrors, 'passwordConfirmation')}
        id="passwordConfirmation"
        label="Confirm password"
        required
      >
        <Input
          aria-describedby={
            firstError(state.fieldErrors, 'passwordConfirmation')
              ? 'passwordConfirmation-error'
              : undefined
          }
          aria-invalid={Boolean(firstError(state.fieldErrors, 'passwordConfirmation'))}
          autoComplete="new-password"
          id="passwordConfirmation"
          maxLength={128}
          name="passwordConfirmation"
          required
          type="password"
        />
      </FormField>
      <fieldset className="auth-consents">
        <legend>Agreements and consent</legend>
        <label>
          <input name="termsAccepted" required type="checkbox" />
          <span>
            I agree to the <Link href="/terms">Terms of Service</Link>.
          </span>
        </label>
        {firstError(state.fieldErrors, 'termsAccepted') ? (
          <span className="auth-consent-error" role="alert">
            {firstError(state.fieldErrors, 'termsAccepted')}
          </span>
        ) : null}
        <label>
          <input name="privacyAccepted" required type="checkbox" />
          <span>
            I agree to the <Link href="/privacy">Privacy Policy</Link>.
          </span>
        </label>
        {firstError(state.fieldErrors, 'privacyAccepted') ? (
          <span className="auth-consent-error" role="alert">
            {firstError(state.fieldErrors, 'privacyAccepted')}
          </span>
        ) : null}
        <label>
          <input name="marketingConsent" type="checkbox" />
          <span>Send me optional Hanaply product and marketing updates.</span>
        </label>
      </fieldset>
      <Button block loading={pending} type="submit">
        Create My Account
      </Button>
      <p className="auth-form-footnote">
        Already registered? <Link href="/login">Sign in</Link>
      </p>
    </form>
  );
}
