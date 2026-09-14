import { missingItemImpact, missingItemLabel } from '@/lib/career';

export function CareerCompletenessMeter({ percent, label }: { percent: number; label?: string }) {
  return (
    <div className="career-meter">
      <div
        aria-label={label ?? 'Profile completeness'}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={percent}
        aria-valuetext={`${percent}% complete`}
        className="career-meter-track"
        role="progressbar"
      >
        <span style={{ width: `${percent}%` }} />
      </div>
      <span className="career-meter-value">{percent}%</span>
    </div>
  );
}

/**
 * Completeness answers come from the database completeness function. Each one
 * is worth ten points, so the list states the real cost of leaving it empty.
 */
export function CareerMissingList({ missing }: { missing: readonly string[] }) {
  if (missing.length === 0) {
    return <p className="career-hint">Every completeness item on this profile is satisfied.</p>;
  }
  return (
    <ul className="career-missing-list">
      {missing.map((key) => (
        <li key={key}>
          <strong>{missingItemLabel(key)}</strong>
          <span>{missingItemImpact(key)}</span>
        </li>
      ))}
    </ul>
  );
}
