'use client';

import type {
  PaymentMethod,
  PaymentSubmission,
  Plan,
  SubscriptionDetail,
} from '@hanaply/contracts';
import { Alert, Badge, Button, Card, EmptyState, FormField, Input, Textarea } from '@hanaply/ui';
import {
  CalendarClock,
  Check,
  CheckCircle2,
  Clipboard,
  Clock3,
  CreditCard,
  FileImage,
  Info,
  QrCode,
  RefreshCw,
  ShieldCheck,
  UploadCloud,
} from 'lucide-react';
import Image from 'next/image';
import { useEffect, useMemo, useState, useActionState } from 'react';

import {
  cancelPaymentAction,
  type PaymentActionState,
  savePaymentDraftAction,
  submitPaymentAction,
} from '@/app/(customer)/dashboard/activation/actions';
import { PreviewDialog } from '@/components/preview-dialog';

const initialActionState: PaymentActionState = { status: 'idle', message: null };

function money(minor: number): string {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(minor / 100);
}

function manilaInputValue(timestamp: string | null): string {
  if (!timestamp) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(timestamp));
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}T${value.hour}:${value.minute}`;
}

function dateTime(timestamp: string | null): string {
  if (!timestamp) return 'Not provided';
  return new Intl.DateTimeFormat('en-PH', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Manila',
  }).format(new Date(timestamp));
}

function statusTone(status: PaymentSubmission['status']) {
  if (status === 'approved') return 'success' as const;
  if (status === 'rejected' || status === 'reversed') return 'danger' as const;
  if (status === 'needs_information' || status === 'refunded') return 'warning' as const;
  if (status === 'submitted' || status === 'under_review' || status === 'resubmitted') {
    return 'brand' as const;
  }
  return 'neutral' as const;
}

function statusLabel(status: string): string {
  return status.replaceAll('_', ' ').replace(/\b\w/gu, (character) => character.toUpperCase());
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => {
      setCopied(false);
    }, 2_000);
  }
  return (
    <button
      className="activation-copy"
      onClick={() => {
        void copy();
      }}
      type="button"
    >
      {copied ? <Check aria-hidden="true" size={16} /> : <Clipboard aria-hidden="true" size={16} />}
      {copied ? 'Copied' : `Copy ${label}`}
    </button>
  );
}

function ImagePreview({ url, alt, title }: { url: string; alt: string; title: string }) {
  const image = (
    <Image
      alt={alt}
      className="activation-preview-image"
      height={720}
      src={url}
      unoptimized
      width={960}
    />
  );
  return (
    <div className="activation-preview">
      {image}
      <PreviewDialog description={`Large private preview of ${title}.`} title={title}>
        {image}
      </PreviewDialog>
    </div>
  );
}

function PlanPicker({
  plans,
  selected,
  onSelect,
  locked,
}: {
  plans: readonly Plan[];
  selected: string;
  onSelect: (planCode: string) => void;
  locked: boolean;
}) {
  return (
    <div aria-label="Choose a Hanaply plan" className="activation-plan-picker" role="group">
      {(['plus', 'pro'] as const).map((tier) => {
        const monthly = plans.find(
          (plan) => plan.tierCode === tier && plan.billingPeriod === 'monthly',
        );
        const annual = plans.find(
          (plan) => plan.tierCode === tier && plan.billingPeriod === 'annual',
        );
        if (!monthly || !annual) return null;
        return (
          <Card className="activation-tier-card" key={tier}>
            <div className="activation-tier-heading">
              <div>
                <Badge tone={tier === 'pro' ? 'brand' : 'neutral'}>{tier}</Badge>
                <h3>{tier === 'pro' ? 'Pro' : 'Plus'}</h3>
              </div>
              {tier === 'pro' ? (
                <ShieldCheck aria-hidden="true" size={22} />
              ) : (
                <CreditCard aria-hidden="true" size={22} />
              )}
            </div>
            <div className="activation-billing-options">
              {[monthly, annual].map((plan) => {
                const savings =
                  plan.billingPeriod === 'annual' ? monthly.priceMinor * 12 - plan.priceMinor : 0;
                return (
                  <button
                    aria-pressed={selected === plan.code}
                    className="activation-billing-option"
                    disabled={locked}
                    key={plan.code}
                    onClick={() => {
                      onSelect(plan.code);
                    }}
                    type="button"
                  >
                    <span>{plan.billingPeriod === 'annual' ? 'Annual' : 'Monthly'}</span>
                    <strong>{money(plan.priceMinor)}</strong>
                    <small>
                      {plan.billingPeriod === 'annual'
                        ? `Save ${money(savings)} each year`
                        : 'Pay for one calendar month'}
                    </small>
                  </button>
                );
              })}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function MethodPicker({
  methods,
  selected,
  onSelect,
  locked,
}: {
  methods: readonly PaymentMethod[];
  selected: string;
  onSelect: (methodId: string) => void;
  locked: boolean;
}) {
  return (
    <div aria-label="Choose a payment method" className="activation-method-picker" role="group">
      {methods.map((method) => (
        <button
          aria-pressed={selected === method.id}
          className="activation-method-option"
          disabled={locked}
          key={method.id}
          onClick={() => {
            onSelect(method.id);
          }}
          type="button"
        >
          <CreditCard aria-hidden="true" size={19} />
          <span>
            <strong>{method.displayName}</strong>
            <small>{method.methodType.replaceAll('_', ' ')}</small>
          </span>
          {selected === method.id ? <CheckCircle2 aria-hidden="true" size={19} /> : null}
        </button>
      ))}
    </div>
  );
}

function StatusTracker({ status }: { status: PaymentSubmission['status'] }) {
  const steps = ['submitted', 'under_review', 'needs_information', 'approved'] as const;
  const index = steps.indexOf(status as (typeof steps)[number]);
  return (
    <ol aria-label="Payment review status" className="activation-status-track">
      {steps.map((step, stepIndex) => (
        <li
          className={
            step === status ? 'is-current' : index >= 0 && stepIndex < index ? 'is-complete' : ''
          }
          key={step}
        >
          <span>{stepIndex + 1}</span>
          {statusLabel(step)}
        </li>
      ))}
    </ol>
  );
}

function PaymentForm({
  plans,
  methods,
  payment,
  proofUrl,
}: {
  plans: readonly Plan[];
  methods: readonly PaymentMethod[];
  payment?: PaymentSubmission;
  proofUrl?: string | null | undefined;
}) {
  const locked = payment?.status === 'needs_information';
  const firstPlan = payment?.planCode ?? plans[0]?.code ?? '';
  const firstMethod = payment?.paymentMethodId ?? methods[0]?.id ?? '';
  const [planCode, setPlanCode] = useState(firstPlan);
  const [methodId, setMethodId] = useState(firstMethod);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [saveState, saveAction, saving] = useActionState(
    savePaymentDraftAction,
    initialActionState,
  );
  const [submitState, submitAction, submitting] = useActionState(
    submitPaymentAction,
    initialActionState,
  );
  const [cancelState, cancelAction, cancelling] = useActionState(
    cancelPaymentAction,
    initialActionState,
  );
  const selectedPlan = plans.find((plan) => plan.code === planCode);
  const selectedMethod = methods.find((method) => method.id === methodId);
  const currentState = submitState.message ? submitState : saveState;

  useEffect(
    () => () => {
      if (localPreview) URL.revokeObjectURL(localPreview);
    },
    [localPreview],
  );

  function preview(file: File | undefined) {
    if (localPreview) URL.revokeObjectURL(localPreview);
    setLocalPreview(file ? URL.createObjectURL(file) : null);
  }

  return (
    <Card className="activation-flow-card">
      <div className="activation-section-heading">
        <div>
          <span className="h-eyebrow">{payment ? 'Resume payment' : 'New payment'}</span>
          <h2>{payment ? `Draft ${payment.id.slice(0, 8)}` : 'Submit payment details'}</h2>
          <p>
            No subscription or paid entitlement is granted until an authorized review approves it.
          </p>
        </div>
        {payment ? (
          <Badge tone={statusTone(payment.status)}>{statusLabel(payment.status)}</Badge>
        ) : null}
      </div>

      {payment?.status === 'needs_information' && payment.publicReviewMessage ? (
        <Alert
          icon={<Info aria-hidden="true" size={20} />}
          title="More information is required"
          tone="warning"
        >
          {payment.publicReviewMessage}
        </Alert>
      ) : null}
      {currentState.message ? (
        <Alert
          aria-live="polite"
          title={currentState.status === 'success' ? 'Payment updated' : 'Payment not updated'}
          tone={currentState.status === 'success' ? 'success' : 'danger'}
        >
          {currentState.message}
        </Alert>
      ) : null}

      <form className="activation-payment-form" encType="multipart/form-data">
        {payment ? <input name="submissionId" type="hidden" value={payment.id} /> : null}
        <input name="expectedVersion" type="hidden" value={payment?.version ?? 0} />
        <input name="status" type="hidden" value={payment?.status ?? 'draft'} />
        <input name="planCode" type="hidden" value={planCode} />
        <input name="paymentMethodId" type="hidden" value={methodId} />

        <section className="activation-form-section">
          <div className="activation-form-step">
            <span>1</span>
            <div>
              <h3>Choose your plan</h3>
              <p>Select monthly or annual billing. Hanaply does not renew automatically.</p>
            </div>
          </div>
          <PlanPicker locked={locked} onSelect={setPlanCode} plans={plans} selected={planCode} />
        </section>

        <section className="activation-form-section">
          <div className="activation-form-step">
            <span>2</span>
            <div>
              <h3>Choose a payment method</h3>
              <p>Complete the payment outside Hanaply using the current instructions.</p>
            </div>
          </div>
          <MethodPicker
            locked={locked}
            methods={methods}
            onSelect={setMethodId}
            selected={methodId}
          />
          {selectedMethod ? (
            <div className="activation-method-detail">
              <div className="activation-method-copy">
                <dl>
                  {selectedMethod.accountHolderName ? (
                    <div>
                      <dt>Account holder</dt>
                      <dd>
                        {selectedMethod.accountHolderName}
                        <CopyButton
                          label="account holder"
                          value={selectedMethod.accountHolderName}
                        />
                      </dd>
                    </div>
                  ) : null}
                  {selectedMethod.accountIdentifier ? (
                    <div>
                      <dt>Account or mobile number</dt>
                      <dd>
                        {selectedMethod.accountIdentifier}
                        <CopyButton
                          label="account number"
                          value={selectedMethod.accountIdentifier}
                        />
                      </dd>
                    </div>
                  ) : null}
                  {selectedMethod.bankName ? (
                    <div>
                      <dt>Bank</dt>
                      <dd>{selectedMethod.bankName}</dd>
                    </div>
                  ) : null}
                </dl>
                <p>{selectedMethod.publicInstructions}</p>
                {selectedMethod.publicNotes ? <small>{selectedMethod.publicNotes}</small> : null}
              </div>
              {selectedMethod.qrCodeUrl ? (
                <div className="activation-qr">
                  <QrCode aria-hidden="true" size={20} />
                  <ImagePreview
                    alt={`QR code for ${selectedMethod.displayName}`}
                    title="payment QR code"
                    url={selectedMethod.qrCodeUrl}
                  />
                </div>
              ) : null}
            </div>
          ) : null}
        </section>

        <section className="activation-form-section">
          <div className="activation-form-step">
            <span>3</span>
            <div>
              <h3>Add payment details</h3>
              <p>Use the reference and payment time shown by your payment provider.</p>
            </div>
          </div>
          <div className="activation-field-grid">
            <FormField
              id={`paymentReference-${payment?.id ?? 'new'}`}
              label="Reference number"
              required
            >
              <Input
                defaultValue={payment?.referenceNumber ?? ''}
                id={`paymentReference-${payment?.id ?? 'new'}`}
                maxLength={100}
                minLength={6}
                name="referenceNumber"
                placeholder="Example: TEST-REF-123456"
                required
              />
            </FormField>
            <FormField
              hint="Displayed and reviewed in Asia/Manila time."
              id={`paymentTime-${payment?.id ?? 'new'}`}
              label="Payment date and time"
              required
            >
              <Input
                defaultValue={manilaInputValue(payment?.paidAt ?? null)}
                id={`paymentTime-${payment?.id ?? 'new'}`}
                name="paidAt"
                required
                type="datetime-local"
              />
            </FormField>
          </div>
          <FormField
            hint="JPEG, PNG, or WebP. Maximum 8 MB. Metadata is removed before storage."
            id={`paymentProof-${payment?.id ?? 'new'}`}
            label={payment?.proof ? 'Replace payment proof' : 'Payment proof'}
            required={!payment?.proof}
          >
            <label className="activation-upload" htmlFor={`paymentProof-${payment?.id ?? 'new'}`}>
              <UploadCloud aria-hidden="true" size={24} />
              <span>
                <strong>
                  {payment?.proof ? 'Choose a replacement image' : 'Choose a proof image'}
                </strong>
                <small>Only a validated image is stored in private payment storage.</small>
              </span>
              <Input
                accept="image/jpeg,image/png,image/webp"
                id={`paymentProof-${payment?.id ?? 'new'}`}
                name="proof"
                onChange={(event) => {
                  preview(event.currentTarget.files?.[0]);
                }}
                required={!payment?.proof}
                type="file"
              />
            </label>
          </FormField>
          {localPreview ? (
            <ImagePreview
              alt="Selected payment proof preview"
              title="selected proof"
              url={localPreview}
            />
          ) : proofUrl ? (
            <ImagePreview
              alt="Private payment proof preview"
              title="payment proof"
              url={proofUrl}
            />
          ) : null}
          {payment?.proof ? (
            <p className="activation-file-meta">
              <FileImage aria-hidden="true" size={17} />
              {payment.proof.originalFilename} · {(payment.proof.sizeBytes / 1024).toFixed(1)} KB ·{' '}
              {payment.proof.width} × {payment.proof.height}
            </p>
          ) : null}
          <FormField id={`paymentNote-${payment?.id ?? 'new'}`} label="Optional note">
            <Textarea
              defaultValue={payment?.userNote ?? ''}
              id={`paymentNote-${payment?.id ?? 'new'}`}
              maxLength={1000}
              name="userNote"
              rows={3}
            />
          </FormField>
          {locked ? (
            <FormField
              id={`informationResponse-${payment.id}`}
              label="Response to reviewer"
              required
            >
              <Textarea
                defaultValue={payment.informationResponse ?? ''}
                id={`informationResponse-${payment.id}`}
                maxLength={2000}
                name="informationResponse"
                required
                rows={4}
              />
            </FormField>
          ) : null}
        </section>

        <section className="activation-review-box">
          <div className="activation-form-step">
            <span>4</span>
            <div>
              <h3>Review and declare</h3>
              <p>Confirm the exact details before sending them to a reviewer.</p>
            </div>
          </div>
          <dl>
            <div>
              <dt>Plan</dt>
              <dd>{selectedPlan?.name ?? 'Choose a plan'}</dd>
            </div>
            <div>
              <dt>Billing</dt>
              <dd>{selectedPlan ? statusLabel(selectedPlan.billingPeriod) : 'Not selected'}</dd>
            </div>
            <div>
              <dt>Exact amount</dt>
              <dd>{selectedPlan ? money(selectedPlan.priceMinor) : 'Not selected'}</dd>
            </div>
            <div>
              <dt>Payment method</dt>
              <dd>{selectedMethod?.displayName ?? 'Not selected'}</dd>
            </div>
          </dl>
          <label className="activation-declaration">
            <input name="declarationAccepted" type="checkbox" />
            <span>
              The details are accurate, the proof belongs to this payment, and I understand that
              altered or reused proof may be rejected. Submission does not guarantee approval.
            </span>
          </label>
        </section>

        <div className="activation-form-actions">
          <Button formAction={saveAction} loading={saving} type="submit" variant="secondary">
            Save Draft
          </Button>
          <Button
            formAction={submitAction}
            loading={submitting}
            leadingIcon={<ShieldCheck aria-hidden="true" size={18} />}
            type="submit"
          >
            {locked ? 'Resubmit for Review' : 'Submit for Review'}
          </Button>
        </div>
      </form>

      {payment ? (
        <form action={cancelAction} className="activation-cancel-form">
          <input name="submissionId" type="hidden" value={payment.id} />
          <input name="expectedVersion" type="hidden" value={payment.version} />
          <Button loading={cancelling} type="submit" variant="quiet">
            Cancel Payment
          </Button>
          {cancelState.message ? <span aria-live="polite">{cancelState.message}</span> : null}
        </form>
      ) : null}
    </Card>
  );
}

function PaymentHistory({
  payments,
  proofUrls,
}: {
  payments: readonly PaymentSubmission[];
  proofUrls: Readonly<Record<string, string | null>>;
}) {
  if (payments.length === 0) {
    return (
      <EmptyState
        description="Saved drafts and submitted payments will appear here."
        eyebrow="Payment history"
        icon={<Clock3 aria-hidden="true" size={23} />}
        title="No payment history yet"
      />
    );
  }
  return (
    <div className="activation-history-list">
      {payments.map((payment) => {
        const proofUrl = proofUrls[payment.id];
        return (
          <Card className="activation-history-card" key={payment.id}>
            <div className="activation-history-heading">
              <div>
                <Badge tone={statusTone(payment.status)}>{statusLabel(payment.status)}</Badge>
                <h3>{payment.paymentMethod.displayName}</h3>
                <p>
                  {payment.planCode.replaceAll('_', ' ')} · {money(payment.quotedAmountMinor)}
                </p>
              </div>
              <time dateTime={payment.createdAt}>{dateTime(payment.createdAt)}</time>
            </div>
            {['submitted', 'under_review', 'needs_information', 'approved'].includes(
              payment.status,
            ) ? (
              <StatusTracker status={payment.status} />
            ) : null}
            {payment.publicReviewMessage ? (
              <Alert title="Review update" tone={payment.status === 'rejected' ? 'danger' : 'info'}>
                {payment.publicReviewMessage}
              </Alert>
            ) : null}
            <dl className="activation-history-facts">
              <div>
                <dt>Reference</dt>
                <dd>{payment.referenceNumber ?? 'Not provided'}</dd>
              </div>
              <div>
                <dt>Payment time</dt>
                <dd>{dateTime(payment.paidAt)}</dd>
              </div>
              <div>
                <dt>Last updated</dt>
                <dd>{dateTime(payment.updatedAt)}</dd>
              </div>
            </dl>
            {proofUrl ? (
              <ImagePreview
                alt="Private submitted payment proof"
                title="submitted proof"
                url={proofUrl}
              />
            ) : null}
            {payment.events.length ? (
              <ol className="activation-timeline">
                {payment.events.map((event) => (
                  <li key={event.id}>
                    <span />
                    <div>
                      <strong>{event.eventType.replaceAll('.', ' ').replaceAll('_', ' ')}</strong>
                      <time dateTime={event.createdAt}>{dateTime(event.createdAt)}</time>
                      {event.publicMessage ? <p>{event.publicMessage}</p> : null}
                    </div>
                  </li>
                ))}
              </ol>
            ) : null}
          </Card>
        );
      })}
    </div>
  );
}

export function ActivationCenter({
  plans,
  methods,
  subscription,
  payments,
  proofUrls,
  accountStatus,
}: {
  plans: readonly Plan[];
  methods: readonly PaymentMethod[];
  subscription: SubscriptionDetail | null;
  payments: readonly PaymentSubmission[];
  proofUrls: Readonly<Record<string, string | null>>;
  accountStatus: string;
}) {
  const editable = useMemo(
    () => payments.filter((payment) => ['draft', 'needs_information'].includes(payment.status)),
    [payments],
  );
  const history = useMemo(
    () => payments.filter((payment) => !['draft', 'needs_information'].includes(payment.status)),
    [payments],
  );
  return (
    <>
      <div className="activation-summary-grid">
        <Card className="activation-summary-card">
          <ShieldCheck aria-hidden="true" size={22} />
          <span>Account</span>
          <strong>{statusLabel(accountStatus)}</strong>
        </Card>
        <Card className="activation-summary-card">
          <CreditCard aria-hidden="true" size={22} />
          <span>Subscription</span>
          <strong>{subscription ? statusLabel(subscription.status) : 'Inactive'}</strong>
        </Card>
        <Card className="activation-summary-card">
          <CalendarClock aria-hidden="true" size={22} />
          <span>Paid access until</span>
          <strong>{subscription?.endsAt ? dateTime(subscription.endsAt) : 'No active term'}</strong>
        </Card>
      </div>
      <Alert
        icon={<RefreshCw aria-hidden="true" size={20} />}
        title="Manual renewal only"
        tone="info"
      >
        Hanaply does not charge automatically. Each activation or renewal requires a separate
        payment and review.
      </Alert>
      {methods.length === 0 ? (
        <EmptyState
          description="An administrator must enable a payment method before a new payment draft can be created."
          eyebrow="Activation unavailable"
          icon={<CreditCard aria-hidden="true" size={24} />}
          title="No payment methods are available"
        />
      ) : (
        <div className="activation-form-stack">
          {editable.map((payment) => (
            <PaymentForm
              key={payment.id}
              methods={methods}
              payment={payment}
              plans={plans}
              proofUrl={proofUrls[payment.id]}
            />
          ))}
          <PaymentForm methods={methods} plans={plans} />
        </div>
      )}
      <section className="activation-history-section">
        <div className="activation-section-heading">
          <div>
            <span className="h-eyebrow">Account record</span>
            <h2>Payment history</h2>
            <p>Track submitted, reviewed, approved, rejected, refunded, and reversed payments.</p>
          </div>
        </div>
        <PaymentHistory payments={history} proofUrls={proofUrls} />
      </section>
    </>
  );
}
