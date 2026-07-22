# Phase 0 report

Date: 2026-07-22 (Asia/Singapore)

Decision: **CONDITIONAL GO**

Every mandatory local architecture, migration, RLS, security, build, test, and browser gate passes. Remaining work is intentionally owner-controlled: hosted Supabase, production URLs/secrets, distributed rate limiting, Resend/provider implementation, secure first-admin bootstrap, legal approval, and deployment authorization.

## Delivered

- Private pnpm/Turborepo monorepo on Git `main`, Node 24 LTS and pnpm 11.10.
- Strict ESM TypeScript, flat ESLint, Prettier, dependency-aware builds, and catalogs.
- Next.js 16.2 App Router web experience on port 3100.
- NestJS 11/Fastify 5 bearer-only API on port 3101 and idle worker health shell on 3102.
- Canonical Zod route/task contracts, OpenAPI 3.1, shared fetch client, and safe envelopes.
- Supabase Auth sessions, account-status checks, explicit admin RBAC, and confirmation-gated bootstrap.
- Eight forward-only migrations, production-safe catalogs, forced RLS, and 80 pgTAP assertions.
- Four locked plans with complete database-backed entitlement values and fail-closed evaluation.
- Feature/platform evaluation, accessible design system, responsive shells, CSP/security headers, and honest empty states.
- Disabled AI/email/queue provider seams, redacted observability, and safe dead-letter metadata.
- Vitest, API integration, component, Playwright, Axe, drift, secret, audit, and CI gates.

## Validation evidence

| Command/gate          | Result                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Node/pnpm baseline    | PASS: Node 24.12.0, pnpm 11.10.0                                                                                   |
| `pnpm format:check`   | PASS                                                                                                               |
| `pnpm lint`           | PASS: zero warnings allowed                                                                                        |
| `pnpm typecheck`      | PASS: 15 workspaces plus tests/tooling                                                                             |
| `pnpm test`           | PASS: 9 files, 59 tests                                                                                            |
| `pnpm tokens:check`   | PASS: generated token outputs match JSON source                                                                    |
| `pnpm build`          | PASS: 15 workspaces; Next.js generated 21 routes                                                                   |
| `pnpm openapi:check`  | PASS: artifact matches 8 canonical REST operations                                                                 |
| `pnpm secrets:check`  | PASS: no committed key patterns                                                                                    |
| `pnpm audit:prod`     | PASS: no known production dependency vulnerabilities                                                               |
| `pnpm db:reset`       | PASS: eight migrations and empty activity seed                                                                     |
| `pnpm db:lint`        | PASS: no schema errors                                                                                             |
| `pnpm db:test`        | PASS: 5 files, 80 assertions                                                                                       |
| `pnpm db:types:check` | PASS                                                                                                               |
| `pnpm e2e`            | PASS: 9 scenarios including login/logout, suspension, admin, pricing, Axe, reduced motion, and all required widths |
| `pnpm validate`       | PASS after generated-cache secret-scan exclusion was narrowed                                                      |
| `pnpm validate:local` | Final rerun recorded below before handoff                                                                          |

Required widths verified without horizontal overflow: 1440, 1280, 1024, 768, 430, 390, and 360 px for marketing, customer, and admin shells.

## Defects caught during validation

- A stale Docker network and local port collision were cleared; PostgreSQL moved to local port 54332 while application ports remained locked at 3100-3102.
- pgTAP caught brittle function-count and data-modifying test patterns before the suite was finalized.
- Generated database/OpenAPI formatting was made deterministic and drift-checked.
- Browser testing found a suspended-account transition stuck on a streaming loading boundary; the login action now uses an API-authoritative result and a deliberate full-document transition for that state.
- Auth-user cleanup exposed an append-only audit/FK conflict; only nested FK actor anonymization is now allowed, with direct service mutation still rejected.
- Production audit found Sharp and PostCSS advisories; workspace overrides now use patched releases and the audit is clean.
- Secret scanning initially inspected generated Turbo cache data; it now excludes generated/runtime artifacts while continuing to scan committed source formats.

## Limitations

- Registration, recovery, reset, and verification are Phase 1 placeholders.
- No hosted migration, remote project link, live provider, upload, payment, job, LLM, notification, push, mobile app, deployment, tag, or push was performed.
- Worker mode remains idle; active mode is a startup error.
- Email and AI providers remain disabled.
- Production API startup is gated until a distributed rate-limit adapter exists.
- Privacy and terms remain owner-review drafts.

## Logical commits

1. `1d6d6e1` - Monorepo and tooling
2. `a1c8299` - Configuration and contracts
3. `2ef5a6e` - Design tokens and UI
4. `94e3ba9` - Web shells
5. `62a3e99` - API and worker
6. `014089e` - Supabase schema
7. `d9d4b7c` - RLS and database tests
8. `d42bf82` - Plans, entitlements, flags, and platforms
9. `98cce9f` - Authentication and authorization
10. `d7361e2` - CI and complete test coverage
11. Documentation and final validation - the commit containing this report

## Owner actions

Follow [owner-actions.md](owner-actions.md). Those actions require owner-selected accounts, credentials, vendors, URLs, legal approval, or deployment authority and were deliberately not inferred or executed.

## Final local rerun

`pnpm validate:local` completed successfully in 149.1 seconds after the documentation set was formatted. The single command reran formatting, lint, strict types, 59 Vitest assertions, token/build/OpenAPI/secret gates, all eight migrations, schema lint, 80 pgTAP assertions, generated database-type drift, and all 9 Playwright/Axe scenarios. Browser setup removed every temporary Auth user during teardown.
