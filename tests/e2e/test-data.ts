import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { testAccounts } from './accounts.js';
import { readLocalSupabaseEnvironment } from './local-supabase.js';

interface AuthUser {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
}

const environment = readLocalSupabaseEnvironment();
const adminHeaders = {
  apikey: environment.serviceRoleKey,
  Authorization: `Bearer ${environment.serviceRoleKey}`,
  'Content-Type': 'application/json',
};

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(adminHeaders);
  if (init.headers) {
    for (const [name, value] of new Headers(init.headers)) headers.set(name, value);
  }
  const response = await fetch(new URL(path, environment.apiUrl), {
    ...init,
    headers,
  });
  if (!response.ok) {
    throw new Error(
      `Local Supabase test-data request failed for ${path} (HTTP ${response.status})`,
    );
  }
  return response;
}

async function existingTestUsers(): Promise<AuthUser[]> {
  const response = await request('/auth/v1/admin/users?page=1&per_page=1000');
  const body = (await response.json()) as { users?: AuthUser[] };
  const emails = new Set(Object.values(testAccounts).map((account) => account.email));
  return (body.users ?? []).filter((user) => user.email && emails.has(user.email));
}

export async function getAuthUserByEmail(email: string): Promise<AuthUser | undefined> {
  const response = await request('/auth/v1/admin/users?page=1&per_page=1000');
  const body = (await response.json()) as { users?: AuthUser[] };
  return body.users?.find((user) => user.email?.toLowerCase() === email.toLowerCase());
}

export async function getServiceRows<T>(path: string): Promise<T> {
  const response = await request(path);
  return (await response.json()) as T;
}

/**
 * Removes the fixture accounts.
 *
 * Cleanup is best effort, and the failure is reported rather than swallowed.
 * Deleting an account that suspended, or was suspended by, another account is
 * refused by `account_suspensions.suspended_by`, whose RESTRICT is intentional:
 * the administrative audit trail must not lose the fact that a suspension
 * happened. That makes a strict teardown the wrong shape, because a failed
 * cleanup says nothing about whether the suite passed.
 *
 * This is safe because the end-to-end stack provisions its own database from
 * the migrations on every run, so a leftover fixture cannot reach the next run.
 */
export async function removeTestUsers(): Promise<void> {
  const failures: string[] = [];
  for (const user of await existingTestUsers()) {
    try {
      await request(`/auth/v1/admin/users/${user.id}`, { method: 'DELETE' });
    } catch (error) {
      failures.push(
        `${user.email ?? user.id}: ${error instanceof Error ? error.message : 'removal failed'}`,
      );
    }
  }
  if (failures.length > 0) {
    console.warn(
      `[e2e] ${failures.length} fixture account(s) could not be removed. The database is rebuilt from the migrations before the next run, so this does not affect the result.\n  ${failures.join('\n  ')}`,
    );
  }
}

async function createUser(
  account: { email: string; password: string },
  firstName: string,
  lastName: string,
): Promise<AuthUser> {
  const response = await request('/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({
      email: account.email,
      password: account.password,
      email_confirm: true,
      user_metadata: {
        first_name: firstName,
        last_name: lastName,
        display_name: `${firstName} ${lastName}`,
      },
    }),
  });
  const user = (await response.json()) as AuthUser;
  if (!user.id) throw new Error(`Local Supabase did not return an ID for ${account.email}`);
  return user;
}

export async function createTestUsers(): Promise<void> {
  await removeTestUsers();
  const customer = await createUser(testAccounts.customer, 'Customer', 'Member');
  const admin = await createUser(testAccounts.admin, 'Admin', 'Owner');
  const suspended = await createUser(testAccounts.suspended, 'Suspended', 'Member');
  await createUser(testAccounts.recovery, 'Recovery', 'Member');
  await createUser(testAccounts.managed, 'Managed', 'Member');

  const planResponse = await request('/rest/v1/plans?select=id&code=eq.plus_monthly');
  const plans = (await planResponse.json()) as { id: string }[];
  const plan = plans[0];
  if (!plan) throw new Error('The Plus Monthly catalog fixture is unavailable');

  await request('/rest/v1/subscriptions', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      user_id: customer.id,
      plan_id: plan.id,
      status: 'active',
      starts_at: '2026-07-01T00:00:00.000Z',
      ends_at: '2027-07-01T00:00:00.000Z',
      source: 'admin_grant',
    }),
  });

  await request('/rest/v1/profiles?id=eq.' + suspended.id, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ account_status: 'suspended' }),
  });

  const bootstrapScript = fileURLToPath(
    new URL('../../tooling/bootstrap-super-admin.mjs', import.meta.url),
  );
  execFileSync(
    process.execPath,
    [bootstrapScript, '--user', admin.id, '--confirm', 'ASSIGN_FIRST_SUPER_ADMIN'],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        SUPABASE_URL: environment.apiUrl,
        SUPABASE_SERVICE_ROLE_KEY: environment.serviceRoleKey,
        ADMIN_BOOTSTRAP_ENABLED: 'true',
        ADMIN_BOOTSTRAP_EMAIL: testAccounts.admin.email,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  const bootstrapAudit = await request(
    `/rest/v1/audit_events?select=id&action=eq.admin.bootstrap_completed&target_id=eq.${admin.id}`,
  );
  const events = (await bootstrapAudit.json()) as { id: string }[];
  if (events.length !== 1) {
    throw new Error('The Super Admin bootstrap did not create exactly one audit event');
  }

  const idempotentResult = await request('/rest/v1/rpc/bootstrap_first_super_admin', {
    method: 'POST',
    body: JSON.stringify({
      target_user_id: admin.id,
      target_email: testAccounts.admin.email,
      confirmation: 'ASSIGN_FIRST_SUPER_ADMIN',
    }),
  });
  if ((await idempotentResult.json()) !== false) {
    throw new Error('The Super Admin bootstrap was not idempotent');
  }
}
