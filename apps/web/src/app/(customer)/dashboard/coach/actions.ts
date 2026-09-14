'use server';

import {
  coachConversationParamsSchema,
  openCoachConversationRequestSchema,
  sendCoachMessageRequestSchema,
  type CoachConversationDetail,
} from '@hanaply/contracts';
import { revalidatePath } from 'next/cache';

import {
  coachErrorMessage,
  coachErrorState,
  coachFailure,
  coachSuccess,
  type CoachActionState,
} from '@/lib/coach-action';
import { formEntry, formOptionalText, formText } from '@/lib/career-action';
import { providerLabel, unavailableReason } from '@/lib/ai';
import { assertTrustedMutationOrigin } from '@/lib/request-integrity';
import { createAuthenticatedApiClient, requireUser } from '@/lib/session';

/** The coach index and the thread it changed are revalidated together. */
function revalidateCoach(conversationId?: string): void {
  revalidatePath('/dashboard/coach');
  if (conversationId !== undefined) revalidatePath(`/dashboard/coach/${conversationId}`);
}

/**
 * What the member is told after a send.
 *
 * The wording follows the response rather than the request. A model-written
 * reply is named as such and reports how many statements rested on confirmed
 * facts and how many were labelled inferences; a stored notice is reported as a
 * notice with the API's own reason, never as coaching that happened to be short.
 */
function describeReply(detail: CoachConversationDetail): string {
  const assistant = [...detail.messages].reverse().find((message) => message.role === 'assistant');
  if (assistant === undefined) {
    return 'Your message was saved. Hanaply has not written a reply to it yet, so the thread shows your message on its own.';
  }
  if (!detail.provenance.generated) {
    return `Your message was saved, and Hanaply did not write a model reply: ${unavailableReason(detail.provenance)} The thread repeats this in place of a reply so nothing is left unsaid.`;
  }
  if (assistant.facts.length === 0 && assistant.suggestions.length === 0) {
    return 'Your message was saved. Hanaply answered with a notice rather than coaching: it states no facts about you and cites no confirmed evidence.';
  }
  const writer = detail.provenance.model ?? providerLabel(detail.provenance.provider);
  const facts = `${assistant.facts.length} ${assistant.facts.length === 1 ? 'statement rests' : 'statements rest'} on confirmed facts you can open`;
  const suggestions = `${assistant.suggestions.length} ${assistant.suggestions.length === 1 ? 'inference is' : 'inferences are'} labelled as suggestions rather than facts`;
  return `Reply written by ${writer} under the truth gate. ${facts}, and ${suggestions}.`;
}

/**
 * Opens a coach thread.
 *
 * The thread is created whether or not a provider is configured: it is the
 * member's own record either way, and the reply path — not the thread — is what
 * a missing provider changes. The response's thread id is returned so the client
 * opens exactly the thread the API created rather than guessing at one.
 */
export async function openCoachConversationAction(
  previous: CoachActionState,
  formData: FormData,
): Promise<CoachActionState> {
  void previous;
  await assertTrustedMutationOrigin();

  const title = formOptionalText(formData, 'title');
  const topic = formOptionalText(formData, 'topic');
  const parsed = openCoachConversationRequestSchema.safeParse({
    ...(title === null ? {} : { title }),
    ...(topic === null ? {} : { topic }),
  });
  if (!parsed.success) {
    return coachFailure(
      'That thread could not be created. Give it a title of 160 characters or fewer, or leave the title blank and choose one of the listed topics.',
      { title: ['Keep the title to 160 characters or fewer.'] },
    );
  }

  const { session } = await requireUser();
  try {
    const result = await createAuthenticatedApiClient(session).openCoachConversation(parsed.data);
    const { conversation, provenance } = result.data;
    revalidateCoach(conversation.id);
    return coachSuccess(
      provenance.generated
        ? `Thread “${conversation.title}” opened. Ask your first question below.`
        : `Thread “${conversation.title}” opened and stored. ${unavailableReason(provenance)} You can still write in it, and the thread will say why no reply was written.`,
      conversation.id,
    );
  } catch (error) {
    return coachErrorState(error, 'The coach thread could not be opened.');
  }
}

/**
 * Sends one message and returns the thread as the API stored it.
 *
 * The API appends the member's own message whether or not generation succeeds,
 * so a failure here never means the text was lost; the message says so, and the
 * thread is revalidated so the stored message is visible either way.
 */
export async function sendCoachMessageAction(
  previous: CoachActionState,
  formData: FormData,
): Promise<CoachActionState> {
  void previous;
  await assertTrustedMutationOrigin();

  const params = coachConversationParamsSchema.safeParse({
    conversationId: formEntry(formData, 'conversationId') ?? '',
  });
  if (!params.success) {
    return coachFailure('This thread could not be identified. Reload the page and try again.');
  }

  const body = formText(formData, 'body');
  const parsed = sendCoachMessageRequestSchema.safeParse({ body });
  if (!parsed.success) {
    if (body === '') {
      return coachFailure('Write a message before sending it.', {
        body: ['Enter the message you want to send.'],
      });
    }
    return coachFailure('That message is longer than the 8,000 characters Hanaply stores.', {
      body: ['Shorten this to 8,000 characters or fewer.'],
    });
  }

  const { session } = await requireUser();
  try {
    const result = await createAuthenticatedApiClient(session).sendCoachMessage(
      params.data.conversationId,
      parsed.data,
    );
    revalidateCoach(params.data.conversationId);
    return coachSuccess(describeReply(result.data), params.data.conversationId);
  } catch (error) {
    const message = coachErrorMessage(
      error,
      'Your message could not be sent. Nothing was added to the thread.',
    );
    return coachFailure(
      `${message} Reload the thread before sending again: the API stores your message before it generates a reply, so a request that failed late may still have saved your text.`,
    );
  }
}
