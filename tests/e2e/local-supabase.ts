import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface LocalSupabaseEnvironment {
  apiUrl: string;
  databaseUrl: string;
  mailpitUrl: string;
  publishableKey: string;
  serviceRoleKey: string;
  /** JSON-lines file shared by every process that captures an email. */
  mailboxFile: string;
}

interface StackState {
  apiUrl?: string;
  databaseUrl?: string;
  mailpitUrl?: string;
  publishableKey?: string;
  serviceRoleKey?: string;
  mailboxFile?: string;
}

const stackStatePath = resolve(import.meta.dirname, '..', '..', '.localdb', 'e2e-stack.json');

/**
 * Reads the Dockerless end-to-end stack that `pnpm e2e` starts before Playwright
 * loads this configuration (`tooling/e2e/stack.mjs`).
 *
 * It replaces the previous `supabase status -o env` shell-out, which required
 * Docker and the Supabase CLI. The returned shape is unchanged, so the
 * Playwright configuration and the browser specs consume it exactly as before:
 * the published `apiUrl` is the Supabase-compatible origin (auth + PostgREST),
 * `mailpitUrl` is the Mailpit-compatible capture, and the two keys are HS256
 * JWTs carrying the `anon` and `service_role` claims.
 */
export function readLocalSupabaseEnvironment(): LocalSupabaseEnvironment {
  let state: StackState;
  try {
    state = JSON.parse(readFileSync(stackStatePath, 'utf8')) as StackState;
  } catch {
    throw new Error(
      `The Dockerless end-to-end stack is not running (no readable ${stackStatePath}). Run "pnpm e2e:stack start", or use "pnpm e2e", which starts and stops the stack around the Playwright run.`,
    );
  }
  const { apiUrl, databaseUrl, mailpitUrl, publishableKey, serviceRoleKey, mailboxFile } = state;
  if (
    !apiUrl ||
    !databaseUrl ||
    !mailpitUrl ||
    !publishableKey ||
    !serviceRoleKey ||
    !mailboxFile
  ) {
    throw new Error(
      `The Dockerless end-to-end stack state at ${stackStatePath} is incomplete. Restart it with "pnpm e2e:stack restart".`,
    );
  }
  return { apiUrl, databaseUrl, mailpitUrl, publishableKey, serviceRoleKey, mailboxFile };
}
