import { Alert, Badge, LinkButton } from '@hanaply/ui';
import { Construction } from 'lucide-react';

export interface AuthPlaceholderProps {
  eyebrow: string;
  title: string;
  description: string;
}

export function AuthPlaceholder({ eyebrow, title, description }: AuthPlaceholderProps) {
  return (
    <div className="auth-card">
      <Badge tone="brand">{eyebrow}</Badge>
      <h1>{title}</h1>
      <p>{description}</p>
      <Alert
        icon={<Construction aria-hidden="true" size={20} />}
        title="Planned for Phase 1"
        tone="info"
      >
        This workflow is intentionally not operational yet. The route and secure architecture are
        ready without pretending the account action has completed.
      </Alert>
      <LinkButton block href="/login" variant="secondary">
        Return to Sign In
      </LinkButton>
    </div>
  );
}
