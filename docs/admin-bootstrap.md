# First Super Admin bootstrap

## Purpose and prerequisites

The bootstrap tool assigns exactly the first Super Admin. It is not a general role-management command. Before running it, the owner must:

- Select the intended Supabase project and verify the environment.
- Create the owner through the normal Auth flow.
- Verify the owner's email.
- Obtain the exact Auth UUID from an authenticated admin console/private server process.
- Review the migrations and ensure the expanded `super_admin` role exists. The reviewed migration count is now 26 in `supabase/migrations`.
- Open a private server shell with access to the secret manager.

Do not run bootstrap for an unverified identity, from a browser, in a developer's shared shell history, or through an unreviewed CI job.

## Required environment gate

Set these values only for the operation:

```powershell
$env:ADMIN_BOOTSTRAP_ENABLED = 'true'
$env:ADMIN_BOOTSTRAP_EMAIL = 'owner@example.com'
$env:SUPABASE_URL = 'https://your-project.supabase.co'
$env:SUPABASE_SERVICE_ROLE_KEY = '<secret-manager-value>'
```

The target email is normalized and must exactly match the verified Auth user returned for the supplied UUID. Remote URLs must use HTTPS.

## Exact command

```powershell
pnpm admin:bootstrap --user <verified-auth-uuid> --confirm ASSIGN_FIRST_SUPER_ADMIN
```

The command verifies the user through the Supabase Admin API and calls `bootstrap_first_super_admin` with the service role. The database transaction creates or activates membership, assigns the expanded role, and writes `admin.bootstrap_completed` once.

Expected first-run output:

```text
Super Admin assigned and audited for <uuid>.
```

A retry for the same owner is idempotent and reports that no duplicate audit event was written. Attempting to bootstrap a different owner after the first succeeds is rejected.

## Disable immediately

```powershell
$env:ADMIN_BOOTSTRAP_ENABLED = 'false'
Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY
Remove-Item Env:ADMIN_BOOTSTRAP_EMAIL
```

Also remove any temporary secret-manager lease or one-off job. Sign in through `/admin/login`, verify `/v1/admin/me`, inspect the bootstrap audit event, and confirm the admin security page reports bootstrap disabled.

## Recovery guidance

- If the UUID/email check fails, stop and re-read the Auth identity. Do not weaken the script.
- If the selected user is unverified, complete normal email verification first.
- If the RPC fails, preserve the error/request context without copying service credentials; verify migration state and database logs.
- If the first owner's access is lost, use a documented owner incident process and database backup/audit evidence. Do not edit JWT metadata or silently run SQL to create a second owner.
- Later admin assignments require a separate permissioned role-administration feature; the current API exposes no membership or role-assignment route (`services/api/src/controllers.ts` declares only the admin identity, directory, account-status, audit, and security routes), so a second owner has to be created through a reviewed database change rather than a supported endpoint.

## Security warnings

The service-role key bypasses ordinary RLS and must never appear in command arguments, browser variables, screenshots, chat, issues, or logs. Bootstrap does not grant permission to deploy, migrate a remote project, or add other admins. The final active Super Admin is protected against suspension by the database operation.

The implementation and E2E suite exercise bootstrap against local Supabase only. Hosted bootstrap remains an owner action and was not executed.
