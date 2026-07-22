import { testAccounts } from './accounts.js';
import { readLocalSupabaseEnvironment } from './local-supabase.js';

interface AuthUser {
  id: string;
  email?: string;
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

export async function removeTestUsers(): Promise<void> {
  for (const user of await existingTestUsers()) {
    await request(`/auth/v1/admin/users/${user.id}`, { method: 'DELETE' });
  }
}

async function createUser(account: { email: string; password: string }): Promise<AuthUser> {
  const response = await request('/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({ email: account.email, password: account.password, email_confirm: true }),
  });
  const user = (await response.json()) as AuthUser;
  if (!user.id) throw new Error(`Local Supabase did not return an ID for ${account.email}`);
  return user;
}

export async function createTestUsers(): Promise<void> {
  await removeTestUsers();
  const customer = await createUser(testAccounts.customer);
  const admin = await createUser(testAccounts.admin);
  const suspended = await createUser(testAccounts.suspended);

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

  await request('/rest/v1/rpc/bootstrap_first_super_admin', {
    method: 'POST',
    body: JSON.stringify({
      target_user_id: admin.id,
      confirmation: 'ASSIGN_FIRST_SUPER_ADMIN',
    }),
  });
}
