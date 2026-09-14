'use server';

import {
  opportunityAnalysisRequestSchema,
  type OpportunityAnalysisResponse,
} from '@hanaply/contracts';
import { revalidatePath } from 'next/cache';

import { providerLabel, summariseGrounding, unavailableReason } from '@/lib/ai';
import { formEntry } from '@/lib/career-action';
import { isUuid } from '@/lib/radar';
import {
  radarErrorState,
  radarFailure,
  radarSuccess,
  type RadarActionState,
} from '@/lib/radar-action';
import { assertTrustedMutationOrigin } from '@/lib/request-integrity';
import { createAuthenticatedApiClient, requireUser } from '@/lib/session';

/**
 * What the member is told after an analysis request.
 *
 * The sentence follows the response, not the request. A report that was written
 * names the model and reports what the truth gate did with its claims; a
 * response with no report repeats the API's own reason and says that the
 * deterministic analysis above is what still applies. Neither case is allowed to
 * read as though something was produced when nothing was.
 */
function describeAnalysis(response: OpportunityAnalysisResponse): string {
  if (response.analysis === null) {
    const reason = unavailableReason(response.provenance);
    const refusal = response.refusal === null ? '' : ` ${response.refusal}`;
    return `${reason}${refusal} Nothing was stored for this opportunity, and the deterministic analysis on this page is unchanged and still applies in full.`;
  }
  if (!response.provenance.generated) {
    return 'The API returned a report whose provenance does not say a model wrote it, so it is not presented as AI output here. The deterministic analysis on this page still applies in full.';
  }
  const model = response.provenance.model ?? providerLabel(response.provenance.provider);
  const grounding = summariseGrounding(response.grounding);
  const lead = response.cached
    ? `Stored analysis returned for ${model}`
    : `Analysis written by ${model} under the truth gate`;
  return `${lead}. ${grounding.sentence} Score and confidence are unchanged: they come from Hanaply’s matching engine, not from the model.`;
}

/**
 * One analysis request, shared by the first run and the refresh.
 *
 * `refresh` is what the difference between the two actions comes down to, so it
 * is passed explicitly rather than read from the form: a client cannot ask for a
 * forced regeneration by editing a hidden field.
 */
async function requestAnalysis(formData: FormData, refresh: boolean): Promise<RadarActionState> {
  const jobId = formEntry(formData, 'jobId') ?? '';
  if (!isUuid(jobId)) {
    return radarFailure('That opportunity could not be identified. Reload the page and try again.');
  }

  const careerProfileId = formEntry(formData, 'careerProfileId');
  const parsed = opportunityAnalysisRequestSchema.safeParse({
    ...(careerProfileId !== null && isUuid(careerProfileId) ? { careerProfileId } : {}),
    ...(refresh ? { refresh: true } : {}),
  });
  if (!parsed.success) {
    return radarFailure('The analysis request was rejected before it was sent. Reload the page.');
  }

  const { session } = await requireUser();
  try {
    const result = await createAuthenticatedApiClient(session).opportunityAnalysis(
      jobId,
      parsed.data,
    );
    revalidatePath(`/dashboard/radar/${jobId}`);
    return radarSuccess(describeAnalysis(result.data));
  } catch (error) {
    return radarErrorState(error, 'The analysis could not be requested.');
  }
}

/**
 * Runs the analysis for the first time.
 *
 * This is a generation request, not a read: the API consults its cache by
 * evidence fingerprint first, so pressing it twice on unchanged evidence returns
 * the stored report rather than generating again or spending another unit.
 */
export async function runOpportunityAnalysisAction(
  previous: RadarActionState,
  formData: FormData,
): Promise<RadarActionState> {
  void previous;
  await assertTrustedMutationOrigin();
  return requestAnalysis(formData, false);
}

/**
 * Re-runs the analysis even when a stored one exists for this evidence.
 *
 * A forced refresh deliberately skips the cache, which is why it is a separate
 * action with its own button: it is the member saying the stored reasoning is
 * stale, and it is the only path that spends a unit on unchanged evidence.
 */
export async function refreshOpportunityAnalysisAction(
  previous: RadarActionState,
  formData: FormData,
): Promise<RadarActionState> {
  void previous;
  await assertTrustedMutationOrigin();
  return requestAnalysis(formData, true);
}
