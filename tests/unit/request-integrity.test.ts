import { isTrustedMutationOrigin } from '../../apps/web/src/lib/request-integrity.js';
import { describe, expect, it } from 'vitest';

describe('web mutation origin checks', () => {
  it('accepts the configured same-origin host', () => {
    expect(
      isTrustedMutationOrigin({
        origin: 'https://hanaply.example',
        host: 'hanaply.example',
        expectedOrigin: 'https://hanaply.example',
      }),
    ).toBe(true);
  });

  it.each([
    [null, 'hanaply.example'],
    ['https://evil.example', 'hanaply.example'],
    ['https://hanaply.example', 'evil.example'],
    ['https://hanaply.example', 'hanaply.example, evil.example'],
  ])('rejects an untrusted origin/host pair', (origin, host) => {
    expect(
      isTrustedMutationOrigin({ origin, host, expectedOrigin: 'https://hanaply.example' }),
    ).toBe(false);
  });
});
