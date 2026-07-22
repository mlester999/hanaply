import { z } from 'zod';

export const errorCodeSchema = z.enum([
  'VALIDATION_ERROR',
  'AUTHENTICATION_REQUIRED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'ENTITLEMENT_REQUIRED',
  'SUBSCRIPTION_INACTIVE',
  'ACCOUNT_SUSPENDED',
  'INTERNAL_ERROR',
  'SERVICE_UNAVAILABLE',
]);

export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const responseMetaSchema = z.object({
  apiVersion: z.literal('v1'),
  requestId: z.uuid(),
});

export const validationDetailSchema = z.object({
  path: z.array(z.union([z.string(), z.number()])),
  code: z.string().trim().min(1),
  message: z.string().trim().min(1),
});

export const apiErrorEnvelopeSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string().trim().min(1),
    details: z.array(validationDetailSchema).optional(),
  }),
  meta: responseMetaSchema,
});

export type ApiErrorEnvelope = z.infer<typeof apiErrorEnvelopeSchema>;

export function successEnvelopeSchema<TSchema extends z.ZodType>(data: TSchema) {
  return z.object({ data, meta: responseMetaSchema });
}
