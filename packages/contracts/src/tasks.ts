import { z } from 'zod';

export const taskEnvelopeSchema = z.object({
  id: z.uuid(),
  type: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_.-]+$/u),
  version: z.number().int().positive(),
  correlationId: z.uuid(),
  idempotencyKey: z.string().trim().min(8).max(200),
  createdAt: z.iso.datetime({ offset: true }),
  attempt: z.number().int().nonnegative(),
  maxAttempts: z.number().int().min(1).max(20).default(5),
  payload: z.record(z.string(), z.unknown()),
});

export const deadLetterMetadataSchema = taskEnvelopeSchema.omit({ payload: true }).extend({
  failedAt: z.iso.datetime({ offset: true }),
  errorCode: z.string().trim().min(1),
  errorMessage: z.string().trim().max(500),
});

export type TaskEnvelope = z.infer<typeof taskEnvelopeSchema>;
export type DeadLetterMetadata = z.infer<typeof deadLetterMetadataSchema>;
