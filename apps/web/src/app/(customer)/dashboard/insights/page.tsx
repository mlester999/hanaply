import type { CareerInsights, CoachSuggestion } from '@hanaply/contracts';
import { LinkButton, PageHeader } from '@hanaply/ui';
import { ArrowUpRight, Compass, Lightbulb, TrendingUp } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { createAuthenticatedApiClient, requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Insights' };

function insightsErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  return 'Hanaply could not load your insights.';
}

function formatRate(rate: number | null): string {
  // A rate with no denominator is unknown, not zero. Saying "0%" to someone who
  // has not applied anywhere yet would be a false statement.
  return rate === null ? 'Not enough data yet' : `${rate}%`;
}

function formatMoney(minor: number | null, currency: string | null): string {
  if (minor === null) return '—';
  const amount = minor / 100;
  const formatted = new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: currency ?? 'PHP',
    maximumFractionDigits: 0,
  }).format(amount);
  return formatted;
}

function PriorityBadge({ priority }: { priority: number }) {
  const label = priority <= 2 ? 'High impact' : priority <= 4 ? 'Worth doing' : 'Optional';
  return (
    <span className={`insight-priority insight-priority-${priority <= 2 ? 'high' : 'normal'}`}>
      {label}
    </span>
  );
}

function Suggestion({ suggestion }: { suggestion: CoachSuggestion }) {
  return (
    <li className="insight-suggestion">
      <div className="insight-suggestion-head">
        <Lightbulb aria-hidden="true" size={18} />
        <h3>{suggestion.title}</h3>
        <PriorityBadge priority={suggestion.priority} />
      </div>
      <p className="insight-suggestion-detail">{suggestion.detail}</p>
      <p className="insight-suggestion-action">
        <strong>Next step:</strong> {suggestion.action}
      </p>
      <details className="insight-evidence">
        <summary>Why Hanaply is suggesting this</summary>
        <dl>
          {Object.entries(suggestion.evidence).map(([key, value]) => (
            <div key={key}>
              <dt>
                {key
                  .replaceAll(/([A-Z])/gu, ' $1')
                  .replace(/^./u, (character) => character.toUpperCase())}
              </dt>
              <dd>{typeof value === 'string' ? value : JSON.stringify(value)}</dd>
            </div>
          ))}
        </dl>
      </details>
    </li>
  );
}

function StrengthList({ insights }: { insights: CareerInsights }) {
  const strength = insights.profileStrength;
  if (strength === null) return null;
  const missing = strength.fields.filter((field) => !field.present);
  const present = strength.fields.filter((field) => field.present);

  return (
    <section className="insight-panel" aria-labelledby="insight-strength-heading">
      <h2 id="insight-strength-heading">Profile strength</h2>
      <p className="insight-panel-note">
        Your profile is <strong>{strength.completenessPercent}%</strong> complete. Anything left
        blank is reported as unknown rather than guessed, which lowers confidence on every result.
      </p>
      <div
        className="insight-strength-bar"
        role="img"
        aria-label={`${strength.completenessPercent}% complete`}
      >
        <span style={{ width: `${strength.completenessPercent}%` }} />
      </div>
      {missing.length > 0 ? (
        <>
          <h3>Missing, and what it costs you</h3>
          <ul className="insight-field-list">
            {missing.map((field) => (
              <li key={field.field}>
                <strong>{field.label}</strong>
                <span>{field.impact}</span>
              </li>
            ))}
          </ul>
          <LinkButton href="/dashboard/career" variant="secondary">
            Improve your profile
          </LinkButton>
        </>
      ) : (
        <p className="insight-complete">
          Every field that changes match quality is filled in. Nothing is being scored as unknown.
        </p>
      )}
      {present.length > 0 ? (
        <details className="insight-evidence">
          <summary>{present.length} fields already complete</summary>
          <ul className="insight-field-list">
            {present.map((field) => (
              <li key={field.field}>
                <strong>{field.label}</strong>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

export default async function InsightsPage() {
  const { session } = await requireUser();

  let insights: CareerInsights | null = null;
  let unavailable: string | null = null;
  try {
    insights = (await createAuthenticatedApiClient(session).careerInsights()).data;
  } catch (error) {
    unavailable = insightsErrorMessage(error);
  }

  if (unavailable !== null) {
    return (
      <div className="workspace-page insight-page">
        <PageHeader title="Insights" description="Coaching and progress for your search." />
        <div className="insight-unavailable" role="alert">
          <h2>Insights are unavailable</h2>
          <p>{unavailable}</p>
          <p className="insight-panel-note">
            Nothing here is estimated. Hanaply shows a number only when it can compute it from your
            own profile, matches, and applications.
          </p>
        </div>
      </div>
    );
  }

  if (!insights?.hasProfile) {
    return (
      <div className="workspace-page insight-page">
        <PageHeader title="Insights" description="Coaching and progress for your search." />
        <div className="insight-empty">
          <Compass aria-hidden="true" size={28} />
          <h2>Create a Career Profile to unlock insights</h2>
          <p>
            Every number here is computed from your profile, the opportunities you were matched
            against, and your own applications. There is nothing to measure until a profile exists.
          </p>
          <LinkButton href="/dashboard/career">Open Career Profile</LinkButton>
        </div>
      </div>
    );
  }

  const { matching, pipeline, salary } = insights;

  return (
    <div className="workspace-page insight-page">
      <PageHeader
        title="Insights"
        description={`Coaching and progress for ${insights.profileName ?? 'your search'}, over the last ${
          insights.windowWeeks ?? 8
        } weeks.`}
        actions={
          <LinkButton href="/dashboard/applications" variant="secondary">
            Open tracker
          </LinkButton>
        }
      />

      {insights.coaching.length > 0 ? (
        <section className="insight-panel" aria-labelledby="insight-coaching-heading">
          <h2 id="insight-coaching-heading">What to do next</h2>
          <p className="insight-panel-note">
            Each suggestion shows the count that produced it. If a number looks wrong, the data
            behind it is wrong, and you can fix it.
          </p>
          <ul className="insight-suggestion-list">
            {insights.coaching.map((suggestion) => (
              <Suggestion key={suggestion.key} suggestion={suggestion} />
            ))}
          </ul>
        </section>
      ) : (
        <section className="insight-panel">
          <h2>What to do next</h2>
          <p className="insight-complete">
            Nothing needs attention right now. Keep the radar open and Hanaply will tell you when
            something changes.
          </p>
        </section>
      )}

      <StrengthList insights={insights} />

      <section className="insight-panel" aria-labelledby="insight-funnel-heading">
        <h2 id="insight-funnel-heading">Your pipeline</h2>
        <div className="insight-metrics">
          <div className="insight-metric">
            <span className="insight-metric-label">Saved</span>
            <strong>{pipeline?.saved ?? 0}</strong>
          </div>
          <div className="insight-metric">
            <span className="insight-metric-label">Applied</span>
            <strong>{pipeline?.applied ?? 0}</strong>
          </div>
          <div className="insight-metric">
            <span className="insight-metric-label">Interviewing</span>
            <strong>{pipeline?.interviewing ?? 0}</strong>
          </div>
          <div className="insight-metric">
            <span className="insight-metric-label">Offers</span>
            <strong>{pipeline?.offers ?? 0}</strong>
          </div>
          <div className="insight-metric">
            <span className="insight-metric-label">Rejected</span>
            <strong>{pipeline?.rejected ?? 0}</strong>
          </div>
        </div>
        <dl className="insight-rate-list">
          <div>
            <dt>Interview rate</dt>
            <dd>{formatRate(pipeline?.interviewRate ?? null)}</dd>
          </div>
          <div>
            <dt>Offer rate</dt>
            <dd>{formatRate(pipeline?.offerRate ?? null)}</dd>
          </div>
          <div>
            <dt>Rejection rate</dt>
            <dd>{formatRate(pipeline?.rejectionRate ?? null)}</dd>
          </div>
        </dl>
        <p className="insight-panel-note">
          A rate stays unmeasured until there is something to divide by. Hanaply would rather say it
          does not know than show you a zero that is not true.
        </p>
      </section>

      <section className="insight-panel" aria-labelledby="insight-matching-heading">
        <h2 id="insight-matching-heading">Matching</h2>
        <div className="insight-metrics">
          <div className="insight-metric">
            <span className="insight-metric-label">Opportunities analysed</span>
            <strong>{matching?.opportunitiesMatched ?? 0}</strong>
          </div>
          <div className="insight-metric">
            <span className="insight-metric-label">Strong matches</span>
            <strong>{matching?.strongMatches ?? 0}</strong>
          </div>
          <div className="insight-metric">
            <span className="insight-metric-label">Strong match rate</span>
            <strong>{formatRate(matching?.strongMatchRate ?? null)}</strong>
          </div>
        </div>
        {insights.directions.length > 0 ? (
          <>
            <h3>Where your matches are coming from</h3>
            <ul className="insight-direction-list">
              {insights.directions.map((direction) => (
                <li key={direction.title}>
                  <span>{direction.title}</span>
                  <span className="insight-direction-meta">
                    {direction.opportunityCount}{' '}
                    {direction.opportunityCount === 1 ? 'opportunity' : 'opportunities'}
                    {direction.averageScore === null
                      ? ''
                      : ` · average score ${direction.averageScore}`}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </section>

      {insights.gaps.length > 0 ? (
        <section className="insight-panel" aria-labelledby="insight-gaps-heading">
          <h2 id="insight-gaps-heading">Requirements that keep coming up</h2>
          <p className="insight-panel-note">
            These are requirements you do not meet across more than one opportunity. A requirement
            that repeats is worth either learning or deliberately targeting around.
          </p>
          <ul className="insight-gap-list">
            {insights.gaps.map((gap) => (
              <li key={gap.skill}>
                <span>{gap.skill}</span>
                <span className="insight-direction-meta">
                  blocks {gap.opportunityCount}{' '}
                  {gap.opportunityCount === 1 ? 'opportunity' : 'opportunities'}
                </span>
              </li>
            ))}
          </ul>
          <Link className="insight-link" href="/dashboard/radar">
            See the opportunities <ArrowUpRight aria-hidden="true" size={15} />
          </Link>
        </section>
      ) : null}

      {salary !== null && salary.observedSampleSize > 0 ? (
        <section className="insight-panel" aria-labelledby="insight-salary-heading">
          <h2 id="insight-salary-heading">Salary in your matches</h2>
          <dl className="insight-rate-list">
            <div>
              <dt>Observed range</dt>
              <dd>
                {formatMoney(salary.observedMinMinor, salary.observedCurrency)} –{' '}
                {formatMoney(salary.observedMaxMinor, salary.observedCurrency)}
              </dd>
            </div>
            <div>
              <dt>Postings with a stated salary</dt>
              <dd>{salary.observedSampleSize}</dd>
            </div>
            {salary.expectationMinMinor !== null ? (
              <div>
                <dt>Your minimum</dt>
                <dd>{formatMoney(salary.expectationMinMinor, salary.expectationCurrency)}</dd>
              </div>
            ) : null}
            {salary.belowExpectationCount !== null ? (
              <div>
                <dt>Below your minimum</dt>
                <dd>{salary.belowExpectationCount}</dd>
              </div>
            ) : null}
          </dl>
          {salary.belowExpectationCount === null ? (
            <p className="insight-panel-note">
              Add a salary expectation to your profile and Hanaply will flag postings that fall
              below it.
            </p>
          ) : null}
        </section>
      ) : null}

      {insights.activity.length > 0 ? (
        <section className="insight-panel" aria-labelledby="insight-activity-heading">
          <h2 id="insight-activity-heading">Activity by week</h2>
          <table className="insight-activity-table">
            <caption className="visually-hidden">
              Opportunities analysed and applications started each week
            </caption>
            <thead>
              <tr>
                <th scope="col">Week starting</th>
                <th scope="col">Analysed</th>
                <th scope="col">Started</th>
              </tr>
            </thead>
            <tbody>
              {insights.activity.map((week) => (
                <tr key={week.weekStart}>
                  <th scope="row">{week.weekStart}</th>
                  <td>{week.opportunitiesMatched}</td>
                  <td>{week.applicationsStarted}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <section className="insight-panel">
        <h2>How these numbers are produced</h2>
        <p className="insight-panel-note">
          <TrendingUp aria-hidden="true" size={16} /> Every figure here is arithmetic over your own
          profile, matches, and applications. Nothing is generated, estimated, or modelled, and no
          claim about your experience appears anywhere unless you confirmed it.
        </p>
      </section>
    </div>
  );
}
