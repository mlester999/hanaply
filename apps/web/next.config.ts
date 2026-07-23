import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import type { NextConfig } from 'next';

const rootEnvironmentFile = resolve(import.meta.dirname, '../../.env.local');
if (existsSync(rootEnvironmentFile)) process.loadEnvFile(rootEnvironmentFile);

const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  devIndicators: false,
  logging: {
    incomingRequests: { ignore: [/\/auth\/callback/u] },
    serverFunctions: false,
  },
  transpilePackages: ['@hanaply/auth', '@hanaply/config', '@hanaply/contracts', '@hanaply/ui'],
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
