'use client';

import { Badge } from '@hanaply/ui';
import { FileCheck2, SearchCheck, ShieldCheck, Target } from 'lucide-react';
import { usePathname } from 'next/navigation';

import { BrandLogo } from '@/components/brand-logo';

const benefits = [
  {
    icon: ShieldCheck,
    title: 'Keep verified career facts together',
    copy: 'Build from information you can review and stand behind.',
  },
  {
    icon: Target,
    title: 'Understand why opportunities match',
    copy: 'See meaningful overlap, blockers, and learnable gaps.',
  },
  {
    icon: FileCheck2,
    title: 'Prepare truthful application materials',
    copy: 'Review every document before anything leaves Hanaply.',
  },
] as const;

export function AuthBrandPanel() {
  const pathname = usePathname();
  const login = pathname === '/login';

  return (
    <section className="auth-brand-panel">
      <BrandLogo tone="on-dark" />
      <div className="auth-brand-copy">
        <Badge tone="brand">{login ? 'Your career radar' : 'Your career workspace'}</Badge>
        <h2>
          {login ? (
            <>Welcome back to your career radar.</>
          ) : (
            <>
              One Career Profile.
              <br />
              Every stronger application.
            </>
          )}
        </h2>
        <p>
          {login
            ? 'Continue managing your account and preparing for the Hanaply features being released in phases.'
            : 'Create one account for the career system being released in clear, carefully reviewed phases.'}
        </p>
        {!login ? (
          <div className="auth-benefits" aria-label="Why create a Hanaply account">
            {benefits.map((benefit) => {
              const Icon = benefit.icon;
              return (
                <div key={benefit.title}>
                  <Icon aria-hidden="true" size={18} />
                  <span>
                    <strong>{benefit.title}</strong>
                    <small>{benefit.copy}</small>
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="auth-login-signal">
            <SearchCheck aria-hidden="true" size={19} />
            <span>Registration is available now. Career intelligence is coming next.</span>
          </div>
        )}
      </div>
      <div className="auth-trust-note">
        <ShieldCheck aria-hidden="true" size={20} />
        <span>Your career information stays private and is never used to invent experience.</span>
      </div>
    </section>
  );
}
