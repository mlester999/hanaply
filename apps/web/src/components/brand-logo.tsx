import { Radar } from 'lucide-react';
import Link from 'next/link';

export function BrandLogo({ compact = false }: { compact?: boolean }) {
  return (
    <Link aria-label="Hanaply home" className="brand-logo" href="/">
      <span aria-hidden="true" className="brand-logo-mark">
        <Radar size={20} strokeWidth={2.4} />
      </span>
      {!compact ? <span>Hanaply</span> : null}
    </Link>
  );
}
