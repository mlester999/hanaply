# Hanaply

Hanaply is a Philippines-first AI Career Radar and Job Intelligence SaaS. This repository contains the completed local implementation of Phase 1: Authentication and SaaS Core Experience plus the Phase 2 manual-payment activation checkpoint, built on the Phase 0 pnpm/Turborepo, Next.js, NestJS, Supabase, shared-contract, and RLS foundation.

Phase 1 provides registration, email verification, login/logout, password recovery, session refresh and revocation, protected customer settings, account-status enforcement, permissioned admin user operations, transactional-email adapters, audit trails, and executable security/accessibility gates. The Phase 2 checkpoint adds manual payment methods and QR instructions, private proof upload and signed access, permissioned review with approve/reject/request-information actions, atomic subscription and entitlement lifecycle, refunds/reversals/corrections, and a database-backed notification/cleanup worker. Career-profile onboarding, resume handling, job ingestion, AI matching, application packs, and native mobile applications remain intentionally unopened.

## Prerequisites

- Node.js 24 LTS (`>=24.11.0 <25`)
- pnpm 11.10
- Docker Desktop
- Supabase CLI 2.109 or compatible
- Chromium installed through Playwright for browser tests

## Local setup

```powershell
corepack enable
pnpm install --frozen-lockfile
Copy-Item .env.example .env.local
pnpm db:start
pnpm db:reset
pnpm dev
```

After `pnpm db:start`, run `supabase status -o env` and copy only the local values into `.env.local`:

- `API_URL` to `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_URL`
- `PUBLISHABLE_KEY` to `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_PUBLISHABLE_KEY`
- `SERVICE_ROLE_KEY` to `SUPABASE_SERVICE_ROLE_KEY`
- `DB_URL` to `SUPABASE_DB_URL`

Keep `EMAIL_PROVIDER=capture`, `EMAIL_ALLOW_LIVE_SENDS=false`, and `ADMIN_BOOTSTRAP_ENABLED=false` locally. Never commit `.env.local`, put a service-role key in a `NEXT_PUBLIC_` variable, or reuse local credentials outside the local stack.

| Service         | URL                      |
| --------------- | ------------------------ |
| Web             | `http://localhost:3100`  |
| API             | `http://localhost:3101`  |
| Worker health   | `http://localhost:3102`  |
| Supabase API    | `http://127.0.0.1:55421` |
| PostgreSQL      | `127.0.0.1:55432`        |
| Supabase Studio | `http://127.0.0.1:55423` |
| Mailpit         | `http://127.0.0.1:55424` |

The worker defaults to idle. Set `WORKER_MODE=active` only with the local database and reviewed email configuration; it runs subscription expiry maintenance, the payment/subscription notification outbox, and private payment-object cleanup. A production deployment still needs worker health probes, retry/dead-letter monitoring, and owner-approved provider configuration.

## Local authentication and email

Open `/register`, submit a valid account with the required draft legal acknowledgements, and retrieve the verification link from Mailpit. Verification and recovery are owned by Supabase Auth; local Supabase sends branded confirmation, recovery, and password-change messages only to Mailpit.

`@hanaply/email` also provides disabled, in-memory capture, and Resend adapters with versioned HTML/plain-text templates, idempotency keys, bounded timeout/retry behavior, and masked receipts. Live Resend delivery is forbidden in local/test environments and requires all production gates. Hosted Supabase Auth must be configured to use the owner-controlled Resend SMTP credentials before hosted verification is considered passed. See [Email operations](docs/email.md).

Playwright creates and removes deterministic local users during `pnpm e2e`; migrations seed no users. The fixtures are defined in `tests/e2e/accounts.ts`:

| Local-only identity                | Purpose                               |
| ---------------------------------- | ------------------------------------- |
| `phase1.customer@hanaply.test`     | Active subscribed customer            |
| `phase1.admin@hanaply.test`        | Controlled Super Admin bootstrap      |
| `phase1.suspended@hanaply.test`    | Suspended-account enforcement         |
| `phase1.recovery@hanaply.test`     | Password recovery and reset           |
| `phase1.managed@hanaply.test`      | Admin suspend/restore/session actions |
| `phase1.registration@hanaply.test` | Created through the registration UI   |

These credentials are test data, not development seed accounts, and do not exist after the browser suite tears down.

## First Super Admin

Bootstrap is a server-only, one-time, confirmation-gated operation. First create and verify the owner identity, set the service variables in a private shell, and run:

```powershell
$env:ADMIN_BOOTSTRAP_ENABLED = 'true'
$env:ADMIN_BOOTSTRAP_EMAIL = 'owner@example.com'
$env:SUPABASE_URL = 'https://your-project.supabase.co'
$env:SUPABASE_SERVICE_ROLE_KEY = '<secret-manager-value>'
pnpm admin:bootstrap --user <verified-auth-uuid> --confirm ASSIGN_FIRST_SUPER_ADMIN
```

Immediately disable the gate and remove the service key from the shell afterward. The script verifies the UUID/email pair and email confirmation, requires HTTPS remotely, calls an atomic service-only function, protects against a second owner bootstrap, and writes one audit event. It has not been run against a hosted project. Follow [Admin bootstrap](docs/admin-bootstrap.md) before using it.

## Commands

| Command                                        | Purpose                                                        |
| ---------------------------------------------- | -------------------------------------------------------------- |
| `pnpm dev`                                     | Start web, API, and idle worker development processes          |
| `pnpm format` / `pnpm format:check`            | Write or verify Prettier formatting                            |
| `pnpm lint`                                    | Run strict flat-config ESLint                                  |
| `pnpm typecheck`                               | Type-check all workspaces and test tooling                     |
| `pnpm test`                                    | Run unit, component, email, and API integration tests          |
| `pnpm build`                                   | Build all workspaces and the Next.js production app            |
| `pnpm db:start` / `pnpm db:stop`               | Start or stop local Supabase                                   |
| `pnpm db:reset`                                | Recreate the database from forward-only migrations             |
| `pnpm db:lint`                                 | Run the Supabase schema linter at error severity               |
| `pnpm db:test`                                 | Run pgTAP database, catalog, and RLS tests                     |
| `pnpm db:types` / `pnpm db:types:check`        | Write or verify generated database types                       |
| `pnpm admin:bootstrap`                         | Run the gated first-Super-Admin tool                           |
| `pnpm e2e`                                     | Run real local auth/admin, responsive, keyboard, and Axe tests |
| `pnpm openapi:generate` / `pnpm openapi:check` | Write or verify OpenAPI 3.1                                    |
| `pnpm tokens:check`                            | Verify generated design-token outputs                          |
| `pnpm secrets:check`                           | Scan committed source for credential patterns                  |
| `pnpm audit:prod`                              | Audit production dependencies at high severity                 |
| `pnpm validate`                                | Run all non-database local gates                               |
| `pnpm validate:local`                          | Reset and validate the complete local system                   |

`pnpm validate:local` requires Docker Desktop and local Supabase. It resets the database before pgTAP and browser tests, so do not point the local CLI at a shared or production project.

## Repository map

```text
apps/web                  Next.js presentation, Supabase SSR sessions, and server actions
services/api              Bearer-only REST orchestration and permission guards
services/worker           Payment notification/cleanup maintenance and worker health
packages/auth             Shared validation, redirect, account-status, and RBAC primitives
packages/contracts        Canonical Zod routes, OpenAPI, task schemas, and fetch client
packages/database         Typed clients and generated schema types
packages/email            Capture/disabled/Resend providers and versioned templates
packages/entitlements     Fail-closed subscription evaluation
packages/observability    Correlation context and sensitive-field redaction
packages/platform         Feature and platform-version evaluation
packages/design-tokens    Canonical JSON tokens and generated outputs
packages/ui               Accessible Hanaply components
supabase/migrations       Forward-only Phase 0, Phase 1, and Phase 2 schema/catalog migrations
supabase/tests/database   pgTAP constraints, permissions, and RLS tests
templates                 Supabase Auth confirmation and recovery email templates
tests                     Unit, API, component, and browser acceptance tests
tooling                   Drift, secret, bootstrap, and test runners
```

## Documentation

- [Architecture](docs/architecture.md)
- [Authentication](docs/authentication.md)
- [Authorization](docs/authorization.md)
- [Email operations](docs/email.md)
- [Admin bootstrap](docs/admin-bootstrap.md)
- [Database and RLS](docs/database.md)
- [Security and storage](docs/security.md)
- [Mobile readiness](docs/mobile-readiness.md)
- [Product lock](docs/product-lock.md)
- [Roadmap](docs/roadmap.md)
- [Owner actions](docs/owner-actions.md)
- [Phase 0 report](docs/phase-0-report.md)
- [Phase 1 report](docs/phase-1-report.md)
- [Phase 2 report](docs/phase-2-report.md)

Privacy and terms remain owner-review drafts, not approved legal advice. Hosted Supabase, Resend/DNS, production URLs, first-owner bootstrap, deployment, and production smoke validation remain explicit owner actions.
