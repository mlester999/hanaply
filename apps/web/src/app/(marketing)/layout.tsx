import './landing-vision.css';
import './landing-responsive.css';
import './landing-overrides.css';

import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { MarketingHeader } from '@/components/marketing-header';

export const dynamic = 'force-dynamic';

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="marketing-shell">
      <MarketingHeader />
      <main id="main-content" tabIndex={-1}>
        {children}
      </main>
      <footer className="site-footer">
        <div>
          <Link aria-label="Hanaply home" className="brand" href="/">
            <Image
              alt=""
              aria-hidden="true"
              className="brand-logo-image"
              height={218}
              src="/brand/hanaply-logo.png"
              width={800}
            />
          </Link>
          <p>Hanap smarter. Apply stronger.</p>
        </div>
        <div className="footer-note">
          <strong>A smarter way to move your career forward</strong>
          <p>
            Create your account now. Career intelligence and truthful application preparation are
            coming in later releases.
          </p>
        </div>
        <nav aria-label="Footer navigation">
          <Link href="/#pricing">Pricing</Link>
          <Link href="/security">Security</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/help">Help</Link>
          <Link href="/#faq">FAQ</Link>
        </nav>
      </footer>
    </div>
  );
}
