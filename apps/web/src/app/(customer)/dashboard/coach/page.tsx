import {
  type AiStatus,
  type CoachConversation,
  type CoachConversationDirectory,
} from '@hanaply/contracts';
import { Badge, Card, EmptyState, LinkButton, PageHeader } from '@hanaply/ui';
import { ArrowUpRight, Clock, MessagesSquare } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { AiStatusNotice } from '@/components/coach/ai-status-notice';
import { NewThreadPanel } from '@/components/coach/new-thread-panel';
import { coachConversationStatusLabel, coachTopicLabel, messageCountLabel } from '@/lib/ai';
import { coachErrorMessage } from '@/lib/coach-action';
import { relativeFromIso } from '@/lib/radar';
import { createAuthenticatedApiClient, requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Coach' };

type ApiClient = ReturnType<typeof createAuthenticatedApiClient>;

interface StatusRead {
  status: AiStatus | null;
  unavailable: string | null;
}

interface DirectoryRead {
  directory: CoachConversationDirectory | null;
  unavailable: string | null;
}

/**
 * The two reads this page needs, each caught at the call.
 *
 * They fail independently: an unreadable status is reported as unreadable rather
 * than as "AI is off", and an unreadable thread list is reported as a read
 * failure rather than as an empty inbox, because those are different statements
 * and only one of them is true. Neither failure takes the page down.
 */
async function readStatus(client: ApiClient): Promise<StatusRead> {
  try {
    return { status: (await client.aiStatus()).data.status, unavailable: null };
  } catch (error) {
    return {
      status: null,
      unavailable: coachErrorMessage(error, 'Hanaply could not read whether AI is configured.'),
    };
  }
}

async function readDirectory(client: ApiClient): Promise<DirectoryRead> {
  try {
    return { directory: (await client.coachConversations()).data, unavailable: null };
  } catch (error) {
    return {
      directory: null,
      unavailable: coachErrorMessage(error, 'Hanaply could not load your coach threads.'),
    };
  }
}

function ThreadCard({ conversation, now }: { conversation: CoachConversation; now: Date }) {
  const activity = relativeFromIso(
    conversation.lastMessageAt ?? conversation.createdAt,
    now,
    conversation.lastMessageAt === null ? 'Opened' : 'Last message',
  );
  const href = `/dashboard/coach/${conversation.id}`;

  return (
    <li className="coach-thread-item">
      <Card className="coach-thread-card">
        <div className="coach-thread-card-head">
          <h2>
            <Link href={href}>{conversation.title}</Link>
          </h2>
          <Badge tone={conversation.status === 'open' ? 'brand' : 'neutral'}>
            {coachConversationStatusLabel(conversation.status)}
          </Badge>
        </div>
        <p className="coach-thread-meta">
          <span>{coachTopicLabel(conversation.topic)}</span>
          <span aria-hidden="true">·</span>
          <span>{messageCountLabel(conversation.messageCount)}</span>
          <span aria-hidden="true">·</span>
          <span title={activity?.title ?? undefined}>
            <Clock aria-hidden="true" size={14} /> {activity?.label ?? 'Activity time not reported'}
          </span>
        </p>
        <p className="coach-thread-provider">
          {conversation.model === null
            ? 'No model has written in this thread.'
            : `Replies in this thread were written by ${conversation.model}${
                conversation.provider === null ? '' : ` (${conversation.provider})`
              }.`}
        </p>
        <LinkButton href={href} size="sm" variant="secondary">
          Open the thread <ArrowUpRight aria-hidden="true" size={15} />
        </LinkButton>
      </Card>
    </li>
  );
}

export default async function CoachPage() {
  const { session } = await requireUser();
  const client = createAuthenticatedApiClient(session);

  const [statusRead, directoryRead] = await Promise.all([
    readStatus(client),
    readDirectory(client),
  ]);
  const { status, unavailable: statusUnavailable } = statusRead;
  const conversations = directoryRead.directory?.items ?? [];
  const now = new Date();
  const configured = status === null ? null : status.configured;

  return (
    <div className="workspace-page coach-page">
      <PageHeader
        description="A grounded writing and thinking partner for your search. It answers from the facts you confirmed, and labels anything it merely infers."
        eyebrow="Customer dashboard"
        title="Coach"
      />

      <AiStatusNotice status={status} unavailable={statusUnavailable} variant="page" />

      {directoryRead.unavailable === null ? null : (
        <Card className="coach-unavailable" role="alert">
          <h2>
            <MessagesSquare aria-hidden="true" size={20} /> Your coach threads are unavailable
          </h2>
          <p>{directoryRead.unavailable}</p>
          <p className="career-hint">
            This is a read failure, not an empty inbox: Hanaply does not know what threads you have
            right now, so it is not claiming you have none. Nothing was deleted.
          </p>
        </Card>
      )}

      {directoryRead.unavailable === null && conversations.length === 0 ? (
        <EmptyState
          description={
            <>
              No thread has been opened yet. A thread keeps one question together — a role, a
              resume, or an interview — and every reply in it cites the confirmed facts it used.
              {configured === false
                ? ' AI generation is not configured in this deployment, so a thread opened now stores your messages and says plainly that no model reply was written.'
                : ''}
            </>
          }
          eyebrow="Coach"
          icon={<MessagesSquare aria-hidden="true" size={26} />}
          title="No coach threads yet"
        />
      ) : null}

      {conversations.length > 0 ? (
        <section aria-labelledby="coach-threads-heading" className="coach-threads">
          <div className="application-section-heading">
            <MessagesSquare aria-hidden="true" size={20} />
            <div>
              <h2 id="coach-threads-heading">Your threads</h2>
              <p>Newest activity first, in the order the API returned them.</p>
            </div>
          </div>
          <ul className="coach-thread-list">
            {conversations.map((conversation) => (
              <ThreadCard conversation={conversation} key={conversation.id} now={now} />
            ))}
          </ul>
        </section>
      ) : null}

      <NewThreadPanel configured={configured} />
    </div>
  );
}
