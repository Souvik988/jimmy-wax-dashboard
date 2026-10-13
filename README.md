# Jimmy & Wax operator dashboard

The operator console and **Experience Studio** for the Jimmy & Wax store. Operators use it to run orders, shipping, returns and
refunds, the catalogue and media library, coupons, customers, GST reports, and to design, preview and publish what the mobile app and
the website show.

It is a Next.js application that acts as a **backend-for-frontend (BFF)**: the browser only ever talks to this server, and this server
talks to the commerce API.

```
Browser ──(same-origin, CSRF-checked)──► Dashboard (Next.js BFF) ──(Bearer token, server to server)──► Commerce API
                                          │  encrypted, httpOnly session cookie
                                          └─ roles and permissions enforced here AND by the API
```

## Requirements

- Node.js 22 or newer
- pnpm 11 (`corepack enable` or `npm i -g pnpm@11.20.0`)
- A running commerce API (see the backend repository) for anything beyond the unit tests

## Run it locally

```bash
pnpm install

# Process-only secret: 32 random bytes, base64
export DASHBOARD_SESSION_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")"
export BACKEND_ORIGIN=http://localhost:8080
export DASHBOARD_COOKIE_SECURE=false      # local plain-HTTP development only

pnpm dev                                   # http://localhost:3200
```

On Windows, `tools/start-dev-local.ps1` does the same and warms the main routes.

## Configuration

All configuration is environment variables; see [`.env.example`](.env.example). Nothing is read from files at runtime.

| Variable | Required | Purpose |
|---|---|---|
| `BACKEND_ORIGIN` | yes | `https://` origin of the commerce API. |
| `DASHBOARD_SESSION_SECRET` | yes | 32 random bytes, base64. Encrypts the session cookie. Rotating it signs everyone out. |
| `DASHBOARD_PUBLIC_ORIGIN` | behind a proxy | The origin browsers use. Without it CSRF origin checks fall back to the `Host` header. |
| `DASHBOARD_STOREFRONT_ORIGIN` | optional | Website origin allowed to be framed by Studio's "Preview draft on website". |
| `DASHBOARD_COOKIE_SECURE` | never in production | Set to `false` only for local plain-HTTP development. |

## Scripts

| Command | What it does |
|---|---|
| `pnpm verify` | Everything CI runs: contract check, typecheck, lint, unit tests, production build. |
| `pnpm contract:check` | Fails if `docs/backend-contract/` no longer matches `contract.lock.json` (the pinned backend API version). |
| `pnpm contract:generate` | Regenerates `src/lib/api/generated/schema.ts` from the OpenAPI file. |
| `pnpm test` | Unit tests (Vitest, jsdom). |
| `pnpm test:e2e` | Playwright. `*.local.spec.ts` files need the local stack, see below. |
| `pnpm preflight` | Production readiness probe for a deployment's environment (`tools/preflight-production.ts`). |
| `pnpm audit:prod` | Known-vulnerability scan of production dependencies. |

## Architecture notes

- **Contract first.** The backend publishes `openapi.yaml`, `blocks.schema.json`, `doc-schemas.json` and `entity-schemas.json`. They are
  copied into `docs/backend-contract/` and pinned by hash in `contract.lock.json`. To upgrade, copy the new pack, update the lock, run
  `pnpm contract:generate` and `pnpm verify`.
- **Strict runtime parsing.** Every API response is parsed with a Zod schema in `src/lib/api/resources/`. A field the dashboard does not
  know is a visible error, never silently ignored. `tools/contract-drift.local.ts` runs every read against a live backend to catch drift.
- **Guarded writes.** Changes to live data send the version stamp the operator loaded (`expectedRev`, `expectedUpdatedAt`,
  `expectedVersion`, `If-Match`) and, for sensitive ones, a reason that lands in the audit log. A stale write is refused, not merged.
- **Roles.** `src/lib/auth/permissions.ts` mirrors the backend role table. The BFF and the API both enforce it; the UI only hides what a
  role cannot do. Publishing, rollback, the kill switch, team, settings, refunds and stock changes need a fresh MFA step-up.
- **Security headers.** A per-request CSP nonce is set in `src/proxy.ts`; the remaining headers are in `next.config.ts`. The console is
  `noindex` and cannot be framed except by the configured storefront.

## Testing

```bash
pnpm test                 # ~400 unit tests, no services needed
```

Live specs (`tests/e2e/*.local.spec.ts`) run against the **local** backend with disposable operators and refuse to touch anything else.
They are driven by PowerShell helpers that create the operator, run, and disable it again:

```powershell
$env:PG_HOST_PORT = '55432'
powershell -File tools\run-live-spec.ps1 tests/e2e/taxonomy-media-guards-live.local.spec.ts
powershell -File tools\run-drift.ps1          # every read parsed against the live backend
powershell -File tools\run-role-matrix.ps1    # every role x every write endpoint
```

See [`docs/build/LOCAL_DEV.md`](docs/build/LOCAL_DEV.md) for bringing up the local backend stack.

## Deploying

[`deploy/README.md`](deploy/README.md) covers the Docker image, Caddy TLS, the environment template and the first-sign-in checklist.
Run `pnpm preflight` against the production environment before going live. The operational checklist is
[`docs/build/RELEASE_READINESS.md`](docs/build/RELEASE_READINESS.md).

## Project layout

```
src/app/            routes (App Router) and the BFF handlers under src/app/api
src/features/       one folder per area: orders, shipping, catalog, media, studio, insights, ...
src/components/     shared UI kit, layout shell, providers
src/lib/api/        typed API client, Zod resources, generated contract types
src/server/         session cookie, CSRF, token refresh, backend proxy
tests/unit/         Vitest
tests/e2e/          Playwright (CI-safe specs and *.local.spec.ts live specs)
tools/              contract check, preflight, live-run helpers
docs/backend-contract/   the pinned backend contract
docs/build/         decisions, progress log, risks, backend requests, release readiness
deploy/             docker compose, Caddy, runbook
```

## Open items

Tracked in [`docs/build/DASH_NEXT_ACTION.md`](docs/build/DASH_NEXT_ACTION.md): a screen-reader session, live Shiprocket and Razorpay
sandbox runs, and the production deployment itself need people, credentials or infrastructure.
