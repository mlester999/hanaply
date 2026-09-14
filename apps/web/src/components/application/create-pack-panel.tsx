'use client';

import { Badge, Button, Card, LinkButton } from '@hanaply/ui';
import { Compass, FileStack, PackagePlus, ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { createApplicationPackAction } from '@/app/(customer)/dashboard/packs/actions';
import { ApplicationFeedback } from '@/components/application/application-feedback';
import { useApplicationAction } from '@/components/application/use-application-action';
import { packStatusLabel, packStatusTone } from '@/lib/application';

export interface ExistingPackSummary {
  id: string;
  status: string;
  artifactCount: number;
}

export interface CreatePackPanelProps {
  jobId: string;
  /** The career profile a pack would be built for; null when none is attached. */
  careerProfileId: string | null;
  /** The pack the API already reports for this opportunity, when there is one. */
  existingPack: ExistingPackSummary | null;
}

/**
 * The Application Pack action on an opportunity.
 *
 * A pack already exists for most opportunities the member opens twice, and the
 * API is idempotent by pack identity, so an existing pack is linked instead of
 * offering a second create. Nothing here claims a generation ran: the status
 * shown is the status the API returned.
 */
export function CreatePackPanel({ jobId, careerProfileId, existingPack }: CreatePackPanelProps) {
  const router = useRouter();
  const create = useApplicationAction(createApplicationPackAction, {
    onSuccess: (state) => {
      if (state.packId !== null) router.push(`/dashboard/packs/${state.packId}`);
    },
  });

  return (
    <Card className="application-next-step">
      <div className="application-section-heading">
        <PackagePlus aria-hidden="true" size={20} />
        <div>
          <h2>Application Pack</h2>
          <p>
            A resume, cover letter, and the other artifacts Hanaply can support from the career
            facts you confirmed yourself.
          </p>
        </div>
      </div>

      {careerProfileId === null ? (
        <>
          <p className="application-explainer">
            A pack is always built for one career profile, and this opportunity is not matched to
            one yet. Create or complete a career profile, then return here to request the pack.
          </p>
          <div className="application-card-actions">
            <LinkButton href="/dashboard/career" variant="secondary">
              <Compass aria-hidden="true" size={18} /> Open your career profile
            </LinkButton>
          </div>
        </>
      ) : existingPack !== null ? (
        <>
          <div className="application-existing-pack">
            <Badge tone={packStatusTone(existingPack.status)}>
              {packStatusLabel(existingPack.status)}
            </Badge>
            <span>
              An Application Pack already exists for this opportunity, with{' '}
              {existingPack.artifactCount === 1
                ? '1 artifact'
                : `${existingPack.artifactCount} artifacts`}{' '}
              stored.
            </span>
          </div>
          <p className="application-explainer">
            Opening it does not use another of your monthly packs. Hanaply keeps one pack per
            opportunity and career profile, so asking again returns this same pack.
          </p>
          <div className="application-card-actions">
            <LinkButton href={`/dashboard/packs/${existingPack.id}`}>
              <FileStack aria-hidden="true" size={18} /> Open the Application Pack
            </LinkButton>
            <LinkButton href="/dashboard/packs" variant="secondary">
              All Application Packs
            </LinkButton>
          </div>
        </>
      ) : (
        <>
          <p className="application-explainer">
            Creating a pack draws one Application Pack from this period&apos;s allowance. It is
            assembled only from facts you confirmed in your truth ledger, and each artifact records
            which of those facts it cites. If the allowance is already used, Hanaply refuses the
            request and states the limit in its own words — nothing is created and no allowance is
            used by a refusal.
          </p>
          <p className="application-explainer">
            <ShieldCheck aria-hidden="true" size={16} /> Nothing is invented on your behalf: an
            artifact that cannot be supported by a confirmed fact is not passed by the truth gate.
          </p>
          <form onSubmit={create.onSubmit}>
            <input name="jobId" type="hidden" value={jobId} />
            <input name="careerProfileId" type="hidden" value={careerProfileId} />
            <div className="application-card-actions">
              <Button
                leadingIcon={<PackagePlus aria-hidden="true" size={16} />}
                loading={create.pending}
                type="submit"
              >
                Create Application Pack
              </Button>
              <LinkButton href="/dashboard/packs" variant="quiet">
                View existing packs
              </LinkButton>
            </div>
          </form>
        </>
      )}

      <ApplicationFeedback
        errorTitle="Application Pack not created"
        refusedNote={
          <>
            That sentence is your plan&apos;s allowance speaking, not a fault in the page. Review
            the period on the packs page, or wait for the next period to begin. Nothing was created
            and no allowance was used.
          </>
        }
        state={create.state}
        successTitle="Application Pack ready to open"
      />
    </Card>
  );
}
