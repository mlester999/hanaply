'use server';

import {
  careerFactCategorySchema,
  careerFactDecisionSchema,
  careerProfileInputSchema,
  careerProfileParamsSchema,
  careerProfileStatusSchema,
  careerProfileUpdateSchema,
  careerRecordInputSchema,
  careerRecordKindSchema,
  careerRecordParamsSchema,
  type CareerRecordKind,
} from '@hanaply/contracts';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { setActiveCareerProfileCookie } from '@/lib/career-cookie';
import {
  careerErrorState,
  careerFailure,
  careerLeafFieldErrors,
  careerSuccess,
  firstFieldError,
  formBoolean,
  formEntry,
  formInteger,
  formLines,
  formList,
  formMoneyMinor,
  formNumber,
  formOptionalText,
  formText,
  uuidOrNull,
  type CareerActionState,
} from '@/lib/career-action';
import { assertTrustedMutationOrigin } from '@/lib/request-integrity';
import { createAuthenticatedApiClient, requireUser } from '@/lib/session';

function revalidateCareer(profileId: string): void {
  revalidatePath('/dashboard');
  revalidatePath('/dashboard/career');
  revalidatePath(`/dashboard/career/${profileId}`);
  revalidatePath(`/dashboard/career/${profileId}/facts`);
  revalidatePath('/dashboard/onboarding');
}

function optionalString(formData: FormData, name: string): string | undefined {
  return formOptionalText(formData, name) ?? undefined;
}

function profileIdFrom(formData: FormData): string | null {
  const parsed = careerProfileParamsSchema.safeParse({
    profileId: formEntry(formData, 'profileId') ?? '',
  });
  return parsed.success ? parsed.data.profileId : null;
}

/**
 * Form values for one structured record kind. Empty optional text is passed
 * through untouched because the contract schemas turn empty strings into null,
 * which is how the owner clears a value.
 */
function recordValues(kind: CareerRecordKind, formData: FormData): Record<string, unknown> {
  switch (kind) {
    case 'sub_career':
      return {
        name: formText(formData, 'name'),
        focus: formOptionalText(formData, 'focus'),
        keywords: formLines(formData, 'keywords'),
        priority: formInteger(formData, 'priority') ?? undefined,
      };
    case 'employment':
      return {
        companyName: formText(formData, 'companyName'),
        roleTitle: formText(formData, 'roleTitle'),
        employmentType: optionalString(formData, 'employmentType'),
        workArrangement: formOptionalText(formData, 'workArrangement'),
        location: formOptionalText(formData, 'location'),
        countryCode: formOptionalText(formData, 'countryCode'),
        companyUrl: formOptionalText(formData, 'companyUrl'),
        industry: formOptionalText(formData, 'industry'),
        startDate: formText(formData, 'startDate'),
        endDate: formOptionalText(formData, 'endDate'),
        isCurrent: formBoolean(formData, 'isCurrent'),
        summary: formOptionalText(formData, 'summary'),
        highlights: formLines(formData, 'highlights'),
        skills: formLines(formData, 'skills'),
      };
    case 'project':
      return {
        name: formText(formData, 'name'),
        roleTitle: formOptionalText(formData, 'roleTitle'),
        description: formOptionalText(formData, 'description'),
        projectUrl: formOptionalText(formData, 'projectUrl'),
        repositoryUrl: formOptionalText(formData, 'repositoryUrl'),
        startDate: formOptionalText(formData, 'startDate'),
        endDate: formOptionalText(formData, 'endDate'),
        isFeatured: formBoolean(formData, 'isFeatured'),
        highlights: formLines(formData, 'highlights'),
        skills: formLines(formData, 'skills'),
      };
    case 'education':
      return {
        institution: formText(formData, 'institution'),
        degree: formOptionalText(formData, 'degree'),
        fieldOfStudy: formOptionalText(formData, 'fieldOfStudy'),
        startYear: formInteger(formData, 'startYear'),
        endYear: formInteger(formData, 'endYear'),
        isCurrent: formBoolean(formData, 'isCurrent'),
        grade: formOptionalText(formData, 'grade'),
        description: formOptionalText(formData, 'description'),
      };
    case 'certification':
      return {
        name: formText(formData, 'name'),
        issuer: formOptionalText(formData, 'issuer'),
        credentialId: formOptionalText(formData, 'credentialId'),
        credentialUrl: formOptionalText(formData, 'credentialUrl'),
        issuedOn: formOptionalText(formData, 'issuedOn'),
        expiresOn: formOptionalText(formData, 'expiresOn'),
      };
    case 'link':
      return {
        linkKind: formText(formData, 'linkKind'),
        label: formOptionalText(formData, 'label'),
        url: formText(formData, 'url'),
      };
    case 'skill':
      return {
        name: formText(formData, 'name'),
        skillKind: optionalString(formData, 'skillKind'),
        proficiency: formOptionalText(formData, 'proficiency'),
        yearsExperience: formNumber(formData, 'yearsExperience'),
        lastUsedYear: formInteger(formData, 'lastUsedYear'),
        isPrimary: formBoolean(formData, 'isPrimary'),
      };
  }
}

export async function createCareerProfileAction(
  previous: CareerActionState,
  formData: FormData,
): Promise<CareerActionState> {
  void previous;
  await assertTrustedMutationOrigin();
  const parsed = careerProfileInputSchema.safeParse({
    name: formText(formData, 'name'),
    headline: formOptionalText(formData, 'headline'),
    currentRoleTitle: formOptionalText(formData, 'currentRoleTitle'),
    careerLevel: formOptionalText(formData, 'careerLevel'),
    yearsExperience: formNumber(formData, 'yearsExperience'),
    targetRoleTitles: formList(formData, 'targetRoleTitles'),
  });
  if (!parsed.success) {
    return careerFailure(
      'Review the profile details before creating it.',
      careerLeafFieldErrors(parsed.error.issues),
    );
  }

  const { session } = await requireUser();
  let createdId: string;
  try {
    const result = await createAuthenticatedApiClient(session).createCareerProfile(parsed.data);
    createdId = result.data.profileId;
  } catch (error) {
    return careerErrorState(error, 'The career profile could not be created.');
  }

  await setActiveCareerProfileCookie(createdId);
  revalidateCareer(createdId);
  redirect(`/dashboard/career/${createdId}`);
}

export async function updateCareerProfileAction(
  previous: CareerActionState,
  formData: FormData,
): Promise<CareerActionState> {
  void previous;
  await assertTrustedMutationOrigin();
  const profileId = profileIdFrom(formData);
  if (!profileId) {
    return careerFailure(
      'The career profile could not be identified. Reload the page and try again.',
    );
  }
  const expectedVersion = formInteger(formData, 'expectedVersion');
  if (expectedVersion === null) {
    return careerFailure('The career profile version is missing. Reload the page and try again.');
  }
  const parsed = careerProfileUpdateSchema.safeParse({
    name: formText(formData, 'name'),
    headline: formOptionalText(formData, 'headline'),
    summary: formOptionalText(formData, 'summary'),
    currentRoleTitle: formOptionalText(formData, 'currentRoleTitle'),
    careerLevel: formOptionalText(formData, 'careerLevel'),
    yearsExperience: formNumber(formData, 'yearsExperience'),
    industries: formList(formData, 'industries'),
    targetRoleTitles: formList(formData, 'targetRoleTitles'),
    excludedRoleTitles: formList(formData, 'excludedRoleTitles'),
    preferredEmploymentTypes: formList(formData, 'preferredEmploymentTypes'),
    preferredWorkArrangement: formOptionalText(formData, 'preferredWorkArrangement'),
    preferredLocations: formList(formData, 'preferredLocations'),
    openToInternational: formBoolean(formData, 'openToInternational'),
    openToRelocation: formBoolean(formData, 'openToRelocation'),
    workAuthorizations: formList(formData, 'workAuthorizations'),
    availability: formOptionalText(formData, 'availability'),
    salaryMinMinor: formMoneyMinor(formData, 'salaryMin'),
    salaryMaxMinor: formMoneyMinor(formData, 'salaryMax'),
    salaryCurrency: optionalString(formData, 'salaryCurrency'),
    salaryPeriod: formOptionalText(formData, 'salaryPeriod'),
    careerGoals: formOptionalText(formData, 'careerGoals'),
    expectedVersion,
  });
  if (!parsed.success) {
    return careerFailure(
      'Review the highlighted profile fields.',
      careerLeafFieldErrors(parsed.error.issues),
    );
  }

  const { session } = await requireUser();
  try {
    await createAuthenticatedApiClient(session).updateCareerProfile(profileId, parsed.data);
  } catch (error) {
    return careerErrorState(error, 'The career profile could not be updated.');
  }

  revalidateCareer(profileId);
  return careerSuccess('The career profile was updated.');
}

export async function setCareerProfileStatusAction(
  previous: CareerActionState,
  formData: FormData,
): Promise<CareerActionState> {
  void previous;
  await assertTrustedMutationOrigin();
  const profileId = profileIdFrom(formData);
  if (!profileId) {
    return careerFailure(
      'The career profile could not be identified. Reload the page and try again.',
    );
  }
  const status = careerProfileStatusSchema.safeParse(formEntry(formData, 'status'));
  if (!status.success) {
    return careerFailure('Choose draft, active, or archived.', {
      status: ['Choose draft, active, or archived.'],
    });
  }

  const { session } = await requireUser();
  try {
    await createAuthenticatedApiClient(session).setCareerProfileStatus(profileId, {
      status: status.data,
    });
  } catch (error) {
    return careerErrorState(error, 'The career profile status could not be changed.');
  }

  revalidateCareer(profileId);
  return careerSuccess(`The career profile is now ${status.data}.`);
}

export async function setPrimaryCareerProfileAction(
  previous: CareerActionState,
  formData: FormData,
): Promise<CareerActionState> {
  void previous;
  await assertTrustedMutationOrigin();
  const profileId = profileIdFrom(formData);
  if (!profileId) {
    return careerFailure(
      'The career profile could not be identified. Reload the page and try again.',
    );
  }

  const { session } = await requireUser();
  try {
    const result = await createAuthenticatedApiClient(session).setPrimaryCareerProfile(profileId);
    revalidateCareer(profileId);
    return careerSuccess(
      result.data.changed
        ? 'This is now your primary career profile.'
        : 'This career profile was already primary.',
    );
  } catch (error) {
    return careerErrorState(error, 'The primary career profile could not be changed.');
  }
}

export async function deleteCareerProfileAction(
  previous: CareerActionState,
  formData: FormData,
): Promise<CareerActionState> {
  void previous;
  await assertTrustedMutationOrigin();
  const profileId = profileIdFrom(formData);
  if (!profileId) {
    return careerFailure(
      'The career profile could not be identified. Reload the page and try again.',
    );
  }
  if (!formBoolean(formData, 'confirmDelete')) {
    return careerFailure('Confirm that the profile and every record beneath it will be deleted.');
  }

  const { session } = await requireUser();
  try {
    await createAuthenticatedApiClient(session).deleteCareerProfile(profileId);
  } catch (error) {
    return careerErrorState(error, 'The career profile could not be deleted.');
  }

  revalidateCareer(profileId);
  redirect('/dashboard/career');
}

export async function saveCareerRecordAction(
  previous: CareerActionState,
  formData: FormData,
): Promise<CareerActionState> {
  void previous;
  await assertTrustedMutationOrigin();
  const profileId = profileIdFrom(formData);
  if (!profileId) {
    return careerFailure(
      'The career profile could not be identified. Reload the page and try again.',
    );
  }
  const kind = careerRecordKindSchema.safeParse(formEntry(formData, 'kind'));
  if (!kind.success) {
    return careerFailure('Choose which kind of career record to save.');
  }
  const recordId = formOptionalText(formData, 'recordId');
  if (recordId) {
    const params = careerRecordParamsSchema.safeParse({
      profileId,
      recordKind: kind.data,
      recordId,
    });
    if (!params.success) {
      return careerFailure(
        'That career record could not be identified. Reload the page and try again.',
      );
    }
  }

  const parsed = careerRecordInputSchema.safeParse({
    kind: kind.data,
    ...(recordId ? { recordId } : {}),
    record: recordValues(kind.data, formData),
  });
  if (!parsed.success) {
    return careerFailure(
      'Review the highlighted fields.',
      careerLeafFieldErrors(parsed.error.issues),
    );
  }

  const { session } = await requireUser();
  try {
    await createAuthenticatedApiClient(session).upsertCareerRecord(profileId, parsed.data);
  } catch (error) {
    return careerErrorState(error, 'The career record could not be saved.');
  }

  revalidateCareer(profileId);
  return careerSuccess(
    recordId ? 'The career record was updated.' : 'The career record was added.',
  );
}

export async function deleteCareerRecordAction(
  previous: CareerActionState,
  formData: FormData,
): Promise<CareerActionState> {
  void previous;
  await assertTrustedMutationOrigin();
  const params = careerRecordParamsSchema.safeParse({
    profileId: formEntry(formData, 'profileId') ?? '',
    recordKind: formEntry(formData, 'kind') ?? '',
    recordId: formEntry(formData, 'recordId') ?? '',
  });
  if (!params.success) {
    return careerFailure(
      'That career record could not be identified. Reload the page and try again.',
    );
  }

  const { session } = await requireUser();
  try {
    await createAuthenticatedApiClient(session).deleteCareerRecord(
      params.data.profileId,
      params.data.recordKind,
      params.data.recordId,
    );
  } catch (error) {
    return careerErrorState(error, 'The career record could not be deleted.');
  }

  revalidateCareer(params.data.profileId);
  return careerSuccess('The career record was deleted.');
}

export async function recordCareerFactAction(
  previous: CareerActionState,
  formData: FormData,
): Promise<CareerActionState> {
  void previous;
  await assertTrustedMutationOrigin();
  const profileId = profileIdFrom(formData);
  if (!profileId) {
    return careerFailure(
      'The career profile could not be identified. Reload the page and try again.',
    );
  }
  const statement = formText(formData, 'statement');
  const category = careerFactCategorySchema.safeParse(formOptionalText(formData, 'category'));
  const metricValue = formNumber(formData, 'metricValue');
  const metricUnit = formOptionalText(formData, 'metricUnit');
  const fieldErrors: Record<string, string[]> = {};
  if (statement.length < 3 || statement.length > 500) {
    fieldErrors.statement = ['Write a claim between 3 and 500 characters long.'];
  }
  if (metricValue !== null && !metricUnit) {
    fieldErrors.metricUnit = ['Add a unit so the number stays truthful.'];
  }
  if (metricUnit && metricValue === null) {
    fieldErrors.metricValue = ['Enter the number that belongs with this unit.'];
  }
  if (!category.success) {
    fieldErrors.category = ['Choose a category for this claim.'];
  }
  if (Object.keys(fieldErrors).length > 0) {
    return careerFailure('Review the claim before saving it.', fieldErrors);
  }

  const { session } = await requireUser();
  try {
    await createAuthenticatedApiClient(session).recordCareerFacts(profileId, {
      facts: [
        {
          statement,
          ...(category.success ? { category: category.data } : {}),
          metricValue,
          metricUnit,
        },
      ],
    });
  } catch (error) {
    return careerErrorState(error, 'The claim could not be recorded.');
  }

  revalidateCareer(profileId);
  return careerSuccess('The claim was recorded as confirmed evidence.');
}

export async function decideCareerFactAction(
  previous: CareerActionState,
  formData: FormData,
): Promise<CareerActionState> {
  void previous;
  await assertTrustedMutationOrigin();
  const profileId = profileIdFrom(formData);
  const factId = uuidOrNull(formOptionalText(formData, 'factId'));
  if (!profileId || !factId) {
    return careerFailure('That claim could not be identified. Reload the page and try again.');
  }

  const parsed = careerFactDecisionSchema.safeParse({
    decision: formText(formData, 'decision'),
    statement: formOptionalText(formData, 'statement'),
    metricUnit: formOptionalText(formData, 'metricUnit'),
    metricValue: formNumber(formData, 'metricValue'),
  });
  if (!parsed.success) {
    const errors = careerLeafFieldErrors(parsed.error.issues);
    return careerFailure(
      firstFieldError(errors, 'statement') ??
        firstFieldError(errors, 'decision') ??
        'Review the claim before recording a decision.',
      errors,
    );
  }

  const { session } = await requireUser();
  try {
    await createAuthenticatedApiClient(session).decideCareerFact(factId, parsed.data);
  } catch (error) {
    return careerErrorState(error, 'The decision could not be recorded.');
  }

  revalidateCareer(profileId);
  const decisionCopy =
    parsed.data.decision === 'confirm'
      ? 'The claim is confirmed and may now be cited.'
      : parsed.data.decision === 'reject'
        ? 'The claim was rejected and will not be cited.'
        : 'The corrected claim was recorded.';
  return careerSuccess(decisionCopy);
}
