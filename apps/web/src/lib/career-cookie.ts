import { cookies } from 'next/headers';

/**
 * The active career profile for this browser. It is written by server actions
 * only, so a client can never point onboarding at another account's profile:
 * every action still resolves ownership through the API before writing.
 */
export const activeCareerProfileCookie = 'hanaply-career-profile';

const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/dashboard',
  maxAge: 60 * 60 * 24 * 180,
} as const;

export async function setActiveCareerProfileCookie(profileId: string): Promise<void> {
  const store = await cookies();
  store.set(activeCareerProfileCookie, profileId, cookieOptions);
}

export async function readActiveCareerProfileCookie(): Promise<string | null> {
  const store = await cookies();
  const value = store.get(activeCareerProfileCookie)?.value;
  return value && value.length > 0 ? value : null;
}
