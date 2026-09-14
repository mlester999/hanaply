import type { UsageSummary } from '@hanaply/contracts';
import { Badge, Card } from '@hanaply/ui';
import { Gauge, Info } from 'lucide-react';

import { usagePeriodLabel, usageProgress, type UsageProgress } from '@/lib/application';

/** The contract exports the summary type; a single row is one of its items. */
type UsageItem = UsageSummary['items'][number];

/**
 * One metered feature. A feature the plan does not include says so instead of
 * rendering an empty bar, and an exhausted allowance says so in words — the
 * figures themselves always come from the API response.
 */
function UsageRow({ progress }: { progress: UsageProgress }) {
  if (!progress.included) {
    return (
      <li className="application-usage-item application-usage-item--excluded">
        <div className="application-usage-item-heading">
          <strong>{progress.label}</strong>
          <Badge tone="neutral">Not in your plan</Badge>
        </div>
        <p className="application-usage-note">
          Your current plan does not include {progress.label.toLowerCase()}, so no monthly allowance
          is counted for it. Nothing is drawn as an empty bar, because there is no allowance to
          measure against.
        </p>
      </li>
    );
  }

  return (
    <li className="application-usage-item">
      <div className="application-usage-item-heading">
        <strong>{progress.label}</strong>
        <span className="application-usage-counts">
          {progress.used} of {progress.limit} used · {progress.remaining} left
        </span>
      </div>
      <div
        aria-label={`${progress.label} used this period`}
        aria-valuemax={progress.limit}
        aria-valuemin={0}
        aria-valuenow={progress.used}
        aria-valuetext={`${progress.used} of ${progress.limit} used, ${progress.remaining} remaining`}
        className={`application-usage-track${progress.exhausted ? ' is-exhausted' : ''}`}
        role="progressbar"
      >
        <span className="application-usage-fill" style={{ width: `${progress.percent}%` }} />
      </div>
      {progress.exhausted ? (
        <p className="application-usage-exhausted">
          <Info aria-hidden="true" size={15} /> You have used your allowance this month. Nothing
          further is drawn from it until the next period begins; the counter resets then, and your
          existing packs stay exactly as they are.
        </p>
      ) : null}
    </li>
  );
}

export interface PackUsagePanelProps {
  usage: UsageSummary;
}

/** The usage panel that heads the pack list. */
export function PackUsagePanel({ usage }: PackUsagePanelProps) {
  return (
    <Card className="application-usage">
      <div className="application-section-heading">
        <Gauge aria-hidden="true" size={20} />
        <div>
          <h2 id="application-usage-title">Your allowance this period</h2>
          <p>
            Billing period {usagePeriodLabel(usage.periodStart, usage.periodEnd)}. Every figure here
            is the plan limit the API reports for this period — nothing is estimated.
          </p>
        </div>
      </div>
      <ul aria-labelledby="application-usage-title" className="application-usage-list">
        {usage.items.map((item: UsageItem) => (
          <UsageRow key={item.feature} progress={usageProgress(item)} />
        ))}
      </ul>
    </Card>
  );
}

export interface ApplicationUsageCardProps {
  item: UsageItem;
  periodStart: string;
  periodEnd: string;
}

/**
 * The compact dashboard summary. It is only rendered when the usage response was
 * actually read: an unreachable API omits the card rather than drawing a zero.
 */
export function ApplicationUsageCard({ item, periodStart, periodEnd }: ApplicationUsageCardProps) {
  const progress = usageProgress(item);
  return (
    <Card className="application-usage-card dashboard-usage-card">
      <div className="dashboard-card-heading">
        <Gauge aria-hidden="true" size={22} />
        <div>
          <span className="h-eyebrow">Application Packs</span>
          <h2>Usage this period</h2>
        </div>
      </div>
      {progress.included ? (
        <>
          <p className="application-usage-counts application-usage-counts--lead">
            {progress.used} of {progress.limit} used · {progress.remaining} left
          </p>
          <div
            aria-label="Application Packs used this period"
            aria-valuemax={progress.limit}
            aria-valuemin={0}
            aria-valuenow={progress.used}
            aria-valuetext={`${progress.used} of ${progress.limit} used, ${progress.remaining} remaining`}
            className={`application-usage-track${progress.exhausted ? ' is-exhausted' : ''}`}
            role="progressbar"
          >
            <span className="application-usage-fill" style={{ width: `${progress.percent}%` }} />
          </div>
          {progress.exhausted ? (
            <p className="application-usage-exhausted">
              You have used your allowance this month. The counter resets with the next billing
              period.
            </p>
          ) : null}
        </>
      ) : (
        <p className="application-usage-note">
          Your current plan does not include Application Packs, so no monthly allowance is counted.
        </p>
      )}
      <p className="career-hint">
        Billing period {usagePeriodLabel(periodStart, periodEnd)}. A pack is counted once when it is
        created; opening an existing pack again does not use another one.
      </p>
    </Card>
  );
}
