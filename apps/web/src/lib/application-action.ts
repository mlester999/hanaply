import { HanaplyApiError } from '@hanaply/contracts';

/**
 * Shared server-action plumbing for the Application Pack and tracker surfaces.
 *
 * This mirrors `radar-action.ts` deliberately: mutations return the same
 * serializable `{ status, message, fieldErrors }` shape so every client form
 * renders one consistent `aria-live` result region. Two extra serializable
 * fields are carried because this feature needs them:
 *
 * - `conflict` marks the optimistic-concurrency refusal. A stale write must be
 *   reported as "reload and look again", never as a silent overwrite and never
 *   as a crash, so the client needs to tell it apart from every other failure.
 * - `refused` marks a plan or entitlement refusal. The API's sentence is shown
 *   verbatim and is styled as a decision rather than a fault, because that is
 *   what it is: the monthly allowance is spent, nothing broke.
 * - `packId` carries the pack a create request resolved to, so the client can
 *   open it. The API is idempotent by pack identity, so this is either a newly
 *   created pack or the one that already existed.
 */
export interface ApplicationActionState {
  status: 'idle' | 'success' | 'error';
  message: string | null;
  fieldErrors: Readonly<Record<string, readonly string[]>>;
  conflict: boolean;
  refused: boolean;
  packId: string | null;
}

export const idleApplicationActionState: ApplicationActionState = {
  status: 'idle',
  message: null,
  fieldErrors: {},
  conflict: false,
  refused: false,
  packId: null,
};

export function applicationSuccess(
  message: string,
  packId: string | null = null,
): ApplicationActionState {
  return { status: 'success', message, fieldErrors: {}, conflict: false, refused: false, packId };
}

export function applicationFailure(
  message: string,
  fieldErrors: Readonly<Record<string, readonly string[]>> = {},
): ApplicationActionState {
  return { status: 'error', message, fieldErrors, conflict: false, refused: false, packId: null };
}

/** The non-destructive copy a stale write gets, on every surface. */
export const applicationConflictMessage =
  'This application changed in another session, so your change was not saved. Nothing was overwritten. Reload to see the latest version, then make the change again.';

/**
 * Maps API failures onto member-facing copy. Plan-limit and validation
 * explanations are shown exactly as the API wrote them, because they are the
 * only place the real rule is stated — the monthly Application Pack allowance
 * in particular is quoted verbatim.
 *
 * A conflict is answered with the interface's own wording instead: the API
 * reports the shared optimistic-concurrency code, and the member needs to know
 * which record moved, not which internal code fired.
 */
export function applicationErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof HanaplyApiError)) return fallback;
  const envelopeMessage = error.envelope.error.message.trim();
  switch (error.envelope.error.code) {
    case 'FORBIDDEN':
    case 'ENTITLEMENT_REQUIRED':
    case 'SUBSCRIPTION_INACTIVE':
    case 'VALIDATION_ERROR':
    case 'NOT_FOUND':
      return envelopeMessage || fallback;
    case 'CONFLICT':
      return applicationConflictMessage;
    case 'RATE_LIMITED':
      return 'Too many application actions were attempted. Wait a moment before trying again.';
    case 'AUTHENTICATION_REQUIRED':
      return 'Your session expired. Sign in again to continue.';
    case 'SERVICE_UNAVAILABLE':
      return 'The application service is not answering right now. Try again shortly.';
    case 'ACCOUNT_SUSPENDED':
      return 'This account cannot change application data. Contact support if this is unexpected.';
    default:
      return fallback;
  }
}

export function isApplicationConflict(error: unknown): boolean {
  return error instanceof HanaplyApiError && error.envelope.error.code === 'CONFLICT';
}

/** A plan, entitlement, or subscription decision rather than a failure. */
export function isApplicationRefusal(error: unknown): boolean {
  if (!(error instanceof HanaplyApiError)) return false;
  const code = error.envelope.error.code;
  return (
    code === 'FORBIDDEN' || code === 'ENTITLEMENT_REQUIRED' || code === 'SUBSCRIPTION_INACTIVE'
  );
}

export function applicationErrorState(error: unknown, fallback: string): ApplicationActionState {
  return {
    status: 'error',
    message: applicationErrorMessage(error, fallback),
    fieldErrors: {},
    conflict: isApplicationConflict(error),
    refused: isApplicationRefusal(error),
    packId: null,
  };
}
