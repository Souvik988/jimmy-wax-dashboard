# Bakaloo parity and API coverage

Status legend: `not started` · `in progress` · `implemented` · `verified`.

## Reference capability matrix

| ID | Decision | JIMMY & WAX outcome | Phase | Status |
|---|---|---|---:|---|
| UI-01 | replace | shared design tokens + campaigns | 11,15 | verified - shared design base editor + per-channel overrides (unify) + campaigns; contrast/type guard-rails |
| UI-02 | drop | no store tabs or B2B audience | — | verified by scope |
| UI-03 | adapt | two-channel builder shell | 10–13 | implemented - channel switcher, document list, structure tree + inspector (no canvas) |
| UI-04 | adapt | typed block libraries | 10–13 | verified - 34 block types round-trip live |
| UI-05 | keep | keyboard-capable reorder/duplicate/visibility | 12–13 | verified - keyboard reorder/duplicate/visibility (e2e keyboard test) |
| UI-06 | adapt | block and chrome selection | 11–13 | implemented - block palette per channel/page; chrome and navigation forms from backend schemas |
| UI-07 | keep | schema-driven data/style editors | 10–13 | verified - schema-driven forms for blocks, design system, navigation, chrome |
| UI-08 | adapt | collection/category/manual bindings | 12–13 | implemented - live product/collection/category pickers with availability warnings |
| UI-09 | adapt | shared action picker | 10 | verified - Action picker with live catalogue search (e2e) |
| UI-10 | adapt | image slot dimensions/aspect warnings | 12–13 | implemented - alt/focal/decorative enforced; general image-quality warnings (too small, soft in full-width slots, extreme shape) on every media field. Exact per-slot pixel sizes need slot specs from the backend/owner |
| UI-11 | adapt | token and page starter layouts | 11–13 | implemented - starter layouts for empty pages (e2e) |
| UI-12 | keep | bounded undo/redo | 10 | verified - bounded undo/redo |
| UI-13 | replace | server autosave + revision conflict | 10 | implemented - explicit save creates a server revision; local draft recovery; If-Match conflicts (not timed autosave, ADR in phase notes) |
| UI-14 | adapt | validation, immutable releases, schedule | 15 | verified live - validation, diff, publish, schedule (MFA, idempotency) |
| UI-15 | adapt | release diff, rollback and cancel | 15 | verified live - rollback, cancel, kill switch (e2e) |
| UI-16 | adapt | typed banner/announcement blocks | 12–15 | implemented - announcement blocks and announcements library |
| UI-17 | adapt | app/web navigation editor | 11 | implemented - app/web navigation editors from backend schemas |
| UI-18 | adapt | approved assets, bundled fallback | 09,11 | implemented - approved-media picker; bundled fallbacks are client-side |
| UI-19 | keep | app update controls | 17 | verified - app version policy |
| UI-20 | adapt | store pause controls | 05,19 | verified for pause/resume; broader settings remain Phase 19 |
| UI-21 | adapt | Markdown policy documents | 19 | verified - Markdown policy documents with safe preview, draft + publish (e2e) |
| UI-22 | adapt | care guides and stories | 14 | implemented - care guides and stories in the content library |
| UI-23 | adapt | admin-only feature flags | 19 | implemented - admin-only feature flags |
| UI-24 | adapt | true client previews first | 12–15 | implemented - website: real storefront draft framed in the Studio Preview tab (phone/tablet/desktop, verified live) plus new-tab preview; app: preview token + device command (the app fetches the draft; on-screen rendering of blocks is the remaining adapter work) |
| OPS-01 | adapt | real overview, alerts, no rider map | 05 | verified |
| OPS-02 | keep | orders, filters, export, invoice/packing | 06 | complete with documented exceptions — list/detail/notes/lifecycle/cancel/print live; invoice BFF containment and missing DTO fields tracked by DASH-BR-008/009 |
| OPS-03 | later | manual orders only with new contract | later | not started |
| OPS-04 | adapt | returns/refunds, no wallet | 07 | complete with exceptions — return decisions/read-only refunds; receipt blocked by missing inventory MFA guard; refund process withheld pending gateway/eligibility capability |
| OPS-05 | adapt | products/variants, no food fields | 08 | verified live 2026-10-09 - guarded CSV commit (previewed price change, reason, revert), variant details editor, archive/restore, duplicate; see tests/e2e/catalog-writes-live.local.spec.ts and guarded-writes-live.local.spec.ts |
| OPS-06 | later | families only if variants require them | later | not started |
| OPS-07 | keep | categories and collections | 08 | in progress — protected workflow and role boundary built; reviewed category create, manual/smart collection create and expectedRev edit; unguarded category writes, collection delete and undocumented resolver preview withheld; live mutation proof remains |
| OPS-08 | adapt | inventory ledger and audited adjustment | 08 | in progress — protected complete-snapshot view, cursor ledger and AAL2 adjustment UI; live role boundary and Catalog write denial verified; successful MFA adjustment, conflict and audit proof remain |
| OPS-09 | adapt | customers, notes, privacy/export | 16 | verified - masked customers, audited reveal, notes, block, MFA-gated CSV export |
| OPS-10 | adapt | review/photo moderation | 16 | implemented - review and photo moderation |
| OPS-11 | drop | provider/manual fulfilment, no riders | — | verified by scope |
| OPS-12 | replace | Shipping Center, manual first | 07 | complete with exceptions — manual shipment flow, guarded settings and delivery-area edits (verified live); provider dispatch (courier comparison, ship, label, bulk) is built behind a capability gate and unit-tested but NOT run live (no processing order locally; Shiprocket parked). See deploy/README.md 'Connecting Shiprocket' |
| OPS-13 | later | recovery policy required | later | not started |
| OPS-14 | keep | audit log/diffs | 18 | verified - audit log with before/after |
| OPS-15 | later | customer event model required | later | not started |
| MKT-01 | adapt | GST-correct coupon types | 17 | verified - coupons (create/deactivate live; cart application via API) |
| MKT-02 | later | promotion engines require policy | later | not started |
| MKT-03 | drop | no spin/scratch or gamification | — | verified by scope |
| MKT-04 | adapt | transactional templates and later campaigns | 17 | verified - message templates with preview/test send |
| MKT-05 | drop | no WhatsApp CRM | — | verified by scope |
| MKT-06 | later | payment offers require provider | later | not started |
| SET-01 | adapt | GST-inclusive fees and checkout policy | 05,19 | checkout readiness/activation state verified; editable settings remain Phase 19 |
| SET-02 | adapt | provider status, never secret forms | 19 | implemented - integration status + test, no secret forms |
| SET-03 | adapt | PIN allow-list plus provider check | 07,19 | implemented - read-only list plus guarded edit (reason + list etag, 409 on stale, admin MFA); verified live 2026-10-09 (guarded-writes-live.local.spec.ts: add/remove, stale etag 409, audit) |
| SET-04 | keep | fixed roles, MFA and sessions | 03,19 | verified |
| SET-05 | adapt | TOTP/security recovery controls | 03,19 | verified |
| SET-06 | keep | command palette/shortcuts | 02 | verified |
| SET-07 | adapt | sales, GST and shipping analytics | 18 | implemented - sales, products, customers, shipping, returns, geo analytics |
| SET-08 | adapt | GST exports when merchant data exists | 18 | implemented - GSTR-1 working paper (table 7 B2C summary + table 12 HSN summary, JSON and offline-tool CSV) for one IST month, reconciled to order tax; verified live. Not a filing: no credit notes/B2B/exports; needs merchant GSTIN and variant HSN codes for CGST/SGST split and HSN rows |
| SET-09 | adapt | catalogue import/export, no procurement | 08 | implemented - export, dry-run and guarded commit (exact previewed file, reason, stale/replay refusal); live commit proof pending |

## Contract operation-family coverage

| Family | Planned surface | Phase | Status |
|---|---|---:|---|
| public health, store settings | shell connectivity/public policy | 01 | verified |
| admin auth, me, sessions, MFA | BFF identity and role UX | 03 | verified |
| dashboard, health, store status, checkout, integrations, audit, sales | overview/system status and safe controls | 05 | verified with runtime parsers; generic contract schemas requested in DASH-BR-007 |
| orders, notes, invoice, packing, exports | orders operations | 06 | complete with exceptions — live list/detail/notes/status/cancel/print/CSV; invoice issue blocked by missing GST profile and backend guard drift (DASH-BR-008); reveal and full allocations need DTO fields (DASH-BR-009) |
| shipments, provider, serviceability, returns, refunds | fulfilment center | 07 | complete with exceptions — live manual shipment and returns/refunds role matrix verified; serviceability/settings/PIN shapes observed live earlier in phase; latest delivery-tools browser role rerun blocked by Docker Engine API 500; receipt withheld for DASH-BR-016, refunds read-only, provider intentionally not live-verified |
| products, variants, categories, collections, inventory, import/export | catalogue | 08 | in progress — product/inventory/taxonomy workflows and explicit CSV export/dry-run built; live six-role boundary, export and dry-run verified; customer-facing write/audit/MFA and unsafe CSV commit acceptance remain blocked |
| media and usage | media library | 09 | implemented with exceptions — strict DTOs, server filters, raw-byte upload, same-origin public proxy, rights/publicity warnings, detail/usage and Admin review; `pnpm verify` 44 files / 212 tests passed. Live auth/upload/approval/Range, axe, responsive and keyboard proof pending; archive/bundling withheld for DASH-BR-039–043. |
| experience docs, validation, releases, preview, presence, campaigns | Experience Studio | 10–15 | implemented - route-verified live (see DASH_PROGRESS.md) |
| content library and policies | Studio content | 14,19 | implemented - route-verified live (see DASH_PROGRESS.md) |
| customers, reveal, block, exports, reviews | customer support | 16 | implemented - route-verified live (see DASH_PROGRESS.md) |
| coupons, message templates, outbox, app versions | marketing | 17 | implemented - route-verified live (see DASH_PROGRESS.md) |
| analytics, GST, audit, ops | reporting and operations | 18 | implemented - route-verified live (see DASH_PROGRESS.md) |
| settings, store status, flags, integrations, team | platform | 19 | implemented - route-verified live (see DASH_PROGRESS.md) |

## Phase 04 shared-engine evidence (does not mark Phase 06 complete)

| Capability | Evidence | Status / limit |
|---|---|---|
| Cursor-paged order reference | Real `/orders` browser E2E, live `{items,nextCursor}`, status/search URL state, responsive captures | verified read-only slice; lifecycle/detail remains Phase 06 |
| Customer-list envelope | Real backend probe confirmed `{items,nextCursor}`; PII fields not retained | shape observed; customer UI/parser remains Phase 16 |
| Order CSV export | Real AAL2 export returned `text/csv`; UI requires dates and supports MFA-aware request | verified with a 400-day cap; endpoint and browser both buffer the whole export (DASH-BR-004 / R-018) |
| Settings concurrency | Real stale `expectedVersion` PATCH returned 409 without a successful write | stale rejection verified; two-browser successful-write race not exercised |
| Store-status safe observation | Real GET plus same-value AAL1 PUT returned expected response without changing pause/checkout | verified no-op only; Phase 05 owns actual pause/resume controls |
| Studio ETag conflict | Conflict policy test double | not real-backend verified; re-test with Phase 10 documents |
| Idempotency and multipart upload | Unit tests cover key retention/header and upload progress/cancel/schema | real mutation integration deferred to safe consuming flows; decision pending |
| Contract-backed test fixture tooling | Existing focused Vitest mocks and live Playwright checks | generated MSW handlers + recorded-fixture harness not implemented; R-021 |
