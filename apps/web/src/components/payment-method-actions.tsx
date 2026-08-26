'use client';

import type { AdminPaymentMethod } from '@hanaply/contracts';
import { Alert, Button, Card, FormField, Input } from '@hanaply/ui';
import { Archive, Power, QrCode } from 'lucide-react';
import { useActionState } from 'react';

import {
  archivePaymentMethodAction,
  disablePaymentMethodAction,
  enablePaymentMethodAction,
  type PaymentMethodActionState,
  uploadPaymentMethodQrAction,
} from '@/app/admin/(protected)/payment-methods/actions';

const initial: PaymentMethodActionState = { status: 'idle', message: null, paymentMethodId: null };

export function PaymentMethodActions({ method }: { method: AdminPaymentMethod }) {
  const [enableState, enableAction, enabling] = useActionState(enablePaymentMethodAction, initial);
  const [disableState, disableAction, disabling] = useActionState(
    disablePaymentMethodAction,
    initial,
  );
  const [archiveState, archiveAction, archiving] = useActionState(
    archivePaymentMethodAction,
    initial,
  );
  const [qrState, qrAction, uploading] = useActionState(uploadPaymentMethodQrAction, initial);
  const message =
    qrState.message ?? archiveState.message ?? disableState.message ?? enableState.message;
  const successful = [qrState, archiveState, disableState, enableState].some(
    (state) => state.message === message && state.status === 'success',
  );
  return (
    <div className="admin-payment-action-grid">
      {message ? (
        <Alert
          aria-live="polite"
          className="admin-payment-action-message"
          title={successful ? 'Method updated' : 'Method not updated'}
          tone={successful ? 'success' : 'danger'}
        >
          {message}
        </Alert>
      ) : null}
      <Card className="admin-payment-action-card">
        <div>
          <Power aria-hidden="true" size={21} />
          <div>
            <h2>Availability</h2>
            <p>Enable or disable new customer drafts without changing historical submissions.</p>
          </div>
        </div>
        {!method.archivedAt ? (
          <form
            action={method.enabled ? disableAction : enableAction}
            className="admin-confirmation-form"
          >
            <input name="paymentMethodId" type="hidden" value={method.id} />
            <input name="expectedVersion" type="hidden" value={method.version} />
            <FormField id="methodStateReason" label="Reason" required>
              <Input id="methodStateReason" maxLength={500} minLength={10} name="reason" required />
            </FormField>
            <Button
              loading={method.enabled ? disabling : enabling}
              type="submit"
              variant={method.enabled ? 'secondary' : 'primary'}
            >
              {method.enabled ? 'Disable Method' : 'Enable Method'}
            </Button>
          </form>
        ) : (
          <p>This method is archived and cannot be changed.</p>
        )}
      </Card>
      <Card className="admin-payment-action-card">
        <div>
          <QrCode aria-hidden="true" size={21} />
          <div>
            <h2>Private QR image</h2>
            <p>
              JPEG, PNG, or WebP up to 5 MB. The image is validated, sanitized, and stored
              privately.
            </p>
          </div>
        </div>
        {!method.archivedAt ? (
          <form action={qrAction} className="admin-confirmation-form" encType="multipart/form-data">
            <input name="paymentMethodId" type="hidden" value={method.id} />
            <FormField
              id="methodQrCode"
              label={method.qrCodeVersion ? 'Replace QR image' : 'QR image'}
              required
            >
              <Input
                accept="image/jpeg,image/png,image/webp"
                id="methodQrCode"
                name="qrCode"
                required
                type="file"
              />
            </FormField>
            <Button loading={uploading} type="submit" variant="secondary">
              {method.qrCodeVersion ? 'Replace QR Image' : 'Upload QR Image'}
            </Button>
          </form>
        ) : (
          <p>Archived methods cannot receive a new QR image.</p>
        )}
      </Card>
      {!method.archivedAt ? (
        <Card className="admin-payment-action-card admin-payment-action-card--danger">
          <div>
            <Archive aria-hidden="true" size={21} />
            <div>
              <h2>Archive method</h2>
              <p>Archiving is permanent for new use. Historical snapshots remain available.</p>
            </div>
          </div>
          <form action={archiveAction} className="admin-confirmation-form">
            <input name="paymentMethodId" type="hidden" value={method.id} />
            <input name="expectedVersion" type="hidden" value={method.version} />
            <FormField id="methodArchiveReason" label="Archive reason" required>
              <Input
                id="methodArchiveReason"
                maxLength={500}
                minLength={10}
                name="reason"
                required
              />
            </FormField>
            <Button loading={archiving} type="submit" variant="danger">
              Archive Payment Method
            </Button>
          </form>
        </Card>
      ) : null}
    </div>
  );
}
