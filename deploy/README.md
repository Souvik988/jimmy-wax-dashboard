# Deploying the operator dashboard

The dashboard is a Next.js server (a "BFF") that holds the operator session in an encrypted cookie and forwards requests to the
commerce API. Caddy sits in front of it and handles HTTPS certificates automatically.

## Before you start

| You need | Notes |
|---|---|
| A server with Docker and ports 80 and 443 open | Any small VM is enough. |
| Two DNS names pointing at it / at the backend | e.g. `ops.example.com` (this dashboard) and `api.example.com` (the commerce API). |
| The commerce API already running over HTTPS | See the backend settings below. |

## 1. Configure

```bash
cd deploy
cp .env.production.example .env.production
# edit .env.production: the two origins, DASHBOARD_HOST, ACME_EMAIL and a fresh DASHBOARD_SESSION_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # paste as DASHBOARD_SESSION_SECRET
```

Keep `.env.production` out of git and out of chat. Use your host's secret manager if it has one.

## 2. Check it (from the repository root)

```bash
set -a; . deploy/.env.production; set +a
pnpm exec tsx tools/preflight-production.ts --probe
```

It fails (exit code 1) on: plain `http`, local addresses, a weak or short secret, insecure cookies, a dashboard that points at itself,
and, with `--probe`, a backend that is not ready or whose admin routes answer without a login. **Do not deploy while it reports FAIL.**

## 3. Start

```bash
cd deploy
docker compose --env-file .env.production up -d --build
docker compose ps          # both services should become "healthy"/running
```

Caddy fetches the certificate on the first request to `https://<DASHBOARD_HOST>`; DNS must already point at the server.

## Backend settings the dashboard relies on

Set these on the commerce API, not here:

- `ADMIN_REQUIRE_MFA=true` (the default). Publishing, rollback, the kill switch, team, settings, refunds, stock changes and PIN edits all depend on it.
- `CORS_ORIGINS` includes `https://<DASHBOARD_HOST>` only if browsers call the API directly; the dashboard itself talks server-to-server.
- Real email delivery (SMTP) for operator invitations and customer notices; without it invitations cannot be delivered.
- `SHIPPING_PROVIDER=none` keeps manual courier entry. To connect Shiprocket later see "Connecting Shiprocket" below. Never use `fake` in production (the backend refuses it).
- Database backups on and a restore drill done.

## First sign-in

1. Create the first admin on a trusted machine with the backend's `scripts/create-admin.ts` (a strong password is generated and shown once).
2. Sign in, complete authenticator (TOTP) enrolment and store the recovery codes somewhere private.
3. Invite the rest of the team from **Settings → Team** with the narrowest role that works.
4. Remove every local or test operator account (`live-guard-…@local.…`, `admin@local.…`). The dashboard ships no credentials.

## Connecting Shiprocket (when you are ready)

No dashboard change is needed. On the backend set `SHIPPING_PROVIDER=shiprocket`, `SHIPROCKET_EMAIL`, `SHIPROCKET_PASSWORD`,
`SHIPROCKET_WEBHOOK_TOKEN` (and `SHIPROCKET_BASE_URL` only if told to), register the webhook with the same token, restart the API and
workers, then open **Shipping centre**: it shows "Provider reachable", and ready orders gain **Ship via provider** (courier comparison,
cost, label PDF, bulk shipping). Set the pickup location and PIN in **Shipping settings**, then ship one low-value test order first.

## Updating and rolling back

```bash
git pull && docker compose --env-file .env.production up -d --build     # update
docker compose --env-file .env.production logs -f dashboard             # watch it
```

To roll back, check out the previous commit and run the same `up -d --build`. The dashboard keeps no data of its own, so a rollback is
safe; operators may need to sign in again. Studio releases are rolled back in the dashboard itself (**Studio → Releases → Roll back**).

## Health and monitoring

- `GET /api/health` answers 200 when the dashboard can reach the backend (used by Docker and Caddy).
- Backend admin writes are rate-limited (HTTP 429 under bursts); the dashboard never retries a write automatically.
- Watch Caddy's JSON access log for repeated 401/403/429 on `/api/auth/*`.
