import type {
  PaymentMethod,
  PaymentSubmission,
  Plan,
  SubscriptionDetail,
} from '@hanaply/contracts';
import { Alert, PageHeader } from '@hanaply/ui';
import type { Metadata } from 'next';

import { ActivationCenter } from '@/components/activation-center';
import { createAuthenticatedApiClient, requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Activation Center' };

export default async function ActivationPage() {
  const { session, me } = await requireUser();
  const client = createAuthenticatedApiClient(session);
  let plans: readonly Plan[] = [];
  let methods: readonly PaymentMethod[] = [];
  let subscription: SubscriptionDetail | null = null;
  let payments: readonly PaymentSubmission[] = [];
  let unavailable = false;

  try {
    const [plansResult, methodsResult, subscriptionResult, paymentResult] = await Promise.all([
      client.plans(),
      client.paymentMethods(),
      client.mySubscription(),
      client.myPaymentSubmissions({ page: 1, pageSize: 100 }),
    ]);
    plans = plansResult.data;
    methods = methodsResult.data;
    subscription = subscriptionResult.data;
    payments = await Promise.all(
      paymentResult.data.items.map(
        async (payment) => (await client.myPaymentSubmission(payment.id)).data,
      ),
    );
  } catch {
    unavailable = true;
  }

  const proofEntries = await Promise.all(
    payments.map(async (payment) => {
      if (!payment.proof) return [payment.id, null] as const;
      try {
        return [payment.id, (await client.myPaymentProofAccess(payment.id)).data.url] as const;
      } catch {
        return [payment.id, null] as const;
      }
    }),
  );

  return (
    <div className="workspace-page activation-page">
      <PageHeader
        description="Choose a plan, follow the current payment instructions, and submit private proof for an authorized review."
        eyebrow="Customer dashboard"
        title="Activate Hanaply"
      />
      {unavailable ? (
        <Alert title="Activation services are unavailable" tone="danger">
          Hanaply could not load authoritative plans or payment records. No fallback pricing or
          payment instructions are being shown.
        </Alert>
      ) : (
        <ActivationCenter
          accountStatus={me.profile.accountStatus}
          methods={methods}
          payments={payments}
          plans={plans}
          proofUrls={Object.fromEntries(proofEntries)}
          subscription={subscription}
        />
      )}
    </div>
  );
}
