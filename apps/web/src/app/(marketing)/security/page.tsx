import { Badge, Card } from '@hanaply/ui';
import { DatabaseZap, KeyRound, LockKeyhole, ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Security' };

const controls = [
  {
    icon: DatabaseZap,
    title: 'Database isolation',
    copy: 'Row Level Security and explicit column grants limit access to each user’s permitted records.',
  },
  {
    icon: KeyRound,
    title: 'Server-enforced permissions',
    copy: 'Plans, entitlements, account status, and administrator roles are resolved from trusted backend data.',
  },
  {
    icon: LockKeyhole,
    title: 'Secret separation',
    copy: 'Browser-safe configuration is isolated from service credentials, tokens, and provider keys.',
  },
  {
    icon: ShieldCheck,
    title: 'Truth and prompt boundaries',
    copy: 'External job content is untrusted input, while applicant claims must trace to verified facts.',
  },
] as const;

export default function SecurityPage() {
  return (
    <section className="page-section">
      <div className="page-container">
        <header className="centered-heading">
          <Badge tone="success">Security foundation</Badge>
          <h1>Trust is designed into every boundary.</h1>
          <p>
            Hanaply uses layered controls. No single middleware, token, or hidden menu is treated as
            complete security.
          </p>
        </header>
        <div className="security-grid">
          {controls.map((control) => {
            const Icon = control.icon;
            return (
              <Card className="security-card" key={control.title}>
                <Icon aria-hidden="true" size={24} />
                <h2>{control.title}</h2>
                <p>{control.copy}</p>
              </Card>
            );
          })}
        </div>
        <div className="security-disclosure">
          <h2>Responsible disclosure</h2>
          <p>
            A monitored security contact and response policy must be configured by the owner before
            public launch. Do not include sensitive exploit details in general support requests.
          </p>
        </div>
      </div>
    </section>
  );
}
