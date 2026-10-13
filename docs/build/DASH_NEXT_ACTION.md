# Next action (updated 2026-10-13)

The dashboard is feature-complete against backend contract **1.4.0** and verified on the production build. What remains needs a person,
credentials or infrastructure; nothing is waiting on dashboard code.

## Verified this round (production build, local stack, disposable operators)

| Area | Evidence |
|---|---|
| Contract pin, typecheck, lint, 68 unit-test files / 398 tests, production build, Docker image build + smoke run | `pnpm verify`; `docker build .` (non-root, `/api/health` 200, `noindex`) |
| Every dashboard read parsed by its strict schema against the live backend (63 reads) | `tools/run-drift.ps1`. It found two real breakages (Categories and Media library failed on backend 1.4.0 fields); both fixed. |
| Category create / edit / reorder / delete, collection delete, media upload -> private preview -> archive -> restore, ETag header | `tests/e2e/taxonomy-media-guards-live.local.spec.ts` |
| Studio publish, kill switch, rollback; Studio -> real website -> rollback; website preview frame | `studio-publish`, `studio-to-website`, `studio-preview-live` |
| Guarded CSV commit, variant details, shipping settings, delivery areas, archive/restore, coupons, team invite, custom pages, GSTR-1 | `catalog-writes-live`, `guarded-writes-live`, `admin-writes-live`, `studio-finance-live` |
| 20 Studio/ops routes: no console errors, no serious axe findings; edit-save-restore; keyboard reorder | `remaining-phases` (26 tests) |
| 40 routes x 375/768/1440: axe WCAG 2 A/AA/2.2 AA, no horizontal overflow, skip link, focus, no keyboard trap | `responsive-a11y` (screenshots are git-ignored; `summary.json` is kept) |
| Every role x every write endpoint | `tools/run-role-matrix.ps1`: 155 checks, 0 mismatches |

Run them all with `powershell -File tools\run-live-suite.ps1` (needs the local stack, the production build served by
`tools\start-prod-local.ps1`, and the storefront on :5174).

## Built from the backend's answers (DASH-BR-001..050)

Invoice read (GET) vs issue (POST + reason + MFA); authenticated media preview; `X-JW-Upload-Meta` upload transport with structured rights
fields; media archive/restore with blockers and an `inUse` filter; category edit/reorder/delete and collection delete with revisions; gated
Process refund with `processable` / `blockedReason` / `paymentCapability`; order history card (status changes, shipments, returns, email
delivery); exact `x-slot` image-size guidance in Studio; ETag forwarded by the BFF; drift guards for document and library schemas.
Details: ADR-045..049 in `DASH_DECISIONS.md`, status table at the end of `BACKEND_REQUESTS.md`.

Two defects found and fixed while testing live: a reason prompt inside a drawer closed the drawer behind it (React bubbles nested dialog
`close` events), and a form opened in the first moment after page load was wiped when the session check finished.

## Still open (needs a person, credentials or an owner decision)

1. **Push to GitHub**: the folder is a local git repository; publishing needs the owner's go-ahead.
2. **Screen-reader session** with NVDA/VoiceOver: `docs/build/SCREEN_READER_CHECKLIST.md` (about 60 minutes).
3. **Razorpay sandbox**: Process refund is unit-tested and gated but has never sent money, because the local store has no gateway.
4. **Shiprocket** (parked on purpose): provider dispatch UI is built behind a capability gate; never run against a provider. Steps in `deploy/README.md`.
5. **Production deployment**: `deploy/` + `pnpm preflight`; set real SMTP and keep `ADMIN_REQUIRE_MFA=true` on the backend; delete all local/test operators.
6. **DASH-BR-023**: may Finance see cost price? Owner decision; cost stays Admin-only.
7. **DASH-BR-051**: app page blocks have no `placement` field yet (backend).
8. **GSTR-1** needs the merchant GSTIN in store settings and HSN codes on variants for CGST/SGST splits; it is a working paper, not a filing.
9. Backend notes: exports are bounded but not streamed; the local dev stack keeps the `MEDIA_PUBLIC_ALLOW_UNAPPROVED` bridge on (production refuses it), and its `dev-stack.ps1` comment about the dashboard previewing through the public URL is now outdated.

## Running the local stack on this machine
- Postgres host port is **55432**. After a reboot: `docker start jimmywax-backend-postgres-1`, then `$env:PG_HOST_PORT='55432'; powershell -File backend\scripts\dev-stack.ps1` (never `-Reset`), then `tools\start-dev-local.ps1 -Clean` or `pnpm build; tools\start-prod-local.ps1`.
- About 7 GB of RAM: run one heavy thing at a time.
