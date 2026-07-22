import type { Metadata } from 'next';

import { Badge } from '@hanaply/ui';

import { RegistrationForm } from '@/components/registration-form';

export const metadata: Metadata = { title: 'Register' };

export default function RegisterPage() {
  return (
    <div className="auth-card auth-card--wide">
      <Badge tone="brand">Create your account</Badge>
      <h1>Start with one trusted profile.</h1>
      <p>Register securely, verify your email, and enter your protected Hanaply workspace.</p>
      <RegistrationForm />
    </div>
  );
}
