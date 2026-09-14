'use server';

import {
  applicationParamsSchema,
  applicationStageSchema,
  setApplicationStageSchema,
  trackApplicationSchema,
} from '@hanaply/contracts';
import { revalidatePath } from 'next/cache';

import { applicationStageLabel } from '@/lib/application';
import {
  applicationErrorState,
  applicationFailure,
  applicationSuccess,
  type ApplicationActionState,
} from '@/lib/application-action';
import {
  careerLeafFieldErrors,
  formEntry,
  formInteger,
  formOptionalText,
} from '@/lib/career-action';
import { assertTrustedMutationOrigin } from '@/lib/request-integrity';
import { createAuthenticatedApiClient, requireUser } from '@/lib/session';

/**
 * A tracker mutation can change the board, one timeline, and the dashboard
 * summary, so all of them are revalidated together.
 */
function revalidateApplications(applicationId: string | null): void {
  revalidatePath('/dashboard');
  revalidatePath('/dashboard/applications');
  if (applicationId !== null) revalidatePath(`/dashboard/applications/${applicationId}`);
}

function applicationIdFrom(formData: FormData): string | null {
  const parsed = applicationParamsSchema.safeParse({
    applicationId: formEntry(formData, 'applicationId') ?? '',
  });
  return parsed.success ? parsed.data.applicationId : null;
}

/**
 * A `datetime-local` control submits a wall-clock value with no zone. The client
 * converts it to an instant before submitting, so anything that arrives here
 * without a zone is a value Hanaply refuses rather than one it silently assumes
 * a timezone for.
 *
 * `null` is not "clear it": the tracking RPC coalesces every absent text field
 * onto the row it already holds, so an omitted date or note keeps the stored
 * value. The card says exactly that beside the controls rather than implying a
 * removal this endpoint cannot perform.
 */
function nextActionAtFrom(formData: FormData): { value: string | null } | { error: string } {
  const raw = formOptionalText(formData, 'nextActionAt');
  if (raw === null) return { value: null };
  const instant = new Date(raw);
  if (Number.isNaN(instant.getTime())) {
    return { error: 'That next action date could not be read. Enter a date and time.' };
  }
  return { value: instant.toISOString() };
}

/**
 * Starts tracking an opportunity, or updates the notes and scheduled next action
 * of one already tracked. Both are the same API call: the tracker keeps one row
 * per opportunity, and the stage is only sent when the caller chose one.
 */
export async function trackApplicationAction(
  previous: ApplicationActionState,
  formData: FormData,
): Promise<ApplicationActionState> {
  void previous;
  await assertTrustedMutationOrigin();

  const jobId = formEntry(formData, 'jobId') ?? '';
  const rawStage = formOptionalText(formData, 'stage');
  const stage = rawStage === null ? null : applicationStageSchema.safeParse(rawStage);
  if (stage !== null && !stage.success) {
    return applicationFailure('Choose one of the listed pipeline stages.');
  }

  const nextActionAt = nextActionAtFrom(formData);
  if ('error' in nextActionAt) {
    return applicationFailure(nextActionAt.error, {
      nextActionAt: ['Enter a valid date and time.'],
    });
  }

  const candidate: Record<string, unknown> = {
    jobId,
    careerProfileId: formOptionalText(formData, 'careerProfileId'),
    notes: formOptionalText(formData, 'notes'),
    nextActionNote: formOptionalText(formData, 'nextActionNote'),
    nextActionAt: nextActionAt.value,
  };
  if (stage !== null) candidate.stage = stage.data;

  const parsed = trackApplicationSchema.safeParse(candidate);
  if (!parsed.success) {
    return applicationFailure(
      'Review the tracking details before saving them.',
      careerLeafFieldErrors(parsed.error.issues),
    );
  }

  const applicationId = applicationIdFrom(formData);
  const { session } = await requireUser();
  try {
    const result = await createAuthenticatedApiClient(session).trackApplication(parsed.data);
    revalidateApplications(applicationId ?? result.data.id);
    return applicationSuccess(
      applicationId === null
        ? `Added to your tracker as ${applicationStageLabel(result.data.stage)}. Every stage change from here is recorded in its timeline.`
        : 'Notes and next action saved.',
    );
  } catch (error) {
    return applicationErrorState(error, 'The application could not be updated.');
  }
}

/**
 * Moves one tracked application to another stage under optimistic concurrency.
 * `expectedVersion` is the version the member was looking at; a write built on a
 * version that has since moved on is refused with a conflict instead of
 * overwriting the newer stage.
 */
export async function setApplicationStageAction(
  previous: ApplicationActionState,
  formData: FormData,
): Promise<ApplicationActionState> {
  void previous;
  await assertTrustedMutationOrigin();

  const applicationId = applicationIdFrom(formData);
  const expectedVersion = formInteger(formData, 'expectedVersion');
  const stage = applicationStageSchema.safeParse(formEntry(formData, 'stage') ?? '');
  if (applicationId === null || expectedVersion === null || expectedVersion < 0 || !stage.success) {
    return applicationFailure(
      'That stage change could not be read. Reload the page and try again.',
    );
  }

  const parsed = setApplicationStageSchema.safeParse({
    stage: stage.data,
    expectedVersion,
    note: formOptionalText(formData, 'note'),
  });
  if (!parsed.success) {
    const noteIssue = parsed.error.issues.some((issue) => issue.path[0] === 'note');
    return applicationFailure(
      noteIssue
        ? 'Keep the stage note under 1000 characters.'
        : 'That stage change is not valid. Reload the page and try again.',
    );
  }

  const { session } = await requireUser();
  try {
    const result = await createAuthenticatedApiClient(session).setApplicationStage(
      applicationId,
      parsed.data,
    );
    revalidateApplications(applicationId);
    return applicationSuccess(`Moved to ${applicationStageLabel(result.data.stage)}.`);
  } catch (error) {
    return applicationErrorState(error, 'The stage could not be changed.');
  }
}
