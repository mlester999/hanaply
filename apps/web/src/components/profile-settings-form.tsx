'use client';

import type { PublicProfile } from '@hanaply/contracts';
import { Alert, Button, FormField, Input } from '@hanaply/ui';
import { useActionState } from 'react';

import {
  type ProfileFormState,
  updateProfileAction,
} from '@/app/(customer)/dashboard/settings/profile/actions';

const initialState: ProfileFormState = { status: 'idle', message: null, fieldErrors: {} };

function firstError(
  errors: Readonly<Record<string, readonly string[]>>,
  field: string,
): string | undefined {
  return errors[field]?.[0];
}

export function ProfileSettingsForm({ profile }: { profile: PublicProfile }) {
  const [state, action, pending] = useActionState(updateProfileAction, initialState);
  return (
    <form action={action} className="settings-form" noValidate>
      {state.message ? (
        <Alert
          aria-live="polite"
          title={state.status === 'success' ? 'Profile saved' : 'Profile not saved'}
          tone={state.status === 'success' ? 'success' : 'danger'}
        >
          {state.message}
        </Alert>
      ) : null}
      <div className="settings-form-grid">
        <FormField
          error={firstError(state.fieldErrors, 'firstName')}
          id="profileFirstName"
          label="First name"
          required
        >
          <Input
            aria-invalid={Boolean(firstError(state.fieldErrors, 'firstName'))}
            autoComplete="given-name"
            defaultValue={profile.firstName ?? ''}
            id="profileFirstName"
            maxLength={80}
            name="firstName"
            required
          />
        </FormField>
        <FormField
          error={firstError(state.fieldErrors, 'lastName')}
          id="profileLastName"
          label="Last name"
          required
        >
          <Input
            aria-invalid={Boolean(firstError(state.fieldErrors, 'lastName'))}
            autoComplete="family-name"
            defaultValue={profile.lastName ?? ''}
            id="profileLastName"
            maxLength={80}
            name="lastName"
            required
          />
        </FormField>
      </div>
      <FormField
        error={firstError(state.fieldErrors, 'displayName')}
        hint="This is the name shown in your Hanaply workspace."
        id="profileDisplayName"
        label="Display name"
      >
        <Input
          aria-invalid={Boolean(firstError(state.fieldErrors, 'displayName'))}
          autoComplete="nickname"
          defaultValue={profile.displayName ?? ''}
          id="profileDisplayName"
          maxLength={120}
          name="displayName"
        />
      </FormField>
      <div className="settings-form-grid settings-form-grid--regional">
        <FormField
          error={firstError(state.fieldErrors, 'countryCode')}
          hint="Two-letter code"
          id="profileCountry"
          label="Country"
          required
        >
          <Input
            autoComplete="country"
            defaultValue={profile.countryCode}
            id="profileCountry"
            maxLength={2}
            name="countryCode"
            required
          />
        </FormField>
        <FormField id="profileLocale" label="Locale" required>
          <select
            className="h-input"
            defaultValue={profile.locale}
            id="profileLocale"
            name="locale"
            required
          >
            <option value="en-PH">English (Philippines)</option>
          </select>
        </FormField>
        <FormField id="profileTimezone" label="Timezone" required>
          <select
            className="h-input"
            defaultValue={profile.timezone}
            id="profileTimezone"
            name="timezone"
            required
          >
            <option value="Asia/Manila">Asia/Manila</option>
            <option value="Asia/Singapore">Asia/Singapore</option>
            <option value="UTC">UTC</option>
          </select>
        </FormField>
      </div>
      <div className="settings-form-actions">
        <Button loading={pending} type="submit">
          Save Profile
        </Button>
      </div>
    </form>
  );
}
