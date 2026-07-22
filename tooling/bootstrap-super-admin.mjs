const REQUIRED_CONFIRMATION = 'ASSIGN_FIRST_SUPER_ADMIN';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const userId = argumentValue('--user');
const confirmation = argumentValue('--confirm');
const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bootstrapEnabled = process.env.ADMIN_BOOTSTRAP_ENABLED === 'true';
const bootstrapEmail = process.env.ADMIN_BOOTSTRAP_EMAIL?.normalize('NFKC').trim().toLowerCase();

if (!bootstrapEnabled) {
  fail('ADMIN_BOOTSTRAP_ENABLED must be exactly true for this controlled operation.');
}
if (!bootstrapEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(bootstrapEmail)) {
  fail('ADMIN_BOOTSTRAP_EMAIL must contain the single verified owner target.');
}

if (!userId || !uuidPattern.test(userId)) {
  fail('Provide an owner-selected auth UUID with --user <uuid>.');
}
if (confirmation !== REQUIRED_CONFIRMATION) {
  fail(`Refusing to continue. Pass --confirm ${REQUIRED_CONFIRMATION} after verifying the UUID.`);
}
if (!supabaseUrl || !serviceRoleKey) {
  fail('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be present in the server environment.');
}

let normalizedUrl;
try {
  normalizedUrl = new URL(supabaseUrl);
} catch {
  fail('SUPABASE_URL must be an absolute URL.');
}
if (!['http:', 'https:'].includes(normalizedUrl.protocol)) {
  fail('SUPABASE_URL must use HTTP locally or HTTPS remotely.');
}
if (
  normalizedUrl.protocol !== 'https:' &&
  !['localhost', '127.0.0.1'].includes(normalizedUrl.hostname)
) {
  fail('Remote Supabase bootstrap requires HTTPS.');
}

const headers = {
  apikey: serviceRoleKey,
  Authorization: `Bearer ${serviceRoleKey}`,
  'Content-Type': 'application/json',
};

const userResponse = await fetch(new URL(`/auth/v1/admin/users/${userId}`, normalizedUrl), {
  headers,
});
if (!userResponse.ok) {
  fail(`The selected auth user could not be verified (HTTP ${userResponse.status}).`);
}
const userBody = await userResponse.json();
const selectedUser = userBody.user ?? userBody;
if (selectedUser.email?.normalize('NFKC').trim().toLowerCase() !== bootstrapEmail) {
  fail('The selected auth UUID does not match ADMIN_BOOTSTRAP_EMAIL.');
}
if (!selectedUser.email_confirmed_at) {
  fail('The selected auth user must verify their email before bootstrap.');
}

const rpcResponse = await fetch(
  new URL('/rest/v1/rpc/bootstrap_first_super_admin', normalizedUrl),
  {
    method: 'POST',
    headers,
    body: JSON.stringify({
      target_user_id: userId,
      target_email: bootstrapEmail,
      confirmation: REQUIRED_CONFIRMATION,
    }),
  },
);
if (!rpcResponse.ok) {
  fail(`Super Admin bootstrap failed atomically (HTTP ${rpcResponse.status}).`);
}

const created = await rpcResponse.json();
process.stdout.write(
  created === true
    ? `Super Admin assigned and audited for ${userId}.\n`
    : `Super Admin was already assigned to ${userId}; no duplicate audit event was written.\n`,
);
