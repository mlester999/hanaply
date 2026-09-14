import type { ApplicationPackListItem } from '@hanaply/contracts';
import { Badge, Card, EmptyState, LinkButton } from '@hanaply/ui';
import { FileStack, PackageOpen, Radar, TriangleAlert } from 'lucide-react';
import Link from 'next/link';

import {
  packFailureExplanation,
  packStatusExplanation,
  packStatusLabel,
  packStatusTone,
} from '@/lib/application';
import { formatAbsoluteTimestamp, relativeFromIso } from '@/lib/radar';

export interface PackListProps {
  items: readonly ApplicationPackListItem[];
  now: Date;
}

function PackCard({ item, now }: { item: ApplicationPackListItem; now: Date }) {
  const created = formatAbsoluteTimestamp(item.createdAt);
  const freshness = relativeFromIso(item.createdAt, now, 'Created');
  const cited = item.evidenceFactIds.length;

  return (
    <Card className="application-pack-card">
      <div className="application-pack-heading">
        <div className="application-pack-title">
          <h3>
            <Link href={`/dashboard/packs/${item.id}`}>{item.jobTitle}</Link>
          </h3>
          <p className="application-pack-company">{item.companyName}</p>
        </div>
        <div className="application-pack-badges">
          <Badge tone={packStatusTone(item.status)}>{packStatusLabel(item.status)}</Badge>
          <Badge tone="neutral">
            {item.artifactCount === 1 ? '1 artifact' : `${item.artifactCount} artifacts`}
          </Badge>
        </div>
      </div>

      <dl className="application-pack-meta">
        <div>
          <dt>Created</dt>
          <dd>
            <span title={freshness?.title ?? undefined}>
              {created ?? 'The API did not report a creation time'}
            </span>
            {freshness === null ? null : <small>{freshness.label}</small>}
          </dd>
        </div>
        <div>
          <dt>Confirmed facts cited</dt>
          <dd>
            {cited}
            <small>
              {cited === 1
                ? 'One of your confirmed career facts supports this pack.'
                : 'Your own confirmed career facts support this pack.'}
            </small>
          </dd>
        </div>
        <div>
          <dt>Generation</dt>
          <dd>
            {item.generatedAt === null
              ? 'Not finished yet'
              : (formatAbsoluteTimestamp(item.generatedAt) ?? 'Recorded, but unreadable')}
            <small>{packStatusExplanation(item.status)}</small>
          </dd>
        </div>
      </dl>

      {item.status === 'failed' ? (
        <div className="application-pack-failure">
          <TriangleAlert aria-hidden="true" size={18} />
          <div>
            <p>{packFailureExplanation(item.errorCode)}</p>
            <p className="application-pack-code">
              Failure code: {item.errorCode ?? 'none recorded'}
            </p>
          </div>
        </div>
      ) : null}

      <div className="application-card-actions">
        <LinkButton href={`/dashboard/packs/${item.id}`} variant="secondary">
          Open this pack
        </LinkButton>
        <LinkButton href={`/dashboard/radar/${item.jobId}`} variant="quiet">
          View the opportunity
        </LinkButton>
      </div>
    </Card>
  );
}

/**
 * The pack list, in the order the API returns: newest first. Nothing is
 * re-sorted here and no pack is invented to fill the page.
 */
export function PackList({ items, now }: PackListProps) {
  if (items.length === 0) {
    return (
      <EmptyState
        action={
          <div className="application-empty-actions">
            <LinkButton href="/dashboard/radar">
              <Radar aria-hidden="true" size={18} /> Open the job radar
            </LinkButton>
          </div>
        }
        description={
          <>
            <p>
              An Application Pack is created from an opportunity, never from this page: open the
              opportunity on the radar and use Create Application Pack. Hanaply then assembles a
              resume, cover letter, and the other artifacts it can support from the career facts you
              have confirmed, and every artifact records which facts it used.
            </p>
            <p>
              This page lists only the packs the API reports for your account, newest first. An
              archived pack is left out of the list.
            </p>
          </>
        }
        eyebrow="No packs yet"
        icon={<PackageOpen aria-hidden="true" size={23} />}
        title="You have no Application Packs"
      />
    );
  }

  return (
    <section aria-label="Your Application Packs" className="application-pack-section">
      <div className="application-section-heading">
        <FileStack aria-hidden="true" size={20} />
        <div>
          <h2>Newest first</h2>
          <p>{items.length === 1 ? 'One pack is stored.' : `${items.length} packs are stored.`}</p>
        </div>
      </div>
      <ul className="application-pack-list">
        {items.map((item) => (
          <li key={item.id}>
            <PackCard item={item} now={now} />
          </li>
        ))}
      </ul>
    </section>
  );
}
