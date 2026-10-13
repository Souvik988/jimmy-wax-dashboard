# SESSION PROMPT: BACKEND (`jimmy&wax_backend`)

You are the **backend** session. You own the API contract the other three projects consume. Goal: make the backend fully match what the dashboard, website and app need, document every change in the contract, close the open requests, and make it production-deployable.

__SHARED__

## 1. What already exists (do not redo; review and keep)
Express 5 + PostgreSQL 17 monorepo (`apps/commerce-api`, `apps/experience-api`, `apps/workers`, `packages/*`; gateway script `scripts/dev-gateway.ts`; start script `scripts/dev-stack.ps1`). Roles: admin, support, catalog, fulfillment, finance, designer, each with permission strings (`catalog:write`, `shipping:write`, `experience:publish`, ...). Admin writes that matter need MFA step-up when `ADMIN_REQUIRE_MFA=true`.

**Changes made by the dashboard sessions that you must review, keep, and document in the contract:**
1. Guarded writes (reason 3-300 chars + version): `POST /v1/admin/products/:id/archive|restore` (`expectedVersion`, `reason`); catalogue CSV import commit (`previewHash`, `reason`, stale/replay refusal); variant PATCH extensions (metadata, thresholds, price change invalidates quotes); `PUT /v1/admin/shipping/settings` (`expectedUpdatedAt`, `reason`; the response includes `updatedAt`); `PUT /v1/admin/shipping/pins` (`expectedEtag`, `reason`; `GET` returns `etag`).
2. New in the latest round: `POST /v1/admin/experience/:channel/docs/:kind/:key/discard-draft` (`If-Match` + `{reason}`; returns the draft to the live version as a new revision; `ILLEGAL_STATE` if never published) in `adminB9Routes.ts` and `packages/commerce-domain/src/experience/docs.ts`; `GET /v1/admin/analytics/gstr1?month=YYYY-MM&format=json|csv&table=b2cs|hsn` in `adminB11Routes.ts` and `packages/commerce-domain/src/gstr1.ts` (GSTR-1 tables 7 and 12 working paper); product duplicate now picks the first free `-copy`, `-copy-2`, ... id and a collision-free SKU (`catalogue.ts`, `duplicateProduct`); `packages/commerce-domain/scripts/gen-doc-schemas.ts` generates `doc-schemas.json`.
3. Tests added: `b9.test.ts` (discard-draft), `b8.test.ts` (duplicate twice), `b11.test.ts` (GSTR-1 reconciles with orders), `packages/commerce-domain/test/unit/gstr1.test.ts`.

## 2. Tasks (in this order)
**B1. Contract hygiene (blocking for everyone).** Add every operation and field in section 1 to `openapi.yaml`, `api-index.md` and `CHANGELOG.md` (bump the contract version), regenerate `doc-schemas.json` (`pnpm exec tsx packages/commerce-domain/scripts/gen-doc-schemas.ts <outfile>` from the `packages/commerce-domain` folder), and copy the contract files into `jimmy&wax_dashboard/docs/backend-contract/`. Then in the dashboard run `pnpm contract:generate`, update `contract.lock.json` through the tool in `tools/contract/`, and run `pnpm verify` there. Do this as one coordinated change and tell the owner the dashboard needs a commit.

**B2. Close open requests.** Read `jimmy&wax_dashboard/docs/build/BACKEND_REQUESTS.md` fully; each `open` row is yours. Priority:
 a. Content-library entity schemas (care guides, stories, journal, testimonials, FAQ groups, announcements): publish JSON Schemas generated from the validators next to `doc-schemas.json` (extend `gen-doc-schemas.ts`) so the dashboard can replace its hand mirrors (`src/features/studio/library-schemas.ts`).
 b. Per-slot image requirements: extend the `blocks.schema.json` generation so every image prop carries `x-slot: { minWidth, minHeight?, aspect? }` (agree the numbers with the owner or designer; for example website hero at least 1920 px wide). The dashboard currently only gives generic warnings.
 c. DASH-BR-048: return the `ETag` header through the gateway for document GETs. DASH-BR-049: document or raise the admin write rate limit (429 during bulk Studio edits).
 d. Media safety (DASH-BR-038/042): the public content-addressed media GET must refuse pending or rejected media; document that approve/reject is admin-only.
 e. HSN: invoices omit HSN (`hsnIncluded: false`); once variants carry `hsnCode` (the dashboard edits it), print it on invoices (GSTR-1 table 12 already uses it).
 f. Every other `open` row in BACKEND_REQUESTS.md (shipping provider shape drift, invoice issue blocked by a missing GST profile, order DTO fields for reveal and allocations, refund process capability, and so on).

**B3. What the website and app need from the public API (verify, fix, document).**
 - `GET /v1/experience/{web,app}`: correct `ETag`/304, `Cache-Control: max-age=60`, honours `x-jw-client` caps (holds back unknown blocks), applies campaigns by time, resolves sources (`resolved.productIds` for product rails and grids, with defined out-of-stock behaviour), substitutes `{{store.*}}`, returns `media` with `url`, `alt`, `poster`, `bundledKey` (the app ships some images) plus `tokens`, `navigation`, `chrome`, `pages`, `content`. Add contract tests with golden JSON.
 - `product:<slug>` and `custom:<slug>` pages and `nativeSections` visibility are served; web pages carry `seo`.
 - A **public app version policy** endpoint (minimum supported, forced update, latest per platform; the dashboard edits these under Settings, Platform, App versions). Verify one exists and is documented; if not, add `GET /v1/app-version?platform=&version=` returning `{ status: 'ok'|'update_available'|'update_required', message, storeUrl }`.
 - CORS: allow the website origin(s) on public routes; admin routes are called server-to-server by the dashboard BFF only.
 - Store pause and checkout flags via `GET /v1/store-settings` for both clients (already present: `checkoutOpen`, `ordersPaused`, `pauseMessage`).

**B4. Production readiness.**
 - Config validation fails fast on unsafe production values (it already refuses `SHIPPING_PROVIDER=fake`); add HTTPS-only origins, required SMTP when invitations are on, no default passwords, secure session settings.
 - Media storage: move from local `STORAGE_DIR` to S3-compatible object storage behind the existing storage interface; keep content-addressed keys; document lifecycle.
 - Email: real SMTP settings, bounce handling; templates are managed from the dashboard (Messaging).
 - Payments: online payments are off (`FEATURE_ONLINE_PAYMENTS=false`); if the owner enables a gateway implement webhooks with signature checks, idempotency and a refund eligibility capability (the dashboard shows refunds read-only until it exists).
 - Shipping: manual mode is verified live. The Shiprocket adapter is mock-tested only: when the owner provides sandbox credentials run `SHIPPING_PROVIDER=shiprocket` against the sandbox, verify plan, ship, label, manifest and webhooks end to end, then document the setup.
 - Observability: structured logs with request ids, `/healthz` and `/readyz`, metrics, alerts on 5xx and auth failures, audit-log retention.
 - Backups: automated Postgres backups and a **restore drill**; migration procedure; no `db-reset` in production; seed data in dev only.
 - Redis containers exist in `infrastructure/local/docker-compose.yml` (host ports 56379/56380 are sometimes Windows-reserved) but the code does not use Redis; either use it deliberately or remove it.
 - Security review: authz on every admin route (the dashboard's role matrix, `tools/role-write-matrix.local.ts`, must stay at 0 mismatches), rate limits, body size limits, upload and SSRF hardening, dependency audit.

**B5. Tests.** Run the whole suite (`$env:PG_HOST_PORT='55432'; pnpm test`; the integration tests create their own `jimmywax_test` database). Add tests for every change. Then, from the dashboard folder, run the live specs and the role matrix listed in section 0b; they must still pass.

## 3. Acceptance (report each as pass or fail with evidence)
1. Contract files, OpenAPI, the dashboard's generated types and `contract.lock.json` agree; `pnpm verify` in the dashboard passes.
2. The backend test suite passes; new tests cover discard-draft, GSTR-1, guarded writes, duplicate and bundle golden files.
3. Dashboard role matrix: 0 mismatches; `studio-publish`, `studio-to-website`, `studio-preview-live`, `studio-finance-live`, `guarded-writes-live`, `catalog-writes-live` and `admin-writes-live` pass.
4. Every `open` request in BACKEND_REQUESTS.md is closed (with the change described) or explicitly deferred with the owner's agreement.
5. A written production runbook (config, secrets, migrations, backups and restore drill, rollback) in `docs/`.
