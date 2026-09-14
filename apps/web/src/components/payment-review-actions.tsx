'use client';

import type { AdminPaymentSubmission } from '@hanaply/contracts';
import { Alert, Button, Card, FormField, Input, Textarea } from '@hanaply/ui';
import { CheckCircle2, HelpCircle, RefreshCcw, XCircle } from 'lucide-react';
import { useActionState } from 'react';

import {
  approvePaymentAction,
  type PaymentReviewActionState,
  recordPaymentRefundAction,
  rejectPaymentAction,
  requestPaymentInformationAction,
  reversePaymentApprovalAction,
  startPaymentReviewAction,
} from '@/app/admin/(protected)/payments/actions';

const initial: PaymentReviewActionState = { status: 'idle', message: null };

function HiddenPayment({ payment }: { payment: AdminPaymentSubmission }) {
  return (
    <>
      <input name="submissionId" type="hidden" value={payment.id} />
      <input name="expectedVersion" type="hidden" value={payment.version} />
    </>
  );
}

/**
 * The result of the last review action, read from the submission's own history.
 *
 * Every action here changes `payment.status`, and the controls below render a
 * different set of forms for each status — "Start Review" is replaced by the
 * decision forms the moment the lock is claimed, and approving them replaces
 * those with the read-only state. The result therefore cannot live in a card
 * that unmounts with its own form, and it cannot be "the first result still
 * remembered" either: the reviewer claims a review and then approves it, and
 * reporting the claim while the approval has already committed tells them the
 * opposite of what happened to the payment in front of them.
 *
 * `payment_submission_events` is append-only and is written by the same database
 * function that makes the decision, so its newest reviewer-caused entry is what
 * actually happened to this payment.
 */
function Result({ notice }: { notice: string | null }) {
  if (notice === null) return null;
  return (
    <Alert aria-live="polite" title="Review updated" tone="success">
      {notice}
    </Alert>
  );
}

interface PaymentReviewControlsProps {
  payment: AdminPaymentSubmission;
  reviewerId: string;
  mayReview: boolean;
  mayChangeSubscription: boolean;
  startAction: (payload: FormData) => void;
  starting: boolean;
  infoAction: (payload: FormData) => void;
  requesting: boolean;
  approveAction: (payload: FormData) => void;
  approving: boolean;
  rejectAction: (payload: FormData) => void;
  rejecting: boolean;
  refundAction: (payload: FormData) => void;
  refunding: boolean;
  reverseAction: (payload: FormData) => void;
  reversing: boolean;
}

function PaymentReviewControls({
  payment,
  reviewerId,
  mayReview,
  mayChangeSubscription,
  startAction,
  starting,
  infoAction,
  requesting,
  approveAction,
  approving,
  rejectAction,
  rejecting,
  refundAction,
  refunding,
  reverseAction,
  reversing,
}: PaymentReviewControlsProps) {
  const ownsReview =
    payment.status === 'under_review' &&
    payment.reviewerId === reviewerId &&
    payment.reviewLockExpiresAt &&
    new Date(payment.reviewLockExpiresAt) > new Date();
  if (!mayReview)
    return (
      <Alert title="Read-only review" tone="info">
        Payments review permission is required for every state change and proof preview.
      </Alert>
    );
  if (payment.status === 'submitted' || payment.status === 'resubmitted') {
    return (
      <Card className="payment-review-action-card">
        <div>
          <RefreshCcw aria-hidden="true" size={22} />
          <div>
            <h2>Claim this review</h2>
            <p>A 15 minute lock prevents another reviewer from approving the same payment.</p>
          </div>
        </div>
        <form action={startAction}>
          <HiddenPayment payment={payment} />
          <Button loading={starting} type="submit">
            Start Review
          </Button>
        </form>
      </Card>
    );
  }
  if (payment.status === 'under_review' && !ownsReview)
    return (
      <Alert title="Review lock unavailable" tone="warning">
        This review is assigned to another reviewer or its lock expired. Refresh the payment before
        acting.
      </Alert>
    );
  if (ownsReview) {
    return (
      <div className="payment-review-action-stack">
        <Card className="payment-review-action-card">
          <div>
            <HelpCircle aria-hidden="true" size={22} />
            <div>
              <h2>Request more information</h2>
              <p>
                Send a clear public message. Keep private investigation details in the internal
                note.
              </p>
            </div>
          </div>
          <form action={infoAction} className="admin-confirmation-form">
            <HiddenPayment payment={payment} />
            <FormField id="informationCategory" label="Reason category" required>
              <select className="h-input" id="informationCategory" name="reasonCategory" required>
                <option value="proof_unclear">Proof unclear</option>
                <option value="reference_unclear">Reference unclear</option>
                <option value="details_mismatch">Details mismatch</option>
                <option value="payment_date_unclear">Payment date unclear</option>
                <option value="other">Other</option>
              </select>
            </FormField>
            <FormField id="informationPublicMessage" label="Public message" required>
              <Textarea
                id="informationPublicMessage"
                maxLength={2000}
                minLength={10}
                name="publicMessage"
                required
                rows={4}
              />
            </FormField>
            <FormField id="informationInternalNote" label="Internal note">
              <Textarea
                id="informationInternalNote"
                maxLength={2000}
                name="internalNote"
                rows={3}
              />
            </FormField>
            <FormField id="informationReason" label="Action reason" required>
              <Input id="informationReason" maxLength={500} minLength={10} name="reason" required />
            </FormField>
            <Button loading={requesting} type="submit" variant="secondary">
              Request Information
            </Button>
          </form>
        </Card>
        <Card className="payment-review-action-card payment-review-action-card--success">
          <div>
            <CheckCircle2 aria-hidden="true" size={22} />
            <div>
              <h2>Approve and activate</h2>
              <p>
                Approval rechecks the account, plan, price, proof, reference, lock, and subscription
                atomically.
              </p>
            </div>
          </div>
          <form action={approveAction} className="admin-confirmation-form">
            <HiddenPayment payment={payment} />
            <FormField id="approvalReason" label="Approval reason" required>
              <Input id="approvalReason" maxLength={500} minLength={10} name="reason" required />
            </FormField>
            <FormField id="approvalInternalNote" label="Internal note">
              <Textarea id="approvalInternalNote" maxLength={2000} name="internalNote" rows={3} />
            </FormField>
            <Button loading={approving} type="submit">
              Approve Payment
            </Button>
          </form>
        </Card>
        <Card className="payment-review-action-card payment-review-action-card--danger">
          <div>
            <XCircle aria-hidden="true" size={22} />
            <div>
              <h2>Reject payment</h2>
              <p>Rejection does not change existing paid access.</p>
            </div>
          </div>
          <form action={rejectAction} className="admin-confirmation-form">
            <HiddenPayment payment={payment} />
            <FormField id="rejectionCode" label="Rejection code" required>
              <select className="h-input" id="rejectionCode" name="rejectionReasonCode" required>
                <option value="payment_not_found">Payment not found</option>
                <option value="amount_mismatch">Amount mismatch</option>
                <option value="reference_invalid">Reference invalid</option>
                <option value="proof_invalid">Proof invalid</option>
                <option value="proof_reused">Proof reused</option>
                <option value="details_incomplete">Details incomplete</option>
                <option value="other">Other</option>
              </select>
            </FormField>
            <FormField id="rejectionPublicMessage" label="Public message" required>
              <Textarea
                id="rejectionPublicMessage"
                maxLength={2000}
                minLength={10}
                name="publicMessage"
                required
                rows={4}
              />
            </FormField>
            <FormField id="rejectionInternalNote" label="Internal note">
              <Textarea id="rejectionInternalNote" maxLength={2000} name="internalNote" rows={3} />
            </FormField>
            <FormField id="rejectionReason" label="Action reason" required>
              <Input id="rejectionReason" maxLength={500} minLength={10} name="reason" required />
            </FormField>
            <Button loading={rejecting} type="submit" variant="danger">
              Reject Payment
            </Button>
          </form>
        </Card>
      </div>
    );
  }
  if (payment.status === 'approved' && mayChangeSubscription) {
    return (
      <div className="payment-review-action-stack">
        <Card className="payment-review-action-card">
          <div>
            <RefreshCcw aria-hidden="true" size={22} />
            <div>
              <h2>Record external refund</h2>
              <p>This records a refund completed outside Hanaply. It does not move money.</p>
            </div>
          </div>
          <form action={refundAction} className="admin-confirmation-form">
            <HiddenPayment payment={payment} />
            <FormField id="refundAmount" label="Refund amount in PHP" required>
              <Input
                id="refundAmount"
                max={payment.quotedAmountMinor / 100}
                min="0.01"
                name="refundedAmount"
                required
                step="0.01"
                type="number"
              />
            </FormField>
            <FormField id="refundTime" label="Refund date and time" required>
              <Input id="refundTime" name="refundedAt" required type="datetime-local" />
            </FormField>
            <FormField id="refundReference" label="External refund reference">
              <Input id="refundReference" maxLength={120} name="externalReference" />
            </FormField>
            <FormField id="refundImpact" label="Subscription impact" required>
              <select className="h-input" id="refundImpact" name="subscriptionImpact">
                <option value="none">Record only, keep access</option>
                <option value="end_access_now">End access now</option>
              </select>
            </FormField>
            <FormField id="refundReason" label="Action reason" required>
              <Input id="refundReason" maxLength={500} minLength={10} name="reason" required />
            </FormField>
            <FormField id="refundInternalNote" label="Internal note">
              <Textarea id="refundInternalNote" maxLength={2000} name="internalNote" rows={3} />
            </FormField>
            <Button loading={refunding} type="submit" variant="secondary">
              Record Refund
            </Button>
          </form>
        </Card>
        <Card className="payment-review-action-card payment-review-action-card--danger">
          <div>
            <XCircle aria-hidden="true" size={22} />
            <div>
              <h2>Reverse incorrect approval</h2>
              <p>
                This ends the subscription outcome. Later renewals may require a controlled
                correction.
              </p>
            </div>
          </div>
          <form action={reverseAction} className="admin-confirmation-form">
            <HiddenPayment payment={payment} />
            <FormField id="reversalReason" label="Reversal reason" required>
              <Input id="reversalReason" maxLength={500} minLength={10} name="reason" required />
            </FormField>
            <FormField id="reversalInternalNote" label="Internal note">
              <Textarea id="reversalInternalNote" maxLength={2000} name="internalNote" rows={3} />
            </FormField>
            <Button loading={reversing} type="submit" variant="danger">
              Reverse Approval and End Access
            </Button>
          </form>
        </Card>
      </div>
    );
  }
  return (
    <Alert title="No review action is available" tone="info">
      This payment is in {payment.status.replaceAll('_', ' ')} state. Its append-only history
      remains available.
    </Alert>
  );
}

export function PaymentReviewActions({
  payment,
  reviewerId,
  permissions,
  notice,
}: {
  payment: AdminPaymentSubmission;
  reviewerId: string;
  permissions: readonly string[];
  /** The outcome of the newest reviewer action on this submission. */
  notice: string | null;
}) {
  const [, startAction, starting] = useActionState(startPaymentReviewAction, initial);
  const [, infoAction, requesting] = useActionState(requestPaymentInformationAction, initial);
  const [, approveAction, approving] = useActionState(approvePaymentAction, initial);
  const [, rejectAction, rejecting] = useActionState(rejectPaymentAction, initial);
  const [, refundAction, refunding] = useActionState(recordPaymentRefundAction, initial);
  const [, reverseAction, reversing] = useActionState(reversePaymentApprovalAction, initial);
  return (
    <>
      <Result notice={notice} />
      <PaymentReviewControls
        approveAction={approveAction}
        approving={approving}
        infoAction={infoAction}
        mayChangeSubscription={permissions.includes('subscriptions.manage')}
        mayReview={permissions.includes('payments.review')}
        payment={payment}
        refundAction={refundAction}
        refunding={refunding}
        rejectAction={rejectAction}
        rejecting={rejecting}
        requesting={requesting}
        reverseAction={reverseAction}
        reversing={reversing}
        reviewerId={reviewerId}
        startAction={startAction}
        starting={starting}
      />
    </>
  );
}
