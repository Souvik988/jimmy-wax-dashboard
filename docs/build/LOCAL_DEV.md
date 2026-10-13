# Local development

## Verified environment — 2026-10-06 IST

- Dashboard: `C:\Users\MSI\OneDrive\Desktop\jimmy&wax_dashboard`, port `3200`.
- Backend project root: `C:\Users\MSI\OneDrive\Desktop\jimmy&wax_backend\backend`.
- Docker stack: PostgreSQL `54422`, commerce API `4000`, experience API `4001`, gateway `8080`.

## Start and reset backend

```powershell
Set-Location 'C:\Users\MSI\OneDrive\Desktop\jimmy&wax_backend\backend'
powershell -ExecutionPolicy Bypass -File .\scripts\dev-stack.ps1 -Reset
```

The reset intentionally restores production-like local safety: stock is zero and checkout is off. For local order flows only:

```powershell
docker exec jimmywax-backend-postgres-1 psql -U postgres -d jimmywax_dev -c "update inventory_positions set on_hand = 40" -c "update store_settings set checkout_enabled=true, checkout_policy_confirmed=true"
```

## Reachability evidence

`GET http://localhost:8080/healthz` → `200 {"status":"ok"}`

`GET http://localhost:8080/readyz` → `200 {"status":"ready"}`

`GET http://localhost:8080/v1/store-settings` → `200`, GST-inclusive policy, COD fee `2500` paise, shipping fee `4000` paise, and `checkoutOpen:false` after reset.

## Latest health probe — 2026-10-07 IST

- `/healthz` previously returned `200`; the latest `/readyz` returned `503 {"status":"not_ready"}`. A fresh read-only `docker ps` request did not return and was interrupted after the tool timeout.
- Fresh admin setup stalled on PostgreSQL connect before account creation. The identified child process was stopped. No backend reset, container restart, stock/checkout/provider change, or catalogue/inventory write was performed.
- Do not use `dev-stack.ps1 -Reset` to recover this state. Re-check the Docker Desktop engine and readiness first; preserve the existing local database and the delivered Phase 06/07 synthetic order.

## Recovery check — 2026-10-07 IST

- The local services later recovered without resetting PostgreSQL or changing checkout, stock, provider configuration, catalogue, or inventory. Current read-only checks: gateway `/healthz` 200, `/readyz` 200, and dashboard `/api/health` 200.
- The dashboard's protected `/catalogue` route returned 307 to `/login` when requested without an operator session; this is the expected auth boundary, not a route failure.
- The dashboard was run with a process-only random `DASHBOARD_SESSION_SECRET` as described below. No key or temporary operator credential is retained in this repository. Playwright role test accounts used for the Phase 08 run were disabled after the run; no catalogue or inventory fixtures were created.

## Local roles

Local accounts were created for `admin`, `support`, `catalog`, `fulfillment`, `finance`, and `designer` at `<role>@local.jimmywax.test`. Their generated one-time passwords were intentionally discarded rather than stored in this repository or command logs. Recreate a role when credentials are needed:

```powershell
$env:PG_ADMIN_URL = 'postgres://postgres:postgres@127.0.0.1:54422/jimmywax_dev'
pnpm exec tsx scripts/create-admin.ts --email admin@local.jimmywax.test --role admin
```

Use the printed password only in the current terminal session; do not commit it. TOTP codes may be obtained only from an already-enrolled operator's secret on a trusted machine.

## Dashboard BFF session secret

The dashboard refuses to create or decrypt operator sessions without `DASHBOARD_SESSION_SECRET`. For local HTTP only, start it with an ephemeral 32-byte key in the same PowerShell session; do not put the generated key in `.env`, source control, or screenshots:

```powershell
Set-Location 'C:\Users\MSI\OneDrive\Desktop\jimmy&wax_dashboard'
$env:DASHBOARD_SESSION_SECRET = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
$env:BACKEND_ORIGIN = 'http://localhost:8080'
$env:DASHBOARD_COOKIE_SECURE = 'false' # local HTTP only; production remains Secure by default
pnpm dev
```

The ephemeral key is intentionally lost when the terminal ends, invalidating its local sessions. Production must inject a persistent, randomly generated 32-byte secret from the host secret manager, terminate TLS, and leave `DASHBOARD_COOKIE_SECURE` unset or `true`. Never reuse local credentials or keys in production.

## Current tooling (2026-10-13)

On this machine PostgreSQL's host port is **55432** (54422 is in a Windows reserved range), so every helper below reads `PG_HOST_PORT`:

```powershell
$env:PG_HOST_PORT = '55432'
powershell -File ..\jimmy&wax_backendackend\scripts\dev-stack.ps1      # never -Reset on a database you want to keep
powershell -File tools\start-dev-local.ps1 -Clean                          # dashboard, next dev
pnpm build; powershell -File tools\start-prod-local.ps1                    # dashboard, the production build (what ships)
powershell -File toolsun-drift.ps1                                       # every read parsed against the live backend (no writes)
powershell -File toolsun-live-spec.ps1 tests/e2e/<name>.local.spec.ts    # one live spec with a disposable admin
powershell -File toolsun-live-suite.ps1                                  # all live specs + role matrix, one summary line each
```

Live specs that publish or compare with the real website also need the storefront on `http://localhost:5174`
(`npx vite --port 5174 --host 127.0.0.1` in the website folder). Run one heavy process at a time: the machine has about 7 GB of RAM.

The backend's dev stack sets `MEDIA_PUBLIC_ALLOW_UNAPPROVED=true`, so draft media is also reachable on the public URL locally. Production refuses
that flag. Set `DASHBOARD_EXPECT_PRIVATE_DRAFTS=1` to make the live media spec assert the production behaviour on a backend without the bridge.
