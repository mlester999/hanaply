'use server';

import {
  createApplicationPackSchema,
  type GenerateApplicationPackAiRequest,
} from '@hanaply/contracts';
import { revalidatePath } from 'next/cache';

import {
  applicationErrorState,
  applicationFailure,
  applicationSuccess,
  type ApplicationActionState,
} from '@/lib/application-action';
import { summarisePackGeneration } from '@/lib/ai';
import { packStatusLabel } from '@/lib/application';
import { formEntry } from '@/lib/career-action';
import { assertTrustedMutationOrigin } from '@/lib/request-integrity';
import { createAuthenticatedApiClient, requireUser } from '@/lib/session';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

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

/**
 * Generates the pack artifacts from the facts the subscriber has confirmed.
 *
 * Two paths can write these artifacts and they are not interchangeable, so the
 * response — not the request — decides what the member is told. The
 * deterministic generator composes each artifact from confirmed career facts
 * through a fixed template; the AI path is a model writing prose that the truth
 * gate checks before anything is stored. The message names the path that ran,
 * reports the provenance the API returned, and lists any kind the model was
 * asked for and did not produce, so no artifact is ever reported that was not
 * written and no model text is ever described as deterministic.
 */
export async function generateApplicationPackAction(
  previous: ApplicationActionState,
  formData: FormData,
): Promise<ApplicationActionState> {
  void previous;
  await assertTrustedMutationOrigin();

  const packId = formEntry(formData, 'packId');
  const jobId = formEntry(formData, 'jobId');
  if (!packId || !uuidPattern.test(packId)) {
    return applicationFailure('This pack could not be identified. Reload the page and try again.');
  }

  // `auto` asks the API to prefer the AI path when a provider is configured and
  // to fall back to the deterministic generator otherwise. Anything else —
  // including a missing field, which is what a member with no AI configured
  // sends — means the deterministic path, and the response still states which
  // one ran.
  const requested = formEntry(formData, 'generator');
  const body: GenerateApplicationPackAiRequest = requested === 'auto' ? { generator: 'auto' } : {};

  const { session } = await requireUser();
  try {
    const result = await createAuthenticatedApiClient(session).generateApplicationPack(
      packId,
      body,
    );
    revalidatePacks(jobId ?? result.data.jobId, packId);

    const attribution = summarisePackGeneration(result.data.ai);
    const count = result.data.artifacts.length;
    if (count === 0) {
      return applicationFailure(
        `No artifact could be written, so nothing was stored. ${attribution.headline} ran and returned none. Confirm at least one career fact on your profile, then generate again.`,
      );
    }

    const cited = result.data.evidenceFactIds.length;
    const skipped =
      attribution.skipped.length === 0
        ? ''
        : ` ${attribution.skipped.length} requested ${attribution.skipped.length === 1 ? 'kind' : 'kinds'} did not come from the model: ${attribution.skipped.join(' ')}`;

    return applicationSuccess(
      `${attribution.headline}. Wrote ${count} ${count === 1 ? 'artifact' : 'artifacts'} from ${cited} confirmed ${cited === 1 ? 'fact' : 'facts'}. ${attribution.detail}${skipped}`,
      packId,
      result.data.ai,
    );
  } catch (error) {
    return applicationErrorState(error, 'The pack artifacts could not be generated.');
  }
}
