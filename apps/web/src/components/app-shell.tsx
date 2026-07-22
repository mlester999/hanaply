'use client';

import { Button, Drawer, NavigationItem } from '@hanaply/ui';
import {
  BadgeCheck,
  CreditCard,
  Flag,
  Gauge,
  Home,
  Menu,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { logout } from '@/app/actions/auth';
import { BrandLogo } from '@/components/brand-logo';

const customerItems = [
  { href: '/dashboard', label: 'Career Radar', icon: Gauge },
  { href: '/dashboard/activation', label: 'Activation Center', icon: CreditCard },
  { href: '/dashboard/settings', label: 'Settings', icon: Settings },
] as const;

const adminItems = [
  { href: '/admin', label: 'Overview', icon: Home },
  { href: '/admin/settings', label: 'Platform Settings', icon: SlidersHorizontal },
  { href: '/admin#users', label: 'Users', icon: Users },
  { href: '/admin#flags', label: 'Feature Flags', icon: Flag },
  { href: '/admin#audit', label: 'Audit Logs', icon: ShieldCheck },
] as const;

function ShellNavigation({ admin }: { admin: boolean }) {
  const pathname = usePathname();
  const items = admin ? adminItems : customerItems;
  return (
    <nav
      aria-label={admin ? 'Admin navigation' : 'Dashboard navigation'}
      className="shell-navigation"
    >
      {items.map((item) => {
        const Icon = item.icon;
        const active = item.href.includes('#')
          ? false
          : item.href === pathname ||
            (item.href !== '/admin' && pathname.startsWith(`${item.href}/`));
        return (
          <NavigationItem
            active={active}
            href={item.href}
            icon={<Icon size={18} />}
            key={item.href}
          >
            {item.label}
          </NavigationItem>
        );
      })}
    </nav>
  );
}

export interface AppShellProps {
  admin?: boolean;
  displayName: string;
  children: ReactNode;
}

export function AppShell({ admin = false, displayName, children }: AppShellProps) {
  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <BrandLogo />
        <div className="shell-context">
          <BadgeCheck aria-hidden="true" size={16} />
          <span>{admin ? 'Administration' : 'Customer workspace'}</span>
        </div>
        <ShellNavigation admin={admin} />
        <form action={logout} className="sidebar-signout">
          <Button block type="submit" variant="quiet">
            Sign Out
          </Button>
        </form>
      </aside>
      <div className="app-main-column">
        <header className="app-topbar">
          <div className="app-mobile-controls">
            <BrandLogo compact />
            <Drawer
              description={admin ? 'Administrative navigation' : 'Customer navigation'}
              title={admin ? 'Admin menu' : 'Dashboard menu'}
              trigger={
                <Button aria-label="Open workspace menu" size="sm" variant="quiet">
                  <Menu aria-hidden="true" size={21} />
                </Button>
              }
            >
              <ShellNavigation admin={admin} />
              <form action={logout} className="drawer-signout">
                <Button block type="submit" variant="secondary">
                  Sign Out
                </Button>
              </form>
            </Drawer>
          </div>
          <div className="topbar-identity">
            <span>{admin ? 'Protected admin area' : 'Hanaply workspace'}</span>
            <strong>{displayName}</strong>
          </div>
          <Link className="topbar-help" href={admin ? '/admin/settings' : '/help'}>
            {admin ? 'Settings' : 'Get help'}
          </Link>
        </header>
        <main className="app-content" id="main-content" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
