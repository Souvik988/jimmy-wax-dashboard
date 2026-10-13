## 0. Who you are and the situation
You are a Claude Code session working on ONE of four connected projects for **JIMMY & WAX**, a leather-care shop in India (prices in integer paise, GST-inclusive 18%, COD + prepaid). Another session built the operator **dashboard** and it is about 95% finished; your job is to make *your* project match it so the whole system works end to end. Do not rebuild the dashboard. If you believe the dashboard or the contract is wrong, say so with evidence instead of silently working around it.

| Project | Path | Stack | Local port |
|---|---|---|---|
| Dashboard (admin console; a Next.js BFF that holds the operator session and forwards to the backend) | `C:\Users\MSI\OneDrive\Desktop\jimmy&wax_dashboard` | Next.js 16, React 19 | 3200 |
| Backend (commerce API, experience API, workers, gateway) | `C:\Users\MSI\OneDrive\Desktop\jimmy&wax_backend\backend` | Express 5, PostgreSQL 17, pnpm workspace | gateway 8080 → commerce 4000, experience 4001 |
| Website (storefront) | `C:\Users\MSI\OneDrive\Desktop\jimmy_nd _wax_website` | Vite + React | 5174 |
| Mobile app | `C:\Users\MSI\OneDrive\Desktop\jimmy&wax_app` | Flutter | n/a |

### How the pieces fit
Operators use the dashboard. In its **Experience Studio** they edit *draft documents* per channel (`app` or `web`): a shared **design system** (colours, type, motion), per-channel **token overrides**, **navigation**, **chrome** (header/splash/footer/help/brand slots) and **pages** made of typed **blocks** (21 website blocks, 13 app blocks). A **release** is an immutable snapshot of the drafts; publishing flips a live pointer, rollback publishes an older snapshot again, and a per-channel **kill switch** makes clients fall back to their built-in design. Clients read the published result from the public API:
- `GET /v1/experience/web` and `GET /v1/experience/app`, with header `x-jw-client: <web|app>/<version>[+build]; platform=<android|ios|web>; caps=<comma-separated block types this build can draw>` (the server **holds back** block types the client does not list). Responses carry an `ETag`; send `If-None-Match`; cache ~60 s.
- Drafts: `GET /v1/experience/<channel>/preview?token=<short-lived token>` (the dashboard issues the token; never cache it; the website uses `?jw_preview=<token>` on any page URL; the app uses a debug-only `--dart-define=EXPERIENCE_PREVIEW_TOKEN=...`).
- Bundle shape (see `jimmy&wax_dashboard/docs/backend-contract/openapi.yaml` and `blocks.schema.json`): `{ schemaVersion, channel, enabled, release:{number,label,publishedAt}, tokens, navigation, chrome, pages:{<key>:{blocks:[{id,type,props,resolved?}],seo?,nativeSections?}}, media:{<mediaId>:{kind,url,alt,poster?,bundledKey?}}, content:{testimonials,careGuides,...,announcements}, generatedAt }`. `enabled:false` means "use the built-in design". Product lists are resolved server-side (`resolved.productIds`). `{{store.*}}` variables are substituted by the server.
- Page keys: website `home, shop, product, ritual, story`, plus `custom:<slug>` and `product:<slug>` templates; app `home, category, product, cart`.

### Source of truth for the contract (read these first, read-only unless you are the backend session)
`jimmy&wax_dashboard/docs/backend-contract/`: `openapi.yaml`, `api-index.md`, `blocks.schema.json` (all block prop schemas, `colorRoles`, `brandSlots`, `Action`, `MediaRef`, `VisibilityRules`, `BlockStyle`, `Seo`), `doc-schemas.json` (design system / token overrides / navigation / chrome JSON Schemas generated from the backend validators), `INTEGRATION_GUIDE.md`, `05_CLIENT_INTEGRATION_SPEC.md`, `02_EXPERIENCE_STUDIO_SPEC.md`, `CHANGELOG.md`. Also read `jimmy&wax_dashboard/AGENTS.md`, `docs/build/DASH_NEXT_ACTION.md`, `docs/build/BACKEND_REQUESTS.md`, `docs/build/RELEASE_READINESS.md`.

## 0b. Rules for every session
- **Secrets**: never write passwords, API keys, tokens or session secrets into code, tests, docs, commits or chat. Use environment variables / the host's secret manager. Placeholders look like `<VALUE>`; the owner fills them in.
- **No destructive actions without asking the owner**: no database reset (`dev-stack.ps1 -Reset`), no force-push, no deleting data, no publishing a Studio release to production.
- Prefer small, tested changes. After every change run that project's typecheck, lint and tests and report failures honestly (including what you could not verify).
- Money is integer paise; text is UTF-8; dates are ISO-8601 with offset; India Standard Time for display.
- **Contract changes** are made only by the backend session. Website/app sessions that need a change write a precise request (endpoint, example request/response, why) into `jimmy&wax_dashboard/docs/build/BACKEND_REQUESTS.md` style and continue with a safe fallback.
- Local machine notes: ~7 GB RAM (run one heavy process at a time); Postgres host port is **55432** (54422 is Windows-reserved); Git Bash mangles heredocs and `/v1/...` paths (use PowerShell + the file tools); folder names containing `&` break some tools (use a junction, e.g. `New-Item -ItemType Junction -Path C:\jwapp2 -Target '<path>'`).
- Start the local stack (never with `-Reset`): `docker start jimmywax-backend-postgres-1`; then in the backend folder `$env:PG_HOST_PORT='55432'; powershell -File scripts\dev-stack.ps1`; dashboard `powershell -File tools\start-dev-local.ps1 -Clean` (from the dashboard folder); website `npx vite --port 5174 --host 127.0.0.1`.
- Dashboard live tests you can re-run to prove nothing broke (from the dashboard folder; each creates and later disables a disposable admin): `powershell -File tools\run-live-spec.ps1 tests/e2e/<spec>`; relevant specs: `studio-publish.local.spec.ts`, `studio-to-website.local.spec.ts`, `studio-preview-live.local.spec.ts`, `studio-finance-live.local.spec.ts`, `guarded-writes-live.local.spec.ts`, `catalog-writes-live.local.spec.ts`, `admin-writes-live.local.spec.ts`; roles: `powershell -File tools\run-role-matrix.ps1`.

## 0c. Production configuration names (values are the owner's; never commit them)
| Where | Name | Meaning |
|---|---|---|
| Dashboard | `BACKEND_ORIGIN`, `DASHBOARD_PUBLIC_ORIGIN`, `DASHBOARD_SESSION_SECRET`, `DASHBOARD_STOREFRONT_ORIGIN`, `DASHBOARD_HOST`, `ACME_EMAIL` (leave `DASHBOARD_COOKIE_SECURE` unset) | see `deploy/README.md` there |
| Backend | `DATABASE_URL` (per service role), `PORT`, `CORS_ORIGINS`, `ADMIN_REQUIRE_MFA=true`, `STORAGE_DIR` or object storage settings, SMTP settings, `SHIPPING_PROVIDER` (`none` until Shiprocket) with `SHIPROCKET_EMAIL`, `SHIPROCKET_PASSWORD`, `SHIPROCKET_WEBHOOK_TOKEN`, optional `SHIPROCKET_BASE_URL`, payment provider keys when online payments are enabled, `FEATURE_CHECKOUT`, `FEATURE_COD`, `FEATURE_ONLINE_PAYMENTS` | see `packages/config/src/index.ts` |
| Website | `VITE_API_ORIGIN=https://<api-domain>` | public API origin |
| App | `--dart-define=API_ORIGIN=https://<api-domain>` (https required outside development), `APP_ENV=production` | `EXPERIENCE_PREVIEW_TOKEN` is debug-only |
