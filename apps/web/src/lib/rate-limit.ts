import { createHash } from 'node:crypto';

import type { AuthRateLimitBucket } from '@hanaply/auth';
import { headers } from 'next/headers';

import { getWebServerEnvironment } from '@/lib/environment';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

function digest(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('\u0000')).digest('hex');
}

function clientAddress(forwardedFor: string | null, realIp: string | null): string {
  const forwarded = forwardedFor?.split(',')[0]?.trim();
  if (forwarded) return forwarded;
  const direct = realIp?.trim();
  if (direct) return direct;
  return 'unknown';
}

async function consume(bucket: AuthRateLimitBucket, keyHash: string): Promise<RateLimitDecision> {
  const supabase = await createSupabaseServerClient();
  const result = await supabase.rpc('consume_auth_rate_limit', {
    rate_bucket: bucket,
    rate_key_hash: keyHash,
  });
  if (result.error || !Array.isArray(result.data) || !result.data[0]) {
    return { allowed: false, retryAfterSeconds: 60 };
  }
  const row = result.data[0] as { allowed?: unknown; retry_after_seconds?: unknown };
  return {
    allowed: row.allowed === true,
    retryAfterSeconds: typeof row.retry_after_seconds === 'number' ? row.retry_after_seconds : 60,
  };
}

export async function consumeWebRateLimit(
  bucket: AuthRateLimitBucket,
  subject: string,
): Promise<RateLimitDecision> {
  const requestHeaders = await headers();
  const address = clientAddress(
    requestHeaders.get('x-forwarded-for'),
    requestHeaders.get('x-real-ip'),
  );
  const environment = getWebServerEnvironment();
  const normalizedSubject = subject.normalize('NFKC').trim().toLowerCase();
  const [addressDecision, subjectDecision] = await Promise.all([
    consume(bucket, digest([environment.AUTH_RATE_LIMIT_PEPPER, bucket, 'address', address])),
    consume(
      bucket,
      digest([environment.AUTH_RATE_LIMIT_PEPPER, bucket, 'subject', address, normalizedSubject]),
    ),
  ]);
  return {
    allowed: addressDecision.allowed && subjectDecision.allowed,
    retryAfterSeconds: Math.max(
      addressDecision.retryAfterSeconds,
      subjectDecision.retryAfterSeconds,
    ),
  };
}
