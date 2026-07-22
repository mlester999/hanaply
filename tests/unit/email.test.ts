import { parseEmailEnvironment } from '@hanaply/config';
import {
  CaptureEmailProvider,
  createEmailProvider,
  DisabledEmailProvider,
  type EmailMessage,
  emailTemplateIds,
  renderEmailTemplate,
  ResendEmailProvider,
} from '@hanaply/email';
import { describe, expect, it } from 'vitest';

function message(templateId: (typeof emailTemplateIds)[number]): EmailMessage {
  const category = templateId === 'welcome' ? 'account' : 'authentication';
  return {
    recipient: 'member@example.com',
    templateId,
    templateVersion: 'v1',
    category,
    idempotencyKey: `email:${templateId}:30000000-0000-4000-8000-000000000001`,
    variables: {
      displayName: 'Ana & Kai',
      actionUrl: 'https://hanaply.example/auth/callback?token_hash=opaque-value',
      expiresIn: 'one hour',
      securityEvent: 'Password changed',
    },
  };
}

const resendEnvironment = parseEmailEnvironment({
  HANAPLY_ENV: 'staging',
  EMAIL_PROVIDER: 'resend',
  EMAIL_ALLOW_LIVE_SENDS: 'true',
  RESEND_API_KEY: 're_test_not_a_live_secret',
  RESEND_FROM_ADDRESS: 'Hanaply <no-reply@example.com>',
  RESEND_REPLY_TO_ADDRESS: 'support@example.com',
  RESEND_REQUEST_TIMEOUT_MS: '1000',
});

describe('email templates and providers', () => {
  it.each(emailTemplateIds)('renders accessible HTML and plain text for %s', (templateId) => {
    const rendered = renderEmailTemplate(message(templateId));
    expect(rendered.subject).toBeTruthy();
    expect(rendered.html).toContain('<!doctype html>');
    expect(rendered.html).toContain('lang="en"');
    expect(rendered.html).toContain('Ana &amp; Kai');
    expect(rendered.text).toContain('HANAPLY');
    expect(rendered.text).toContain('Ana & Kai');
    expect(`${rendered.subject}${rendered.html}${rendered.text}`).not.toContain('—');
    expect(rendered.html).not.toContain('<img');
  });

  it('rejects unsafe links and incorrect category conventions', () => {
    expect(() =>
      renderEmailTemplate({
        ...message('verify-email'),
        variables: { actionUrl: 'javascript:alert(1)' },
      }),
    ).toThrow(/HTTPS/u);
    expect(() =>
      renderEmailTemplate({ ...message('password-reset'), category: 'account' }),
    ).toThrow(/must use authentication/u);
  });

  it('keeps disabled and capture modes deterministic and secret-free', async () => {
    const disabled = await new DisabledEmailProvider().send(message('password-changed'));
    expect(disabled).toMatchObject({ provider: 'disabled', status: 'disabled', attempts: 0 });

    const provider = createEmailProvider(
      parseEmailEnvironment({ HANAPLY_ENV: 'local', EMAIL_PROVIDER: 'capture' }),
    );
    expect(provider).toBeInstanceOf(CaptureEmailProvider);
    const capture = provider as CaptureEmailProvider;
    const captured = await capture.send(message('verify-email'));
    expect(captured).toMatchObject({
      provider: 'capture',
      status: 'captured',
      recipientMasked: 'me****@example.com',
      providerMessageId: null,
    });
    expect(JSON.stringify(captured)).not.toContain('opaque-value');
    expect(capture.captured()).toHaveLength(1);
    capture.clear();
    expect(capture.captured()).toHaveLength(0);
  });

  it('sends HTML and text through Resend with an idempotency key', async () => {
    let suppliedKey: string | undefined;
    let suppliedSubject: string | undefined;
    const provider = new ResendEmailProvider(resendEnvironment, {
      transport: (payload, idempotencyKey) => {
        suppliedKey = idempotencyKey;
        suppliedSubject = payload.subject;
        return Promise.resolve({ data: { id: 'email_123' }, error: null });
      },
    });
    const delivered = await provider.send(message('welcome'));
    expect(delivered).toMatchObject({
      provider: 'resend',
      status: 'queued',
      providerMessageId: 'email_123',
      attempts: 1,
      failureCode: null,
    });
    expect(suppliedKey).toContain('email:welcome:');
    expect(suppliedSubject).toBe('Welcome to Hanaply');
  });

  it('retries transient provider failures with bounded jitter', async () => {
    let attempts = 0;
    const waits: number[] = [];
    const provider = new ResendEmailProvider(resendEnvironment, {
      random: () => 0.5,
      sleep: (milliseconds) => {
        waits.push(milliseconds);
        return Promise.resolve();
      },
      transport: () => {
        attempts += 1;
        return Promise.resolve(
          attempts < 3
            ? { data: null, error: { name: 'rate_limit_exceeded', statusCode: 503 } }
            : { data: { id: 'email_retry' }, error: null },
        );
      },
    });
    const delivered = await provider.send(message('security-alert'));
    expect(delivered).toMatchObject({ status: 'queued', attempts: 3 });
    expect(waits).toEqual([125, 250]);
  });

  it('fails honestly without retrying a permanent provider rejection', async () => {
    let attempts = 0;
    const provider = new ResendEmailProvider(resendEnvironment, {
      transport: () => {
        attempts += 1;
        return Promise.resolve({
          data: null,
          error: { name: 'validation_error', statusCode: 422 },
        });
      },
    });
    const failed = await provider.send(message('password-changed'));
    expect(failed).toMatchObject({
      status: 'failed',
      attempts: 1,
      failureCode: 'provider_rejected',
    });
    expect(attempts).toBe(1);
  });

  it('reports timeouts without exposing credentials or message content', async () => {
    const provider = new ResendEmailProvider(
      { ...resendEnvironment, RESEND_REQUEST_TIMEOUT_MS: 5 },
      {
        maximumAttempts: 1,
        transport: () => new Promise(() => undefined),
      },
    );
    const failed = await provider.send(message('password-reset'));
    expect(failed).toMatchObject({ status: 'failed', attempts: 1, failureCode: 'timeout' });
    const metadata = JSON.stringify(failed);
    expect(metadata).not.toContain('re_test_not_a_live_secret');
    expect(metadata).not.toContain('opaque-value');
  });

  it('refuses to construct live delivery when the explicit gate is absent', () => {
    expect(
      () =>
        new ResendEmailProvider({
          ...resendEnvironment,
          EMAIL_ALLOW_LIVE_SENDS: false,
        }),
    ).toThrow(/not safely configured/u);
  });
});
