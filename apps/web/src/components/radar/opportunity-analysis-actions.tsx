'use client';

import { Button } from '@hanaply/ui';
import { Play, RefreshCw } from 'lucide-react';

import {
  refreshOpportunityAnalysisAction,
  runOpportunityAnalysisAction,
} from '@/app/(customer)/dashboard/radar/analysis-actions';
import { RadarFeedback } from '@/components/radar/radar-feedback';
import { useRadarAction } from '@/components/radar/use-radar-action';

export interface OpportunityAnalysisActionsProps {
  jobId: string;
  careerProfileId: string | null;
  /** True when a model-written report is currently stored for this evidence. */
  hasGeneratedAnalysis: boolean;
}

/**
 * The two ways to ask for an analysis.
 *
 * They are separate actions rather than one button with a hidden flag: the first
 * run reuses a stored report for the same evidence, and the forced refresh
 * deliberately skips that cache. Both are metered, so the panel says which one
 * it is about to do instead of leaving the member to guess.
 */
export function OpportunityAnalysisActions({
  jobId,
  careerProfileId,
  hasGeneratedAnalysis,
}: OpportunityAnalysisActionsProps) {
  const run = useRadarAction(runOpportunityAnalysisAction);
  const refresh = useRadarAction(refreshOpportunityAnalysisAction);
  const profileField =
    careerProfileId === null ? null : (
      <input name="careerProfileId" type="hidden" value={careerProfileId} />
    );

  if (!hasGeneratedAnalysis) {
    return (
      <div className="ai-analysis-actions">
        <form onSubmit={run.onSubmit}>
          <input name="jobId" type="hidden" value={jobId} />
          {profileField}
          <div className="application-card-actions">
            <Button
              leadingIcon={<Play aria-hidden="true" size={16} />}
              loading={run.pending}
              type="submit"
            >
              Run the analysis
            </Button>
          </div>
        </form>
        <RadarFeedback
          errorTitle="Analysis not generated"
          state={run.state}
          successTitle="Analysis ready"
        />
      </div>
    );
  }

  return (
    <div className="ai-analysis-actions">
      <form onSubmit={refresh.onSubmit}>
        <input name="jobId" type="hidden" value={jobId} />
        {profileField}
        <div className="application-card-actions">
          <Button
            leadingIcon={<RefreshCw aria-hidden="true" size={16} />}
            loading={refresh.pending}
            type="submit"
            variant="secondary"
          >
            Refresh the analysis
          </Button>
        </div>
      </form>
      <RadarFeedback
        errorTitle="Analysis not refreshed"
        state={refresh.state}
        successTitle="Analysis refreshed"
      />
    </div>
  );
}
