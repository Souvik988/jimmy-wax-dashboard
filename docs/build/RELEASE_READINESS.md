# Release readiness: addendum 2026-10-13 (contract 1.4.0, production build)

| Check | Result |
|---|---|
| `contract:check`, `tsc`, `eslint`, `vitest` | PASS: 68 files / 398 tests |
| `pnpm build`, `docker build`, container smoke run | PASS (non-root, `/api/health` 200, `X-Robots-Tag: noindex`, no `X-Powered-By`) |
| `pnpm audit --prod` | No known vulnerabilities |
| Live drift probe: 63 dashboard reads parsed against the real backend | PASS (initially 2 failures, fixed) |
| Live specs on the production build: guards, publish, website, preview, finance, guarded writes, catalogue writes, admin writes, 20-route smoke | PASS |
| 40 routes x 375/768/1440 with axe, overflow, focus, keyboard | PASS |
| Role matrix | 155 checks, 0 mismatches |

Not proven: a real gateway refund (no Razorpay sandbox), provider dispatch (Shiprocket), a human screen-reader session, the production deployment itself.

# Release readiness: addendum 2026-10-10

| Check | Result |
|---|---|
| `tsc`, `eslint`, `vitest` | PASS: 61 files / 325 tests |
| Signed-in sweep: 40 routes x 375/768/1440, axe WCAG 2 A/AA/2.2 AA (serious/critical), horizontal overflow, skip link, visible focus, no keyboard trap | PASS: 120 screenshots, 0 findings (`docs/build/evidence/responsive/`) |
| Role matrix: 5 roles x every write endpoint (incl. shipping, archive/restore, discard-draft) + 5 roles x 17 routes | PASS: 155 checks, 0 mismatches |
| Guarded writes live: CSV commit, variant details, shipping settings, delivery areas, archive/restore, coupon, team invite, publish, kill switch, rollback, Studio -> real website -> rollback | PASS (see `DASH_NEXT_ACTION.md` for spec names) |
| Custom page keys, Return to live version, GSTR-1 working paper, in-Studio website preview, app preview token | PASS live |
| Backend (own repo): discard-draft, duplicate-many-times, GSTR-1, schema generator | PASS integration/unit tests |
| App (own repo): experience repository + preview token | PASS: 7 tests, `flutter analyze` clean |

Not proven live: provider dispatch (no processing order locally; Shiprocket parked), the app rendering the bundle (data layer done, `HomeScreen` not wired), a human screen-reader session (`SCREEN_READER_CHECKLIST.md`), production deployment (`deploy/`).

# Release readiness — 2026-10-08

## Automated evidence (all re-runnable)
| Check | Command | Result |
|---|---|---|
| Contract pin, types, lint, unit tests, production build | `pnpm verify` | PASS — 49 test files / 247 tests; build emits every route |
| All 34 Studio block types: add via engine → save to the real backend → read back → validate | `ROUNDTRIP_EMAIL=… ROUNDTRIP_PASSWORD=… pnpm exec tsx tools/studio-roundtrip.local.ts` | PASS 34/34 (local dev backend only; refuses non-local hosts) |
| Every Phase 10–19 route renders against the real backend with no console errors and no serious/critical axe violations (WCAG 2 A/AA); real edit → save → restore through the schema form; field-error display | `LOCAL_ADMIN_EMAIL=… LOCAL_ADMIN_PASSWORD=… pnpm exec playwright test tests/e2e/remaining-phases.local.spec.ts` | PASS (21 tests, admin role) |

## Production checklist (owner / ops)
1. Inject `DASHBOARD_SESSION_SECRET` (32 random bytes), `BACKEND_ORIGIN` and `DASHBOARD_PUBLIC_ORIGIN` (the https origin operators use; without it sign-in is rejected behind a TLS proxy) from a secret manager; leave `DASHBOARD_COOKIE_SECURE` unset. Terminate TLS in front (HSTS at the proxy). See `.env.example`.
2. Run the backend with `ADMIN_REQUIRE_MFA=true`: verified identity gates publish, rollback, kill switch, team, settings, flags, integrations, template edits, customer block.
3. Build with the `Dockerfile`; health probe is `GET /api/health`.
4. Backend admin writes are rate-limited (429 under bursts). The dashboard never auto-retries writes.
5. No operator credentials are shipped; remove the disposable local operators.

## Known limits (honest list)
- The real WEBSITE renders published Studio releases (end-to-end test passes; bundle cache about 60 s). The mobile APP adapter parses the live bundle (Flutter unit test); on-device rendering was not exercised. No in-dashboard rendered preview; use backend preview-token links.
- Standard Studio pages cannot be deleted (backend), only emptied (DASH-BR-047).
- Tokens/navigation/chrome have no published JSON Schema; their forms are inferred (backend validates). Library entity schemas are a hand mirror (DASH-BR-046).
- `custom:<slug>` web pages cannot be opened (BFF path allowlist rejects `:`; DASH-BR-045).
- Role matrix (5 roles x 17 routes), 120 non-admin write checks, and MFA-gated publish/kill-switch/rollback/stock/approve/archive/invite/coupon/settings were exercised live (backend MFA mode is on by default).
- Not testable here: real client rendering of releases, live Shiprocket, human screen-reader session, production deployment, real SMTP.
- Phase 08/09 live acceptance now PASS locally (see DASH_PROGRESS.md); responsive screenshots and keyboard-only walkthroughs are still open.
