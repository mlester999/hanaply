import { parseBrowserEnvironment, parseWebServerEnvironment } from '@hanaply/config';

export function getBrowserEnvironment() {
  return parseBrowserEnvironment({
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
}

export function getWebServerEnvironment() {
  return parseWebServerEnvironment({
    ...getBrowserEnvironment(),
    HANAPLY_ENV: process.env.HANAPLY_ENV,
    AUTH_RATE_LIMIT_PEPPER: process.env.AUTH_RATE_LIMIT_PEPPER,
  });
}
