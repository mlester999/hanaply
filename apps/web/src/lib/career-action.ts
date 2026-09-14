import { careerProfileParamsSchema, HanaplyApiError } from '@hanaply/contracts';

/**
 * Shared server-action plumbing for the Career Intelligence Profile surfaces.
 *
 * Server actions return this exact serializable state so the client can render
 * one consistent `aria-live` result region for every mutation.
 */
export interface CareerActionState {
  status: 'idle' | 'success' | 'error';
  message: string | null;
  fieldErrors: Readonly<Record<string, readonly string[]>>;
}

export function careerSuccess(message: string): CareerActionState {
  return { status: 'success', message, fieldErrors: {} };
}

export function careerFailure(
  message: string,
  fieldErrors: Readonly<Record<string, readonly string[]>> = {},
): CareerActionState {
  return { status: 'error', message, fieldErrors };
}

export function careerFieldErrors(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
): Readonly<Record<string, readonly string[]>> {
  const errors: Record<string, string[]> = {};
  for (const issue of issues) {
    const field = String(issue.path[0] ?? 'form');
    (errors[field] ??= []).push(issue.message);
  }
  return errors;
}

/** Zod messages that reach the form verbatim are rewritten into plain language. */
function friendlyIssueMessage(message: string): string {
  if (/invalid iso date/iu.test(message)) return 'Enter a date in YYYY-MM-DD format.';
  if (/invalid option/iu.test(message)) return 'Choose one of the listed options.';
  if (/invalid uuid/iu.test(message)) return 'That identifier is not valid.';
  if (/too big/iu.test(message)) return 'That value is longer than this field allows.';
  if (/too small/iu.test(message)) return 'That value is shorter than this field requires.';
  return message;
}

/**
 * Record payloads are nested (`{ kind, record: { … } }`), so the leaf segment
 * of an issue path is the field the owner actually sees in the form.
 */
export function careerLeafFieldErrors(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
): Readonly<Record<string, readonly string[]>> {
  const errors: Record<string, string[]> = {};
  for (const issue of issues) {
    const leaf = issue.path.length > 0 ? issue.path[issue.path.length - 1] : undefined;
    const field = String(leaf ?? 'form');
    (errors[field] ??= []).push(friendlyIssueMessage(issue.message));
  }
  return errors;
}

export function firstFieldError(
  errors: Readonly<Record<string, readonly string[]>>,
  field: string,
): string | undefined {
  return errors[field]?.[0];
}

/**
 * Maps API failures onto owner-facing copy. Plan-limit and validation
 * explanations are shown exactly as the API wrote them, because they are the
 * only place the real limit or rule is stated.
 */
export function careerErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof HanaplyApiError)) return fallback;
  const envelopeMessage = error.envelope.error.message.trim();
  switch (error.envelope.error.code) {
    case 'FORBIDDEN':
    case 'ENTITLEMENT_REQUIRED':
    case 'SUBSCRIPTION_INACTIVE':
    case 'VALIDATION_ERROR':
    case 'CONFLICT':
      return envelopeMessage || fallback;
    case 'NOT_FOUND':
      return envelopeMessage || fallback;
    case 'RATE_LIMITED':
      return 'Too many career actions were attempted. Wait a moment before trying again.';
    case 'AUTHENTICATION_REQUIRED':
      return 'Your session expired. Sign in again to continue.';
    default:
      return fallback;
  }
}

export function careerApiFieldErrors(error: unknown): Readonly<Record<string, readonly string[]>> {
  if (!(error instanceof HanaplyApiError)) return {};
  const details = error.envelope.error.details;
  if (!details?.length) return {};
  return careerFieldErrors(
    details.map((detail) => ({ path: detail.path, message: detail.message })),
  );
}

export function careerErrorState(error: unknown, fallback: string): CareerActionState {
  return careerFailure(careerErrorMessage(error, fallback), careerApiFieldErrors(error));
}

export function formEntry(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  return typeof value === 'string' ? value : null;
}

export function formText(formData: FormData, name: string): string {
  return formEntry(formData, name)?.trim() ?? '';
}

export function formOptionalText(formData: FormData, name: string): string | null {
  const value = formText(formData, name);
  return value === '' ? null : value;
}

export function formBoolean(formData: FormData, name: string): boolean {
  const value = formEntry(formData, name);
  return value === 'on' || value === 'true' || value === '1';
}

export function formNumber(formData: FormData, name: string): number | null {
  const value = formText(formData, name);
  if (value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formInteger(formData: FormData, name: string): number | null {
  const value = formNumber(formData, name);
  return value === null ? null : Math.trunc(value);
}

/** Repeats of one field name, such as chip values or checked boxes. */
export function formList(formData: FormData, name: string): string[] {
  const values = formData.getAll(name);
  const result: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed !== '' && !result.includes(trimmed)) result.push(trimmed);
  }
  return result;
}

/** One item per line inside a textarea, for the array-shaped record fields. */
export function formLines(formData: FormData, name: string): string[] {
  const raw = formText(formData, name);
  if (raw === '') return [];
  const result: string[] = [];
  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed !== '' && !result.includes(trimmed)) result.push(trimmed);
  }
  return result;
}

/** A human-entered currency amount converted into minor units. */
export function formMoneyMinor(formData: FormData, name: string): number | null {
  const value = formText(formData, name);
  if (value === '') return null;
  const amount = Number(value.replaceAll(',', ''));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Math.round(amount * 100);
}

export function uuidOrNull(value: string | null): string | null {
  if (!value) return null;
  const parsed = careerProfileParamsSchema.shape.profileId.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Checkbox strings ("1", "2", …) turned into the indexes the API expects. */
export function formIndexes(formData: FormData, name: string): number[] {
  const indexes: number[] = [];
  for (const value of formList(formData, name)) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed >= 0 && !indexes.includes(parsed)) indexes.push(parsed);
  }
  return indexes;
}
