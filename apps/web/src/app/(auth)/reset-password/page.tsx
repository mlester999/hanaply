import type { Metadata } from 'next';

import { AuthPlaceholder } from '@/components/auth-placeholder';

export const metadata: Metadata = { title: 'Reset Password' };

export default function ResetPasswordPage() {
  return (
    <AuthPlaceholder
      description="Reset links, session validation, and password update safeguards will be completed with the Phase 1 account experience."
      eyebrow="Reset foundation"
      title="Password reset is not active yet."
    />
  );
}
