import type { JobRadar, JobRadarQuery } from '@hanaply/contracts';
import { EmptyState, LinkButton } from '@hanaply/ui';
import { Activity, Compass, Filter, Radar, Target } from 'lucide-react';
import Link from 'next/link';

import { OpportunityCard } from '@/components/radar/opportunity-card';
import {
  formatAbsoluteTimestamp,
  radarActiveFilters,
  radarHref,
  radarPaginationWindow,
  radarScope,
  type RadarActiveFilter,
  type RadarFeedScope,
} from '@/lib/radar';

export interface RadarFeedProps {
  items: JobRadar['items'];
  pagination: JobRadar['pagination'];
  query: JobRadarQuery;
  careerProfileId: string | null;
  basePath: string;
  /** The response's own `evaluatedAt`, so the page never invents a timestamp. */
  evaluatedAt: string;
  now: Date;
}

function Pagination({
  pagination,
  query,
  basePath,
}: {
  pagination: JobRadar['pagination'];
  query: JobRadarQuery;
  basePath: string;
}) {
  if (pagination.totalPages <= 1) return null;
  const links = radarPaginationWindow(pagination.page, pagination.totalPages);
  const href = (page: number) => radarHref(basePath, query, page);
  return (
    <nav aria-label="Opportunity results pages" className="radar-pagination">
      {pagination.page > 1 ? (
        <LinkButton href={href(pagination.page - 1)} size="sm" variant="secondary">
          Previous
        </LinkButton>
      ) : (
        <span className="radar-pagination-spacer" />
      )}
      <ol className="radar-pagination-pages">
        {links.map((link, index) =>
          link.page === null ? (
            <li aria-hidden="true" className="radar-pagination-gap" key={`gap-${index}`}>
              …
            </li>
          ) : link.current ? (
            <li key={link.page}>
              <span aria-current="page" className="radar-pagination-current">
                {link.label}
              </span>
            </li>
          ) : (
            <li key={link.page}>
              <Link href={href(link.page)}>{link.label}</Link>
            </li>
          ),
        )}
      </ol>
      {pagination.page < pagination.totalPages ? (
        <LinkButton href={href(pagination.page + 1)} size="sm" variant="secondary">
          Next
        </LinkButton>
      ) : (
        <span className="radar-pagination-spacer" />
      )}
    </nav>
  );
}

function NoResults({
  filters,
  basePath,
}: {
  filters: readonly RadarActiveFilter[];
  basePath: string;
}) {
  return (
    <EmptyState
      action={<LinkButton href={basePath}>Clear all filters</LinkButton>}
      description={
        <>
          <p>
            {filters.length} {filters.length === 1 ? 'filter is' : 'filters are'} narrowing this
            view, so the radar returned nothing:
          </p>
          <ul className="radar-empty-filters">
            {filters.map((filter) => (
              <li key={`${filter.label}:${filter.value}`}>
                <strong>{filter.label}</strong>
                <span>{filter.value}</span>
              </li>
            ))}
          </ul>
          <p>
            Opportunities that have not been analysed yet are excluded as soon as a minimum score is
            set, because there is no score to compare. Clearing the filters shows them again.
          </p>
        </>
      }
      eyebrow="No results"
      icon={<Filter aria-hidden="true" size={23} />}
      title="No opportunity matches these filters"
    />
  );
}

function RadarIsEmpty({ scope }: { scope: RadarFeedScope }) {
  if (scope.isSavedView) {
    return (
      <EmptyState
        action={<LinkButton href="/dashboard/radar">Open the radar</LinkButton>}
        description="Nothing has been saved yet. Open the radar and use Save opportunity on anything worth a closer look; saved opportunities appear here with the same match intelligence."
        eyebrow="Nothing saved yet"
        icon={<Compass aria-hidden="true" size={23} />}
        title="Your saved list is empty"
      />
    );
  }
  if (scope.isDismissedView) {
    return (
      <EmptyState
        action={<LinkButton href="/dashboard/radar">Back to the radar</LinkButton>}
        description="You have not given a negative signal to any opportunity, so there is nothing to review here. Dismissed opportunities are the ones you marked as not interested, wrong role, wrong seniority, wrong location, salary too low, already applied, or irrelevant."
        eyebrow="Nothing dismissed"
        icon={<Compass aria-hidden="true" size={23} />}
        title="You have not dismissed anything"
      />
    );
  }
  return (
    <EmptyState
      action={
        <div className="radar-empty-actions">
          <LinkButton href="/dashboard/career">
            <Target aria-hidden="true" size={18} /> Open your career profile
          </LinkButton>
          <LinkButton href="/dashboard/career/documents" variant="secondary">
            Add a resume
          </LinkButton>
        </div>
      }
      description="Opportunities arrive only from job sources Hanaply has approved and connected, so an empty radar means nothing has been ingested for your profile yet. Analysis happens after the radar scans your career profile: whenever a posting arrives, it is matched against the target roles, skills, seniority, location, and compensation recorded there. There is no sample data on this page and no opportunity is invented for you."
      eyebrow="No opportunities yet"
      icon={<Radar aria-hidden="true" size={23} />}
      title="Your radar has no opportunities yet"
    />
  );
}

/**
 * The ranked feed. Every count comes from the API response: the totals card
 * above the list is rendered by the page from its own aggregate queries, and
 * nothing here is estimated from the page of results.
 */
export function RadarFeed({
  items,
  pagination,
  query,
  careerProfileId,
  basePath,
  evaluatedAt,
  now,
}: RadarFeedProps) {
  const scope = radarScope(query, basePath);
  const filters = radarActiveFilters(query, { excludeStatus: true });
  const unanalysed = items.filter((item) => item.match === null).length;
  const evaluated = formatAbsoluteTimestamp(evaluatedAt);

  if (items.length === 0) {
    return filters.length > 0 ? (
      <NoResults basePath={basePath} filters={filters} />
    ) : (
      <RadarIsEmpty scope={scope} />
    );
  }

  return (
    <section aria-label="Opportunity results" className="radar-feed">
      <ul className="radar-card-list">
        {items.map((item) => (
          <li key={item.id}>
            <OpportunityCard careerProfileId={careerProfileId} item={item} now={now} />
          </li>
        ))}
      </ul>

      <Pagination basePath={basePath} pagination={pagination} query={query} />

      <p className="radar-feed-note">
        <Activity aria-hidden="true" size={16} />
        <span>
          {unanalysed} of the {items.length} opportunities on this page{' '}
          {unanalysed === 1 ? 'has' : 'have'} no analysis yet; {pagination.total} match the current
          filters in total.{evaluated === null ? '' : ` Evaluated ${evaluated}.`}
        </span>
      </p>
    </section>
  );
}
