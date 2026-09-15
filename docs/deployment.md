# Vercel deployment

The repository deploys as one Vercel project with three services, defined in
[`vercel.json`](../vercel.json). Vercel builds each service separately from its
own root, then routes requests to them through the top-level `rewrites` table.
No hosted project, DNS record, or deployment exists yet; this document records
what the configuration requires before one is created. See
[Owner actions](owner-actions.md).

## Services and routing

| Service  | Root              | Framework | Serves                       |
| -------- | ----------------- | --------- | ---------------------------- |
| `web`    | `apps/web`        | `nextjs`  | Everything not matched below |
| `api`    | `services/api`    | (none)    | `/v1/*`                      |
| `worker` | `services/worker` | (none)    | Internal health only         |

Every path in `packages/contracts/src/api-contract.ts` begins `/v1/`, so one
rewrite covers the API without shadowing a web route:

- `/v1/(.*)` → `api`
- `/(.*)` → `web`

`apps/web` has exactly one route handler, `/auth/callback`, and no route under
`/v1`, so the two rules cannot collide. The service entries are internal by
default and are reached only through these rewrites.

`worker` deliberately has no public rewrite. Its `/health` endpoint is
unauthenticated and its `/ready` endpoint reports the worker's mode, queue name,
and last error code. That is operational information, not public information.

## Environment

A service binds the port the platform routes to. Both `services/api` and
`services/worker` now read an injected `PORT` ahead of `API_PORT` and
`WORKER_HEALTH_PORT`, which keep their local defaults of `3101` and `3102`. Do
not set `API_PORT` or `WORKER_HEALTH_PORT` on Vercel: an explicit value outranks
`PORT` and would bind the service where the router is not looking.

Set these for the deployed project:

- `NEXT_PUBLIC_API_URL` — the deployment's own origin, for example
  `https://hanaply.com`, **not** a separate API hostname. The `api` service is
  reachable at `/v1` on the same origin, so browser calls stay same-origin. This
  keeps `connect-src 'self'` sufficient in the CSP that `apps/web/src/proxy.ts`
  builds, and makes credentialed requests same-origin rather than cross-origin.
- `API_BASE_URL` — the same origin, used by the API and worker processes.
- `CORS_ALLOWED_ORIGINS` — the deployment origin. Not required for the
  same-origin path above, which is why the schema makes it a required non-empty
  string rather than optional: it still governs any cross-origin caller.
- `APP_BASE_URL`, `NEXT_PUBLIC_APP_URL` — the deployment origin.
- `SUPABASE_*`, `EMAIL_*`, and the AI settings — as [`.env.example`](../.env.example)
  describes. `RATE_LIMIT_STORE=memory` remains a hard production gate in
  `packages/config`, so a production deployment is refused until a distributed
  store exists.

`AUTH_RATE_LIMIT_PEPPER` must be at least 32 characters when `HANAPLY_ENV` is
`production`; the schema rejects a shorter one at startup.

## The worker does not poll on Vercel

`WORKER_MODE=active` is a long-running daemon. Vercel services are
request-triggered, so a deployed `worker` service answers `/health` and `/ready`
and runs none of the cycles those endpoints report on — the poll timer in
`JobIntelligenceWorker` and `PaymentMaintenanceWorker` never fires between
requests. Deploying it in that mode would produce a green health check over work
that is not happening.

Two honest options, and neither is implemented yet:

1. **Schedule `WORKER_MODE=once`.** A scheduler invokes the worker entry point
   with `WORKER_MODE=once`, which runs every job-intelligence cycle a single
   time and exits with the worker's own status. This is the same entry point
   `pnpm e2e` uses. The cycles are idempotent and ingestion takes a database
   lock, so overlapping runs are safe. Note that `once` covers the four
   job-intelligence cycles only; the payment maintenance cycles
   (`PaymentMaintenanceWorker`) have no one-shot equivalent today and would need
   one.
2. **Run the worker somewhere that keeps a process alive.** A container, a VM,
   or a worker-capable host, with Vercel serving only `web` and `api`. This
   needs no code change and keeps `WORKER_MODE=active` as written.

Until one of these is chosen and built, a Vercel deployment of this repository
has no working job ingestion, match computation, freshness, notification
delivery, subscription expiry, or storage cleanup.

## Local parity

Nothing here changes local development. `pnpm dev` still runs every service
through Turbo on `3100`/`3101`/`3102`, and `.env.local` still supplies
`API_PORT` and `WORKER_HEALTH_PORT` as before.
