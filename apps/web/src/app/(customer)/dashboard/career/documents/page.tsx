import {
  HanaplyApiError,
  type CareerDocumentExtraction,
  type CareerDocument,
  type CareerProfileSummary,
} from '@hanaply/contracts';
import { Alert, LinkButton, PageHeader } from '@hanaply/ui';
import type { Metadata } from 'next';

import { CareerDocuments } from '@/components/career/career-documents';
import { createAuthenticatedApiClient, requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Career Documents' };

async function loadExtraction(
  client: ReturnType<typeof createAuthenticatedApiClient>,
  document: CareerDocument,
): Promise<CareerDocumentExtraction | null> {
  if (document.status !== 'parsed' && document.status !== 'needs_review') return null;
  try {
    return (await client.careerDocumentExtraction(document.id)).data;
  } catch {
    return null;
  }
}

export default async function CareerDocumentsPage() {
  const { session } = await requireUser();
  const client = createAuthenticatedApiClient(session);

  let documents: readonly CareerDocument[] = [];
  let profiles: readonly CareerProfileSummary[] = [];
  let unavailable: string | null = null;
  try {
    const [documentResult, profileResult] = await Promise.all([
      client.careerDocuments(),
      client.careerProfiles(),
    ]);
    documents = documentResult.data.items;
    profiles = profileResult.data.items;
  } catch (error) {
    unavailable =
      error instanceof HanaplyApiError
        ? error.envelope.error.message
        : 'Hanaply could not load your document library.';
  }

  const accessEntries = await Promise.all(
    documents.map(async (document) => {
      try {
        return [document.id, (await client.careerDocumentAccess(document.id)).data.url] as const;
      } catch {
        return [document.id, null] as const;
      }
    }),
  );
  const extractionEntries = await Promise.all(
    documents.map(
      async (document) => [document.id, await loadExtraction(client, document)] as const,
    ),
  );

  return (
    <div className="workspace-page career-page">
      <PageHeader
        actions={
          <LinkButton href="/dashboard/career" variant="secondary">
            Back to career profiles
          </LinkButton>
        }
        description="Upload a resume, review what the parser proposed, and choose exactly which proposals reach your profile."
        eyebrow="Career intelligence"
        title="Documents"
      />
      {unavailable ? (
        <Alert title="Documents are unavailable" tone="danger">
          {unavailable}
        </Alert>
      ) : (
        <CareerDocuments
          access={Object.fromEntries(accessEntries)}
          documents={documents}
          extractions={Object.fromEntries(extractionEntries)}
          profiles={profiles}
        />
      )}
    </div>
  );
}
