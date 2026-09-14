import { z } from 'zod';

export const legalPolicyVersions = Object.freeze({
  terms: 'draft-2026-07-22',
  privacy: 'draft-2026-07-22',
});

export const authRateLimitBuckets = Object.freeze([
  'registration',
  'login',
  'verification_resend',
  'password_recovery',
  'password_reset',
  'profile_update',
  'session_revocation',
  'admin_user_search',
  'admin_account_action',
] as const);

export type AuthRateLimitBucket = (typeof authRateLimitBuckets)[number];

export function normalizeEmail(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase();
}

export function maskEmail(value: string): string {
  const normalized = normalizeEmail(value);
  const separator = normalized.lastIndexOf('@');
  if (separator <= 0) return 'your email address';
  const local = normalized.slice(0, separator);
  const domain = normalized.slice(separator + 1);
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${'*'.repeat(Math.max(3, Math.min(8, local.length - visible.length)))}@${domain}`;
}

export const normalizedEmailSchema = z.preprocess(
  (value) => (typeof value === 'string' ? normalizeEmail(value) : value),
  z.email('Enter a valid email address.').max(254, 'Email address is too long.'),
);

export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters.')
  .max(128, 'Use no more than 128 characters.')
  .regex(/[A-Za-z]/u, 'Include at least one letter.')
  .regex(/[0-9]/u, 'Include at least one number.')
  .refine(
    (value) =>
      !Array.from(value).some((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint <= 31 || codePoint === 127;
      }),
    'Password cannot contain control characters.',
  );

export const selectedPlanCodeSchema = z.preprocess(
  (value) => (typeof value === 'string' && value.length > 0 ? value : null),
  z.enum(['plus_monthly', 'plus_annual', 'pro_monthly', 'pro_annual']).nullable(),
);

const personNameSchema = z
  .string()
  .trim()
  .min(1, 'This field is required.')
  .max(80, 'Use 80 characters or fewer.');

const optionalDisplayNameSchema = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
  z.string().trim().min(1).max(120).nullable(),
);

export const countryCodeSchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{2}$/u, 'Use a two-letter country code.'));

export const localeSchema = z
  .string()
  .trim()
  .regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/u, 'Use a supported locale such as en-PH.')
  .max(35);

export const timezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine((value) => {
    try {
      Intl.DateTimeFormat('en', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'Use a valid IANA timezone such as Asia/Manila.');

export const registrationSchema = z
  .object({
    firstName: personNameSchema,
    lastName: personNameSchema,
    email: normalizedEmailSchema,
    password: passwordSchema,
    passwordConfirmation: z.string(),
    selectedPlanCode: selectedPlanCodeSchema.default(null),
    legalAccepted: z.boolean(),
    marketingConsent: z.boolean().default(false),
  })
  .superRefine((value, context) => {
    if (value.password !== value.passwordConfirmation) {
      context.addIssue({
        code: 'custom',
        path: ['passwordConfirmation'],
        message: 'Passwords must match.',
      });
    }
    if (!value.legalAccepted) {
      context.addIssue({
        code: 'custom',
        path: ['legalAccepted'],
        message: 'You must agree to the Terms of Service and Privacy Policy.',
      });
    }
  });

export const loginSchema = z.object({
  email: normalizedEmailSchema,
  password: z.string().min(1, 'Enter your password.').max(128),
});

export const forgotPasswordSchema = z.object({ email: normalizedEmailSchema });

export const passwordUpdateSchema = z
  .object({
    password: passwordSchema,
    passwordConfirmation: z.string(),
  })
  .superRefine((value, context) => {
    if (value.password !== value.passwordConfirmation) {
      context.addIssue({
        code: 'custom',
        path: ['passwordConfirmation'],
        message: 'Passwords must match.',
      });
    }
  });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password.').max(128),
    password: passwordSchema,
    passwordConfirmation: z.string(),
  })
  .superRefine((value, context) => {
    if (value.password !== value.passwordConfirmation) {
      context.addIssue({
        code: 'custom',
        path: ['passwordConfirmation'],
        message: 'Passwords must match.',
      });
    }
    if (value.password === value.currentPassword) {
      context.addIssue({
        code: 'custom',
        path: ['password'],
        message: 'Choose a password different from your current password.',
      });
    }
  });

export const profileUpdateSchema = z
  .object({
    firstName: personNameSchema,
    lastName: personNameSchema,
    displayName: optionalDisplayNameSchema,
    countryCode: countryCodeSchema,
    locale: localeSchema,
    timezone: timezoneSchema,
  })
  .strict();

export const notificationHourSchema = z
  .number()
  .int('Use a whole hour from 0 to 23.')
  .min(0, 'Use a whole hour from 0 to 23.')
  .max(23, 'Use a whole hour from 0 to 23.');

/**
 * Optional email consent. Every category is explicit, and quiet hours are sent
 * on every write because the database assigns them directly: omitting them
 * would silently clear an existing quiet-hours window.
 */
export const notificationPreferencesSchema = z
  .object({
    productUpdates: z.boolean(),
    marketingEmails: z.boolean(),
    jobAlerts: z.boolean(),
    dailyDigest: z.boolean(),
    instantAlerts: z.boolean(),
    weeklyStrategy: z.boolean(),
    quietHoursStart: notificationHourSchema.nullable(),
    quietHoursEnd: notificationHourSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.quietHoursStart === null) !== (value.quietHoursEnd === null)) {
      context.addIssue({
        code: 'custom',
        path: ['quietHoursEnd'],
        message: 'Set both quiet hours or leave both blank.',
      });
    }
  });

export type RegistrationInput = z.infer<typeof registrationSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;
export type NotificationPreferencesInput = z.infer<typeof notificationPreferencesSchema>;
