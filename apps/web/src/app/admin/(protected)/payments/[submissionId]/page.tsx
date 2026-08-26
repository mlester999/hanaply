import { HanaplyApiError, type AdminPaymentSubmission } from '@hanaply/contracts';
import { Alert, Badge, Card, PageHeader, Table, TableCell, TableHeaderCell } from '@hanaply/ui';
import { AlertTriangle, FileImage, ReceiptText, UserRound } from 'lucide-react';
import Image from 'next/image';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PaymentReviewActions } from '@/components/payment-review-actions';
import { PreviewDialog } from '@/components/preview-dialog';
import { createAuthenticatedApiClient, requireAdminPermission } from '@/lib/session';

export const metadata: Metadata = { title: 'Payment Review Detail' };

function showDate(value: string | null) {
  return value
    ? new Date(value).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })
    : 'Not available';
}

export default async function PaymentReviewDetailPage({
  params,
}: {
  params: Promise<{ submissionId: string }>;
}) {
  const { submissionId } = await params;
  const { session, admin } = await requireAdminPermission('payments.read');
  const client = createAuthenticatedApiClient(session);
  let payment: AdminPaymentSubmission;
  try {
    payment = (await client.adminPaymentSubmission(submissionId)).data;
  } catch (error) {
    if (error instanceof HanaplyApiError && error.status === 404) notFound();
    throw error;
  }
  const [proofAccess, audit] = await Promise.all([
    admin.permissions.includes('payments.review') && payment.proof
      ? client
          .adminPaymentProofAccess(submissionId)
          .then((result) => result.data)
          .catch(() => null)
      : Promise.resolve(null),
    admin.permissions.includes('audit.read')
      ? client
          .adminAudit({ targetId: submissionId, page: 1, pageSize: 25 })
          .then((result) => result.data.items)
          .catch(() => [])
      : Promise.resolve([]),
  ]);
  const proofImage = proofAccess ? (
    <Image
      alt="Private payment proof submitted by the customer"
      className="payment-review-proof-image"
      height={900}
      src={proofAccess.url}
      unoptimized
      width={1200}
    />
  ) : null;
  return (
    <div className="workspace-page">
      <PageHeader
        actions={
          <Badge
            tone={
              payment.status === 'approved'
                ? 'success'
                : payment.status === 'rejected' || payment.status === 'reversed'
                  ? 'danger'
                  : payment.status === 'needs_information'
                    ? 'warning'
                    : 'brand'
            }
          >
            {payment.status.replaceAll('_', ' ')}
          </Badge>
        }
        description="Review only the payment, subscription, identity summary, and history needed for this decision."
        eyebrow="Payment operations"
        title={`Payment ${payment.id.slice(0, 8)}`}
      />
      {payment.flags.length ? (
        <Alert
          icon={<AlertTriangle aria-hidden="true" size={20} />}
          title="Private review warnings"
          tone="warning"
        >
          {payment.flags.map((flag) => (
            <p key={flag.id}>{flag.warning}</p>
          ))}
        </Alert>
      ) : null}
      <div className="payment-review-layout">
        <div className="payment-review-primary">
          <Card className="payment-review-proof-card">
            <div className="admin-detail-heading">
              <FileImage aria-hidden="true" size={22} />
              <h2>Private proof</h2>
            </div>
            {proofImage ? (
              <>
                {proofImage}
                <PreviewDialog
                  description="Large permissioned proof preview with keyboard focus management."
                  title="payment proof"
                >
                  {proofImage}
                </PreviewDialog>
                <dl>
                  <div>
                    <dt>Filename</dt>
                    <dd>{payment.proof?.originalFilename}</dd>
                  </div>
                  <div>
                    <dt>Type</dt>
                    <dd>{payment.proof?.mimeType}</dd>
                  </div>
                  <div>
                    <dt>Size</dt>
                    <dd>
                      {payment.proof ? `${(payment.proof.sizeBytes / 1024).toFixed(1)} KB` : 'None'}
                    </dd>
                  </div>
                  <div>
                    <dt>Dimensions</dt>
                    <dd>
                      {payment.proof ? `${payment.proof.width} × ${payment.proof.height}` : 'None'}
                    </dd>
                  </div>
                  <div>
                    <dt>Checksum</dt>
                    <dd className="payment-checksum">{payment.proof?.checksumSha256}</dd>
                  </div>
                  <div>
                    <dt>Signed access expires</dt>
                    <dd>{showDate(proofAccess?.expiresAt ?? null)}</dd>
                  </div>
                </dl>
              </>
            ) : (
              <Alert
                title={payment.proof ? 'Proof preview unavailable' : 'No proof attached'}
                tone="warning"
              >
                A proof can be viewed only by an active administrator with payments review
                permission.
              </Alert>
            )}
          </Card>
          <Card className="admin-detail-card">
            <div className="admin-detail-heading">
              <ReceiptText aria-hidden="true" size={22} />
              <h2>Payment details</h2>
            </div>
            <dl>
              <div>
                <dt>Plan</dt>
                <dd>{payment.planCode.replaceAll('_', ' ')}</dd>
              </div>
              <div>
                <dt>Amount</dt>
                <dd>₱{(payment.quotedAmountMinor / 100).toLocaleString('en-PH')}</dd>
              </div>
              <div>
                <dt>Billing</dt>
                <dd>{payment.billingPeriod}</dd>
              </div>
              <div>
                <dt>Method</dt>
                <dd>{payment.paymentMethod.displayName}</dd>
              </div>
              <div>
                <dt>Original reference</dt>
                <dd>{payment.referenceNumber ?? 'None'}</dd>
              </div>
              <div>
                <dt>Normalized reference</dt>
                <dd>{payment.normalizedReference ?? 'None'}</dd>
              </div>
              <div>
                <dt>Paid at</dt>
                <dd>{showDate(payment.paidAt)}</dd>
              </div>
              <div>
                <dt>Submitted at</dt>
                <dd>{showDate(payment.submittedAt)}</dd>
              </div>
              <div>
                <dt>User note</dt>
                <dd>{payment.userNote ?? 'None'}</dd>
              </div>
              <div>
                <dt>Information response</dt>
                <dd>{payment.informationResponse ?? 'None'}</dd>
              </div>
              <div>
                <dt>Method snapshot</dt>
                <dd className="admin-payment-prewrap">
                  {payment.paymentMethod.publicInstructions}
                </dd>
              </div>
            </dl>
          </Card>
        </div>
        <div className="payment-review-secondary">
          <Card className="admin-detail-card">
            <div className="admin-detail-heading">
              <UserRound aria-hidden="true" size={22} />
              <h2>User and access</h2>
            </div>
            <dl>
              <div>
                <dt>User</dt>
                <dd>{payment.user.displayName ?? 'Unnamed user'}</dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>{payment.user.email ?? 'Unavailable'}</dd>
              </div>
              <div>
                <dt>Account</dt>
                <dd>{payment.user.accountStatus}</dd>
              </div>
              <div>
                <dt>Reviewer</dt>
                <dd>{payment.reviewerId ?? 'Unclaimed'}</dd>
              </div>
              <div>
                <dt>Review lock</dt>
                <dd>{showDate(payment.reviewLockExpiresAt)}</dd>
              </div>
              <div>
                <dt>Current subscription</dt>
                <dd>
                  {payment.currentSubscription ? (
                    <Link href={`/admin/subscriptions/${payment.currentSubscription.id}`}>
                      {payment.currentSubscription.planCode} · {payment.currentSubscription.status}
                    </Link>
                  ) : (
                    'None'
                  )}
                </dd>
              </div>
            </dl>
          </Card>
          <PaymentReviewActions
            payment={payment}
            permissions={admin.permissions}
            reviewerId={admin.userId}
          />
        </div>
      </div>
      <Card className="payment-review-timeline-card">
        <h2>Append-only payment history</h2>
        <ol className="activation-timeline">
          {payment.events.map((event) => (
            <li key={event.id}>
              <span />
              <div>
                <strong>{event.eventType.replaceAll('.', ' ').replaceAll('_', ' ')}</strong>
                <time dateTime={event.createdAt}>{showDate(event.createdAt)}</time>
                {event.publicMessage ? <p>Public: {event.publicMessage}</p> : null}
                {event.internalNote ? <p>Internal: {event.internalNote}</p> : null}
                {event.reasonCode ? <p>Reason code: {event.reasonCode}</p> : null}
              </div>
            </li>
          ))}
        </ol>
      </Card>
      {admin.permissions.includes('audit.read') ? (
        <section className="admin-payment-history">
          <h2>Related audit events</h2>
          {audit.length ? (
            <Table>
              <thead>
                <tr>
                  <TableHeaderCell>Action</TableHeaderCell>
                  <TableHeaderCell>Actor</TableHeaderCell>
                  <TableHeaderCell>Request</TableHeaderCell>
                  <TableHeaderCell>Created</TableHeaderCell>
                </tr>
              </thead>
              <tbody>
                {audit.map((event) => (
                  <tr key={event.id}>
                    <TableCell>{event.action}</TableCell>
                    <TableCell>{event.actorUserId ?? event.actorType}</TableCell>
                    <TableCell>{event.requestId ?? 'None'}</TableCell>
                    <TableCell>{showDate(event.createdAt)}</TableCell>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <p>No related audit event is available.</p>
          )}
        </section>
      ) : null}
    </div>
  );
}
