import { appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

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
  'email-changed',
  'welcome',
  'security-alert',
  'payment-submission-received',
  'payment-under-review',
  'payment-more-information-required',
  'payment-resubmitted',
  'payment-approved',
  'payment-rejected',
  'payment-refund-recorded',
  'payment-approval-reversed',
  'subscription-activated',
  'subscription-renewed',
  'subscription-expires-soon',
  'subscription-expired',
  'subscription-corrected',
  'job-alert',
  'daily-digest',
] as const);

export type EmailTemplateId = (typeof emailTemplateIds)[number];

/**
 * Variables are bounded on purpose: an outbox row is written by a database
 * function and a queue row must never be able to smuggle an unbounded payload
 * into a rendered message.
 *
 * Exactly two levels of plain objects are accepted. The first level is the
 * `variables` record itself; the second level is one entry inside an array such
 * as `jobs`. An entry may hold scalars and flat scalar lists only, so a third
 * level of nesting is rejected.
 */
const variableScalarSchema = z.union([z.string().max(4_096), z.number(), z.boolean(), z.null()]);
const variableScalarListSchema = z.array(variableScalarSchema).max(20);
const variableEntrySchema = z.record(
  z.string(),
  z.union([variableScalarSchema, variableScalarListSchema]),
);
const variableValueSchema = z.union([
  variableScalarSchema,
  variableScalarListSchema,
  variableEntrySchema,
  z.array(variableEntrySchema).max(20),
]);

export { variableValueSchema as emailVariableValueSchema };

export type EmailVariableEntry = z.infer<typeof variableEntrySchema>;

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
  preheader: string;
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
  'email-changed': 'authentication',
  welcome: 'account',
  'security-alert': 'authentication',
  'payment-submission-received': 'administrative',
  'payment-under-review': 'administrative',
  'payment-more-information-required': 'administrative',
  'payment-resubmitted': 'administrative',
  'payment-approved': 'administrative',
  'payment-rejected': 'administrative',
  'payment-refund-recorded': 'administrative',
  'payment-approval-reversed': 'administrative',
  'subscription-activated': 'administrative',
  'subscription-renewed': 'administrative',
  'subscription-expires-soon': 'administrative',
  'subscription-expired': 'administrative',
  'subscription-corrected': 'administrative',
  'job-alert': 'job_alert',
  'daily-digest': 'daily_digest',
});

/** Resolves the category a template id must use, or null when it is unknown. */
export function emailTemplateCategory(templateId: string): EmailCategory | null {
  const known = emailTemplateIds.find((candidate) => candidate === templateId);
  return known ? expectedCategory[known] : null;
}

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

interface TemplateItem {
  readonly title: string;
  readonly subtitle: string;
  readonly emphasis: readonly string[];
  readonly details: readonly string[];
}

interface TemplateContent {
  subject: string;
  preview: string;
  heading: string;
  paragraphs: readonly string[];
  items?: readonly TemplateItem[];
  action?: { label: string; url: string };
  footer: string;
  signature?: string;
}

const defaultSignature =
  'Hanaply account and subscription services. Private payment proof is never attached to email.';

function activationAction(message: EmailMessage, label = 'Open Activation Center') {
  return {
    label,
    url: safeLink(variable(message, 'actionUrl', { required: true })),
  };
}

function planName(message: EmailMessage): string {
  const code = variable(message, 'planCode', { fallback: 'subscription' });
  const names: Readonly<Record<string, string>> = {
    plus_monthly: 'Plus monthly',
    plus_annual: 'Plus annual',
    pro_monthly: 'Pro monthly',
    pro_annual: 'Pro annual',
  };
  return names[code] ?? 'Hanaply subscription';
}

function amount(message: EmailMessage, key = 'amountMinor'): string {
  const raw = message.variables[key];
  const currency = variable(message, 'currency', { fallback: 'PHP' });
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 0) {
    return 'the recorded amount';
  }
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency }).format(raw / 100);
}

function manilaDate(message: EmailMessage, key: string): string {
  const raw = variable(message, key, { required: true });
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.valueOf())) throw new Error(`Email template variable ${key} is invalid.`);
  return parsed.toLocaleString('en-PH', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Asia/Manila',
  });
}

const paymentFooter =
  'Payment proof and private payment details are available only inside your protected Hanaply account.';
const subscriptionFooter =
  'Hanaply manual subscriptions do not renew automatically. Pay only through approved instructions in your Activation Center.';

// ---------------------------------------------------------------------------
// Opportunity notifications
// ---------------------------------------------------------------------------

const jobAlertFooter =
  'You can turn job alert emails off at any time in your Hanaply notification settings.';
const dailyDigestFooter =
  'You can turn the daily digest off at any time in your Hanaply notification settings.';
const notificationSignature =
  'Hanaply career intelligence. Confirm every detail on the employer posting before you apply.';

const remoteStateLabels: Readonly<Record<string, string>> = {
  remote: 'Remote',
  hybrid: 'Hybrid',
  onsite: 'On-site',
};

const verdictLabels: Readonly<Record<string, string>> = {
  strong_match: 'Strong match',
  good_match: 'Good match',
  stretch: 'Stretch',
  weak_match: 'Weak match',
  not_recommended: 'Not recommended',
};

function isVariableEntry(value: unknown): value is EmailVariableEntry {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Listing text arrives from third-party sources, so it is normalized before it
 * is interpolated: whitespace collapses, and an em dash becomes a hyphen so a
 * source title can never break the house rule that rendered mail contains none.
 */
function listingText(value: string): string {
  return value.replaceAll('—', '-').replace(/\s+/gu, ' ').trim();
}

function entryText(entry: EmailVariableEntry, key: string): string {
  const value = entry[key];
  return typeof value === 'string' ? listingText(value) : '';
}

function entryNumber(entry: EmailVariableEntry, key: string): number | null {
  const value = entry[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function messageNumber(message: EmailMessage, key: string): number | null {
  const value = message.variables[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function jobEntries(message: EmailMessage): readonly EmailVariableEntry[] {
  const value = message.variables.jobs;
  if (!Array.isArray(value)) return [];
  return value.filter((entry) => isVariableEntry(entry));
}

/**
 * The rendered list is the truth of what the reader can see, so the count
 * follows the array whenever it is present and only falls back to the recorded
 * count when nothing could be rendered.
 */
function opportunityCount(message: EmailMessage, jobs: readonly EmailVariableEntry[]): number {
  if (jobs.length > 0) return jobs.length;
  const reported = messageNumber(message, 'jobCount');
  return reported !== null && reported > 0 ? Math.floor(reported) : 0;
}

function countLabel(count: number, singular: string, plural: string): string {
  return `${count.toLocaleString('en-PH')} ${count === 1 ? singular : plural}`;
}

function verdictLabel(verdict: string): string {
  return verdictLabels[verdict] ?? verdict.replaceAll('_', ' ');
}

function matchLine(entry: EmailVariableEntry): string {
  const parts: string[] = [];
  const score = entryNumber(entry, 'score');
  if (score !== null) parts.push(`${Math.round(score)}% match`);
  const verdict = entryText(entry, 'verdict');
  if (verdict !== '') parts.push(verdictLabel(verdict));
  return parts.join(' · ');
}

function locationLine(entry: EmailVariableEntry): string {
  const remote = remoteStateLabels[entryText(entry, 'remoteState').toLowerCase()] ?? '';
  const location = entryText(entry, 'locationRaw');
  if (remote !== '' && location !== '') return `${remote} · ${location}`;
  if (remote !== '') return remote;
  if (location !== '') return location;
  return 'Location not stated';
}

function formatMinor(value: number, currency: string | null): string {
  const amount = value / 100;
  if (currency === null) return amount.toLocaleString('en-PH', { maximumFractionDigits: 2 });
  try {
    return new Intl.NumberFormat('en-PH', { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString('en-PH', { maximumFractionDigits: 2 })}`;
  }
}

function salaryLine(entry: EmailVariableEntry): string {
  const minimum = entryNumber(entry, 'salaryMinMinor');
  const maximum = entryNumber(entry, 'salaryMaxMinor');
  if (minimum === null && maximum === null) return '';
  const stated = entryText(entry, 'salaryCurrency');
  const currency = /^[A-Z]{3}$/u.test(stated) ? stated : null;
  const note = currency === null ? ' (currency not stated)' : '';
  const formattedMinimum =
    minimum !== null && Number.isSafeInteger(minimum) && minimum >= 0
      ? formatMinor(minimum, currency)
      : null;
  const formattedMaximum =
    maximum !== null && Number.isSafeInteger(maximum) && maximum >= 0
      ? formatMinor(maximum, currency)
      : null;
  if (
    formattedMinimum !== null &&
    formattedMaximum !== null &&
    formattedMinimum !== formattedMaximum
  ) {
    return `Salary: ${formattedMinimum} to ${formattedMaximum}${note}`;
  }
  if (formattedMinimum !== null) return `Salary: from ${formattedMinimum}${note}`;
  if (formattedMaximum !== null) return `Salary: up to ${formattedMaximum}${note}`;
  return '';
}

function opportunityItem(
  entry: EmailVariableEntry,
  options: { includeSalary: boolean },
): TemplateItem {
  const emphasis = [matchLine(entry)].filter((line) => line !== '');
  const details = [locationLine(entry)];
  if (options.includeSalary) {
    const salary = salaryLine(entry);
    if (salary !== '') details.push(salary);
  }
  return {
    title: entryText(entry, 'title') || 'Untitled opportunity',
    subtitle: entryText(entry, 'companyName') || 'Company not stated',
    emphasis,
    details,
  };
}

/**
 * The radar action is always the radar on our own origin. A listing URL is
 * never a redirect target, so an opportunity email cannot move a reader to a
 * third-party apply page. A message that arrives without a radar URL still
 * renders; it simply carries no button.
 */
function radarAction(message: EmailMessage): { label: string; url: string } | undefined {
  const candidate = variable(message, 'radarUrl');
  if (candidate === '') return undefined;
  const url = safeLink(candidate);
  if (new URL(url).pathname !== '/dashboard/radar') {
    throw new Error('The opportunity email action must link to the Hanaply radar.');
  }
  return { label: 'Open Job Radar', url };
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
    case 'email-changed':
      return {
        subject: 'Your Hanaply email address was changed',
        preview: 'The email address for your Hanaply account has been updated.',
        heading: 'Email address changed',
        paragraphs: [
          `Hello ${name},`,
          'The email address for your Hanaply account was changed successfully.',
          'If you did not make this change, secure your email account and contact the Hanaply account owner immediately.',
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
    case 'payment-submission-received':
      return {
        subject: 'We received your Hanaply payment submission',
        preview: 'Your manual payment is waiting for review and has not activated access yet.',
        heading: 'Payment submitted for review',
        paragraphs: [
          `Hello ${name},`,
          `We received your ${planName(message)} submission for ${amount(message)}.`,
          'Your payment is waiting for manual review. Submission does not guarantee approval and does not activate paid access.',
        ],
        action: activationAction(message, 'Track Payment Status'),
        footer: paymentFooter,
      };
    case 'payment-under-review':
      return {
        subject: 'Your Hanaply payment is under review',
        preview: 'An authorized reviewer has started checking your payment submission.',
        heading: 'Payment review started',
        paragraphs: [
          `Hello ${name},`,
          'An authorized Hanaply reviewer has started checking your payment submission.',
          'Paid access remains unchanged until the review is approved.',
        ],
        action: activationAction(message, 'Track Payment Status'),
        footer: paymentFooter,
      };
    case 'payment-more-information-required':
      return {
        subject: 'More information is needed for your Hanaply payment',
        preview: 'Open your Activation Center to review the request and resubmit your payment.',
        heading: 'Please update your payment submission',
        paragraphs: [
          `Hello ${name},`,
          variable(message, 'publicMessage', { required: true }),
          'Open your Activation Center to update the allowed details or proof, add your response, and resubmit for review.',
        ],
        action: activationAction(message, 'Respond in Activation Center'),
        footer: paymentFooter,
      };
    case 'payment-resubmitted':
      return {
        subject: 'Your Hanaply payment was resubmitted',
        preview: 'Your updated payment information is waiting for another review.',
        heading: 'Payment resubmitted',
        paragraphs: [
          `Hello ${name},`,
          'We received your updated payment information and returned it to the review queue.',
          'Paid access remains unchanged until an authorized reviewer approves the payment.',
        ],
        action: activationAction(message, 'Track Payment Status'),
        footer: paymentFooter,
      };
    case 'payment-approved':
      return {
        subject: 'Your Hanaply payment was approved',
        preview: 'Your manual payment was approved and the linked subscription was updated.',
        heading: 'Payment approved',
        paragraphs: [
          `Hello ${name},`,
          `Your ${planName(message)} payment for ${amount(message)} was approved.`,
          `Your current paid access is recorded through ${manilaDate(message, 'subscriptionEndsAt')}.`,
        ],
        action: activationAction(message, 'View Subscription'),
        footer: subscriptionFooter,
      };
    case 'payment-rejected':
      return {
        subject: 'Your Hanaply payment was not approved',
        preview: 'Review the recorded decision in your protected Activation Center.',
        heading: 'Payment not approved',
        paragraphs: [
          `Hello ${name},`,
          variable(message, 'publicMessage', { required: true }),
          'This decision did not activate or change paid access. You can review the complete status history in your account.',
        ],
        action: activationAction(message, 'Review Payment Status'),
        footer: paymentFooter,
      };
    case 'payment-refund-recorded': {
      const impact = variable(message, 'subscriptionImpact', { fallback: 'none' });
      return {
        subject: 'A refund was recorded for your Hanaply payment',
        preview: 'An external refund record was added to your Hanaply payment history.',
        heading: 'Refund recorded',
        paragraphs: [
          `Hello ${name},`,
          `Hanaply recorded an externally completed refund for ${amount(message, 'refundedAmountMinor')}. Hanaply did not move money.`,
          impact === 'end_access_now'
            ? 'The recorded refund ended the linked subscription access.'
            : 'The recorded refund did not change the linked subscription access.',
        ],
        action: activationAction(message, 'Review Payment History'),
        footer: paymentFooter,
      };
    }
    case 'payment-approval-reversed':
      return {
        subject: 'A Hanaply payment approval was reversed',
        preview: 'An incorrect approval was reversed and its linked access was ended.',
        heading: 'Payment approval reversed',
        paragraphs: [
          `Hello ${name},`,
          'An administrator reversed an incorrect payment approval and ended the subscription access created by that approval.',
          'Review your protected payment history or contact support if you need help understanding this correction.',
        ],
        action: activationAction(message, 'Review Payment History'),
        footer: paymentFooter,
      };
    case 'subscription-activated':
      return {
        subject: 'Your Hanaply subscription is active',
        preview: 'Your paid Hanaply access is now active for the approved subscription term.',
        heading: 'Subscription activated',
        paragraphs: [
          `Hello ${name},`,
          `Your ${planName(message)} subscription is active from ${manilaDate(message, 'startsAt')} through ${manilaDate(message, 'endsAt')}.`,
          'Your entitlements are evaluated from this authoritative access window.',
        ],
        action: activationAction(message, 'View Subscription'),
        footer: subscriptionFooter,
      };
    case 'subscription-renewed':
      return {
        subject: 'Your Hanaply subscription was renewed',
        preview: 'Your approved renewal extended the authoritative subscription term.',
        heading: 'Subscription renewed',
        paragraphs: [
          `Hello ${name},`,
          `Your ${planName(message)} subscription now runs through ${manilaDate(message, 'endsAt')}.`,
          'The renewal extends from the existing active term when that term has not yet ended.',
        ],
        action: activationAction(message, 'View Subscription'),
        footer: subscriptionFooter,
      };
    case 'subscription-expires-soon':
      return {
        subject: 'Your Hanaply subscription expires soon',
        preview: 'Review your subscription end date and manual renewal options.',
        heading: 'Subscription expires soon',
        paragraphs: [
          `Hello ${name},`,
          `Your ${planName(message)} subscription is scheduled to end on ${manilaDate(message, 'endsAt')}.`,
          'Renewal is manual. Submit a new payment early if you want an authorized reviewer to extend your access.',
        ],
        action: activationAction(message, 'Review Renewal Options'),
        footer: subscriptionFooter,
      };
    case 'subscription-expired':
      return {
        subject: 'Your Hanaply subscription has expired',
        preview: 'Paid entitlements are no longer active after the recorded subscription end time.',
        heading: 'Subscription expired',
        paragraphs: [
          `Hello ${name},`,
          `Your ${planName(message)} subscription ended on ${manilaDate(message, 'endsAt')}.`,
          'Paid entitlements are no longer active. You may submit a new manual payment for review from your Activation Center.',
        ],
        action: activationAction(message, 'Review Activation Options'),
        footer: subscriptionFooter,
      };
    case 'subscription-corrected':
      return {
        subject: 'Your Hanaply subscription dates were corrected',
        preview: 'An audited correction changed the authoritative subscription access window.',
        heading: 'Subscription dates corrected',
        paragraphs: [
          `Hello ${name},`,
          `Your ${planName(message)} access window is now recorded from ${manilaDate(message, 'startsAt')} through ${manilaDate(message, 'endsAt')}.`,
          'Your current entitlements are evaluated from these corrected dates and the recorded subscription status.',
        ],
        action: activationAction(message, 'View Subscription'),
        footer: subscriptionFooter,
      };
    case 'job-alert': {
      const jobs = jobEntries(message);
      const count = opportunityCount(message, jobs);
      const action = radarAction(message);
      return {
        subject:
          count === 1
            ? 'A new strong match on Hanaply'
            : count > 1
              ? `${count} new strong matches on Hanaply`
              : 'New matches on your Hanaply radar',
        preview:
          count > 0
            ? `${countLabel(count, 'opportunity', 'opportunities')} cleared your alert threshold.`
            : 'Open your radar to review the latest opportunities.',
        heading: 'New matches on your radar',
        paragraphs: [
          `Hello ${name},`,
          count > 0
            ? `${countLabel(count, 'opportunity', 'opportunities')} cleared your relevance threshold in the latest scan.`
            : 'Your radar recorded new opportunities in the latest scan.',
          'Open the radar to review why each match scored the way it did, then save the ones worth pursuing.',
        ],
        items: jobs.map((entry) => opportunityItem(entry, { includeSalary: true })),
        ...(action ? { action } : {}),
        footer: jobAlertFooter,
        signature: notificationSignature,
      };
    }
    case 'daily-digest': {
      const jobs = jobEntries(message);
      const count = opportunityCount(message, jobs);
      const localDay = variable(message, 'localDay', { fallback: 'today' });
      const savedCount = Math.max(0, Math.floor(messageNumber(message, 'savedCount') ?? 0));
      const activeApplicationCount = Math.max(
        0,
        Math.floor(messageNumber(message, 'activeApplicationCount') ?? 0),
      );
      const action = radarAction(message);
      return {
        subject: `Your Hanaply digest for ${localDay}`,
        preview: `${countLabel(count, 'match', 'matches')}, ${countLabel(savedCount, 'saved job', 'saved jobs')}, and ${countLabel(activeApplicationCount, 'active application', 'active applications')}.`,
        heading: 'Your daily radar digest',
        paragraphs: [
          `Hello ${name},`,
          `Here is your radar summary for ${localDay}.`,
          `${countLabel(count, 'opportunity', 'opportunities')} cleared your digest threshold, and you are tracking ${countLabel(savedCount, 'saved job', 'saved jobs')} with ${countLabel(activeApplicationCount, 'active application', 'active applications')}.`,
        ],
        items: jobs.map((entry) => opportunityItem(entry, { includeSalary: false })),
        ...(action ? { action } : {}),
        footer: dailyDigestFooter,
        signature: notificationSignature,
      };
    }
  }
}

function htmlItems(items: readonly TemplateItem[]): string {
  return items
    .map((item) => {
      const emphasis = item.emphasis
        .map(
          (line) =>
            `<div style="margin:4px 0 0;color:#1D2F8A;font:bold 14px/1.5 Arial,sans-serif">${escapeHtml(line)}</div>`,
        )
        .join('');
      const details = item.details
        .map(
          (line) =>
            `<div style="margin:2px 0 0;color:#667085;font:13px/1.5 Arial,sans-serif">${escapeHtml(line)}</div>`,
        )
        .join('');
      return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 12px"><tr><td style="padding:16px;background:#F9FAFB;border:1px solid #E4E7EC;border-radius:12px"><div style="color:#101828;font:bold 16px/1.4 Arial,sans-serif">${escapeHtml(item.title)}</div><div style="margin:2px 0 0;color:#475467;font:14px/1.5 Arial,sans-serif">${escapeHtml(item.subtitle)}</div>${emphasis}${details}</td></tr></table>`;
    })
    .join('');
}

function htmlDocument(content: TemplateContent): string {
  const paragraphs = content.paragraphs
    .map(
      (paragraph) =>
        `<p style="margin:0 0 16px;color:#475467;font:16px/1.6 Arial,sans-serif">${escapeHtml(paragraph)}</p>`,
    )
    .join('');
  const items = content.items?.length ? htmlItems(content.items) : '';
  const action = content.action
    ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:24px 0"><tr><td style="border-radius:8px;background:#3157E8"><a href="${escapeHtml(content.action.url)}" style="display:inline-block;padding:13px 22px;color:#ffffff;font:bold 15px/1.2 Arial,sans-serif;text-decoration:none">${escapeHtml(content.action.label)}</a></td></tr></table><p style="margin:0 0 20px;color:#667085;font:13px/1.5 Arial,sans-serif;word-break:break-all">If the button does not work, copy this link:<br><a href="${escapeHtml(content.action.url)}" style="color:#1D2F8A">${escapeHtml(content.action.url)}</a></p>`
    : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(content.subject)}</title><style>@media(max-width:600px){.email-card{padding:24px!important}.email-shell{padding:16px!important}}</style></head><body style="margin:0;background:#F6F8FC"><div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(content.preview)}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#F6F8FC"><tr><td class="email-shell" align="center" style="padding:32px 16px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px"><tr><td style="padding:0 0 20px;color:#101828;font:bold 24px/1.2 Arial,sans-serif">Hanaply</td></tr><tr><td class="email-card" style="padding:40px;background:#ffffff;border:1px solid #E4E7EC;border-radius:16px"><div style="width:44px;height:4px;margin-bottom:24px;background:#22C7A9;border-radius:999px"></div><h1 style="margin:0 0 20px;color:#101828;font:bold 28px/1.25 Arial,sans-serif">${escapeHtml(content.heading)}</h1>${paragraphs}${items}${action}<p style="margin:24px 0 0;padding-top:20px;color:#667085;border-top:1px solid #E4E7EC;font:13px/1.5 Arial,sans-serif">${escapeHtml(content.footer)}</p></td></tr><tr><td style="padding:20px 0;color:#667085;font:12px/1.5 Arial,sans-serif">${escapeHtml(content.signature ?? defaultSignature)}</td></tr></table></td></tr></table></body></html>`;
}

function textItems(items: readonly TemplateItem[]): string[] {
  return items.flatMap((item) => [
    '',
    item.title,
    item.subtitle,
    ...item.emphasis.map((line) => `  ${line}`),
    ...item.details.map((line) => `  ${line}`),
  ]);
}

function textDocument(content: TemplateContent): string {
  return [
    'HANAPLY',
    '',
    content.heading,
    '',
    ...content.paragraphs,
    ...(content.items?.length ? textItems(content.items) : []),
    ...(content.action ? ['', `${content.action.label}:`, content.action.url] : []),
    '',
    content.footer,
    '',
    content.signature ?? defaultSignature,
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
    preheader: content.preview,
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

export function emailTemplatePreviewMessage(templateId: EmailTemplateId): EmailMessage {
  return emailMessageSchema.parse({
    recipient: 'preview.member@example.test',
    templateId,
    templateVersion: 'v1',
    category: expectedCategory[templateId],
    idempotencyKey: `preview:${templateId}:00000000-0000-4000-8000-000000000001`,
    variables: {
      displayName: 'Mika Santos',
      actionUrl: 'http://localhost:3100/dashboard/activation',
      radarUrl: 'http://localhost:3100/dashboard/radar',
      expiresIn: 'one hour',
      securityEvent: 'A security-sensitive setting changed',
      planCode: 'plus_monthly',
      amountMinor: 49900,
      refundedAmountMinor: 49900,
      currency: 'PHP',
      publicMessage: 'Please upload a clearer image that shows the completed payment status.',
      subscriptionImpact: 'end_access_now',
      startsAt: '2026-07-28T04:00:00.000Z',
      endsAt: '2026-08-28T04:00:00.000Z',
      subscriptionEndsAt: '2026-08-28T04:00:00.000Z',
      localDay: 'September 19, 2026',
      jobCount: 2,
      savedCount: 4,
      activeApplicationCount: 2,
      jobs: [
        {
          jobId: '40000000-0000-4000-8000-000000000001',
          title: 'Workflow Automation Engineer',
          companyName: 'Northstar Systems',
          score: 88,
          verdict: 'strong_match',
          locationRaw: 'Metro Manila, Philippines',
          remoteState: 'hybrid',
          salaryMinMinor: 9_000_000,
          salaryMaxMinor: 12_000_000,
          salaryCurrency: 'PHP',
        },
        {
          jobId: '40000000-0000-4000-8000-000000000002',
          title: 'Data Operations Specialist',
          companyName: 'Harbor Analytics',
          score: 76,
          verdict: 'good_match',
          locationRaw: null,
          remoteState: 'remote',
          salaryMinMinor: null,
          salaryMaxMinor: null,
          salaryCurrency: null,
        },
      ],
    },
  });
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

export interface CaptureEmailProviderOptions {
  /**
   * JSON-lines file every captured message is appended to.
   *
   * Capture is used by local development, the e2e stack, and tests. In-memory
   * capture is invisible to another process, so the Dockerless mailbox
   * (`tooling/e2e/mailbox.mjs`) and this provider share one file: the mailbox
   * serves it through Mailpit's HTTP API. Leaving it unset keeps the original
   * in-process behaviour.
   */
  captureFile?: string;
}

function appendCapturedEmail(file: string, email: RenderedEmail): void {
  try {
    const record = {
      id: randomUUID(),
      from: { name: 'Hanaply', address: 'no-reply@hanaply.test' },
      to: [{ name: '', address: email.recipient }],
      subject: email.subject,
      text: email.text,
      html: email.html,
      createdAt: new Date().toISOString(),
      templateId: email.templateId,
    };
    appendFileSync(file, `${JSON.stringify(record)}\n`, 'utf8');
  } catch {
    // The sink is diagnostic. A failed append must never change delivery
    // semantics for the caller, which still sees its captured receipt.
  }
}

export class CaptureEmailProvider implements EmailProvider {
  private readonly messages: RenderedEmail[] = [];
  private readonly captureFile: string | null;

  constructor(options: CaptureEmailProviderOptions = {}) {
    this.captureFile = options.captureFile ?? null;
  }

  send(message: EmailMessage): Promise<EmailDeliveryReceipt> {
    const rendered = renderEmailTemplate(message);
    this.messages.push(rendered);
    if (this.captureFile) appendCapturedEmail(this.captureFile, rendered);
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
  if (environment.EMAIL_PROVIDER === 'capture') {
    return new CaptureEmailProvider(
      environment.EMAIL_CAPTURE_FILE ? { captureFile: environment.EMAIL_CAPTURE_FILE } : {},
    );
  }
  return new ResendEmailProvider(environment);
}
