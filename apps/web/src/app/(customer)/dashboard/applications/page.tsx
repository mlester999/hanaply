import type { ApplicationTracker } from '@hanaply/contracts';
import { LinkButton, PageHeader } from '@hanaply/ui';
import { FileStack, Radar } from 'lucide-react';
import type { Metadata } from 'next';

import { ApplicationUnavailable } from '@/components/application/application-unavailable';
import { TrackerBoard } from '@/components/application/tracker-board';
import { applicationErrorMessage } from '@/lib/application-action';
import { createAuthenticatedApiClient, requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Application Tracker' };

export default async function ApplicationTrackerPage() {
  const { session } = await requireUser();

  let tracker: ApplicationTracker | null = null;
  let unavailable: string | null = null;
  try {
    tracker = (await createAuthenticatedApiClient(session).applicationTracker()).data;
  } catch (error) {
    unavailable = applicationErrorMessage(
      error,
      'Hanaply could not load your application tracker.',
    );
  }

  return (
    <div className="workspace-page application-page">
      <PageHeader
        actions={
          <div className="application-header-actions">
            <LinkButton href="/dashboard/radar" variant="secondary">
              <Radar aria-hidden="true" size={18} /> Job radar
            </LinkButton>
            <LinkButton href="/dashboard/packs" variant="quiet">
              <FileStack aria-hidden="true" size={18} /> Application Packs
            </LinkButton>
          </div>
        }
        description="Every application you are tracking, grouped by the stage it is in. Each stage change is recorded in an append-only history, and a change made in another session is refused rather than overwriting what is already there."
        eyebrow="Application tracker"
        title="Your pipeline"
      />

      {tracker === null ? (
        <ApplicationUnavailable
          message={unavailable ?? 'Your application tracker could not be loaded.'}
          title="Your application tracker is unavailable"
        />
      ) : (
        <TrackerBoard tracker={tracker} />
      )}
    </div>
  );
}
