import Link from 'next/link';
import type { ReactNode } from 'react';

import { BrandLogo } from '@/components/brand-logo';
import { MarketingHeader } from '@/components/marketing-header';

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="marketing-shell">
      <MarketingHeader />
      <main id="main-content" tabIndex={-1}>
        {children}
      </main>
      <footer className="marketing-footer">
        <div className="marketing-footer-inner">
          <div>
            <BrandLogo />
            <p>Hanap smarter. Apply stronger.</p>
          </div>
          <nav aria-label="Footer navigation">
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/security">Security</Link>
            <Link href="/help">Help</Link>
          </nav>
          <small>© {new Date().getUTCFullYear()} Hanaply. Foundation phase.</small>
        </div>
      </footer>
    </div>
  );
}
