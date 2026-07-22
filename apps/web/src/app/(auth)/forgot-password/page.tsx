import type { Metadata } from 'next';

import { AuthPlaceholder } from '@/components/auth-placeholder';

export const metadata: Metadata = { title: 'Forgot Password' };

export default function ForgotPasswordPage() {
  return (
    <AuthPlaceholder
      description="Password recovery will always return a generic response so account existence is not exposed."
      eyebrow="Recovery foundation"
      title="Secure recovery is being prepared."
    />
  );
}
