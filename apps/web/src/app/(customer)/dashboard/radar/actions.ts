'use server';

import { jobFeedbackSchema, jobParamsSchema } from '@hanaply/contracts';
import { revalidatePath } from 'next/cache';

import { formEntry, formOptionalText, formText } from '@/lib/career-action';
import { assertTrustedMutationOrigin } from '@/lib/request-integrity';
import {
  radarErrorState,
  radarFailure,
  radarSuccess,
  type RadarActionState,
} from '@/lib/radar-action';
import { isUuid, jobFeedbackLabel } from '@/lib/radar';
import { createAuthenticatedApiClient, requireUser } from '@/lib/session';

/**
 * Every radar mutation can change the feed, the saved list, and one detail
 * page, so all three are revalidated together.
 */
function revalidateRadar(jobId: string): void {
  revalidatePath('/dashboard');
  revalidatePath('/dashboard/radar');
  revalidatePath('/dashboard/radar/saved');
  revalidatePath(`/dashboard/radar/${jobId}`);
}

function jobIdFrom(formData: FormData): string | null {
  const parsed = jobParamsSchema.safeParse({ jobId: formEntry(formData, 'jobId') ?? '' });
  return parsed.success ? parsed.data.jobId : null;
}

/** An optional career profile selection, validated against the contract. */
function careerProfileIdFrom(formData: FormData): string | null {
  const value = formOptionalText(formData, 'careerProfileId');
  if (!value) return null;
  return isUuid(value) ? value : null;
}

export async function saveJobAction(
  previous: RadarActionState,
  formData: FormData,
): Promise<RadarActionState> {
  void previous;
  await assertTrustedMutationOrigin();
  const jobId = jobIdFrom(formData);
  if (!jobId) {
    return radarFailure('That opportunity could not be identified. Reload the page and try again.');
  }

  const { session } = await requireUser();
  try {
    await createAuthenticatedApiClient(session).saveJob(jobId, {
      careerProfileId: careerProfileIdFrom(formData),
      note: formOptionalText(formData, 'note'),
    });
  } catch (error) {
    return radarErrorState(error, 'The opportunity could not be saved.');
  }

  revalidateRadar(jobId);
  return radarSuccess('Saved. It now appears under Saved opportunities.');
}

export async function unsaveJobAction(
  previous: RadarActionState,
  formData: FormData,
): Promise<RadarActionState> {
  void previous;
  await assertTrustedMutationOrigin();
  const jobId = jobIdFrom(formData);
  if (!jobId) {
    return radarFailure('That opportunity could not be identified. Reload the page and try again.');
  }

  const { session } = await requireUser();
  try {
    const result = await createAuthenticatedApiClient(session).unsaveJob(jobId);
    revalidateRadar(jobId);
    return radarSuccess(
      result.data.removed
        ? 'Removed from your saved opportunities.'
        : 'This opportunity was not in your saved list.',
    );
  } catch (error) {
    return radarErrorState(error, 'The saved opportunity could not be removed.');
  }
}

/**
 * Ranking feedback. The kind is validated against the contract enum, and the
 * reason is trimmed to the contract's limit so a pasted paragraph is refused
 * with a plain-language message rather than a generic failure.
 */
export async function recordJobFeedbackAction(
  previous: RadarActionState,
  formData: FormData,
): Promise<RadarActionState> {
  void previous;
  await assertTrustedMutationOrigin();
  const jobId = jobIdFrom(formData);
  if (!jobId) {
    return radarFailure('That opportunity could not be identified. Reload the page and try again.');
  }

  const reason = formOptionalText(formData, 'reason');
  const parsed = jobFeedbackSchema.safeParse({
    feedback: formText(formData, 'feedback'),
    reason,
    careerProfileId: careerProfileIdFrom(formData),
  });
  if (!parsed.success) {
    const feedbackError = parsed.error.issues.some((issue) => issue.path[0] === 'feedback');
    if (reason && reason.length > 500) {
      return radarFailure('Keep the reason under 500 characters.', {
        reason: ['Shorten this to 500 characters or fewer.'],
      });
    }
    return radarFailure(
      feedbackError
        ? 'Choose one of the listed feedback options.'
        : 'Review the feedback before recording it.',
    );
  }

  const { session } = await requireUser();
  try {
    await createAuthenticatedApiClient(session).recordJobFeedback(jobId, parsed.data);
  } catch (error) {
    return radarErrorState(error, 'Your feedback could not be recorded.');
  }

  revalidateRadar(jobId);
  return radarSuccess(`Recorded: ${jobFeedbackLabel(parsed.data.feedback)}.`);
}
