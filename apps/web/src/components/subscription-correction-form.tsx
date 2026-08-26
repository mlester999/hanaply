'use client';

import type { SubscriptionDetail } from '@hanaply/contracts';
import { Alert, Button, Card, FormField, Input, Textarea } from '@hanaply/ui';
import { ShieldAlert } from 'lucide-react';
import { useActionState } from 'react';

import {
  correctSubscriptionAction,
  type SubscriptionCorrectionState,
} from '@/app/admin/(protected)/subscriptions/actions';

const initialState: SubscriptionCorrectionState = { status: 'idle', message: null };

function utcInput(value: string | null): string {
  return value ? new Date(value).toISOString().slice(0, 16) : '';
}

export function SubscriptionCorrectionForm({
  subscription,
  canRestoreReversed,
}: {
  subscription: SubscriptionDetail;
  canRestoreReversed: boolean;
}) {
  const [state, action, pending] = useActionState(correctSubscriptionAction, initialState);
  return (
    <Card className="subscription-correction-card">
      <div className="admin-detail-heading">
        <ShieldAlert aria-hidden="true" size={22} />
        <div>
          <h2>Controlled correction</h2>
          <p>Use only to repair recorded access dates. This action is versioned and audited.</p>
        </div>
      </div>
      {state.message ? (
        <Alert
          aria-live="polite"
          title={state.status === 'success' ? 'Subscription corrected' : 'Correction not saved'}
          tone={state.status === 'success' ? 'success' : 'danger'}
        >
          {state.message}
        </Alert>
      ) : null}
      <form action={action} className="admin-confirmation-form">
        <input name="subscriptionId" type="hidden" value={subscription.id} />
        <input name="expectedVersion" type="hidden" value={subscription.version} />
        <div className="admin-payment-form-grid">
          <FormField id="correctionStartsAt" label="Starts at, UTC" required>
            <Input
              defaultValue={utcInput(subscription.startsAt)}
              id="correctionStartsAt"
              name="startsAt"
              required
              type="datetime-local"
            />
          </FormField>
          <FormField id="correctionEndsAt" label="Ends at, UTC" required>
            <Input
              defaultValue={utcInput(subscription.endsAt)}
              id="correctionEndsAt"
              name="endsAt"
              required
              type="datetime-local"
            />
          </FormField>
        </div>
        <FormField id="correctionReason" label="Correction reason" required>
          <Input id="correctionReason" maxLength={500} minLength={10} name="reason" required />
        </FormField>
        <FormField id="correctionInternalNote" label="Internal note">
          <Textarea id="correctionInternalNote" maxLength={2000} name="internalNote" rows={3} />
        </FormField>
        {subscription.status === 'reversed' ? (
          canRestoreReversed ? (
            <label className="admin-payment-checkbox">
              <input name="restoreReversed" type="checkbox" value="yes" />
              <span>Restore access from the reversed state using the corrected dates.</span>
            </label>
          ) : (
            <Alert title="Reversed access remains closed" tone="warning">
              Restoring a reversed subscription also requires security management permission.
            </Alert>
          )
        ) : null}
        <label className="admin-payment-checkbox">
          <input name="confirmCorrection" required type="checkbox" value="yes" />
          <span>I reviewed the UTC dates, current status, and resulting access window.</span>
        </label>
        <Button loading={pending} type="submit" variant="danger">
          Record Subscription Correction
        </Button>
      </form>
    </Card>
  );
}
