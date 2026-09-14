'use client';

import type { AdminJobSource } from '@hanaply/contracts';
import { Alert, Button, Card, Dialog, FormField, Textarea } from '@hanaply/ui';
import { useState, useActionState, type ReactNode, type SyntheticEvent } from 'react';

import {
  type AdminJobSourceActionState,
  requestJobSourceScanAction,
  setJobSourceStateAction,
  updateJobSourceConfigAction,
} from '@/app/admin/(protected)/job-sources/actions';

const initialState: AdminJobSourceActionState = { status: 'idle', message: null };

/**
 * The dialogs stay open after submitting so the operator reads the outcome
 * in place. Success and refusal both carry the exact wording the API returned.
 */
function Result({ state }: { state: AdminJobSourceActionState }) {
  return state.message ? (
    <Alert
      aria-live="polite"
      title={state.status === 'success' ? 'Action completed' : 'Action not completed'}
      tone={state.status === 'success' ? 'success' : 'danger'}
    >
      {state.message}
    </Alert>
  ) : null;
}

interface ActionDialogProps {
  source: AdminJobSource;
  action: (
    state: AdminJobSourceActionState,
    formData: FormData,
  ) => Promise<AdminJobSourceActionState>;
  actionName: 'enable' | 'pause' | 'disable';
  title: string;
  description: string;
  confirmLabel: string;
  triggerLabel: string;
  danger?: boolean;
}

function ActionDialog({
  source,
  action,
  actionName,
  title,
  description,
  confirmLabel,
  triggerLabel,
  danger = false,
}: ActionDialogProps) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const fieldId = `jobSourceReason-${source.code}-${actionName}`;
  return (
    <Dialog
      description={description}
      title={title}
      trigger={<Button variant={danger ? 'danger' : 'secondary'}>{triggerLabel}</Button>}
    >
      <form action={formAction} className="admin-confirmation-form">
        <input name="sourceId" type="hidden" value={source.id} />
        <input name="action" type="hidden" value={actionName} />
        <Result state={state} />
        <FormField
          hint="Required for the immutable audit trail. Use 10 to 500 characters."
          id={fieldId}
          label="Reason"
          required
        >
          <Textarea id={fieldId} maxLength={500} minLength={10} name="reason" required rows={4} />
        </FormField>
        <Button loading={pending} type="submit" variant={danger ? 'danger' : 'primary'}>
          {confirmLabel}
        </Button>
      </form>
    </Dialog>
  );
}

function ScanDialog({ source }: { source: AdminJobSource }) {
  const [state, formAction, pending] = useActionState(requestJobSourceScanAction, initialState);
  const fieldId = `jobSourceScanReason-${source.code}`;
  return (
    <Dialog
      description="This clears the provider's last success time so the worker treats it as due on its next tick. It does not start a scan immediately, and the per-provider lock still prevents overlapping runs."
      title={`Request a scan for ${source.displayName}?`}
      trigger={<Button variant="secondary">Request Scan</Button>}
    >
      <form action={formAction} className="admin-confirmation-form">
        <input name="sourceId" type="hidden" value={source.id} />
        <Result state={state} />
        <FormField
          hint="Required for the immutable audit trail. Use 10 to 500 characters."
          id={fieldId}
          label="Reason"
          required
        >
          <Textarea id={fieldId} maxLength={500} minLength={10} name="reason" required rows={4} />
        </FormField>
        <Button loading={pending} type="submit">
          Request Scan
        </Button>
      </form>
    </Dialog>
  );
}

function parseConfigObject(value: string): Record<string, unknown> | null {
  let decoded: unknown;
  try {
    decoded = JSON.parse(value);
  } catch {
    return null;
  }
  if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) return null;
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(decoded)) result[key] = entry;
  return result;
}

function ConfigDialog({ source }: { source: AdminJobSource }) {
  const [state, formAction, pending] = useActionState(updateJobSourceConfigAction, initialState);
  const [value, setValue] = useState(() => JSON.stringify(source.config, null, 2));
  const [localError, setLocalError] = useState<string | null>(null);
  const fieldId = `jobSourceConfig-${source.code}`;

  function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    if (parseConfigObject(value) === null) {
      event.preventDefault();
      setLocalError(
        'The editor must contain a JSON object, for example {"boardTokens": ["acme", "globex"]}.',
      );
      return;
    }
    setLocalError(null);
  }

  return (
    <Dialog
      description="Replace the non-secret provider configuration. Credential values are never stored here and are refused if typed."
      title={`Configuration for ${source.displayName}`}
      trigger={<Button variant="secondary">Edit Configuration</Button>}
    >
      <form action={formAction} className="admin-confirmation-form" onSubmit={handleSubmit}>
        <input name="sourceId" type="hidden" value={source.id} />
        <Result state={state} />
        <FormField
          error={localError}
          hint="A JSON object. The API refuses a top-level key named apiKey, api_key, key, secret, client_secret, password, private_key, access_token, refresh_token, bearer, or authorization."
          id={fieldId}
          label="Configuration JSON"
          required
        >
          <Textarea
            className="admin-source-config-editor"
            id={fieldId}
            name="config"
            onChange={(event) => {
              setValue(event.target.value);
              setLocalError(null);
            }}
            required
            rows={10}
            spellCheck={false}
            value={value}
          />
        </FormField>
        <FormField
          hint="Required for the immutable audit trail. Use 10 to 500 characters."
          id={`${fieldId}-reason`}
          label="Reason"
          required
        >
          <Textarea
            id={`${fieldId}-reason`}
            maxLength={500}
            minLength={10}
            name="reason"
            required
            rows={3}
          />
        </FormField>
        <Button loading={pending} type="submit">
          Replace Configuration
        </Button>
      </form>
    </Dialog>
  );
}

export interface AdminJobSourceActionsProps {
  source: AdminJobSource;
  canManage: boolean;
}

export function AdminJobSourceActions({ source, canManage }: AdminJobSourceActionsProps) {
  if (!canManage) {
    return (
      <Card className="admin-source-actions">
        <Alert title="Read-only provider" tone="info">
          The job_sources.manage permission is required to enable, pause, disable, request a scan,
          or reconfigure this provider.
        </Alert>
      </Card>
    );
  }
  const credentialNote: ReactNode = source.requiresCredentials ? (
    <p className="admin-source-credential-note">
      This provider requires a credential. Enter the reason confirming that the secret already
      exists in the worker environment variable
      {source.credentialEnvVar ? ` ${source.credentialEnvVar}` : ' named for this provider'}. The
      database stores only the variable name and cannot verify the secret, so an enabled provider
      can still fail on its next scan.
    </p>
  ) : null;
  return (
    <Card className="admin-source-actions">
      <div className="admin-source-actions-heading">
        <h3>Provider controls</h3>
        <p>Every change requires a written reason and writes an immutable audit event.</p>
      </div>
      <div className="admin-source-actions-buttons">
        {source.status !== 'active' ? (
          <>
            {credentialNote}
            <ActionDialog
              action={setJobSourceStateAction}
              actionName="enable"
              confirmLabel="Confirm Enable"
              description={
                source.requiresCredentials
                  ? 'Enabling makes the provider eligible for scans. The credential must already be configured in the worker environment, because the database cannot verify it.'
                  : 'The provider becomes eligible for its normal scan cadence and any stale circuit breaker is cleared.'
              }
              source={source}
              title={`Enable ${source.displayName}?`}
              triggerLabel="Enable"
            />
          </>
        ) : null}
        {source.status === 'active' ? (
          <>
            <ActionDialog
              action={setJobSourceStateAction}
              actionName="pause"
              confirmLabel="Confirm Pause"
              description="A paused provider stops being due for scans. Its failure history and consecutive failure count are kept so you can still see why it was paused."
              source={source}
              title={`Pause ${source.displayName}?`}
              triggerLabel="Pause"
            />
            <ScanDialog source={source} />
          </>
        ) : null}
        {source.status !== 'disabled' ? (
          <ActionDialog
            action={setJobSourceStateAction}
            actionName="disable"
            confirmLabel="Disable Provider"
            danger
            description="Disabling stops ingestion for this provider. No new postings are collected, and existing source records stay in the canonical job table."
            source={source}
            title={`Disable ${source.displayName}?`}
            triggerLabel="Disable"
          />
        ) : null}
        <ConfigDialog source={source} />
      </div>
    </Card>
  );
}
