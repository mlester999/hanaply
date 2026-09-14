import type { ApplicationPackDirectory } from '@hanaply/contracts';
import { LinkButton, PageHeader } from '@hanaply/ui';
import { Compass, KanbanSquare } from 'lucide-react';
import type { Metadata } from 'next';

import { ApplicationUnavailable } from '@/components/application/application-unavailable';
import { PackList } from '@/components/application/pack-list';
import { PackUsagePanel } from '@/components/application/pack-usage';
import { applicationErrorMessage } from '@/lib/application-action';
import { createAuthenticatedApiClient, requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Application Packs' };

export default async function ApplicationPacksPage() {
  const { session } = await requireUser();

  let directory: ApplicationPackDirectory | null = null;
  let unavailable: string | null = null;
  try {
    directory = (await createAuthenticatedApiClient(session).applicationPacks()).data;
  } catch (error) {
    unavailable = applicationErrorMessage(error, 'Hanaply could not load your Application Packs.');
  }

  return (
    <div className="workspace-page application-page">
      <PageHeader
        actions={
          <div className="application-header-actions">
            <LinkButton href="/dashboard/radar" variant="secondary">
              <Compass aria-hidden="true" size={18} /> Job radar
            </LinkButton>
            <LinkButton href="/dashboard/applications" variant="quiet">
              <KanbanSquare aria-hidden="true" size={18} /> Tracker
            </LinkButton>
          </div>
        }
        description="Every Application Pack Hanaply has assembled for you, with the allowance it drew on. Each pack records the confirmed career facts it was allowed to use, and every artifact carries its own truth-gate result."
        eyebrow="Application Packs"
        title="Your packs"
      />

      {directory === null ? (
        <ApplicationUnavailable
          message={unavailable ?? 'Your Application Packs could not be loaded.'}
          title="Your Application Packs are unavailable"
        />
      ) : (
        <>
          <PackUsagePanel usage={directory.usage} />
          <PackList items={directory.items} now={new Date()} />
        </>
      )}
    </div>
  );
}
