import { HanaplyApiError, type CareerFact, type CareerProfileDetail } from '@hanaply/contracts';
import { Alert, LinkButton, PageHeader } from '@hanaply/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { CareerFactsLedger } from '@/components/career/career-facts-ledger';
import { humanise } from '@/lib/career';
import { createAuthenticatedApiClient, requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Career Truth Ledger' };

export default async function CareerFactsPage({
  params,
}: {
  params: Promise<{ profileId: string }>;
}) {
  const { profileId } = await params;
  const { session } = await requireUser();
  const client = createAuthenticatedApiClient(session);

  let profile: CareerProfileDetail | null = null;
  let facts: readonly CareerFact[] = [];
  let unavailable: string | null = null;
  try {
    const [profileResult, factResult] = await Promise.all([
      client.careerProfile(profileId),
      client.careerFacts(profileId),
    ]);
    profile = profileResult.data;
    facts = factResult.data.items;
  } catch (error) {
    if (error instanceof HanaplyApiError && error.status === 404) notFound();
    unavailable =
      error instanceof HanaplyApiError
        ? error.envelope.error.message
        : 'Hanaply could not load this truth ledger.';
  }

  if (!profile || unavailable) {
    return (
      <div className="workspace-page career-page">
        <PageHeader eyebrow="Career intelligence" title="Truth ledger" />
        <Alert title="This truth ledger is unavailable" tone="danger">
          {unavailable ?? 'The ledger could not be loaded.'}
        </Alert>
        <LinkButton href="/dashboard/career" variant="secondary">
          Back to career profiles
        </LinkButton>
      </div>
    );
  }

  const candidate = facts.filter((fact) => fact.status === 'candidate');
  const confirmed = facts.filter((fact) => fact.status === 'confirmed');
  const rejected = facts.filter((fact) => fact.status === 'rejected');
  const superseded = facts.filter((fact) => fact.status === 'superseded');

  return (
    <div className="workspace-page career-page">
      <PageHeader
        actions={
          <LinkButton href={`/dashboard/career/${profile.id}`} variant="secondary">
            Back to {profile.name}
          </LinkButton>
        }
        description="Every claim Hanaply may ever cite lives here with its source and status. Nothing is confirmed on your behalf."
        eyebrow="Career intelligence"
        title="Truth ledger"
      />
      <CareerFactsLedger
        candidate={candidate}
        confirmed={confirmed}
        profileId={profile.id}
        profileName={profile.name}
        rejected={rejected}
      />
      {superseded.length > 0 ? (
        <section aria-labelledby="career-ledger-superseded-title" className="career-superseded">
          <h2 id="career-ledger-superseded-title">
            {superseded.length} {superseded.length === 1 ? 'claim was' : 'claims were'} replaced by
            a correction
          </h2>
          <p className="career-hint">
            Replacements keep the original wording for the audit trail. Only the replacement is used
            as evidence.
          </p>
          <ul className="career-fact-list">
            {superseded.map((fact) => (
              <li className="career-fact-row" key={fact.id}>
                <p className="career-fact-statement">{fact.statement}</p>
                <p className="career-hint">
                  {humanise(fact.category)} · source {fact.source}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
