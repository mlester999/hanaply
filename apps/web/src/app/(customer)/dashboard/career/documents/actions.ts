'use server';

import {
  careerDocumentApplySchema,
  careerDocumentKindSchema,
  careerDocumentParamsSchema,
  careerDocumentUploadQuerySchema,
} from '@hanaply/contracts';
import { revalidatePath } from 'next/cache';

import {
  careerErrorState,
  careerFailure,
  careerLeafFieldErrors,
  careerSuccess,
  formEntry,
  formIndexes,
  formList,
  formBoolean,
  formOptionalText,
  type CareerActionState,
} from '@/lib/career-action';
import { assertTrustedMutationOrigin } from '@/lib/request-integrity';
import { createAuthenticatedApiClient, requireUser } from '@/lib/session';

/** Mirrors the API document policy so an oversized file is refused before upload. */
const maximumDocumentBytes = 10 * 1024 * 1024;
const acceptedExtensions: readonly string[] = ['pdf', 'docx', 'rtf', 'txt', 'md'];

function revalidateDocuments(profileId: string | null): void {
  revalidatePath('/dashboard/career/documents');
  revalidatePath('/dashboard/career');
  if (profileId) revalidatePath(`/dashboard/career/${profileId}`);
}

function documentFile(formData: FormData): File | null {
  const entry = formData.get('document');
  return entry instanceof File && entry.size > 0 ? entry : null;
}

function fileExtension(filename: string): string {
  const parts = filename.split('.');
  return parts.length > 1 ? (parts[parts.length - 1] ?? '').toLowerCase() : '';
}

export async function uploadCareerDocumentAction(
  previous: CareerActionState,
  formData: FormData,
): Promise<CareerActionState> {
  void previous;
  await assertTrustedMutationOrigin();
  const file = documentFile(formData);
  if (!file) {
    return careerFailure('Choose a resume file to upload.', {
      document: ['Choose a resume file to upload.'],
    });
  }
  if (file.size > maximumDocumentBytes) {
    return careerFailure('Resumes must be 10 MB or smaller.', {
      document: ['Resumes must be 10 MB or smaller.'],
    });
  }
  const extension = fileExtension(file.name);
  if (!acceptedExtensions.includes(extension)) {
    return careerFailure('Upload a PDF, DOCX, RTF, TXT, or Markdown file.', {
      document: ['Upload a PDF, DOCX, RTF, TXT, or Markdown file.'],
    });
  }

  const kind = careerDocumentKindSchema.safeParse(formEntry(formData, 'documentKind') ?? 'resume');
  if (!kind.success) {
    return careerFailure('Choose which kind of document this is.', {
      documentKind: ['Choose which kind of document this is.'],
    });
  }
  const query = careerDocumentUploadQuerySchema.safeParse({
    documentKind: kind.data,
    careerProfileId: formOptionalText(formData, 'careerProfileId') ?? undefined,
  });
  if (!query.success) {
    return careerFailure(
      'Choose which career profile this document belongs to.',
      careerLeafFieldErrors(query.error.issues),
    );
  }

  const { session } = await requireUser();
  try {
    await createAuthenticatedApiClient(session).uploadCareerDocument(file, file.name, query.data);
  } catch (error) {
    return careerErrorState(error, 'The document could not be uploaded.');
  }

  revalidateDocuments(query.data.careerProfileId ?? null);
  return careerSuccess(
    'The document was uploaded and queued for parsing. Extracted items are proposals until you confirm them.',
  );
}

export async function deleteCareerDocumentAction(
  previous: CareerActionState,
  formData: FormData,
): Promise<CareerActionState> {
  void previous;
  await assertTrustedMutationOrigin();
  const params = careerDocumentParamsSchema.safeParse({
    documentId: formEntry(formData, 'documentId') ?? '',
  });
  if (!params.success) {
    return careerFailure('That document could not be identified. Reload the page and try again.');
  }

  const { session } = await requireUser();
  try {
    await createAuthenticatedApiClient(session).deleteCareerDocument(params.data.documentId);
  } catch (error) {
    return careerErrorState(error, 'The document could not be deleted.');
  }

  revalidateDocuments(null);
  return careerSuccess(
    'The document was deleted and its private object was scheduled for cleanup.',
  );
}

export async function applyCareerDocumentExtractionAction(
  previous: CareerActionState,
  formData: FormData,
): Promise<CareerActionState> {
  void previous;
  await assertTrustedMutationOrigin();
  const params = careerDocumentParamsSchema.safeParse({
    documentId: formEntry(formData, 'documentId') ?? '',
  });
  if (!params.success) {
    return careerFailure('That document could not be identified. Reload the page and try again.');
  }
  const parsed = careerDocumentApplySchema.safeParse({
    careerProfileId: formEntry(formData, 'careerProfileId') ?? '',
    employmentIndexes: formIndexes(formData, 'employmentIndexes'),
    educationIndexes: formIndexes(formData, 'educationIndexes'),
    certificationIndexes: formIndexes(formData, 'certificationIndexes'),
    skillNames: formList(formData, 'skillNames'),
    linkKinds: formList(formData, 'linkKinds'),
    factIndexes: formIndexes(formData, 'factIndexes'),
    confirmSelected: formBoolean(formData, 'confirmSelected'),
  });
  if (!parsed.success) {
    return careerFailure(
      'Choose a career profile and at least one extracted item to apply.',
      careerLeafFieldErrors(parsed.error.issues),
    );
  }
  if (!parsed.data.confirmSelected) {
    return careerFailure('Confirm that you reviewed the selected proposals before applying them.');
  }

  const { session } = await requireUser();
  const client = createAuthenticatedApiClient(session);
  let createdRecords = 0;
  let createdFacts = 0;
  try {
    /**
     * Applying is not confirming.
     *
     * `confirmSelected: true` told the API to promote every claim this action
     * created straight to confirmed evidence, which contradicted the checkbox
     * the member had just ticked ("puts every claim in Needs review until I
     * confirm it"), the success message below, and the truth ledger's standing
     * promise that "Nothing is confirmed on your behalf". It also left the
     * candidate channel of the ledger unreachable from the product, so an
     * extracted claim could never be reviewed before it became citable. The
     * checkbox is a review acknowledgement; the decision stays with the member.
     */
    const result = await client.applyCareerDocumentExtraction(params.data.documentId, {
      ...parsed.data,
      confirmSelected: false,
    });
    createdRecords = result.data.createdRecordIds.length;
    createdFacts = result.data.createdFactIds.length;
  } catch (error) {
    return careerErrorState(error, 'The selected proposals could not be applied.');
  }

  revalidateDocuments(parsed.data.careerProfileId);
  if (createdRecords === 0 && createdFacts === 0) {
    return careerSuccess(
      'Nothing new was applied. Every selected proposal already exists on the profile.',
    );
  }
  return careerSuccess(
    `${createdRecords} profile ${createdRecords === 1 ? 'record' : 'records'} and ${createdFacts} ${
      createdFacts === 1 ? 'claim' : 'claims'
    } were applied. New claims stay in Needs review until you confirm them.`,
  );
}
