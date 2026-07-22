import { execFileSync } from 'node:child_process';

export interface LocalSupabaseEnvironment {
  apiUrl: string;
  databaseUrl: string;
  publishableKey: string;
  serviceRoleKey: string;
}

export function readLocalSupabaseEnvironment(): LocalSupabaseEnvironment {
  const output =
    process.platform === 'win32'
      ? execFileSync('cmd.exe', ['/d', '/s', '/c', 'supabase status -o env'], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        })
      : execFileSync('supabase', ['status', '-o', 'env'], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        });
  const values = new Map<string, string>();
  for (const line of output.split(/\r?\n/u)) {
    const match = /^([A-Z_]+)="(.*)"$/u.exec(line.trim());
    if (match?.[1] && match[2] !== undefined) values.set(match[1], match[2]);
  }
  const apiUrl = values.get('API_URL');
  const databaseUrl = values.get('DB_URL');
  const publishableKey = values.get('PUBLISHABLE_KEY') ?? values.get('ANON_KEY');
  const serviceRoleKey = values.get('SERVICE_ROLE_KEY');
  if (!apiUrl || !databaseUrl || !publishableKey || !serviceRoleKey) {
    throw new Error('Local Supabase is not running or did not return all required status values');
  }
  return { apiUrl, databaseUrl, publishableKey, serviceRoleKey };
}
