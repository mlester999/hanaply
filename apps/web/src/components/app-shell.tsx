'use client';

import type { Permission } from '@hanaply/auth';
import { Button, Drawer, NavigationItem } from '@hanaply/ui';
import {
  Activity,
  BadgeCheck,
  Bookmark,
  Briefcase,
  Cable,
  Compass,
  CopyCheck,
  CreditCard,
  FileStack,
  FileText,
  Flag,
  Gauge,
  Home,
  KanbanSquare,
  MailCheck,
  Menu,
  Radar,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  ReceiptText,
  Users,
  WalletCards,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { logout } from '@/app/actions/auth';
import { BrandLogo } from '@/components/brand-logo';

const customerItems = [
  { href: '/dashboard/radar', label: 'Job radar', icon: Radar },
  { href: '/dashboard/radar/saved', label: 'Saved jobs', icon: Bookmark },
  { href: '/dashboard/packs', label: 'Application Packs', icon: FileStack },
  { href: '/dashboard/applications', label: 'Tracker', icon: KanbanSquare },
  { href: '/dashboard', label: 'Dashboard', icon: Gauge },
  { href: '/dashboard/career', label: 'Career profile', icon: Compass },
  { href: '/dashboard/career/documents', label: 'Documents', icon: FileText },
  { href: '/dashboard/activation', label: 'Activation Center', icon: CreditCard },
  { href: '/dashboard/settings', label: 'Settings', icon: Settings },
] as const;

const finishOnboardingItem = {
  href: '/dashboard/onboarding',
  label: 'Finish onboarding',
  icon: Flag,
} as const;

const adminItems = [
  { href: '/admin', label: 'Overview', icon: Home, permissions: ['users.read'] },
  { href: '/admin/users', label: 'Users', icon: Users, permissions: ['users.read'] },
  {
    href: '/admin/job-sources',
    label: 'Job sources',
    icon: Cable,
    permissions: ['job_sources.read'],
  },
  {
    href: '/admin/ingestion',
    label: 'Ingestion',
    icon: Activity,
    permissions: ['job_sources.read'],
  },
  { href: '/admin/jobs', label: 'Jobs', icon: Briefcase, permissions: ['jobs.read'] },
  {
    href: '/admin/deduplication',
    label: 'Deduplication',
    icon: CopyCheck,
    permissions: ['jobs.moderate'],
  },
  {
    href: '/admin/payments',
    label: 'Payment Reviews',
    icon: ReceiptText,
    permissions: ['payments.read'],
  },
  {
    href: '/admin/payment-methods',
    label: 'Payment Methods',
    icon: WalletCards,
    permissions: ['payment_methods.read'],
  },
  {
    href: '/admin/subscriptions',
    label: 'Subscriptions',
    icon: CreditCard,
    permissions: ['subscriptions.read'],
  },
  {
    href: '/admin/email-preview',
    label: 'Email Preview',
    icon: MailCheck,
    permissions: ['notifications.manage'],
  },
  {
    href: '/admin/security',
    label: 'Security',
    icon: ShieldCheck,
    permissions: ['security.manage'],
  },
  { href: '/admin/audit', label: 'Audit Logs', icon: Flag, permissions: ['audit.read'] },
  {
    href: '/admin/settings',
    label: 'Platform Settings',
    icon: SlidersHorizontal,
    permissions: ['platforms.manage', 'feature_flags.manage'],
  },
] as const satisfies readonly {
  href: string;
  label: string;
  icon: typeof Home;
  permissions: readonly Permission[];
}[];

function ShellNavigation({
  admin,
  adminPermissions = [],
  onboardingIncomplete = false,
}: {
  admin: boolean;
  adminPermissions?: readonly string[];
  onboardingIncomplete?: boolean;
}) {
  const pathname = usePathname();
  const items: readonly { href: string; label: string; icon: typeof Home }[] = admin
    ? adminItems.filter((item) =>
        item.permissions.some((permission) => adminPermissions.includes(permission)),
      )
    : onboardingIncomplete
      ? [...customerItems, finishOnboardingItem]
      : customerItems;
  // Only the longest matching path is marked current, so /dashboard/career does
  // not stay highlighted while the document library is open.
  const activeHref = items.reduce<string | null>((best, item) => {
    const matches =
      item.href === pathname ||
      (item.href !== '/dashboard' &&
        item.href !== '/admin' &&
        pathname.startsWith(`${item.href}/`));
    if (!matches) return best;
    if (best === null || item.href.length > best.length) return item.href;
    return best;
  }, null);

  return (
    <nav
      aria-label={admin ? 'Admin navigation' : 'Dashboard navigation'}
      className="shell-navigation"
    >
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <NavigationItem
            active={item.href === activeHref}
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
  adminPermissions?: readonly string[];
  displayName: string;
  onboardingIncomplete?: boolean;
  children: ReactNode;
}

export function AppShell({
  admin = false,
  adminPermissions = [],
  displayName,
  onboardingIncomplete = false,
  children,
}: AppShellProps) {
  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <BrandLogo />
        <div className="shell-context">
          <BadgeCheck aria-hidden="true" size={16} />
          <span>{admin ? 'Administration' : 'Customer workspace'}</span>
        </div>
        <ShellNavigation
          admin={admin}
          adminPermissions={adminPermissions}
          onboardingIncomplete={onboardingIncomplete}
        />
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
              <ShellNavigation
                admin={admin}
                adminPermissions={adminPermissions}
                onboardingIncomplete={onboardingIncomplete}
              />
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
