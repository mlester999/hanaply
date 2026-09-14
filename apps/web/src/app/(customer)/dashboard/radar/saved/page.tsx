import { type CareerProfileDirectory, type JobRadar, type JobRadarQuery } from '@hanaply/contracts';
import { Badge, LinkButton, PageHeader } from '@hanaply/ui';
import { Bookmark, Compass } from 'lucide-react';
import type { Metadata } from 'next';

import { RadarFilterBar, type RadarProfileOption } from '@/components/radar/radar-filters';
import { RadarFeed } from '@/components/radar/radar-feed';
import {
  RadarIgnoredFilters,
  RadarSavedNote,
  RadarStatStrip,
  RadarUnavailable,
  type RadarStatTotals,
} from '@/components/radar/radar-stats';
import { radarErrorMessage } from '@/lib/radar-action';
import {
  radarActiveFilters,
  radarQueryFromSearchParams,
  type RadarSearchParams,
} from '@/lib/radar';
import { createAuthenticatedApiClient, requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Saved Opportunities' };

const basePath = '/dashboard/radar/saved';

interface SavedTotals {
  stats: RadarStatTotals | null;
  unavailable: string | null;
}

/**
 * The saved list is the same feed pinned to `savedOnly`, so its totals are read
 * the same way the radar reads them: one filtered count from the feed response
 * and two aggregate counts asked for separately.
 */
async function readTotals(
  client: ReturnType<typeof createAuthenticatedApiClient>,
  query: JobRadarQuery,
  pageTotal: number,
): Promise<SavedTotals> {
  try {
    const [strong, analysed] = await Promise.all([
      client.jobRadar({ ...query, pageSize: 1, verdicts: ['strong_match'] }),
      client.jobRadar({ ...query, pageSize: 1, minScore: 0 }),
    ]);
    return {
      stats: {
        total: pageTotal,
        strongMatches: strong.data.pagination.total,
        unanalysed: Math.max(pageTotal - analysed.data.pagination.total, 0),
      },
      unavailable: null,
    };
  } catch (error) {
    return {
      stats: null,
      unavailable: radarErrorMessage(error, 'The saved-opportunity counts could not be read.'),
    };
  }
}

export default async function SavedOpportunitiesPage({
  searchParams,
}: {
  searchParams: Promise<RadarSearchParams>;
}) {
  const values = await searchParams;
  const { session } = await requireUser();
  const client = createAuthenticatedApiClient(session);
  const parsed = radarQueryFromSearchParams(values);
  // The saved list is pinned: a link that also asks for dismissed opportunities
  // cannot widen this page into the dismissed view, and the dropped flag is
  // reported through the ignored-filters notice.
  const query: JobRadarQuery = { ...parsed.query, savedOnly: true, dismissedOnly: undefined };
  const ignoredKeys = parsed.invalidKeys.includes('dismissedOnly')
    ? parsed.invalidKeys
    : [...parsed.invalidKeys, ...(parsed.query.dismissedOnly === true ? ['dismissedOnly'] : [])];

  let feed: JobRadar | null = null;
  let feedError: string | null = null;
  let directory: CareerProfileDirectory | null = null;
  try {
    feed = (await client.jobRadar({ ...query })).data;
  } catch (error) {
    feedError = radarErrorMessage(error, 'Hanaply could not load your saved opportunities.');
  }
  try {
    directory = (await client.careerProfiles()).data;
  } catch {
    directory = null;
  }

  const profileOptions: readonly RadarProfileOption[] = (directory?.items ?? []).map((profile) => ({
    value: profile.id,
    label: profile.isPrimary ? `${profile.name} (primary)` : profile.name,
  }));
  const activeFilterCount = radarActiveFilters(query, { excludeStatus: true }).length;
  const totals: SavedTotals =
    feed === null
      ? { stats: null, unavailable: feedError }
      : await readTotals(client, query, feed.pagination.total);

  return (
    <div className="workspace-page radar-page">
      <PageHeader
        actions={
          <div className="radar-header-actions">
            <LinkButton href="/dashboard/radar" variant="secondary">
              <Compass aria-hidden="true" size={18} /> Back to the radar
            </LinkButton>
          </div>
        }
        description="Opportunities you saved, with the same stored match intelligence as the radar. Saving a posting is not an application and nothing here tracks one."
        eyebrow="Career radar"
        title="Saved opportunities"
      />

      <RadarSavedNote savedCount={feed?.pagination.total ?? 0} />

      <RadarFilterBar
        basePath={basePath}
        pinnedSaved
        profileOptions={profileOptions}
        query={query}
      />

      <RadarIgnoredFilters invalidKeys={ignoredKeys} />

      <RadarStatStrip totals={totals.stats} unavailable={totals.unavailable} />

      {feed === null ? (
        <RadarUnavailable message={feedError ?? 'Your saved opportunities could not be loaded.'} />
      ) : (
        <>
          <div className="radar-results-heading">
            <h2 id="radar-results-title">Saved and ranked</h2>
            <Badge tone={activeFilterCount > 0 ? 'brand' : 'neutral'}>
              {activeFilterCount > 0
                ? `${activeFilterCount} active ${activeFilterCount === 1 ? 'filter' : 'filters'}`
                : 'Every saved opportunity'}
            </Badge>
          </div>
          <RadarFeed
            basePath={basePath}
            careerProfileId={feed.careerProfileId}
            evaluatedAt={feed.evaluatedAt}
            items={feed.items}
            now={new Date()}
            pagination={feed.pagination}
            query={query}
          />
        </>
      )}

      <section aria-label="Where saved opportunities live" className="radar-saved-footer">
        <Bookmark aria-hidden="true" size={18} />
        <p>
          Saved opportunities stay here until you remove them. Marking an opportunity as saved in
          the feedback menu keeps it here too, and the radar keeps showing it until you record a
          negative signal.
        </p>
      </section>
    </div>
  );
}
