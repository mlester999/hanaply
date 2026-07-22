import {
  deadLetterMetadataSchema,
  taskEnvelopeSchema,
  type DeadLetterMetadata,
  type TaskEnvelope,
} from '@hanaply/contracts';

export interface TaskQueue {
  enqueue(task: TaskEnvelope): Promise<void>;
  dequeue(signal?: AbortSignal): Promise<TaskEnvelope | null>;
  deadLetter(task: TaskEnvelope, errorCode: string, errorMessage: string): Promise<void>;
  close(): Promise<void>;
}

export class DisabledQueueAdapter implements TaskQueue {
  enqueue(_task: TaskEnvelope): Promise<void> {
    void _task;
    return Promise.reject(new Error('Task enqueueing is disabled in Phase 0'));
  }

  dequeue(_signal?: AbortSignal): Promise<null> {
    void _signal;
    return Promise.resolve(null);
  }

  deadLetter(_task: TaskEnvelope, _errorCode: string, _errorMessage: string): Promise<void> {
    void _task;
    void _errorCode;
    void _errorMessage;
    return Promise.reject(new Error('Dead-letter storage is disabled in Phase 0'));
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

export class InMemoryTaskQueue implements TaskQueue {
  private readonly tasks: TaskEnvelope[] = [];
  private readonly deadLetters: DeadLetterMetadata[] = [];

  enqueue(task: TaskEnvelope): Promise<void> {
    this.tasks.push(taskEnvelopeSchema.parse(task));
    return Promise.resolve();
  }

  dequeue(_signal?: AbortSignal): Promise<TaskEnvelope | null> {
    void _signal;
    return Promise.resolve(this.tasks.shift() ?? null);
  }

  deadLetter(task: TaskEnvelope, errorCode: string, errorMessage: string): Promise<void> {
    const { payload: _sensitivePayload, ...safeTaskMetadata } = taskEnvelopeSchema.parse(task);
    void _sensitivePayload;
    this.deadLetters.push(
      deadLetterMetadataSchema.parse({
        ...safeTaskMetadata,
        failedAt: new Date().toISOString(),
        errorCode,
        errorMessage: errorMessage.slice(0, 500),
      }),
    );
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.tasks.length = 0;
    return Promise.resolve();
  }

  deadLetterCount(): number {
    return this.deadLetters.length;
  }

  deadLetterMetadata(): readonly DeadLetterMetadata[] {
    return this.deadLetters.map((metadata) => ({ ...metadata }));
  }
}

export function retryDelayMilliseconds(
  attempt: number,
  options: { baseMs?: number; maximumMs?: number; random?: () => number } = {},
): number {
  if (!Number.isInteger(attempt) || attempt < 1)
    throw new RangeError('Attempt must be a positive integer');
  const baseMs = options.baseMs ?? 1_000;
  const maximumMs = options.maximumMs ?? 15 * 60 * 1_000;
  const random = options.random ?? Math.random;
  const ceiling = Math.min(maximumMs, baseMs * 2 ** (attempt - 1));
  return Math.floor(random() * ceiling);
}

export function isRetryableTaskError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return !['VALIDATION_ERROR', 'FORBIDDEN', 'UNSUPPORTED_TASK_VERSION'].includes(error.name);
}
