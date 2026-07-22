'use client';

import { Button, Drawer, LinkButton } from '@hanaply/ui';
import { Menu } from 'lucide-react';
import Link from 'next/link';

import { BrandLogo } from '@/components/brand-logo';

const links = [
  { href: '/pricing', label: 'Pricing' },
  { href: '/security', label: 'Security' },
  { href: '/help', label: 'Help' },
] as const;

export function MarketingHeader() {
  return (
    <header className="marketing-header">
      <div className="marketing-header-inner">
        <BrandLogo />
        <nav aria-label="Primary navigation" className="marketing-nav">
          {links.map((link) => (
            <Link href={link.href} key={link.href}>
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="marketing-actions">
          <LinkButton href="/login" size="sm" variant="quiet">
            Sign In
          </LinkButton>
          <LinkButton href="/register" size="sm">
            Build My Career Radar
          </LinkButton>
        </div>
        <div className="marketing-menu">
          <Drawer
            description="Navigate Hanaply"
            title="Menu"
            trigger={
              <Button aria-label="Open navigation menu" size="sm" variant="quiet">
                <Menu aria-hidden="true" size={21} />
              </Button>
            }
          >
            <nav aria-label="Mobile navigation" className="mobile-nav">
              {links.map((link) => (
                <Link href={link.href} key={link.href}>
                  {link.label}
                </Link>
              ))}
              <Link href="/login">Sign In</Link>
              <Link className="mobile-nav-primary" href="/register">
                Build My Career Radar
              </Link>
            </nav>
          </Drawer>
        </div>
      </div>
    </header>
  );
}
