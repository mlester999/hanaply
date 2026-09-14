import {
  HanaplyApiError,
  type AiStatus,
  type CoachConversationDetail,
  type ConfirmedCareerEvidence,
} from '@hanaply/contracts';
import { Badge, Card, LinkButton, PageHeader } from '@hanaply/ui';
import { ArrowLeft, MessagesSquare } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { AiStatusNotice } from '@/components/coach/ai-status-notice';
import type { CoachEvidenceEntry } from '@/components/coach/coach-facts';
import { CoachThread } from '@/components/coach/coach-thread';
import { coachConversationStatusLabel, coachTopicLabel, messageCountLabel } from '@/lib/ai';
import { coachErrorMessage } from '@/lib/coach-action';
import { formatAbsoluteTimestamp, isUuid, relativeFromIso } from '@/lib/radar';
import { createAuthenticatedApiClient, requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Coach thread' };

type ApiClient = ReturnType<typeof createAuthenticatedApiClient>;

interface EvidenceRead {
  entries: readonly CoachEvidenceEntry[];
  unavailable: string | null;
}

/**
 * The confirmed statements behind the facts a reply cites.
 *
 * This read can fail without taking the thread down. When it does, the thread
 * still shows every cited identifier and says that the statement behind it could
 * not be read — a cited fact is never dropped silently and never replaced with
 * text Hanaply did not read.
 */
async function readEvidence(client: ApiClient, profileId: string): Promise<EvidenceRead> {
  try {
    const evidence: ConfirmedCareerEvidence = (await client.confirmedCareerEvidence(profileId))
      .data;
    return {
      entries: evidence.facts.map((fact) => ({ factId: fact.id, statement: fact.statement })),
      unavailable: null,
    };
  } catch (error) {
    return {
      entries: [],
      unavailable: coachErrorMessage(
        error,
        'The truth ledger read did not answer, so the statements behind the cited facts are not shown.',
      ),
    };
  }
}

async function readStatus(
  client: ApiClient,
): Promise<{ status: AiStatus | null; unavailable: string | null }> {
  try {
    return { status: (await client.aiStatus()).data.status, unavailable: null };
  } catch (error) {
    return {
      status: null,
      unavailable: coachErrorMessage(error, 'Hanaply could not read whether AI is configured.'),
    };
  }
}

export default async function CoachThreadPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;
  if (!isUuid(conversationId)) notFound();

  const { session } = await requireUser();
  const client = createAuthenticatedApiClient(session);

  let detail: CoachConversationDetail | null = null;
  let unavailable: string | null = null;
  try {
    detail = (await client.coachConversation(conversationId)).data;
  } catch (error) {
    if (error instanceof HanaplyApiError && error.status === 404) notFound();
    unavailable = coachErrorMessage(error, 'Hanaply could not open this coach thread.');
  }

  if (detail === null) {
    return (
      <div className="workspace-page coach-page">
        <PageHeader eyebrow="Coach" title="Thread" />
        <Card className="coach-unavailable" role="alert">
          <h2>
            <MessagesSquare aria-hidden="true" size={20} /> This thread is unavailable
          </h2>
          <p>{unavailable ?? 'The thread could not be loaded.'}</p>
          <p className="career-hint">
            Nothing was changed by this read. Your messages are stored by the API, and reopening the
            thread from the coach index will show them if the read succeeds.
          </p>
          <div className="radar-note-actions">
            <LinkButton href="/dashboard/coach" variant="secondary">
              <ArrowLeft aria-hidden="true" size={16} /> Back to the coach
            </LinkButton>
          </div>
        </Card>
      </div>
    );
  }

  const [evidenceRead, statusRead] = await Promise.all([
    detail.conversation.careerProfileId === null
      ? Promise.resolve<EvidenceRead>({
          entries: [],
          unavailable:
            'This thread is not linked to a career profile, so there is no confirmed ledger behind it.',
        })
      : readEvidence(client, detail.conversation.careerProfileId),
    readStatus(client),
  ]);

  const { conversation } = detail;
  const activity = relativeFromIso(
    conversation.lastMessageAt ?? conversation.createdAt,
    new Date(),
    conversation.lastMessageAt === null ? 'Opened' : 'Last message',
  );

  return (
    <div className="workspace-page coach-page">
      <div className="application-detail-nav">
        <LinkButton href="/dashboard/coach" size="sm" variant="quiet">
          <ArrowLeft aria-hidden="true" size={16} /> All coach threads
        </LinkButton>
      </div>

      <header className="coach-thread-header">
        <span className="h-eyebrow">Coach thread</span>
        <h1>{conversation.title}</h1>
        <p className="coach-thread-meta">
          <Badge tone={conversation.status === 'open' ? 'brand' : 'neutral'}>
            {coachConversationStatusLabel(conversation.status)}
          </Badge>
          <span>{coachTopicLabel(conversation.topic)}</span>
          <span aria-hidden="true">·</span>
          <span>{messageCountLabel(conversation.messageCount)}</span>
          <span aria-hidden="true">·</span>
          <span title={activity?.title ?? undefined}>
            {activity?.label ?? 'Activity time not reported'}
          </span>
        </p>
        <p className="coach-thread-opened">
          Opened{' '}
          {formatAbsoluteTimestamp(conversation.createdAt) ?? 'at a time the API did not report'}
        </p>
        <p className="application-explainer">
          Every reply below is shown with the confirmed facts it used and with its inferences kept
          apart. Hanaply does not paraphrase your evidence here: the statements under “stated as
          fact” are read back from your own truth ledger.
        </p>
      </header>

      <AiStatusNotice
        status={statusRead.status}
        unavailable={statusRead.unavailable}
        variant="thread"
      />

      <CoachThread
        configured={statusRead.status === null ? null : statusRead.status.configured}
        detail={detail}
        evidence={evidenceRead.entries}
        evidenceUnavailable={evidenceRead.unavailable}
      />
    </div>
  );
}
