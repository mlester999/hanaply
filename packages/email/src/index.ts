import type { EmailEnvironment } from '@hanaply/config';
import { Resend, type CreateEmailOptions, type ErrorResponse } from 'resend';
import { z } from 'zod';

export const emailCategories = Object.freeze([
  'authentication',
  'account',
  'job_alert',
  'daily_digest',
  'application_reminder',
  'administrative',
] as const);

export type EmailCategory = (typeof emailCategories)[number];

export const emailTemplateIds = Object.freeze([
  'verify-email',
  'password-reset',
  'password-changed',
  'welcome',
  'security-alert',
] as const);

export type EmailTemplateId = (typeof emailTemplateIds)[number];

const variableValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const emailMessageSchema = z
  .object({
    recipient: z.email(),
    templateId: z.enum(emailTemplateIds),
    templateVersion: z.literal('v1'),
    category: z.enum(emailCategories),
    idempotencyKey: z
      .string()
      .trim()
      .min(16)
      .max(256)
      .regex(/^[A-Za-z0-9:_-]+$/u, 'Use a safe opaque idempotency key.'),
    variables: z.record(z.string(), variableValueSchema),
  })
  .strict();

export type EmailMessage = z.infer<typeof emailMessageSchema>;

export interface RenderedEmail {
  templateId: EmailTemplateId;
  templateVersion: 'v1';
  category: EmailCategory;
  recipient: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailDeliveryReceipt {
  provider: 'disabled' | 'capture' | 'resend';
  status: 'disabled' | 'captured' | 'queued' | 'delivered' | 'failed';
  providerMessageId: string | null;
  templateId: EmailTemplateId;
  templateVersion: 'v1';
  recipientMasked: string;
  attempts: number;
  failureCode: 'timeout' | 'provider_rejected' | 'transport_error' | null;
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<EmailDeliveryReceipt>;
}

const expectedCategory: Readonly<Record<EmailTemplateId, EmailCategory>> = Object.freeze({
  'verify-email': 'authentication',
  'password-reset': 'authentication',
  'password-changed': 'authentication',
  welcome: 'account',
  'security-alert': 'authentication',
});

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function variable(
  message: EmailMessage,
  key: string,
  options: { required?: boolean; fallback?: string } = {},
): string {
  const value = message.variables[key];
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (options.required) throw new Error(`Email template variable ${key} is required.`);
  return options.fallback ?? '';
}

function safeLink(value: string): string {
  if (value.length > 2048) throw new Error('Email action URL is too long.');
  const url = new URL(value);
  const localHttp =
    url.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !localHttp) || url.username || url.password) {
    throw new Error('Email action URL must use HTTPS or a loopback local-development URL.');
  }
  return url.toString();
}

interface TemplateContent {
  subject: string;
  preview: string;
  heading: string;
  paragraphs: readonly string[];
  action?: { label: string; url: string };
  footer: string;
}

function templateContent(message: EmailMessage): TemplateContent {
  const name = variable(message, 'displayName', { fallback: 'there' });
  const expiresIn = variable(message, 'expiresIn', { fallback: 'one hour' });
  switch (message.templateId) {
    case 'verify-email':
      return {
        subject: 'Verify your Hanaply email',
        preview: 'Confirm your email address to finish securing your Hanaply account.',
        heading: 'Verify your email address',
        paragraphs: [
          `Hello ${name},`,
          'Confirm this email address to finish setting up your Hanaply account.',
          `This secure link expires in ${expiresIn}. If you did not create an account, you can ignore this message.`,
        ],
        action: {
          label: 'Verify Email',
          url: safeLink(variable(message, 'actionUrl', { required: true })),
        },
        footer: 'For your security, never forward this verification link.',
      };
    case 'password-reset':
      return {
        subject: 'Reset your Hanaply password',
        preview: 'Use this secure link to choose a new Hanaply password.',
        heading: 'Reset your password',
        paragraphs: [
          `Hello ${name},`,
          'We received a request to reset your Hanaply password.',
          `This secure link expires in ${expiresIn}. If you did not request a reset, leave your password unchanged and ignore this message.`,
        ],
        action: {
          label: 'Reset Password',
          url: safeLink(variable(message, 'actionUrl', { required: true })),
        },
        footer: 'Hanaply support will never ask you to share this password-reset link.',
      };
    case 'password-changed':
      return {
        subject: 'Your Hanaply password was changed',
        preview: 'Your Hanaply account password has been updated.',
        heading: 'Password changed',
        paragraphs: [
          `Hello ${name},`,
          'The password for your Hanaply account was changed successfully.',
          'If you did not make this change, contact the account owner immediately and secure your email account.',
        ],
        footer: 'This security message is always sent and cannot be disabled.',
      };
    case 'welcome':
      return {
        subject: 'Welcome to Hanaply',
        preview: 'Your verified Hanaply account is ready.',
        heading: 'Your account is ready',
        paragraphs: [
          `Hello ${name},`,
          'Your email is verified and your protected Hanaply account is ready.',
          'Career intelligence features remain locked until they are introduced in a reviewed product phase.',
        ],
        ...(variable(message, 'actionUrl')
          ? {
              action: {
                label: 'Open Dashboard',
                url: safeLink(variable(message, 'actionUrl', { required: true })),
              },
            }
          : {}),
        footer: 'You can manage optional email categories in your account settings.',
      };
    case 'security-alert': {
      const securityEvent = variable(message, 'securityEvent', { required: true });
      return {
        subject: 'Security notice for your Hanaply account',
        preview: 'A security-sensitive account event was recorded.',
        heading: 'Security notice',
        paragraphs: [
          `Hello ${name},`,
          `Hanaply recorded this account event: ${securityEvent}.`,
          'If you recognize this activity, no action is needed. If you do not, secure your account immediately.',
        ],
        ...(variable(message, 'actionUrl')
          ? {
              action: {
                label: 'Review Account Security',
                url: safeLink(variable(message, 'actionUrl', { required: true })),
              },
            }
          : {}),
        footer: 'This security message is always sent and cannot be disabled.',
      };
    }
  }
}

function htmlDocument(content: TemplateContent): string {
  const paragraphs = content.paragraphs
    .map(
      (paragraph) =>
        `<p style="margin:0 0 16px;color:#475467;font:16px/1.6 Arial,sans-serif">${escapeHtml(paragraph)}</p>`,
    )
    .join('');
  const action = content.action
    ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:24px 0"><tr><td style="border-radius:8px;background:#3157E8"><a href="${escapeHtml(content.action.url)}" style="display:inline-block;padding:13px 22px;color:#ffffff;font:bold 15px/1.2 Arial,sans-serif;text-decoration:none">${escapeHtml(content.action.label)}</a></td></tr></table><p style="margin:0 0 20px;color:#667085;font:13px/1.5 Arial,sans-serif;word-break:break-all">If the button does not work, copy this link:<br><a href="${escapeHtml(content.action.url)}" style="color:#1D2F8A">${escapeHtml(content.action.url)}</a></p>`
    : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(content.subject)}</title><style>@media(max-width:600px){.email-card{padding:24px!important}.email-shell{padding:16px!important}}</style></head><body style="margin:0;background:#F6F8FC"><div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(content.preview)}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#F6F8FC"><tr><td class="email-shell" align="center" style="padding:32px 16px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px"><tr><td style="padding:0 0 20px;color:#101828;font:bold 24px/1.2 Arial,sans-serif">Hanaply</td></tr><tr><td class="email-card" style="padding:40px;background:#ffffff;border:1px solid #E4E7EC;border-radius:16px"><div style="width:44px;height:4px;margin-bottom:24px;background:#22C7A9;border-radius:999px"></div><h1 style="margin:0 0 20px;color:#101828;font:bold 28px/1.25 Arial,sans-serif">${escapeHtml(content.heading)}</h1>${paragraphs}${action}<p style="margin:24px 0 0;padding-top:20px;color:#667085;border-top:1px solid #E4E7EC;font:13px/1.5 Arial,sans-serif">${escapeHtml(content.footer)}</p></td></tr><tr><td style="padding:20px 0;color:#667085;font:12px/1.5 Arial,sans-serif">Hanaply account services. This message does not contain product activity or payment claims.</td></tr></table></td></tr></table></body></html>`;
}

function textDocument(content: TemplateContent): string {
  return [
    'HANAPLY',
    '',
    content.heading,
    '',
    ...content.paragraphs,
    ...(content.action ? ['', `${content.action.label}:`, content.action.url] : []),
    '',
    content.footer,
    '',
    'Hanaply account services. This message does not contain product activity or payment claims.',
  ].join('\n');
}

export function renderEmailTemplate(input: EmailMessage): RenderedEmail {
  const message = emailMessageSchema.parse(input);
  if (message.category !== expectedCategory[message.templateId]) {
    throw new Error(
      `Template ${message.templateId} must use ${expectedCategory[message.templateId]}.`,
    );
  }
  const content = templateContent(message);
  const rendered = {
    templateId: message.templateId,
    templateVersion: message.templateVersion,
    category: message.category,
    recipient: message.recipient,
    subject: content.subject,
    html: htmlDocument(content),
    text: textDocument(content),
  } satisfies RenderedEmail;
  if (
    rendered.subject.includes('—') ||
    rendered.html.includes('—') ||
    rendered.text.includes('—')
  ) {
    throw new Error('Email templates cannot contain em dashes.');
  }
  return rendered;
}

export function maskEmailRecipient(recipient: string): string {
  const [local = '', domain = ''] = recipient.toLowerCase().split('@');
  const prefix = local.slice(0, Math.min(2, local.length));
  return `${prefix}${'*'.repeat(Math.max(3, Math.min(8, local.length - prefix.length)))}@${domain}`;
}

function receipt(
  message: EmailMessage,
  values: Pick<
    EmailDeliveryReceipt,
    'provider' | 'status' | 'providerMessageId' | 'attempts' | 'failureCode'
  >,
): EmailDeliveryReceipt {
  return {
    ...values,
    templateId: message.templateId,
    templateVersion: message.templateVersion,
    recipientMasked: maskEmailRecipient(message.recipient),
  };
}

export class DisabledEmailProvider implements EmailProvider {
  send(message: EmailMessage): Promise<EmailDeliveryReceipt> {
    renderEmailTemplate(message);
    return Promise.resolve(
      receipt(message, {
        provider: 'disabled',
        status: 'disabled',
        providerMessageId: null,
        attempts: 0,
        failureCode: null,
      }),
    );
  }
}

export class CaptureEmailProvider implements EmailProvider {
  private readonly messages: RenderedEmail[] = [];

  send(message: EmailMessage): Promise<EmailDeliveryReceipt> {
    this.messages.push(renderEmailTemplate(message));
    return Promise.resolve(
      receipt(message, {
        provider: 'capture',
        status: 'captured',
        providerMessageId: null,
        attempts: 1,
        failureCode: null,
      }),
    );
  }

  captured(): readonly RenderedEmail[] {
    return this.messages.map((message) => ({ ...message }));
  }

  clear(): void {
    this.messages.length = 0;
  }
}

interface ResendTransportResult {
  data: { id: string } | null;
  error: Pick<ErrorResponse, 'name' | 'statusCode'> | null;
}

export type ResendTransport = (
  payload: CreateEmailOptions,
  idempotencyKey: string,
) => Promise<ResendTransportResult>;

export interface ResendEmailProviderOptions {
  transport?: ResendTransport;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
  maximumAttempts?: number;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new Error('email_timeout'));
        }, milliseconds);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export class ResendEmailProvider implements EmailProvider {
  private readonly transport: ResendTransport;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly random: () => number;
  private readonly maximumAttempts: number;
  private readonly from: string;
  private readonly replyTo: string | undefined;
  private readonly timeoutMilliseconds: number;

  constructor(environment: EmailEnvironment, options: ResendEmailProviderOptions = {}) {
    if (
      environment.EMAIL_PROVIDER !== 'resend' ||
      !environment.EMAIL_ALLOW_LIVE_SENDS ||
      !environment.RESEND_API_KEY ||
      !environment.RESEND_FROM_ADDRESS
    ) {
      throw new Error('Resend email delivery is not safely configured.');
    }
    if (environment.HANAPLY_ENV === 'local' || environment.HANAPLY_ENV === 'test') {
      throw new Error('Resend email delivery is forbidden in local and test environments.');
    }
    this.from = environment.RESEND_FROM_ADDRESS;
    this.replyTo = environment.RESEND_REPLY_TO_ADDRESS;
    this.timeoutMilliseconds = environment.RESEND_REQUEST_TIMEOUT_MS;
    this.sleep = options.sleep ?? delay;
    this.random = options.random ?? Math.random;
    this.maximumAttempts = options.maximumAttempts ?? 3;
    if (
      !Number.isInteger(this.maximumAttempts) ||
      this.maximumAttempts < 1 ||
      this.maximumAttempts > 5
    ) {
      throw new Error('Email maximum attempts must be between 1 and 5.');
    }
    if (options.transport) {
      this.transport = options.transport;
    } else {
      const resend = new Resend(environment.RESEND_API_KEY);
      this.transport = async (payload, idempotencyKey) => {
        const response = await resend.emails.send(payload, { idempotencyKey });
        return {
          data: response.data ? { id: response.data.id } : null,
          error: response.error
            ? { name: response.error.name, statusCode: response.error.statusCode }
            : null,
        };
      };
    }
  }

  async send(messageInput: EmailMessage): Promise<EmailDeliveryReceipt> {
    const message = emailMessageSchema.parse(messageInput);
    const rendered = renderEmailTemplate(message);
    const payload: CreateEmailOptions = {
      from: this.from,
      to: [rendered.recipient],
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      ...(this.replyTo ? { replyTo: this.replyTo } : {}),
      tags: [
        { name: 'category', value: rendered.category },
        { name: 'template', value: rendered.templateId },
        { name: 'version', value: rendered.templateVersion },
      ],
    };
    let lastFailure: EmailDeliveryReceipt['failureCode'] = 'transport_error';
    for (let attempt = 1; attempt <= this.maximumAttempts; attempt += 1) {
      try {
        const result = await withTimeout(
          this.transport(payload, message.idempotencyKey),
          this.timeoutMilliseconds,
        );
        if (result.data) {
          return receipt(message, {
            provider: 'resend',
            status: 'queued',
            providerMessageId: result.data.id,
            attempts: attempt,
            failureCode: null,
          });
        }
        lastFailure = 'provider_rejected';
        const statusCode = result.error?.statusCode;
        const retryable =
          statusCode === 429 ||
          (statusCode !== null && statusCode !== undefined && statusCode >= 500);
        if (!retryable) {
          return receipt(message, {
            provider: 'resend',
            status: 'failed',
            providerMessageId: null,
            attempts: attempt,
            failureCode: lastFailure,
          });
        }
      } catch (error) {
        lastFailure =
          error instanceof Error && error.message === 'email_timeout'
            ? 'timeout'
            : 'transport_error';
      }
      if (attempt < this.maximumAttempts) {
        const ceiling = Math.min(250 * 2 ** (attempt - 1), 2_000);
        await this.sleep(Math.floor(this.random() * ceiling));
      }
    }
    return receipt(message, {
      provider: 'resend',
      status: 'failed',
      providerMessageId: null,
      attempts: this.maximumAttempts,
      failureCode: lastFailure,
    });
  }
}

export function createEmailProvider(environment: EmailEnvironment): EmailProvider {
  if (environment.EMAIL_PROVIDER === 'disabled') return new DisabledEmailProvider();
  if (environment.EMAIL_PROVIDER === 'capture') return new CaptureEmailProvider();
  return new ResendEmailProvider(environment);
}
