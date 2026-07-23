import '@hanaply/design-tokens/tokens.css';
import '@hanaply/ui/styles.css';
import './globals.css';

import type { Metadata, Viewport } from 'next';
import { Inter, Manrope } from 'next/font/google';
import type { ReactNode } from 'react';

import { SkipLink } from '@/components/skip-link';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
  preload: true,
});

const manrope = Manrope({
  subsets: ['latin'],
  variable: '--font-manrope',
  display: 'swap',
  preload: true,
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3100'),
  title: { default: 'Hanaply | AI Career Radar', template: '%s | Hanaply' },
  description:
    'Hanaply discovers fresh jobs, explains fit, and prepares truthful application materials for opportunities worth pursuing.',
  applicationName: 'Hanaply',
};

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FFFFFF' },
    { media: '(prefers-color-scheme: dark)', color: '#0B1020' },
  ],
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html
      className={`${inter.variable} ${manrope.variable}`}
      data-scroll-behavior="smooth"
      lang="en-PH"
    >
      <body>
        <SkipLink />
        {children}
      </body>
    </html>
  );
}
