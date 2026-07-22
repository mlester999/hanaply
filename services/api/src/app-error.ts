import type { ErrorCode } from '@hanaply/contracts';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: readonly {
    path: readonly (string | number)[];
    code: string;
    message: string;
  }[];

  constructor(options: {
    code: ErrorCode;
    status: number;
    message: string;
    details?: readonly { path: readonly (string | number)[]; code: string; message: string }[];
  }) {
    super(options.message);
    this.name = 'AppError';
    this.code = options.code;
    this.status = options.status;
    if (options.details) this.details = options.details;
  }
}
