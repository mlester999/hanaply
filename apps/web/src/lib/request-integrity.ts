import { headers } from 'next/headers';

import { getBrowserEnvironment } from '@/lib/environment';

export interface MutationOriginInput {
  origin: string | null;
  host: string | null;
  expectedOrigin: string;
}

export function isTrustedMutationOrigin(input: MutationOriginInput): boolean {
  if (!input.origin || !input.host || input.host.includes(',')) return false;
  try {
    const actual = new URL(input.origin);
    const expected = new URL(input.expectedOrigin);
    return (
      actual.origin === expected.origin &&
      actual.host.toLowerCase() === input.host.trim().toLowerCase() &&
      ['http:', 'https:'].includes(actual.protocol)
    );
  } catch {
    return false;
  }
}

export async function assertTrustedMutationOrigin(): Promise<void> {
  const requestHeaders = await headers();
  const host = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host');
  if (
    !isTrustedMutationOrigin({
      origin: requestHeaders.get('origin'),
      host,
      expectedOrigin: getBrowserEnvironment().NEXT_PUBLIC_APP_URL,
    })
  ) {
    throw new Error('Request origin could not be verified');
  }
}
