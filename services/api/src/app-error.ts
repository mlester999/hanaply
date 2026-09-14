import type { ErrorCode } from '@hanaply/contracts';

export interface ValidationDetail {
  readonly path: readonly (string | number)[];
  readonly code: string;
  readonly message: string;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: readonly ValidationDetail[];

  constructor(options: {
    code: ErrorCode;
    status: number;
    message: string;
    details?: readonly ValidationDetail[];
  }) {
    super(options.message);
    this.name = 'AppError';
    this.code = options.code;
    this.status = options.status;
    if (options.details) this.details = options.details;
  }
}

/**
 * Normalises Zod issues into the public validation detail shape. Zod paths can
 * contain symbols for map keys, which the API envelope does not accept.
 */
export function toValidationDetails(
  issues: readonly { path: readonly PropertyKey[]; code: string; message: string }[],
): readonly ValidationDetail[] {
  return issues.map((issue) => ({
    path: issue.path.filter(
      (segment): segment is string | number =>
        typeof segment === 'string' || typeof segment === 'number',
    ),
    code: issue.code,
    message: issue.message,
  }));
}
