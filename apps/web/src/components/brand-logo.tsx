import Image from 'next/image';
import Link from 'next/link';

const assets = {
  onDark: {
    src: '/brand/hanaply-logo.png',
    width: 800,
    height: 218,
  },
  onLight: {
    src: '/brand/hanaply-logo-light.png',
    width: 800,
    height: 218,
  },
  mark: {
    src: '/brand/hanaply-mark.png',
    width: 198,
    height: 198,
  },
} as const;

export function BrandLogo({
  compact = false,
  tone = 'on-light',
}: {
  compact?: boolean;
  /** `on-dark` = white wordmark for dark surfaces. `on-light` = ink wordmark for light surfaces. */
  tone?: 'on-dark' | 'on-light';
}) {
  const asset = compact ? assets.mark : tone === 'on-dark' ? assets.onDark : assets.onLight;

  return (
    <Link aria-label="Hanaply home" className="brand-logo" href="/">
      <Image
        alt=""
        aria-hidden="true"
        className={compact ? 'brand-logo-mark-image' : 'brand-logo-image'}
        height={asset.height}
        priority
        src={asset.src}
        width={asset.width}
      />
    </Link>
  );
}
