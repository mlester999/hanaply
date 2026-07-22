import type { Metadata } from 'next';

import { AuthPlaceholder } from '@/components/auth-placeholder';

export const metadata: Metadata = { title: 'Register' };

export default function RegisterPage() {
  return (
    <AuthPlaceholder
      description="Public registration will include email verification, safe redirects, and protected profile provisioning."
      eyebrow="Registration foundation"
      title="Build your career radar soon."
    />
  );
}
