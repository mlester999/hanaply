import { HanaplyApiError } from '@hanaply/contracts';

/**
 * Shared server-action plumbing for the coach surfaces.
 *
 * This mirrors `radar-action.ts` and `application-action.ts` deliberately: coach
 * mutations return the same serializable `{ status, message, fieldErrors }`
 * shape, so every client form renders one consistent `aria-live` result region.
 *
 * One extra serializable field is carried because this feature needs it:
 * `conversationId` is the thread an open request resolved to, so the client can
 * navigate straight into it. It is never a guess — the API returns the thread it
 * created, and `null` means no thread was created.
 */
export interface CoachActionState {
  status: 'idle' | 'success' | 'error';
  message: string | null;
  fieldErrors: Readonly<Record<string, readonly string[]>>;
  conversationId: string | null;
}

export const idleCoachActionState: CoachActionState = {
  status: 'idle',
  message: null,
  fieldErrors: {},
  conversationId: null,
};

export function coachSuccess(
  message: string,
  conversationId: string | null = null,
): CoachActionState {
  return { status: 'success', message, fieldErrors: {}, conversationId };
}

export function coachFailure(
  message: string,
  fieldErrors: Readonly<Record<string, readonly string[]>> = {},
): CoachActionState {
  return { status: 'error', message, fieldErrors, conversationId: null };
}

/**
 * Maps API failures onto member-facing copy. Validation, entitlement, and
 * not-found explanations are shown exactly as the API wrote them, because they
 * are the only place the real rule is stated.
 */
export function coachErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof HanaplyApiError)) return fallback;
  const envelopeMessage = error.envelope.error.message.trim();
  switch (error.envelope.error.code) {
    case 'FORBIDDEN':
    case 'ENTITLEMENT_REQUIRED':
    case 'SUBSCRIPTION_INACTIVE':
    case 'VALIDATION_ERROR':
    case 'NOT_FOUND':
    case 'CONFLICT':
      return envelopeMessage || fallback;
    case 'RATE_LIMITED':
      return 'Too many coach messages were sent. Wait a moment before trying again. Your message was not lost.';
    case 'AUTHENTICATION_REQUIRED':
      return 'Your session expired. Sign in again to continue.';
    case 'SERVICE_UNAVAILABLE':
      return 'The coach service is not answering right now. Try again shortly. Nothing was written.';
    case 'ACCOUNT_SUSPENDED':
      return 'This account cannot use the coach. Contact support if this is unexpected.';
    default:
      return fallback;
  }
}

export function coachErrorState(error: unknown, fallback: string): CoachActionState {
  return coachFailure(coachErrorMessage(error, fallback));
}
