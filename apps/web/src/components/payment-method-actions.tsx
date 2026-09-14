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

/**
 * The result of the last action, kept outside the cards that raise it.
 *
 * Archiving succeeds by setting `archivedAt`, which unmounts the "Archive
 * method" card — and a result stored in that card went with it: the button
 * stayed in its pending state and the page never said the method had been
 * archived. Reporting happens here, in the one part of the panel whose position
 * in the tree does not depend on the method's state.
 */
function Result({ states }: { states: readonly PaymentMethodActionState[] }) {
  const state = states.find((candidate) => candidate.message !== null);
  if (state?.message == null) return null;
  return (
    <Alert
      aria-live="polite"
      className="admin-payment-action-message"
      title={state.status === 'success' ? 'Method updated' : 'Method not updated'}
      tone={state.status === 'success' ? 'success' : 'danger'}
    >
      {state.message}
    </Alert>
  );
}

interface MethodActions {
  enableAction: (payload: FormData) => void;
  enabling: boolean;
  disableAction: (payload: FormData) => void;
  disabling: boolean;
  archiveAction: (payload: FormData) => void;
  archiving: boolean;
  qrAction: (payload: FormData) => void;
  uploading: boolean;
}

function Controls({ method, actions }: { method: AdminPaymentMethod; actions: MethodActions }) {
  return (
    <>
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
            action={method.enabled ? actions.disableAction : actions.enableAction}
            className="admin-confirmation-form"
          >
            <input name="paymentMethodId" type="hidden" value={method.id} />
            <input name="expectedVersion" type="hidden" value={method.version} />
            <FormField id="methodStateReason" label="Reason" required>
              <Input id="methodStateReason" maxLength={500} minLength={10} name="reason" required />
            </FormField>
            <Button
              loading={method.enabled ? actions.disabling : actions.enabling}
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
          <form
            action={actions.qrAction}
            className="admin-confirmation-form"
            encType="multipart/form-data"
          >
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
            <Button loading={actions.uploading} type="submit" variant="secondary">
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
          <form action={actions.archiveAction} className="admin-confirmation-form">
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
            <Button loading={actions.archiving} type="submit" variant="danger">
              Archive Payment Method
            </Button>
          </form>
        </Card>
      ) : null}
    </>
  );
}

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
  return (
    <div className="admin-payment-action-grid">
      <Result states={[qrState, archiveState, disableState, enableState]} />
      <Controls
        actions={{
          enableAction,
          enabling,
          disableAction,
          disabling,
          archiveAction,
          archiving,
          qrAction,
          uploading,
        }}
        method={method}
      />
    </div>
  );
}
