'use server';

import {
  careerProfileInputSchema,
  onboardingStatusRequestSchema,
  type HanaplyApiClient,
} from '@hanaply/contracts';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { setActiveCareerProfileCookie } from '@/lib/career-cookie';
import {
  careerErrorState,
  careerFailure,
  careerLeafFieldErrors,
  careerSuccess,
  formBoolean,
  formList,
  formNumber,
  formOptionalText,
  formText,
  type CareerActionState,
} from '@/lib/career-action';
import { assertTrustedMutationOrigin } from '@/lib/request-integrity';
import { createAuthenticatedApiClient, requireUser } from '@/lib/session';

type CareerProfileCreateBody = Parameters<HanaplyApiClient['createCareerProfile']>[0];
type CareerProfileUpdateBody = Parameters<HanaplyApiClient['updateCareerProfile']>[1];

function revalidateOnboarding(): void {
  revalidatePath('/dashboard');
  revalidatePath('/dashboard/career');
  revalidatePath('/dashboard/onboarding');
}

/**
 * Onboarding always writes through the active profile. The directory read in
 * the same request supplies the current version, so an onboarding step can
 * never overwrite a change made in another tab.
 */
async function persistProfileFields(
  client: HanaplyApiClient,
  profileId: string | null,
  create: CareerProfileCreateBody,
): Promise<{ profileId: string; created: boolean }> {
  const directory = await client.careerProfiles();
  const target = profileId
    ? directory.data.items.find((item) => item.id === profileId)
    : (directory.data.items.find((item) => item.isPrimary) ?? directory.data.items[0]);
  if (!target) {
    const created = await client.createCareerProfile(create);
    return { profileId: created.data.profileId, created: true };
  }
  const update: CareerProfileUpdateBody = { ...create, expectedVersion: target.version };
  await client.updateCareerProfile(target.id, update);
  return { profileId: target.id, created: false };
}

/**
 * Runs when the wizard is opened without a career profile. It creates the
 * profile, remembers it in the active-profile cookie, and moves the account's
 * onboarding state to in_progress. It never reopens completed onboarding.
 *
 * The optional parameters let the same action serve a form and a direct call;
 * neither is read.
 */
export async function beginOnboardingAction(
  previous?: CareerActionState,
  formData?: FormData,
): Promise<CareerActionState> {
  void previous;
  void formData;
  await assertTrustedMutationOrigin();
  const { session, me } = await requireUser();
  const client = createAuthenticatedApiClient(session);
  try {
    const directory = await client.careerProfiles();
    const existing = directory.data.items.find((item) => item.isPrimary) ?? directory.data.items[0];
    let profileId = existing?.id ?? null;
    let created = false;
    if (!profileId) {
      const result = await client.createCareerProfile({ name: 'Primary search' });
      profileId = result.data.profileId;
      created = true;
    }
    await setActiveCareerProfileCookie(profileId);
    if (me.profile.onboardingStatus !== 'complete') {
      await client.setOnboardingStatus({ status: 'in_progress' });
    }
    revalidateOnboarding();
    return careerSuccess(
      created
        ? 'Your career profile was created and onboarding is in progress.'
        : 'Onboarding is in progress.',
    );
  } catch (error) {
    return careerErrorState(error, 'Onboarding could not be started for this account.');
  }
}

function profileName(formData: FormData): string {
  return formText(formData, 'profileName') || 'Primary search';
}

export async function saveSituationAction(
  previous: CareerActionState,
  formData: FormData,
): Promise<CareerActionState> {
  void previous;
  await assertTrustedMutationOrigin();
  const parsed = careerProfileInputSchema.safeParse({
    name: profileName(formData),
    currentRoleTitle: formOptionalText(formData, 'currentRoleTitle'),
    careerLevel: formOptionalText(formData, 'careerLevel'),
    yearsExperience: formNumber(formData, 'yearsExperience'),
  });
  if (!parsed.success) {
    return careerFailure(
      'Review the highlighted answers.',
      careerLeafFieldErrors(parsed.error.issues),
    );
  }

  const { session } = await requireUser();
  try {
    const result = await persistProfileFields(
      createAuthenticatedApiClient(session),
      formOptionalText(formData, 'profileId'),
      parsed.data,
    );
    await setActiveCareerProfileCookie(result.profileId);
  } catch (error) {
    return careerErrorState(error, 'Your current situation could not be saved.');
  }

  revalidateOnboarding();
  return careerSuccess('Your current situation was saved.');
}

export async function saveTargetRolesAction(
  previous: CareerActionState,
  formData: FormData,
): Promise<CareerActionState> {
  void previous;
  await assertTrustedMutationOrigin();
  const parsed = careerProfileInputSchema.safeParse({
    name: profileName(formData),
    targetRoleTitles: formList(formData, 'targetRoleTitles'),
    excludedRoleTitles: formList(formData, 'excludedRoleTitles'),
    preferredEmploymentTypes: formList(formData, 'preferredEmploymentTypes'),
    preferredWorkArrangement: formOptionalText(formData, 'preferredWorkArrangement'),
    openToInternational: formBoolean(formData, 'openToInternational'),
    openToRelocation: formBoolean(formData, 'openToRelocation'),
    preferredLocations: formList(formData, 'preferredLocations'),
  });
  if (!parsed.success) {
    return careerFailure(
      'Review the highlighted answers.',
      careerLeafFieldErrors(parsed.error.issues),
    );
  }

  const { session } = await requireUser();
  try {
    const result = await persistProfileFields(
      createAuthenticatedApiClient(session),
      formOptionalText(formData, 'profileId'),
      parsed.data,
    );
    await setActiveCareerProfileCookie(result.profileId);
  } catch (error) {
    return careerErrorState(error, 'Your target roles could not be saved.');
  }

  revalidateOnboarding();
  return careerSuccess('Your target roles and preferences were saved.');
}

export async function saveLinksSummaryAction(
  previous: CareerActionState,
  formData: FormData,
): Promise<CareerActionState> {
  void previous;
  await assertTrustedMutationOrigin();
  const parsed = careerProfileInputSchema.safeParse({
    name: profileName(formData),
    summary: formOptionalText(formData, 'summary'),
    careerGoals: formOptionalText(formData, 'careerGoals'),
  });
  if (!parsed.success) {
    return careerFailure(
      'Review the highlighted answers.',
      careerLeafFieldErrors(parsed.error.issues),
    );
  }

  const { session } = await requireUser();
  try {
    const result = await persistProfileFields(
      createAuthenticatedApiClient(session),
      formOptionalText(formData, 'profileId'),
      parsed.data,
    );
    await setActiveCareerProfileCookie(result.profileId);
  } catch (error) {
    return careerErrorState(error, 'Your summary and goals could not be saved.');
  }

  revalidateOnboarding();
  return careerSuccess('Your summary and career goals were saved.');
}

export async function finishOnboardingAction(
  previous: CareerActionState,
  formData: FormData,
): Promise<CareerActionState> {
  void previous;
  await assertTrustedMutationOrigin();
  const parsed = onboardingStatusRequestSchema.safeParse(
    formText(formData, 'status') || 'complete',
  );
  if (!parsed.success) {
    return careerFailure('Onboarding could not be completed. Reload the page and try again.');
  }

  const { session } = await requireUser();
  try {
    await createAuthenticatedApiClient(session).setOnboardingStatus({ status: parsed.data });
  } catch (error) {
    return careerErrorState(error, 'Onboarding could not be completed.');
  }

  revalidateOnboarding();
  redirect('/dashboard/career');
}
