import { HanaplyApiError } from '@hanaply/contracts';

/**
 * Shared server-action plumbing for the Career Radar surfaces.
 *
 * This mirrors `career-action.ts` deliberately: mutations on the radar return
 * the same serializable `{ status, message, fieldErrors }` shape so every
 * client form renders one consistent `aria-live` result region.
 */
export interface RadarActionState {
  status: 'idle' | 'success' | 'error';
  message: string | null;
  fieldErrors: Readonly<Record<string, readonly string[]>>;
}

export function radarSuccess(message: string): RadarActionState {
  return { status: 'success', message, fieldErrors: {} };
}

export function radarFailure(
  message: string,
  fieldErrors: Readonly<Record<string, readonly string[]>> = {},
): RadarActionState {
  return { status: 'error', message, fieldErrors };
}

/**
 * Maps API failures onto member-facing copy. Validation and entitlement
 * explanations are shown exactly as the API wrote them, because they are the
 * only place the real rule is stated.
 */
export function radarErrorMessage(error: unknown, fallback: string): string {
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
      return 'Too many radar actions were attempted. Wait a moment before trying again.';
    case 'AUTHENTICATION_REQUIRED':
      return 'Your session expired. Sign in again to continue.';
    case 'SERVICE_UNAVAILABLE':
      return 'The opportunity service is not answering right now. Try again shortly.';
    case 'ACCOUNT_SUSPENDED':
      return 'This account cannot change radar data. Contact support if this is unexpected.';
    default:
      return fallback;
  }
}

export function radarErrorState(error: unknown, fallback: string): RadarActionState {
  return radarFailure(radarErrorMessage(error, fallback));
}
