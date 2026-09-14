'use server';

import { createApplicationPackSchema } from '@hanaply/contracts';
import { revalidatePath } from 'next/cache';

import {
  applicationErrorState,
  applicationFailure,
  applicationSuccess,
  type ApplicationActionState,
} from '@/lib/application-action';
import { packStatusLabel } from '@/lib/application';
import { formEntry } from '@/lib/career-action';
import { assertTrustedMutationOrigin } from '@/lib/request-integrity';
import { createAuthenticatedApiClient, requireUser } from '@/lib/session';

/**
 * Requesting a pack changes the pack list, the usage figures on the dashboard,
 * and the opportunity it belongs to, so all of them are revalidated together.
 */
function revalidatePacks(jobId: string, packId: string): void {
  revalidatePath('/dashboard');
  revalidatePath('/dashboard/packs');
  revalidatePath(`/dashboard/packs/${packId}`);
  revalidatePath('/dashboard/radar');
  revalidatePath(`/dashboard/radar/${jobId}`);
}

/**
 * Requests an Application Pack for one opportunity and one career profile.
 *
 * The API is idempotent by pack identity: asking twice returns the pack that
 * already exists and does not consume quota a second time, so the two outcomes
 * are reported differently and neither message claims a new generation ran.
 * A plan-limit refusal arrives as a 403 whose message states the monthly
 * allowance, and that sentence is passed through unchanged — it is a decision,
 * not a crash.
 */
export async function createApplicationPackAction(
  previous: ApplicationActionState,
  formData: FormData,
): Promise<ApplicationActionState> {
  void previous;
  await assertTrustedMutationOrigin();

  const parsed = createApplicationPackSchema.safeParse({
    jobId: formEntry(formData, 'jobId') ?? '',
    careerProfileId: formEntry(formData, 'careerProfileId') ?? '',
  });
  if (!parsed.success) {
    return applicationFailure(
      'The opportunity or the career profile for this pack could not be identified. Reload the page and try again.',
    );
  }

  const { session } = await requireUser();
  try {
    const result = await createAuthenticatedApiClient(session).createApplicationPack(parsed.data);
    const pack = result.data.pack;
    revalidatePacks(parsed.data.jobId, pack.id);
    const cited = pack.evidenceFactIds.length;
    return applicationSuccess(
      result.data.created
        ? `Application Pack requested. It is stored with the status ${packStatusLabel(pack.status)}, and it cites ${cited} confirmed ${cited === 1 ? 'fact' : 'facts'} from your career profile.`
        : `An Application Pack already exists for this opportunity and career profile, so Hanaply opened that pack instead of using another of your monthly packs. Its status is ${packStatusLabel(pack.status)}.`,
      pack.id,
    );
  } catch (error) {
    return applicationErrorState(error, 'The Application Pack could not be requested.');
  }
}
