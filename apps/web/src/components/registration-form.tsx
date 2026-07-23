'use client';

import { Alert, Button, FormField, Input } from '@hanaply/ui';
import Link from 'next/link';
import { useActionState, useState } from 'react';

import { registerAction, type RegistrationState } from '@/app/(auth)/register/actions';
import { PasswordInput, PasswordRequirements } from '@/components/password-input';

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

export function RegistrationForm({ selectedPlanCode }: { selectedPlanCode?: string }) {
  const [state, action, pending] = useActionState(registerAction, initialRegistrationState);
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const passwordError = firstError(state.fieldErrors, 'password');
  const confirmationError = firstError(state.fieldErrors, 'passwordConfirmation');
  const requirementsVisible = password.length > 0 || passwordConfirmation.length > 0;
  const passwordDescribedBy = [
    passwordError ? 'registrationPassword-error' : null,
    requirementsVisible ? 'registrationPassword-requirements' : null,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <form action={action} className="auth-form" noValidate>
      {selectedPlanCode ? (
        <input name="selectedPlanCode" type="hidden" value={selectedPlanCode} />
      ) : null}
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
      <FormField error={passwordError} id="registrationPassword" label="Password" required>
        <PasswordInput
          aria-describedby={passwordDescribedBy || undefined}
          aria-invalid={Boolean(passwordError)}
          autoComplete="new-password"
          fieldLabel="Password"
          id="registrationPassword"
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
        error={confirmationError}
        id="passwordConfirmation"
        label="Confirm password"
        required
      >
        <PasswordInput
          aria-describedby={
            [
              confirmationError ? 'passwordConfirmation-error' : null,
              requirementsVisible ? 'registrationPassword-requirements' : null,
            ]
              .filter(Boolean)
              .join(' ') || undefined
          }
          aria-invalid={Boolean(confirmationError)}
          autoComplete="new-password"
          fieldLabel="Confirm password"
          id="passwordConfirmation"
          maxLength={128}
          name="passwordConfirmation"
          onChange={(event) => {
            setPasswordConfirmation(event.currentTarget.value);
          }}
          required
        />
      </FormField>
      <PasswordRequirements
        confirmation={passwordConfirmation}
        id="registrationPassword-requirements"
        password={password}
        showMatch
      />
      <fieldset className="auth-consents">
        <legend>Agreements and consent</legend>
        <label>
          <input name="legalAccepted" required type="checkbox" />
          <span>
            I agree to the <Link href="/terms">Terms of Service</Link> and{' '}
            <Link href="/privacy">Privacy Policy</Link>.
          </span>
        </label>
        {firstError(state.fieldErrors, 'legalAccepted') ? (
          <span className="auth-consent-error" role="alert">
            {firstError(state.fieldErrors, 'legalAccepted')}
          </span>
        ) : null}
        <label>
          <input name="marketingConsent" type="checkbox" />
          <span>Send me optional Hanaply product and marketing updates.</span>
        </label>
      </fieldset>
      <Button block loading={pending} type="submit">
        Create my account
      </Button>
      <p className="auth-form-footnote">
        Already registered? <Link href="/login">Sign in</Link>
      </p>
    </form>
  );
}
