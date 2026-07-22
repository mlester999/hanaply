import type { Metadata } from 'next';

import { AuthPlaceholder } from '@/components/auth-placeholder';

export const metadata: Metadata = { title: 'Verify Email' };

export default function VerifyEmailPage() {
  return (
    <AuthPlaceholder
      description="Email verification will use Supabase Auth links and the protected callback already established in this foundation."
      eyebrow="Verification foundation"
      title="Email verification arrives in Phase 1."
    />
  );
}
