# Hanaply

Hanaply is a Philippines-first career intelligence SaaS foundation. This repository contains the Phase 0 production architecture: a responsive Next.js web shell, a mobile-ready NestJS API, an idle worker, shared contracts and providers, a Supabase/PostgreSQL security model, and executable validation gates.

Phase 0 does not ingest jobs, collect payments, generate application materials, send email, call an LLM, accept document uploads, deliver push notifications, or run a production queue. User-facing pages state those limits directly.

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

After `pnpm db:start`, run `supabase status -o env` and map its local-only values into `.env.local`:

- `API_URL` to both Supabase URL variables
- `PUBLISHABLE_KEY` to both publishable-key variables
- `SERVICE_ROLE_KEY` to `SUPABASE_SERVICE_ROLE_KEY`
- `DB_URL` to `SUPABASE_DB_URL`

Never commit `.env.local`, use a hosted service key in the browser, or reuse local development keys outside the local stack.

Local services use these ports:

| Service          | URL                      |
| ---------------- | ------------------------ |
| Web              | `http://localhost:3100`  |
| API              | `http://localhost:3101`  |
| Worker health    | `http://localhost:3102`  |
| Supabase API     | `http://127.0.0.1:54321` |
| PostgreSQL       | `127.0.0.1:54332`        |
| Supabase Studio  | `http://127.0.0.1:54323` |
| Local mail inbox | `http://127.0.0.1:54324` |

The worker starts in honest idle mode. `WORKER_MODE=active` fails startup because no production queue adapter exists in Phase 0.

## Commands

| Command               | Purpose                                                        |
| --------------------- | -------------------------------------------------------------- |
| `pnpm dev`            | Start web, API, and idle worker development processes          |
| `pnpm format`         | Format supported repository files                              |
| `pnpm format:check`   | Verify formatting without writes                               |
| `pnpm lint`           | Run strict ESLint rules                                        |
| `pnpm typecheck`      | Type-check all workspaces and test tooling                     |
| `pnpm test`           | Run Vitest unit, component, and API integration tests          |
| `pnpm build`          | Build all 15 workspaces and the Next.js production application |
| `pnpm db:start`       | Start local Supabase containers                                |
| `pnpm db:stop`        | Stop local Supabase containers                                 |
| `pnpm db:reset`       | Recreate the database from forward-only migrations             |
| `pnpm db:lint`        | Run the Supabase schema linter at error severity               |
| `pnpm db:test`        | Run the pgTAP database and RLS suites                          |
| `pnpm db:types`       | Regenerate checked-in TypeScript database types                |
| `pnpm db:types:check` | Fail on local schema/type drift                                |
| `pnpm e2e`            | Run Playwright, Axe, auth, and responsive acceptance tests     |
| `pnpm validate`       | Run all non-database local gates                               |
| `pnpm validate:local` | Run all gates including reset, pgTAP, type drift, and E2E      |

`pnpm validate:local` requires Docker Desktop and local Supabase to be running. Browser setup creates and removes its own local users; no fake users are seeded by migrations.

## Repository map

```text
apps/web                  Next.js presentation and Supabase web sessions
services/api              Bearer-only REST orchestration and authorization
services/worker           Idle worker health shell and queue contracts
packages/contracts        Canonical Zod REST/task schemas and fetch client
packages/database         Typed Supabase clients and generated schema types
packages/auth             Redirect and permission primitives
packages/entitlements     Fail-closed subscription evaluation
packages/platform         Feature-rule and platform-version evaluation
packages/ai               Disabled provider-neutral AI boundary
packages/email            Disabled provider-neutral email boundary
packages/observability    Pino redaction and correlation context
packages/design-tokens    Canonical JSON tokens and generated outputs
packages/ui               Accessible Hanaply component primitives
packages/testing          Deterministic cross-package fixtures
supabase/migrations       Forward-only schema and catalog
supabase/tests/database   pgTAP constraints, RLS, and lifecycle tests
tests                     Unit, component, API, and browser acceptance tests
tooling                   Drift, secret, bootstrap, and runner tooling
```

## Documentation

- [Architecture](docs/architecture.md)
- [Product lock](docs/product-lock.md)
- [Database and RLS](docs/database.md)
- [Security and storage](docs/security.md)
- [Mobile readiness](docs/mobile-readiness.md)
- [Roadmap](docs/roadmap.md)
- [Owner actions](docs/owner-actions.md)
- [Phase 0 report](docs/phase-0-report.md)

The privacy and terms pages in the application are owner-review drafts, not approved legal advice.
