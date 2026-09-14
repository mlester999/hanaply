import { type CareerProfileDirectory, type JobRadar, type JobRadarQuery } from '@hanaply/contracts';
import { Badge, LinkButton, PageHeader } from '@hanaply/ui';
import { Bookmark, Compass } from 'lucide-react';
import type { Metadata } from 'next';

import { RadarFilterBar, type RadarProfileOption } from '@/components/radar/radar-filters';
import { RadarFeed } from '@/components/radar/radar-feed';
import {
  RadarIgnoredFilters,
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

export const metadata: Metadata = { title: 'Job Radar' };

interface RadarTotals {
  stats: RadarStatTotals | null;
  unavailable: string | null;
}

/**
 * The strip above the feed reports three numbers, each read from the API:
 * the filtered total from the feed's own pagination, and two aggregate counts
 * asked for separately. Nothing is extrapolated from the page of results.
 */
async function readTotals(
  client: ReturnType<typeof createAuthenticatedApiClient>,
  query: JobRadarQuery,
  pageTotal: number,
): Promise<RadarTotals> {
  try {
    const [strong, analysed] = await Promise.all([
      client.jobRadar({ ...query, pageSize: 1, verdicts: ['strong_match'] }),
      client.jobRadar({ ...query, pageSize: 1, minScore: 0 }),
    ]);
    const scored = analysed.data.pagination.total;
    return {
      stats: {
        total: pageTotal,
        strongMatches: strong.data.pagination.total,
        unanalysed: Math.max(pageTotal - scored, 0),
      },
      unavailable: null,
    };
  } catch (error) {
    return {
      stats: null,
      unavailable: radarErrorMessage(error, 'The radar counts could not be read.'),
    };
  }
}

export default async function RadarPage({
  searchParams,
}: {
  searchParams: Promise<RadarSearchParams>;
}) {
  const values = await searchParams;
  const { session } = await requireUser();
  const client = createAuthenticatedApiClient(session);
  const { query, invalidKeys } = radarQueryFromSearchParams(values);

  let feed: JobRadar | null = null;
  let feedError: string | null = null;
  let directory: CareerProfileDirectory | null = null;
  try {
    feed = (await client.jobRadar({ ...query })).data;
  } catch (error) {
    feedError = radarErrorMessage(error, 'Hanaply could not load the opportunity feed.');
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
  const totals: RadarTotals =
    feed === null
      ? { stats: null, unavailable: feedError }
      : await readTotals(client, query, feed.pagination.total);

  return (
    <div className="workspace-page radar-page">
      <PageHeader
        actions={
          <div className="radar-header-actions">
            <LinkButton href="/dashboard/radar/saved" variant="secondary">
              <Bookmark aria-hidden="true" size={18} /> Saved opportunities
            </LinkButton>
            <LinkButton href="/dashboard/career" variant="quiet">
              <Compass aria-hidden="true" size={18} /> Career profile
            </LinkButton>
          </div>
        }
        description="Every opportunity Hanaply has ingested, ranked against your career profile with the reasoning stored beside the score. An opportunity with no analysis yet says so instead of showing a number."
        eyebrow="Career radar"
        title="Job radar"
      />

      <RadarFilterBar basePath="/dashboard/radar" profileOptions={profileOptions} query={query} />

      <RadarIgnoredFilters invalidKeys={invalidKeys} />

      {feed === null ? (
        <RadarUnavailable message={feedError ?? 'The opportunity feed could not be loaded.'} />
      ) : (
        <>
          <RadarStatStrip totals={totals.stats} unavailable={totals.unavailable} />
          <div className="radar-results-heading">
            <h2 id="radar-results-title">Ranked opportunities</h2>
            <Badge tone={activeFilterCount > 0 ? 'brand' : 'neutral'}>
              {activeFilterCount > 0
                ? `${activeFilterCount} active ${activeFilterCount === 1 ? 'filter' : 'filters'}`
                : 'Unfiltered view'}
            </Badge>
          </div>
          <RadarFeed
            basePath="/dashboard/radar"
            careerProfileId={feed.careerProfileId}
            evaluatedAt={feed.evaluatedAt}
            items={feed.items}
            now={new Date()}
            pagination={feed.pagination}
            query={query}
          />
        </>
      )}
    </div>
  );
}
