# Hand-off prompt (paste everything below the line into a new Claude Code session)

Secrets are NOT included on purpose. Wherever you see `<…>` put the real value yourself, in the host's secret manager or a local
`.env.production` that is never committed and never pasted into a chat.

---

You are continuing work on **JIMMY & WAX**, a leather-care shop. There are four projects on this Windows machine:

| Project | Path | Stack | Local port |
|---|---|---|---|
| Operator dashboard (admin console, a Next.js BFF) | `C:\Users\MSI\OneDrive\Desktop\jimmy&wax_dashboard` | Next.js 16 (Turbopack), React 19, TanStack Query, Zod, Vitest, Playwright, pnpm | 3200 |
| Backend (commerce + experience APIs, workers, gateway) | `C:\Users\MSI\OneDrive\Desktop\jimmy&wax_backend\backend` | Express 5, PostgreSQL 17, pnpm workspace | gateway 8080 (commerce 4000, experience 4001) |
| Website (storefront) | `C:\Users\MSI\OneDrive\Desktop\jimmy_nd _wax_website` | Vite + React | 5174 |
| Mobile app | `C:\Users\MSI\OneDrive\Desktop\jimmy&wax_app` | Flutter | n/a |

**Read first:** `jimmy&wax_dashboard/AGENTS.md` (this is NOT the Next.js you know; read `node_modules/next/dist/docs/` before writing Next code),
`docs/build/DASH_NEXT_ACTION.md`, `docs/build/RELEASE_READINESS.md`, `docs/build/SCREEN_READER_CHECKLIST.md`, `deploy/README.md`,
`jimmy&wax_app/docs/EXPERIENCE_ADAPTER_PLAN.md`.

## State of the dashboard (honest)
- All 20 planned phases are built. 325 unit tests, typecheck and lint pass. 40 routes x 375/768/1440 pass axe, overflow and keyboard checks.
- Verified live against the local backend with disposable operators: guarded CSV commit, variant edits, shipping settings and delivery areas,
  archive/restore, coupons, team invites, publish/kill switch/rollback, Studio edit -> real website -> rollback, in-Studio website preview,
  GSTR-1 working paper, custom pages, "Return to live version". All five non-admin roles match the permission table (155 checks).
- NOT production-ready until the items under "Remaining work" are done.

## How to run it locally
1. Docker Desktop up, then `docker start jimmywax-backend-postgres-1` (Postgres host port is **55432**, not 54422, because Windows reserved the default).
2. Backend: `cd jimmy&wax_backend\backend; $env:PG_HOST_PORT='55432'; powershell -File scripts\dev-stack.ps1` (**never `-Reset`**: it wipes data).
3. Dashboard: `powershell -File tools\start-dev-local.ps1 -Clean` (process-only session secret, `BACKEND_ORIGIN=http://localhost:8080`, `DASHBOARD_COOKIE_SECURE=false`).
4. Website (only for the storefront tests): in the website folder, `npx vite --port 5174 --host 127.0.0.1`.
5. Live tests: `powershell -File tools\run-live-spec.ps1 tests/e2e/<name>.local.spec.ts` creates a disposable admin, runs, disables it.
   Roles: `tools\run-role-matrix.ps1`. Unit: `pnpm exec vitest run`; also `pnpm exec tsc --noEmit` and `pnpm exec eslint .`.
- The machine has about 7 GB RAM and runs out; run one heavy process at a time. The Flutter folder name contains `&`: run Flutter from a junction (`New-Item -ItemType Junction -Path C:\jwapp2 -Target '<app path>'`).
- Git Bash mangles heredocs and `/v1/...` arguments; use PowerShell for pnpm/Playwright and the file tools for big edits.

## Configuration the dashboard needs in production (set in the host's secret manager)
| Name | Meaning |
|---|---|
| `BACKEND_ORIGIN` | `https://<api-domain>`, origin only |
| `DASHBOARD_PUBLIC_ORIGIN` | `https://<ops-domain>` that operators type |
| `DASHBOARD_SESSION_SECRET` | 32+ random bytes, base64: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `DASHBOARD_STOREFRONT_ORIGIN` | `https://<website-domain>` (enables the Studio website preview frame) |
| `DASHBOARD_HOST`, `ACME_EMAIL` | for the Caddy TLS proxy in `deploy/` |
| leave **unset** | `DASHBOARD_COOKIE_SECURE` |

Backend (not the dashboard): `ADMIN_REQUIRE_MFA=true`, real SMTP for invitations/notices, database backups with a tested restore,
`SHIPPING_PROVIDER=none` until Shiprocket is connected (`shiprocket` + `SHIPROCKET_EMAIL`, `SHIPROCKET_PASSWORD`, `SHIPROCKET_WEBHOOK_TOKEN`, optional `SHIPROCKET_BASE_URL`),
`merchant_gstin` set in store settings, HSN codes on every variant. Website: `VITE_API_ORIGIN=https://<api-domain>`.
App: `--dart-define=API_ORIGIN=https://<api-domain>` (and `EXPERIENCE_PREVIEW_TOKEN=<token>` only in debug builds).

Check before deploying: `pnpm exec tsx tools/preflight-production.ts --probe` (with the production variables exported). Deploy with `deploy/docker-compose.yml`.

## Remaining work (do these in order; do not skip the tests)
1. **Deploy** the dashboard behind TLS using `deploy/`; run the preflight; create the first admin with the backend's `scripts/create-admin.ts`; enrol an authenticator; delete every local/test operator (`live-guard-*`, `rm-*`, `admin@local.*`).
2. **Screen-reader session** with NVDA or VoiceOver following `docs/build/SCREEN_READER_CHECKLIST.md`; fix every defect found.
3. **App renders the Studio bundle**: wire `jimmy&wax_app/lib/core/data/experience_repository.dart` into `HomeScreen` (`lib/main.dart:879`) per `EXPERIENCE_ADAPTER_PLAN.md`; built-in design stays the fallback; widget test per block; check on an emulator.
4. **Shiprocket** (owner decision): connect on the backend, set pickup location/PIN, ship ONE low-value order through **Ship via provider**, check label and tracking, then enable bulk. The dashboard UI already exists and needs no change.
5. **Production smoke test** on the real domains: sign in with MFA, publish a no-op Studio release and roll it back, confirm the real website shows/reverts it, download a GSTR-1 CSV.
6. **Hardening**: monitoring/alerts on 5xx and repeated 401/403/429 at `/api/auth/*`; log retention; backup restore drill; penetration-style review of the BFF (`src/app/api/backend/[...path]/route.ts`, `src/server/auth/*`).
7. **Backend asks** still open: JSON Schemas for the six content-library entities; per-slot image size specs; documenting the admin write rate limit.

## Rules
- Never put passwords, API keys, session secrets or tokens in code, tests, commits, docs or chat. Use env vars / secret manager.
- Never run a destructive database command or `dev-stack.ps1 -Reset` without asking the owner. Never publish a Studio release to production without asking.
- Write operations the dashboard performs always go through the BFF with CSRF and a reason where the backend requires one; do not add auto-retry for writes.
- After any change: `pnpm exec tsc --noEmit`, `pnpm exec eslint .`, `pnpm exec vitest run`, and the relevant live spec. Report failures plainly.
