'use client';

import type { AdminPaymentMethod } from '@hanaply/contracts';
import { Alert, Button, Card, FormField, Input, Textarea } from '@hanaply/ui';
import Link from 'next/link';
import { useActionState } from 'react';

import {
  createPaymentMethodAction,
  type PaymentMethodActionState,
  updatePaymentMethodAction,
} from '@/app/admin/(protected)/payment-methods/actions';

const initialState: PaymentMethodActionState = {
  status: 'idle',
  message: null,
  paymentMethodId: null,
};

function localDateTime(value: string | null | undefined): string {
  return value ? new Date(value).toISOString().slice(0, 16) : '';
}

export function PaymentMethodForm({ method }: { method?: AdminPaymentMethod }) {
  const action = method ? updatePaymentMethodAction : createPaymentMethodAction;
  const [state, formAction, pending] = useActionState(action, initialState);
  return (
    <Card className="admin-payment-form-card">
      {state.message ? (
        <Alert
          aria-live="polite"
          title={state.status === 'success' ? 'Payment method saved' : 'Payment method not saved'}
          tone={state.status === 'success' ? 'success' : 'danger'}
        >
          {state.message}
          {state.status === 'success' && state.paymentMethodId ? (
            <p>
              <Link href={`/admin/payment-methods/${state.paymentMethodId}`}>
                View payment method
              </Link>
            </p>
          ) : null}
        </Alert>
      ) : null}
      <form action={formAction} className="admin-payment-form" noValidate>
        {method ? <input name="paymentMethodId" type="hidden" value={method.id} /> : null}
        {method ? <input name="expectedVersion" type="hidden" value={method.version} /> : null}
        <div className="admin-payment-form-grid">
          <FormField id="methodDisplayName" label="Public display name" required>
            <Input
              defaultValue={method?.displayName ?? ''}
              id="methodDisplayName"
              maxLength={100}
              name="displayName"
              required
            />
          </FormField>
          <FormField id="methodType" label="Method type" required>
            <select
              className="h-input"
              defaultValue={method?.methodType ?? 'gcash'}
              id="methodType"
              name="methodType"
              required
            >
              <option value="gcash">GCash</option>
              <option value="maya">Maya</option>
              <option value="bank_transfer">Bank transfer</option>
              <option value="other">Other manual method</option>
            </select>
          </FormField>
          <FormField id="methodDisplayOrder" label="Display order" required>
            <Input
              defaultValue={method?.displayOrder ?? 0}
              id="methodDisplayOrder"
              max={10000}
              min={0}
              name="displayOrder"
              required
              type="number"
            />
          </FormField>
          <FormField id="methodCurrency" label="Currency">
            <Input disabled id="methodCurrency" value="PHP" />
          </FormField>
        </div>
        <div className="admin-payment-checkbox">
          <input
            aria-describedby="methodEnabledHelp"
            defaultChecked={method?.enabled ?? false}
            id="methodEnabled"
            name="enabled"
            type="checkbox"
          />
          <div>
            <label htmlFor="methodEnabled">Enable for new customer drafts</label>
            <small id="methodEnabledHelp">
              Keep disabled until every public instruction and fictional local test is reviewed.
            </small>
          </div>
        </div>
        <div className="admin-payment-form-grid">
          <FormField id="methodAccountHolder" label="Account holder name">
            <Input
              defaultValue={method?.accountHolderName ?? ''}
              id="methodAccountHolder"
              maxLength={120}
              name="accountHolderName"
            />
          </FormField>
          <FormField id="methodAccountIdentifier" label="Account or mobile number">
            <Input
              defaultValue={method?.accountIdentifier ?? ''}
              id="methodAccountIdentifier"
              maxLength={120}
              name="accountIdentifier"
            />
          </FormField>
          <FormField id="methodBankName" label="Bank name">
            <Input
              defaultValue={method?.bankName ?? ''}
              id="methodBankName"
              maxLength={120}
              name="bankName"
            />
          </FormField>
          <FormField id="methodBranchDetails" label="Branch or account details">
            <Input
              defaultValue={method?.branchDetails ?? ''}
              id="methodBranchDetails"
              maxLength={300}
              name="branchDetails"
            />
          </FormField>
        </div>
        <FormField
          hint="Shown to customers exactly as entered. Do not include private operations notes."
          id="methodPublicInstructions"
          label="Public payment instructions"
          required
        >
          <Textarea
            defaultValue={method?.publicInstructions ?? ''}
            id="methodPublicInstructions"
            maxLength={2000}
            name="publicInstructions"
            required
            rows={6}
          />
        </FormField>
        <div className="admin-payment-form-grid">
          <FormField id="methodPublicNotes" label="Public notes">
            <Textarea
              defaultValue={method?.publicNotes ?? ''}
              id="methodPublicNotes"
              maxLength={1000}
              name="publicNotes"
              rows={4}
            />
          </FormField>
          <FormField
            hint="Never returned through customer endpoints."
            id="methodPrivateNotes"
            label="Private operations notes"
          >
            <Textarea
              defaultValue={method?.privateNotes ?? ''}
              id="methodPrivateNotes"
              maxLength={2000}
              name="privateNotes"
              rows={4}
            />
          </FormField>
        </div>
        <div className="admin-payment-form-grid">
          <FormField
            hint="Optional amount in Philippine pesos."
            id="methodMinimumAmount"
            label="Minimum payment"
          >
            <Input
              defaultValue={method?.minimumAmountMinor ? method.minimumAmountMinor / 100 : ''}
              id="methodMinimumAmount"
              min={0.01}
              name="minimumAmountPesos"
              step="0.01"
              type="number"
            />
          </FormField>
          <FormField
            hint="Optional amount in Philippine pesos."
            id="methodMaximumAmount"
            label="Maximum payment"
          >
            <Input
              defaultValue={method?.maximumAmountMinor ? method.maximumAmountMinor / 100 : ''}
              id="methodMaximumAmount"
              min={0.01}
              name="maximumAmountPesos"
              step="0.01"
              type="number"
            />
          </FormField>
          <FormField id="methodEffectiveStart" label="Effective start">
            <Input
              defaultValue={localDateTime(method?.effectiveStartAt)}
              id="methodEffectiveStart"
              name="effectiveStartAt"
              type="datetime-local"
            />
          </FormField>
          <FormField id="methodEffectiveEnd" label="Effective end">
            <Input
              defaultValue={localDateTime(method?.effectiveEndAt)}
              id="methodEffectiveEnd"
              name="effectiveEndAt"
              type="datetime-local"
            />
          </FormField>
        </div>
        <div className="admin-payment-form-actions">
          <Button loading={pending} type="submit">
            {method ? 'Save New Version' : 'Create Payment Method'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
