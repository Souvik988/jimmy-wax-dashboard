# Phase 08 — Catalogue, pricing and inventory

Status: THINKING COMPLETE; implementation slices built; Phase 08 acceptance remains in progress pending backend safeguards and safe write evidence. Date: 2026-10-07 IST.

## 0. Re-grounding and contract evidence

- Read the full dashboard master prompt, Phase 07 handoff, `DASH_PROGRESS.md`, `DASH_PLAN.md`, `DASH_NEXT_ACTION.md`, and Phase 08 acceptance file. Phase 07 leaves one synthetic order shipped/delivered; it is not a catalogue/inventory fixture and must not be reused.
- Read `docs/backend-contract/03_BACKEND_CONTRACT.md` **Implementation status and deviations** first: backend phases B8–B13 are built/tested, the current implementation and OpenAPI win over historical gap proposals, API bodies are often generic in OpenAPI, and integration probes must not fake success. Then inspected the matching `api-index.md` and OpenAPI paths.
- Source verification was performed against `apps/commerce-api/src/adminB8Routes.ts`, `adminRoutes.ts`, `packages/commerce-domain/src/catalogue.ts`, `admin.ts`, `inventory.ts`, and quote/order validation. This is evidence of the built handler shapes, not a replacement for the required live probes.
- **Live-read limitation:** gateway `/healthz` returned 200, but `/readyz` timed out; Docker Desktop returned Engine API 500 for read-only container inspection. A fresh admin setup stalled during PostgreSQL connect and was stopped before account creation. Therefore no Phase 08 authenticated live response was obtained. Do not seed or present fixture data as backend data. Repeat live probes only after the existing stack is healthy; do not reset it.

### Operations verified in api-index/OpenAPI and implementation source

| Operation | Contract guard (source-verified) | Source-backed shape / behavior; runtime probe status |
|---|---|---|
| `GET /v1/admin/products` | `catalog:read` | `PageQuery` plus `q`, `categoryId`, `status=active|inactive|archived`, `stock=low|out`; `{items,nextCursor}` ordered by `(sortOrder,id)`. Product includes fields, `version`, `updatedAt`, variants and image; cost omitted unless admin. Not live-probed this session. |
| `POST /v1/admin/products`, `GET /{id}`, `PATCH /{id}` | writes/read `catalog:write` / `catalog:read` | Create is 201; one or more variants required. Patch requires `expectedVersion`; mismatch is `CART_VERSION_CONFLICT`. Archived products cannot be edited. Not live-probed. |
| `POST /products/{id}/variants`, `POST /archive`, `/restore`, `/duplicate`, `PUT /{id}/media` | `catalog:write` | Add variant increments product version; duplicate is created inactive; archive hides and deactivates without deleting order snapshots; archive/restore actions are audited. Media IDs must be ready, active library images. Not live-probed. |
| `GET /v1/admin/catalog/variants`, `PATCH /v1/admin/catalog/variants/{id}` | `catalog:read` / `catalog:write` | Read rows `{id,sku,name,title,pricePaise,comparePaise,active,updatedAt}`. Patch accepts optional price/compare/active plus mandatory reason and `expectedUpdatedAt`; 409 on stale timestamp; compare price may not be below sale price. Not live-probed. |
| `GET/POST/PATCH/DELETE /v1/admin/categories`, `PUT /categories/order` | reads/writes `catalog:read` / `catalog:write` | GET `{items}` with `productCount`; order body lists every category ID exactly once. Category writes are audited but have no expected version. DELETE refuses while any product row references the category. Not live-probed. |
| `GET/POST/GET by id/PUT/DELETE /v1/admin/collections` | reads/writes `catalog:read` / `catalog:write` | Manual collections use ordered `productIds`; smart collections use a bounded rule (categories/tags/in-stock/sort/limit). Detail supports `?resolve=true`; update requires `expectedRev`; kind cannot change. Not live-probed. |
| `GET /v1/admin/inventory` and `GET /inventory/{variantId}/movements` | source guards `inventory:read` | Inventory `{items:[variantId,sku,name,variantTitle,onHand,reserved,available,lowStockThreshold,version]}`; movements are cursor-paged and include deltas, reason, ref, timestamp. api-index/OpenAPI omit the permission and field schema. Not live-probed. |
| `POST /v1/admin/inventory/{variantId}/adjust` | `inventory:write` + AAL2 | Strict `{delta,reason,expectedVersion}`; nonzero integer delta with `|delta| ≤ 100000`, reason 3–300 chars, optimistic version check; cannot lower on-hand below reserved. Single atomic position update, append-only movement and before/after audit. Not live-probed. |
| `GET /v1/admin/catalog/export`, `POST /v1/admin/catalog/import?dryRun=true|false` | `catalog:read` / `catalog:write` | Export is CSV with server-side formula escaping. Import accepts raw CSV text ≤2 MB / 5,000 rows; all-or-nothing; dry run reports counts/errors but not field-level diffs; commit writes an aggregate audit. Not live-probed. |
| `GET /v1/admin/audit?resourceType=...` | source guard `audit:read` | Recent 100 records with before/after/reason; no resource-ID filter. Catalog role cannot call it, while Admin can. Not live-probed. |
| `GET /v1/products` (public) | public | Customer-facing catalogue proof after a local test product is created; use only with a visibly named, opt-in local fixture and archive it before leaving the phase. Not live-probed. |

### Source/brief discrepancies to track before implementation

- Cost price in the Phase 08 text says Admin/Finance, but the binding role matrix gives Finance no `catalog:read`; `withCost` in the running handler returns cost only for Admin. Never widen Finance or expose cost to a client that cannot access the field. Request a deliberate safe finance read path (DASH-BR-023); implement Admin-only until then.
- Existing low-stock thresholds are readable and can be set on new variant creation, but neither product patch nor the dedicated variant patch accepts a threshold. No standalone threshold update route exists. Existing thresholds must remain read-only pending a backend operation (DASH-BR-021).
- Category `productCount` excludes archived products while category delete counts all products. A UI count of zero does not guarantee deletion will succeed; explain the backend refusal and request consistent semantics (DASH-BR-022).
- CSV dry-run is not bound to commit by a server token/hash or expected versions, and commit has no required reason/idempotency contract. The report only gives aggregate product/variant counts and row errors; the response cannot substantiate an exact field diff. Do not claim dry-run/commit atomic review safety or silently auto-replay an ambiguous commit. Request an immutable preview token/hash, expected versions, reason, detailed diff and idempotency semantics (DASH-BR-024). Until the backend change exists, limit or withhold commit paths that can overwrite prices.
- The dedicated price patch requires reason + `expectedUpdatedAt` and the checkout path revalidates live variant prices before consuming a quote, returning `QUOTE_STALE` for a changed line. The price patch itself does not increment `store_settings.rules_version`; settings edits do. The owner brief says a price change bumps this version. Request consistent version invalidation and document current quote behavior (DASH-BR-025). No old quote can silently buy at the changed unit price based on source logic, but the promised version signal is absent.
- OpenAPI response/request bodies for inventory and much of catalogue are generic; `api-index` omits exact guards for inventory and variants. Request concrete schemas/permissions, including CSV `text/csv` body/query/error behavior (DASH-BR-020). The source schema above is provisional until live response probes are possible.
- No bulk stock-take endpoint appears in api-index/OpenAPI/source routes. Do not build a CSV stock-adjustment path; use only per-variant versioned adjustments.

## 1. Users and jobs

- **Admin:** create and maintain products/variants; approve exact public price and content changes; archive/restore without destroying order references; arrange categories and collections; inspect restricted cost and audit evidence; reconcile stock through reasoned, stepped-up adjustments. Fast/safe means no false-success toast, one authoritative diff, visible version, clear quote/cart consequence, and a recoverable path after conflict.
- **Catalog:** create/edit catalogue descriptions, SEO, variants, public price, categories and collections; attach only backend-ready media references; export and inspect imports; inspect stock/thresholds without changing stock. Fast/safe means server-side filters, field-level validation, no role-escalation through a hidden control, and no local draft mistaken for a saved product.
- **Fulfillment:** inspect on-hand/reserved/available and movement history; make a positive receipt or negative adjustment with reason and AAL2; recover from a checkout race by re-reading current stock. It cannot edit product price/content or category/collection data.
- **Designer:** read product/category/collection context needed for Experience work; no catalogue or stock mutation. Keep links read-only and do not add write actions from shared components.
- **Support and Finance:** no catalogue/inventory screens under the binding role matrix. Finance’s audit permission does not imply catalogue access; cost visibility conflict is tracked separately.

## 2. State and data flow

```text
Product list: authenticated role
  -> GET page(filters,cursor) -> loading -> {items,nextCursor}
  -> empty | error(requestId, retry) | offline | permission denied
  -> filter change resets cursor; pagination never sorts a partial page locally

Product editor:
  -> GET authoritative product(version,updatedAt)
  -> local unsaved draft + leave-page warning
  -> review exact changed fields / price consequence
  -> PATCH product(expectedVersion) or PATCH variant(reason,expectedUpdatedAt)
  -> 200 -> replace draft from response
  -> 409 -> preserve draft, show server value, require explicit reload/reapply
  -> 403/MFA/validation -> explain server reason; never infer permission

Inventory:
  -> GET {onHand,reserved,available,threshold,version}
  -> operator enters signed delta + 3–300 character reason
  -> MFA_REQUIRED -> global step-up -> exact request may resume once only after verification
  -> adjustment 200 -> invalidate inventory + movement pages
  -> CART_VERSION_CONFLICT -> reload; do not resubmit old expectedVersion
  -> ILLEGAL_STATE when projected onHand < reserved -> show current values, no local mutation

CSV:
  -> select validated text/csv -> dryRun=true -> counts/errors (422 may include row errors)
  -> show that aggregate counts are not a field-level diff
  -> if safe commit contract is missing, stop before dryRun=false and offer guarded editor path
  -> after future backend preview-token contract: explicit confirmation -> commit -> refetch

Category / collection:
  -> category reorder submits full exact ID list (no client-only persisted reorder)
  -> collection detail may resolve to IDs via documented resolve=true
  -> collection update sends expectedRev; conflict reloads for explicit merge
```

Product lists/details contain inventory aggregates as a backend snapshot; the inventory endpoint is authoritative for adjustment. Existing order snapshots are immutable. `available = onHand - reserved` is displayed exactly from the backend; it is not recomputed from a dashboard cache for writes. Search/status/stock filters run on the server and preserve cursor ordering. Money remains integer paise; `formatMoney` shows GST-inclusive INR without a dashboard tax recomputation. Timestamps use the single IST formatter.

## 3. Deep-think questions and decisions

1. **Expensive mistakes:** sale price, compare-at, stock, archive and category/collection changes can affect customer visibility or checkout. Require an explicit before/after review; state that product text/order snapshots differ (new catalog values affect future views, historical order item snapshots remain unchanged); confirm archive consequence (existing cart lines become unavailable); archive instead of hard delete. Reject an “instant save on blur” because operators must see the final live price/content diff.
2. **Price changes and quotes:** variant price patch is version-checked by `expectedUpdatedAt`, requires a reason, audits before/after, and checkout source revalidates live unit price and refuses stale quotes with `QUOTE_STALE`. It does not currently bump `rules_version`; disclose this discrepancy and request the version bump. Do not tell the operator that rules-version invalidation has occurred until backend evidence confirms it.
3. **Bundled vs library media:** preserve an existing `assetPath` as a backend-returned bundled reference; display its source label and alt text. Show a library picker only from Phase 09’s authenticated ready/approved media list. Never treat a path as a media ID, rewrite an unrecognized bundled path, or imply an uploaded file is attached before `PUT /products/{id}/media` returns.
4. **CSV safety:** use server export’s exact CSV and formula escaping; show import size/row caps and every backend row error. The current dry-run response is aggregate-only and not tied to commit. Do not invent a cell-level diff or send an undocumented reason/token. Withhold existing-price overwrite commit until backend supplies a server-bound preview/version/reason contract; document the acceptance exception.
5. **Reserved inventory:** reserved units are held against online payment-window orders; available is on-hand less reserved. Adjust only by signed delta, reason, current expectedVersion and backend MFA. Preview projected on-hand/available and block a client-side below-reserved value, while treating backend 409/ILLEGAL_STATE as final. Thresholds are displayed but existing values stay read-only until a write endpoint is added.

## 4. Ten-item pre-mortem

| Failure | Specific control |
|---|---|
| Operator enters ₹ paise as rupees or vice versa | Reuse MoneyInput/formatMoney; API model validates integer paise and displays explicit `₹` amounts. |
| Price comparison shows a discount when compare-at is below sale | Client validation mirrors `compareAt >= price`; backend remains authoritative; no negative/absurd amounts. |
| Second operator edits after product load | Send `expectedVersion`/`expectedUpdatedAt`; preserve draft after 409 and force a human review. |
| Archive quietly removes a product from a cart or storefront | Destructive-impact dialog names cart/store consequence; archive is audited and restorable, never hard delete. |
| Inventory reduction consumes units already reserved by checkout | Show three separate values, projected delta, backend guard and AAL2; reconcile stale versions, never use absolute set. |
| Category appears empty but archived products still block delete | Treat server refusal as expected; show product-count semantics discrepancy and do not claim a zero count means deletion is safe. |
| Existing low-stock threshold is edited through a fake control | Render threshold read-only for existing variants until a supported write operation exists. |
| CSV formula payload executes in a spreadsheet | Use backend-exported CSV; never render/import formula cells as HTML; preserve server injection guard and test `=,+,-,@,tab,CR`. |
| Dry-run says one thing while commit overwrites a concurrent/newer price | Withhold price-overwrite commit until a server-bound preview/version/reason contract; never silently repeat ambiguous POST. |
| Cost/audit or wide tables leak to an unauthorized role or fail phone/keyboard users | Permission gates at page and backend, Admin-only cost/audit, minimum fields, 375px layout, keyboard-visible focus, axe and no horizontal page overflow. |

## 5. Security and privacy

- Use the encrypted httpOnly session only through same-origin BFF; no token in browser state, logs, query strings, CSV evidence or screenshots. All writes stay CSRF-protected and backend guarded.
- `catalog:write` owns catalogue mutations; `inventory:write` owns stock adjustment and requires AAL2. Do not grant a permission based on a UI persona or expose Finance cost fields absent the role contract.
- A reason is mandatory for existing price changes and inventory adjustments where the source requires it. Include the exact expected version/timestamp. If a backend CSV route omits these safeguards, do not fake a browser-only equivalent.
- Cost prices and audit before/after objects are commercially sensitive. Admin only sees costs under the current source handler; product audit UI is Admin-only unless a new scoped operation is approved. Never include cost in public/customer API or screenshots.
- Product descriptions, media alt text, tags and CSV content are untrusted input. Render escaped text; no unsafe HTML. Media picker accepts ready, non-archived image IDs only.
- Inventory movements are append-only and stock changes share database transaction/audit boundaries. UI does not fabricate movement rows after an ambiguous outcome; it refetches and reconciles.
- Catalogue export is non-PII but commercially sensitive; do not retain or attach the CSV to test evidence. Phase E2E uses a unique local-only product ID and deactivates/archives it in `finally` after customer API verification.

## 6. Performance and accessibility budgets

- First 50 rendered rows/cards: under 100 ms after data has arrived on a mid-range laptop; always server-cursor paginate product and movement reads; inventory list currently has no cursor and must be measured against actual data volume before claiming scale.
- Filter typing debounced to 250 ms; stale requests aborted; initial authorized data p95 target ≤700 ms on healthy local stack (record observations, not production SLA).
- CSV UI stays bounded by backend 2 MB / 5,000 row limits; no large CSV retained in query cache or logged. Do not run a browser diff that blocks the main thread for >100 ms; if needed, move pure parse to a Worker in a later hardening slice.
- 375/768/1440 responsive checks, no page-level horizontal overflow, 44×44 px minimum primary action, table has an accessible caption and row/column headers, mobile rows have a card alternative where practical.
- Every form field has a programmatic label; dialogs trap/restore focus; conflict and errors announce through a live region with text; no color-only status; all actions keyboard reachable; reduced motion honored. Axe serious/critical violations target zero at 375px and 1440px.

## 7. Test plan (names before implementation)

Unit/component:
- `catalog-models.test.ts`: product/variant/category/collection/inventory/CSV parsers reject wrong shapes, decimal paise, bad HSN, unknown fields and impossible counts.
- `catalog-resources.test.ts`: exact paths, query keys, body encodings and no undocumented import/write fields.
- `catalog-list.test.tsx`: cursor/filter changes, loading/empty/error/offline/denied, no local sort of a partial page.
- `product-editor.test.tsx`: draft protection, exact diff, compare-price/HSN bounds, immutable IDs, expectedVersion conflict and no auto-resubmit.
- `inventory-adjustment.test.tsx`: signed delta, reserved-stock preview, reason, MFA step-up, stale version reconciliation, ledger invalidation.
- `categories-collections.test.tsx`: full category order, delete refusal, rule resolve, expectedRev conflict and kind immutability.
- `catalog-import.test.tsx`: dry-run counts/errors, 2 MB/5,000-row limits, formula payload display, no commit when existing price changes lack server-bound review.
- `catalog-accessibility.test.tsx`: roles, labels, focus and mobile layout.

Real backend/browser:
- `catalog-live-read.spec.ts`: fresh Admin/Catalog/Designer read, Finance/Support denial, Fulfillment inventory read and unsupported catalog denial; verify no denied BFF requests.
- `catalog-product-acceptance.local.spec.ts`: unique visible-local-only product with two variants, backend inventory setup, public API/website view, archive, restore-to-inactive and cleanup.
- `inventory-adjustment.local.spec.ts`: unique test variant, before/after version, reason, AAL2 audit and movement; verify a second stale write is rejected; no live stock is changed.
- `catalog-csv-roundtrip.local.spec.ts`: export → changed field dry-run → commit only when new backend contract allows safe price preview/reason/version; otherwise verify the UI blocks and record the acceptance exception.
- Screenshots at 375/768/1440 for list, editor diff, inventory conflict and CSV dry-run; axe keyboard/phone/desktop. Customer API check only after the synthetic record is created and before it is archived.

## 8. Thin vertical build slices

1. Add Zod DTO/query contracts from source and OpenAPI paths; add tests before resources; try live reads only after gateway/database readiness returns. Record exact missing live evidence.
2. Build server-filtered products list and product/category/collection reads with role-aware cost omission and no mock fallback.
3. Build product editor, versioned metadata save, audited variant price patch with reason/updatedAt, variant creation and archive/restore confirmation; preserve media references.
4. Build inventory table, movement ledger and per-variant signed adjustment with projected values, mandatory reason, MFA and conflict reconciliation. No bulk stock import.
5. Build category order, category CRUD and collection manual/smart preview with expectedRev and deletion refusal states.
6. Build CSV export and dry-run review; enforce caps, keep CSV out of logs, and gate commit according to backend guard evidence. Request missing preview/idempotency shape rather than inventing it.
7. Run role matrix and safe local acceptance using named fixtures, screenshot/axe, `pnpm verify`, docs and Phase 09 handoff.

## 9. Review findings and changes

1. **Initial wording implied one product `version` covers all variant money fields.** Price writes use a variant `expectedUpdatedAt`; use the product `expectedVersion` only for product-field patches and avoid stale guards across resource types.
2. **Initial plan treated the phase prose as proof the API invalidates quotes by version.** Source shows live price revalidation at order creation but no `rules_version` bump in the variant price operation; disclose both facts and raise DASH-BR-025.
3. **Initial plan assumed Finance can read cost because the phase file says so.** The binding role matrix and handler disallow Finance catalogue reads; Admin-only until a safe Finance-specific contract is approved (DASH-BR-023).
4. **Initial plan assumed low-stock thresholds are editable from the inventory table.** Only variant creation accepts a threshold; existing threshold changes have no route. Make existing values read-only (DASH-BR-021).
5. **Initial plan assumed category productCount predicts delete success.** It excludes archived products, while delete counts all products. Preserve backend refusal and ask for aligned counts/semantics (DASH-BR-022).
6. **Initial plan assumed CSV dry-run returned a complete field diff and could safely be committed later.** It returns aggregate counts/errors only and has no server-bound preview, reason, client expected version or idempotency. Do not offer a misleading exact diff or price overwrite commit (DASH-BR-024).
7. **Initial plan assumed the endpoint shapes were live-verified because the backend suite passed.** Health/readiness is currently broken; source-backed parsing may proceed with explicit caveat, but live browser acceptance waits for a healthy stack and must not be replaced with mocks.

## 10. Handoff notes

Phase 09 owns media library upload/provenance/approval; Phase 08 may only link ready library IDs and must preserve bundled image paths. Phase 07's shipping package values remain backend-authoritative; catalogue shipping attributes are editable only where the response and write contract support them. Phase 18 owns broad finance/audit reporting; Phase 19 owns global price/fee policy. Phase 20 must revisit DASH-BR-020–025, run public API/website parity and all safe product/inventory acceptance against the real healthy backend, and remove or archive every named local test product. Checkout remains off unless stock exists and the owner-authorized audited activation test is performed.

## Execution checkpoint — read-only product slice

- Completed strict product/variant/category/inventory/movement parsers and typed read resources. The inventory list remains non-cursor by backend contract; movement history uses only its opaque cursor.
- Completed protected `/products` list with server-driven search/status/stock/category filters, URL state, cursor pagination, backend error/empty states, and a mobile card layout. Costs remain hidden from this view; no edit/adjustment controls are present.
- `pnpm verify` passed at this checkpoint (32 test files / 134 tests and production build). Direct unauthenticated `/products` returned a login redirect.
- Live backend and role/browser evidence could not be collected: `/readyz` returns 503 not-ready and Docker is unresponsive. This is a verification blocker, not permission to use mocks or reset the local database. Next, restore readiness without reset, then begin the inventory view/ledger and guarded edit slices.

## Execution checkpoint — inventory snapshot, ledger and guarded adjustment

- Added protected `/inventory` with the complete backend snapshot, read-only threshold labels, per-variant status, and an on-demand movement ledger that follows only the returned opaque cursor. Direct unauthenticated `/inventory` returned `307` to `/login?next=%2Finventory`.
- Added the documented `POST /v1/admin/inventory/{variantId}/adjust` resource. Request is exactly `{delta, reason, expectedVersion}`; response is strictly parsed as `{variantId,onHand,reserved,version}`. Backend source confirms nonzero signed integer bounds, transaction/version check, reserved-stock floor, append-only movement and audit entry. OpenAPI is still generic and the current backend is not ready, so response/permission behavior is source-backed, not runtime-verified.
- The adjustment dialog requires `inventory:write`, shows current and projected on-hand/reserved/available plus expected version, requires a 3–300 character reason, and blocks projected on-hand below reserved. `authFetch` retains the app's established server-verified single MFA step-up path; only an explicit MFA refusal followed by successful verification replays the exact request once. No automatic retry is configured. On 409 the operator must start over from refreshed inventory; on network/5xx/contract ambiguity the page invalidates reads, preserves request ID, blocks this variant for the page session and instructs the operator to inspect the movement ledger before acting again.
- Thresholds remain read-only. The route remains unlinked from primary navigation until Phase 08's catalogue workflows are complete.
- TDD evidence: new tests first failed because the adjustment resource was absent; after implementation the targeted catalogue/inventory suite passed **2 files / 17 tests**. Final `pnpm verify` passed: contract hash lock, strict TypeScript, clean ESLint, **33 files / 146 tests**, and Next 16.3.8 production build including `/inventory`.
- No adjustment was sent to the live backend; `/readyz` returned `503 {"status":"not_ready"}`. Role matrix, MFA, reserved-stock conflict and ledger results are component/resource tests only. No screenshots or axe evidence for this slice.

**Next:** build the versioned product editor and audited variant price update from the source operation, with reason, `expectedUpdatedAt`, review/diff, stale conflict preservation and open-checkout-quote warning; do not claim the absent `rules_version` bump. Then complete categories/collections and export/dry-run while withholding unsafe CSV commit. Resume backend live reads and role acceptance only when readiness recovers without reset.

## 11. Product-editor continuation — re-ground and skeptical review before UI code

### Contract/source re-check

- The implementation-status section still makes the built backend and OpenAPI authoritative over historical proposals. `GET/PATCH /v1/admin/products/{id}` are documented; the built route uses `catalog:read`/`catalog:write`, and `ProductPatch` requires `expectedVersion`. Its product fields are scalar/list fields (`seoTitle`, `seoDescription`); it does not accept nested variant edits. The handler audits before/after product fields.
- `GET /v1/admin/catalog/variants` is `catalog:read` and returns the complete variant list with `updatedAt`, but the route has no pagination or product filter. It is the only documented read found that supplies the timestamp required by the price mutation. The UI may use it as a shared query and select only the current product’s variants, but it must expose no price action until the strict response has loaded. Add a backend request for scoped/cursor pagination; performance at a large catalogue is unknown.
- `PATCH /v1/admin/catalog/variants/{id}` accepts only `pricePaise`, `comparePaise`, and `active`, plus mandatory 3–300-character `reason` and `expectedUpdatedAt`. It does not update SKU, title, shipping fields, HSN, barcode, cost, or low-stock threshold. Keep those fields read-only; request an explicitly versioned metadata mutation rather than sending extra keys.
- Product endpoint IDs are a contract discrepancy: pinned OpenAPI references `Uuid`, but the running route validates a lowercase slug (`slug()`), and product DTOs use slug IDs. Keep the source-compatible parser for dashboard requests and record the OpenAPI correction request; do not fabricate UUID product IDs.
- Archive/restore remains withheld under DASH-BR-026. Product `active` is editable through the versioned product PATCH and is not equivalent to archive; its review must say that it changes future storefront visibility. Media stays read-only until Phase 09 supplies an approved library workflow. Product history is limited to the server-provided version/timestamp in this slice; do not imply the latest-100 audit endpoint is complete per-product history.
- The local backend was not made ready by this re-check. `/readyz` last returned 503 `not_ready`; no authenticated response or mutation is claimed, and no reset or database write is authorized.

### Implementation adjustment — expensive timestamp read is demand-loaded

The initial review proposed starting product, category and full-variant reads in parallel. Implementation review found that `GET /admin/catalog/variants` is an unfiltered, unpaginated full-catalogue response, so fetching it every time an operator opens any one product would make ordinary product reading scale with the entire catalogue. The product and category reads run when the record opens; the variant list is fetched only after the operator selects **Edit price**. The editor remains closed until the matching variant row and its `updatedAt` have been strictly parsed. A read failure shows its request ID, permits a deliberate read retry, and never exposes a price mutation. The added click latency is an intentional tradeoff for avoiding an unnecessary full-catalogue fetch.

### Slice flow and tests (test names fixed before implementation)

```text
protected product detail
  -> GET product + GET categories
  -> loading / empty-not-found / denied / offline / malformed-response states
  -> edit supported product fields locally; autosave only the non-PII metadata draft per operator
  -> exact product diff review -> PATCH(expectedVersion) -> authoritative product response
  -> 409 or ambiguous failure -> preserve draft, refetch, show latest vs draft; no mutation retry

variant price panel
  -> explicit Edit price action -> GET full catalog variant list -> match product variant IDs to rows with updatedAt
  -> no timestamp/read failure => price write disabled with request reference
  -> edit one variant only -> validate rupee input to integer paise + compare-at + reason
  -> exact diff + quote-staleness warning -> PATCH(reason, expectedUpdatedAt)
  -> 409/ambiguous response => read/reconcile; no automatic repeat or batch write
```

Tests written before implementation: `product-editor-model.test.ts` (exact patch/diff, immutable ID, expectedVersion, display-order bounds and paise/reason validation); `product-editor.test.tsx` (read-only role, no write before review, version conflict and human rebase, exact price guard/warning, failed timestamp read and no price replay after an uncertain outcome); existing `form-draft-protection.test.tsx` (corrupt local data is discarded and long slug scopes stay distinct); `products-queue.test.tsx` (record route link). Follow-up browser/real-backend and accessibility checks remain unverified while readiness is unavailable.

### Skeptical review — weaknesses found and plan changes

1. **Hidden request waterfall / oversized timestamp read:** pricing needs an unscoped unpaginated list. Start product, categories and timestamp reads independently, cache the list with a short freshness window, disable only the price action if the timestamp read fails, and raise DASH-BR-028 for a product-scoped cursor read. Do not silently add a filter the backend does not accept.
2. **Version tokens are not interchangeable:** product fields use `expectedVersion`; price uses variant `expectedUpdatedAt`. Split the save actions and review dialogs so no aggregate “Save all” can send one resource’s token to another.
3. **False confidence from client-side review:** a displayed diff is not a backend guard. Always send the latest backend token, invalidate/refetch after writes, and preserve the draft on conflict; a rebase requires an explicit human choice and a second diff review.
4. **Ambiguous writes could double-change a price:** never retry in the mutation function or on error. After uncertainty, perform reads only; describe whether current values match the intent without claiming authorship, and do not re-enable submit until an authoritative read completes.
5. **Partial multi-variant saves can be mistaken for atomicity:** price mutations are per-variant, so expose one variant review/save at a time and no bulk save. A failed row cannot imply the other rows changed.
6. **Unsupported variant metadata could be sent accidentally:** use only the strict documented price/compare/active patch; show dimensions, HSN, barcode and SKU read-only, and raise DASH-BR-029 rather than widening the resource schema.
7. **Archive state can be confused with inactive state:** keep archive/restore absent entirely under DASH-BR-026. An editable active toggle has its own explicit visibility consequence and is not called “archive”.
8. **Draft persistence can retain sensitive values:** persist only product descriptive fields under the operator-scoped safe draft helper; never persist price reason, tokens, audit payloads or cost price. Clear saved draft after confirmed/reconciled save or explicit discard.
9. **Open quote language can overstate backend behavior:** price review warns that checkout may reject/requote a saved quote; it must not say `rules_version` changed. Continue DASH-BR-025 and avoid a success message that implies global invalidation.
10. **The pinned API path schema contradicts the actual identifier parser:** keep the source-compatible slug for request validation and raise DASH-BR-027 to repair all product path parameter schemas in OpenAPI. Do not switch to UUID just to satisfy a stale generated parameter type.

These changes narrow the editor to supported, versioned fields; make price saves independent and reviewed; and leave archive, media attachment, variant metadata, and bulk price operations unavailable until their own contracts are safe.

### 12. Product editor implementation checkpoint and second challenge

- Implemented the protected slug-based `/products/[id]` page, linked from each live product card. It loads product and categories through documented resources only; it exposes supported product text/category/tags/SEO/visibility/display-order fields, an editorial search-result preview, IST update time, backend version, and immutable-ID explanation. Archived products are read-only.
- Safe descriptive edits are autosaved under a versioned, operator-scoped local key; malformed browser data is rejected; product field errors remain inline; the shared leave-page guard covers dirty product edits and any open price editor. Price/reason/cost values are never put into local draft storage.
- Every product PATCH is limited to the minimal supported fields plus `expectedVersion`, has an exact review dialog, and is not sent before confirmation. A `CART_VERSION_CONFLICT` refetches the latest product and preserves the operator draft; merging replaces the baseline only after an explicit click and requires a second review. Ambiguous product outcomes trigger read-only reconciliation, never a mutation retry.
- Variant price/compare/active editing is one variant at a time. It loads the current unpaged variant list only on operator intent; requires matching `updatedAt`, a reason, integer-paise conversion, an exact diff and a quote warning; it explicitly says the backend does not bump store `rules_version`. After an uncertain failure, the current review is locked until the operator asks for a fresh timestamp; the draft is overlaid only for fields the operator actually changed.
- Skeptical follow-up: the `catalog:read` full variant endpoint is still an unbounded read, and no live timing/role evidence exists. Keep it out of ordinary page load, do not cache it as an authoritative write token, and leave DASH-BR-028 open. Product create/duplicate, archive/restore, category/collection CRUD, media attachments, and CSV import/export are not implied complete by this editor.
- Focused tests: product model, editor, queue link and draft-protection suites pass **4 files / 28 tests** after the uncertain-price guard. Final `pnpm verify` passes: contract lock SHA `d7d6830f60ea17296bb2e50569ecd43b0646d5d6008457bd944ee23a0b2cf144`, strict TypeScript, ESLint, **35 test files / 166 tests**, and the Next.js 16 production build including `/products/[id]`.
- Latest read-only readiness attempt to `http://localhost:8080/readyz` timed out after four seconds; the previous probe returned 503 `not_ready`. No authenticated/live role probe, browser screenshot, axe scan, audit entry, product write, or stock/checkout change is claimed.

**Next slices:** category and collection workflows, then only safe CSV export/dry-run review; keep unsafe CSV commit and product archive/restore withheld. Retry live probes only when the existing gateway is healthy without reset. Phase 08 remains incomplete until its acceptance criteria are demonstrated or precisely recorded as blocked/deferred.

### 13. Category and collection workflow — contract re-ground and skeptical design

#### Verified contract/source facts

- api-index.md documents category GET/POST/PUT-order/PATCH/DELETE and collection GET/POST/GET-by-id/PUT/DELETE. OpenAPI still types all item shapes as generic objects. The built source uses slug IDs for both routes even though OpenAPI references UUID path parameters; record that broader discrepancy as DASH-BR-030.
- Category list is a complete {items} array ordered by sortOrder,id; each row includes name/description/optional productCount, imageMediaId, SEO, active and sort order. productCount excludes archived products, but delete checks all product assignments. Preserve DASH-BR-022. Category create accepts optional id, name, description, nullable UUID image ID, nullable SEO, active, and sortOrder. Existing category PATCH and full-list reorder have no caller version precondition; update audit includes after but no previous row. Do not present stale overwrite as safe: allow audited unique creation only; keep existing-row patch, reorder and delete controls unavailable pending DASH-BR-032.
- Collection list is {items} of records with slug id, name, description, immutable kind (manual|smart), ordered productIds, nullable smart rule, visible, SEO, positive rev, and updatedAt. Manual create/update uses productIds (max 100, no duplicates/archived IDs); smart uses only a rule with category IDs, tags, optional in-stock, sort (newest|price_asc|price_desc|name) and limit (1–48). PUT requires the entire CollectionInput plus expectedRev, and backend rejects kind changes. Use that CAS token; no category-style blind overwrite.
- Source has an admin collection GET ?resolve=true branch returning resolvedProductIds, but the query parameter and result shape are not specified in OpenAPI. The backend is not ready to probe. Do not call this undocumented query; record DASH-BR-031 and show only the backend-returned ordered manual IDs or current smart rule until a documented preview operation is available.
- Collection DELETE has no revision/reason/idempotency or reference check. Studio documents can refer to collection IDs; do not expose delete until backend can check/guard reference impact (DASH-BR-033). imageMediaId remains read-only until Phase 09 gives the operator an approved media picker.
- Latest bounded /readyz timed out after four seconds (previous response was 503); no category/collection runtime shape or role probe is claimed. Shapes above are source-backed only.

#### Slice state, tests-first plan

Protected /catalogue
  -> GET complete categories + GET complete collections
  -> empty / denied / offline / malformed / stale states with request ID
  -> catalog:read => inspect only
  -> catalog:write => create category after exact review; no category overwrite/order/delete
  -> catalog:write => create manual/smart collection after exact review
  -> edit collection at fetched rev -> exact diff -> PUT(expectedRev) -> fresh authoritative record
  -> 409 -> latest read + preserved draft + explicit rebase + second diff; no write replay
  -> collection preview remains labelled configured manual IDs/rule; never claims resolved results

Tests planned before implementation: extend catalog-resources.test.ts for strict category/collection parsers and exact create/update paths/payloads; add catalog-taxonomy-model.test.ts for manual-vs-smart discriminators, bounded rules, manual order, exact diff and expectedRev; add catalog-taxonomy.test.tsx for role-gated category create, no unguarded category controls, collection create/edit review, stale-rev rebase without retry, absence of delete/undocumented resolved preview, and backend-only product choices. Extend route guard tests only if the new server route presents a gap.

#### Skeptical review and changes

1. Category count could enable unsafe delete: list count excludes archived products but the delete handler includes them. Hide delete entirely; retain backend rejection as defense-in-depth and keep existing count labelled narrowly (DASH-BR-022/R-042).
2. Versionless category edits can silently overwrite another operator: expose create only; no patch or full-list order submit until the backend adds an expectedVersion/If-Match and a before/after audit (DASH-BR-032/R-039).
3. A manual order control might submit only the visible subset: no reorder controls until full-list write guards are documented; if later added, payload must include every returned category ID exactly once.
4. Category image UUID could refer to an unapproved asset: keep image reference visible but non-editable until the Phase 09 approved-media picker is ready.
5. Changing collection kind can discard either products or rules: kind is immutable after creation in the backend. Render kind as fixed on edit; changing it requires a newly created collection, never a form toggle.
6. Smart preview could drift if reimplemented locally: do not reproduce backend SQL or issue the source-only resolve=true query. Show the rule as configuration and request a documented resolve response (DASH-BR-031/R-040).
7. Collection update conflict might be mistaken for permission to retry: use latest GET, preserve proposed values, require explicit human merge and a second diff; no automatic PUT retry.
8. Collection deletion can break published Studio references: withhold deletion until a backend reference check, expectedRev and idempotent/ambiguous semantics exist (DASH-BR-033/R-040).
9. A selected manual-product list might include local fixtures or stale products: load picker options only from the backend's product cursor; include only real, non-archived responses and never synthesize missing names.
10. POST ambiguity could create duplicates: no mutation retries; refetch the complete list and compare the requested id/name/content. Report “matching record found; creation outcome not attributable” rather than claiming success when response was lost.

#### Proposed implementation boundary

One server-protected /catalogue route with two sections, live read models and explicit capability notices. Category create and collection create/edit use exact validated payloads and human review. Unsupported category update/order/delete and collection delete/resolve previews stay unavailable; raise requests and risks instead of sending undocumented writes or implying full CRUD. After implementation, run focused tests and full pnpm verify; live role/browser/a11y proof still waits on backend readiness.

### 14. Catalogue CSV export and dry-run review — contract re-ground before code

#### Ground truth

- api-index documents `GET /v1/admin/catalog/export` (`catalog:read`) and `POST /v1/admin/catalog/import` (`catalog:write`). OpenAPI types export as `text/csv`, but incorrectly describes import as JSON and does not document `dryRun`, the body format, or its 422 report response. The route source uses an express text parser with a 2 MB cap, parses `dryRun` as a query boolean defaulting true, and returns the `ImportReport` as JSON with HTTP 422 when row errors exist. Raise this contract drift before adding an exact-content-type request (DASH-BR-034).
- Source-backed export includes complete product/variant catalogue rows, does not include cost or stock, uses the fixed `CSV_COLUMNS` header, and server-side `safeCell` guards formula-leading text. It is a whole-response export with no cursor/size cap.
- Import parser accepts up to 5,000 rows/2 MB. Dry-run validates product/variant/category references and reports aggregate create/update counts plus `{row,field?,message}` errors, always `applied:false`. The implementation accepts `dryRun=false`, but commit is not bound to dry-run, lacks reason/expectedVersion/idempotency, and directly overwrites existing variant prices. Keep commit absent under DASH-BR-024 / ADR-034.
- BFF evidence: `/api/backend/[...path]` forwards the request's content-type and raw `arrayBuffer`; same-origin CSRF/auth remain in place. `apiPost` JSON-stringifies its body, so CSV needs a narrowly scoped raw-text transport. No browser-to-backend call is allowed.
- Latest bounded reads still time out at gateway `/readyz` and dashboard `/catalogue`; no runtime CSV response, role, browser, or audit evidence exists. No import/export call has been sent to the backend.

#### Users, flow, and tests-before-code

Operator job: export the backend's full catalogue to an approved local CSV, or upload an owner-prepared CSV to see whether the backend can parse it and which row errors would occur, without applying any of it.

```text
catalog:read -> explicit Export click -> GET text/csv -> validated filename/type -> browser download
catalog:write -> select .csv -> enforce nonempty, UTF-8, <=2 MB -> explicit dry-run click
  -> raw text POST with `dryRun=true` query -> strict report parse for HTTP 200 or documented-source HTTP 422
  -> show aggregate counts and escaped row/field messages; applied must remain false
  -> no commit action exists; no automatic POST retry
```

Tests planned before implementation: API client proves the body remains raw text with `text/csv`, same-origin proxy path and allowed-status handling; catalogue resource test proves only `dryRun=true` and strict reports; model rejects `applied:true`, wrong `dryRun`, malformed counts/errors and over-limit text; component tests cover read-only export permission, export download after exact click, file-size/UTF-8 rejection before dispatch, source-backed 422 row errors, no commit control, and no synthetic CSV data. The implementation does not parse CSV locally or echo its cells.

#### Skeptical pre-mortem: ten ways this could harm an operator

1. **JSON helper quotes the whole CSV:** implement a raw-text request path and assert exact body/content type before any API call; never reuse `apiPost` JSON serialization.
2. **422 errors disappear into a generic error toast:** accept only the documented-by-source 422 report shape for this dry-run operation, validate it strictly, and preserve request ID. Other status codes still use the standard sanitized API error.
3. **The UI accidentally exposes commit:** only the dry-run function may be imported by this component; hard-code `dryRun=true`, type report as `dryRun:true/applied:false`, and render no commit button or false “imported” wording.
4. **A stale or bad CSV overwrites selling prices:** do not expose `dryRun=false`, any generic POST control, or a background “apply” switch. Explain that aggregate preview cannot guarantee a later commit.
5. **A large/malformed file freezes the tab:** require nonempty `.csv`, cap bytes at 2,000,000 before reading, decode fatal UTF-8, surface clear local errors, and do not persist file contents.
6. **Formula injection leaks into a downloaded spreadsheet:** use the backend's documented export operation and its formula-safe server output; never reconstruct or transform export rows client-side.
7. **Export exhausts memory:** warn that export is complete/unpaged and buffered by the commerce endpoint and browser; the Next BFF forwards the response stream. Download only after a deliberate click, never prefetch it, and record unbounded size as an open risk.
8. **CSV content becomes script or log injection:** never render raw cells or inject HTML, never log uploaded data, and render only bounded row numbers, field names and escaped backend messages.
9. **An uncertain POST is repeated:** dry-run has no data mutation, but avoid automatic retry regardless; report transport request ID and let the operator explicitly run a new dry-run.
10. **A designer/support user reaches an import action:** route requires `catalog:read`, import dry-run is gated on exact `catalog:write`, and the backend permission remains authoritative; export is visible only in its permitted role.

Build order: contract-backed raw transport and 422 parser tests → catalog report schema/resource tests → export and dry-run UI with distinct permission/loading/empty/error states → full verification. Live backend acceptance remains deferred until readiness recovers without reset. Phase 08 stays open for live role/response, browser/accessibility, inventory MFA/conflict/audit, and remaining safe export/dry-run evidence; price-overwriting commit stays excluded.

### 15. Live closeout and acceptance boundary

#### Re-ground and fresh verification

- Re-read this phase file, this thinking record, `DASH_PROGRESS.md`, `DASH_PLAN.md`, and `DASH_NEXT_ACTION.md`; the previous handoff was stale because the outage had recovered and taxonomy/CSV slices were implemented after its last update.
- Read-only current checks: `GET http://localhost:8080/healthz` → 200; `/readyz` → 200; `GET http://localhost:3200/api/health` → 200; unauthenticated `/catalogue` → 307 to login, as required by the protected route.
- Fresh `pnpm verify` completed successfully: locked contract SHA verified; strict TypeScript and ESLint passed; Vitest **39 files / 193 tests passed**; Next 16.3.8 production build passed with catalogue, product, and inventory routes.
- Live role E2E completed **6/6**. It verified route allow/deny behavior, Catalog's absence of inventory adjustment controls, a backend `FORBIDDEN` response for a Catalog-role same-origin inventory adjustment probe, and a real `GET /v1/admin/catalog/export` followed by a raw CSV `POST /v1/admin/catalog/import?dryRun=true` returning a valid non-applied report. It did not invoke a permitted catalogue or inventory mutation.
- The live stack was recovered without database reset. Temporary test operator accounts used for the role run were disabled afterward. No catalogue/inventory records, checkout settings, stock, provider settings, or customer data were changed.

#### Acceptance findings

1. Product create → two variants → stock → public API and website → archive/restore is **not accepted**. Creation flow is not implemented/live-tested, and leaving customer-visible test records would be unsafe. The current archive/restore backend operations lack expected-version, reason, and idempotency guards plus reliable before/after response data (DASH-BR-026); keep them absent.
2. CSV round-trip is **partially accepted only through export and dry-run**. Dry-run does not return an exact field diff and is not bound to a later commit; the commit can overwrite existing prices without server-bound preview/version, mandatory reason, or idempotency (DASH-BR-024). The dashboard intentionally exposes no `dryRun=false` path.
3. Before/after audit completeness is **not verified** because no catalogue or inventory mutation was accepted. Source review found some operations with incomplete audit before-state evidence; live verification cannot be represented by an attempted or denied write.
4. The six-role route boundary is **verified**; successful Catalog edit and Fulfillment/Admin inventory AAL2 mutation paths are not. In particular, do not report the Catalog-role denied probe as proof of a successful adjustment flow.
5. The real-backend E2E and CSV safe path pass, but product create/archive/restore and stock adjustment flows and the required diff-before-save browser screenshot are **not verified**. No screenshots were captured for this continuation.

#### Skeptical closeout review

- A 6/6 role result could be misread as all role permissions verified. Corrected the report to distinguish route visibility/denial from authorized writes and MFA.
- A successful dry-run could be misread as safe commit approval. Corrected the wording and kept the commit endpoint unreachable from UI code.
- `/catalogue` returning 307 could be misread as a runtime failure. Verified it was an unauthenticated redirect and separately checked `/api/health` and gateway readiness.
- Passing unit tests could be mistaken for customer-facing product acceptance. Marked the public API, website, archive/restore, and audit criteria unverified; no product fixture was created.
- A test inventory POST could accidentally change stock if role or middleware changes. The live probe used Catalog role and asserted backend `FORBIDDEN`; no Admin/Fulfillment write was submitted, and the inventory remained unchanged.
- The initial CSV risk note overstated BFF buffering. Inspection of `src/server/auth/proxy.ts` confirmed `NextResponse` forwards `result.response.body`; the commerce handler materializes the CSV string and the browser buffers it with `response.blob()`. The parity/risk/request records now reflect those actual boundaries.

#### Phase status and handoff

Phase 08 remains **IN PROGRESS**. This live-closeout note is superseded by the continuation below: the owner-directed sequence resumed Phase 08 after Phase 09 implementation, without waiving acceptance. No backend repository expansion, unsafe archive/restore, or CSV commit is authorized by this continuation.

Evidence locations: `docs/build/DASH_PROGRESS.md` (acceptance/evidence report), `docs/build/DASH_PLAN.md`, `docs/build/DASH_PARITY.md`, `docs/build/DASH_RISKS.md`, and `tests/e2e/auth-roles.spec.ts`. The transient Playwright stdout and temporary auth snapshots were not retained; do not cite a screenshot or durable E2E log for this run.

### 16. Resumed Phase 08 — safe product creation and add-variant slice

#### Re-ground (before implementation)

- Resumed at the owner's request after Phase 09 local implementation. Re-read `DASH_PROGRESS.md`, `DASH_PLAN.md`, `DASH_NEXT_ACTION.md`, Phase 08 acceptance, and the previous Phase 08/09 thinking handoffs. ADR-040 still applies: Phase 08 must be resolved before Phase 10; Phase 09 remains IN PROGRESS and is not silently accepted.
- Read `docs/backend-contract/03_BACKEND_CONTRACT.md` at “Implementation status and deviations” first; the pinned contract SHA remains `d7d6830f60ea17296bb2e50569ecd43b0646d5d6008457bd944ee23a0b2cf144`. Rechecked `api-index.md` and `openapi.yaml`: `POST /v1/admin/products` and `POST /v1/admin/products/{id}/variants` exist and both require `catalog:write`; product reads require `catalog:read`. No dashboard call to an undocumented endpoint is needed.
- The OpenAPI bodies/201 responses are generic `object`. Source-only shape grounding: backend `apps/commerce-api/src/adminB8Routes.ts` parses `ProductInput` and `VariantInput`, returns 201 with the authoritative Product DTO, and audit-logs create/add-variant. Domain schemas are in `packages/commerce-domain/src/catalogue.ts`; a new product requires a category and 1–20 variants. IDs are lowercase slug IDs (2–100 chars), variant SKU 2–60 chars, title 1–80, price paise integer 0–100,000,000, compare-at nullable and not below price, optional HSN 4–8 digits, dimensions 1–2,000 mm, weight 1–50,000 g, barcode 4–40 chars, and low-stock threshold 0–100,000. Product descriptive bounds are name 2–160, subtitle ≤200, description ≤5,000, benefits ≤10, tags ≤20, SEO as existing editor limits. Cost is Admin-only by the source and role matrix.
- Creation endpoints do not accept `expectedVersion`, reason, or `Idempotency-Key`. Product ID is optional on the backend but explicit stable IDs are required by this UI to reconcile uncertainty. No blind retry is permitted. If a request result is uncertain, read the explicit product ID once and report a matching record as “found; attribution unconfirmed,” not successful creation. Add-variant has no deterministic resource ID supplied by the caller that identifies that request; reconcile by reading the product and looking for its submitted variant ID/SKU, without attributing or retrying.
- Backend product and variant creation default active=true. The UI will hard-code `active:false` for both, make inactive status non-editable in this flow, prohibit initial stock fields, and explain that activation and stock are separate guarded workflows. Although backend allows zero price, UI will require a positive rupee price so accidental free products cannot be created. No media attachment writes, archive/restore, duplicate, or CSV commit are included.
- Local read-only probes in this turn showed backend `/healthz`, `/readyz`, and dashboard `/api/health` healthy; the browser remains at `/login?next=%2F` with no operator session. Do not perform authenticated writes, reset the DB, create operators, or change stock/checkout. Live mutation/audit proof is not available; it is not replaced by component tests.

#### Users, jobs, and state flow

- Admin and Catalog roles use the new product form to capture a durable product ID, active category, descriptive content, and one or more catalog variants with GST-inclusive INR pricing. Admin alone may enter cost price. They review the exact immutable payload before submission. Fulfillment/support/finance/designer do not receive creation controls; only Admin/Catalog satisfy `catalog:write`.
- Product creation path: protected `/products/new` → backend category GET → loading / empty-active-categories / denied / offline / malformed response → valid local draft → exact review → single POST → authoritative Product DTO → navigate to its record. Any transport/server failure after sending is treated as possibly applied; no mutation retry. Attempt one GET by the explicit ID to reconcile, but make no success claim based on a match alone.
- Add-variant path: existing protected product GET → valid existing non-archived product + `catalog:write` → local variant draft → exact review of ID/SKU/price/metadata/inactive status → single POST → authoritative Product DTO and invalidate catalogue → if uncertain, read the product and report candidate match as unattributed; do not retry.
- State labels remain honest: not submitted, sending (disabled), response confirmed, rejected with sanitized request ID/field errors, outcome uncertain/reconciliation unavailable, matching record found but un-attributed, conflict/not found/offline. No optimistic product/variant row is inserted into the cache.

#### Ten-item pre-mortem and controls

| Failure | Control |
|---|---|
| Product becomes buyable because the backend defaults active=true | Send literal `active:false` for product and every initial variant; show inactive state in review; do not offer an activation switch in creation. |
| New product cannot be entered because its category is stale/inactive | Load exact backend categories, require an active category, fail closed on load error, and explain empty active-category state. |
| Accidental free/decimal/paise-confused price | Positive rupee-only input, shared paise parser, localized GST-inclusive preview, exact integer paise payload tests. |
| Lost response creates duplicate on a blind retry | Disable repeats after first send; use explicit product/variant read for reconciliation; never say a matching existing row proves this request created it. |
| Product looks stocked when it is not | No stock field; show “new variants start with zero stock” and link to separately guarded inventory workflow only after creation. |
| Duplicate IDs/SKUs across concurrent operators | Client strict slug/SKU validation and backend errors preserved; after ambiguity, do not retry even if a list does not yet show the row. |
| Cost leaks to Catalog role through forms or payload | Cost field/render and payload inclusion gated on server-derived Admin capability, never inferred from client input; strict test proves Catalog body has no cost. |
| Added variant changes an active product's assortment unexpectedly | The variant is always inactive; require review that product's current live state remains unchanged until a separate reviewed activation. |
| Draft persistence leaks money or falsely restores an obsolete write payload | Do not persist create/add-variant drafts to local storage; leave guard only; prices/cost never go into browser persistence. |
| Untrusted text, weak labels or modal focus harms users | Render plain text, use design-system controls/dialog, field labels and `role=alert/status`; keyboard test exact review/submit path, responsive CSS and axe component check. |

#### Security, performance, accessibility, and tests-before-code

- Security budget: server route enforces `catalog:write`; no token leaves the encrypted httpOnly-cookie BFF. Mutations use the same-origin CSRF-protected API client, JSON only, `retry:false`; no PII or request-body logging. Strict schemas reject unknown fields. Never add initial stock, media IDs, or a client-only permission elevation. Product/variant creation remains backend-audited but lacks idempotency and caller reason/version; expose this limitation before the first submit.
- Performance budget: no new unbounded reads beyond one existing complete category list; do not fetch the full variant timestamp list to create. Category load should use the existing 60-second cache; submit once, no optimistic list work. At 375/768/1440 CSS breakpoints, no page overflow; keyboard/focus flow must be operable without pointer; every field has label/help/error, disabled/loading state, and dialog focus restoration.
- Tests to write first: `catalog-resources.test.ts` exact source-backed create/add bodies, response parsing, strict unknown rejection, no calls on invalid IDs/SKUs/price/category/variant count; `product-create-model.test.ts` build/validate safe inactive payload, rupee→paise, compare-at, Admin-only cost; `product-create.test.tsx` permission gating, category loading/empty/error, exact review, no stock/media/active fields, no mutation before confirmation, no retry/reconcile wording and denied-role states; extend `product-editor.test.tsx` for add-variant review, inactive-only payload, confirmed invalidation and uncertain outcome with no retry. Run focused tests red before implementation, then strict checks and full `pnpm verify`. Integration writes remain unrun until an authorized session and safe disposable backend fixture/cleanup path are available.

#### Build slices

1. Add strict source-backed product/variant creation schemas and API resource helpers with tests.
2. Add pure form model validation/payload builders with focused tests; money never persisted.
3. Add `/products/new` route, role-aware Products CTA, form/review states, uncertainty handling; component tests.
4. Add product detail variant creation with same schema/review/uncertain handling and cache invalidation; component tests.
5. Update API request, risk, decision, parity, progress, and handoff docs; run full verify and report live limitations.

#### Skeptical reviewer challenge and fixes

1. **Risk:** “active=false” could still leave product externally visible if the backend filters only variants. **Fix:** source storefront queries and handler checks treat product active/archived state as gates; nevertheless test payload explicitly sends false for both levels and do not promise public invisibility without live public GET evidence.
2. **Risk:** explicit ID reconciliation could mistake another operator's record for this request. **Fix:** state attribution remains unknown even when record exists; only show an authoritative record link and never success toast based on read-after-uncertain.
3. **Risk:** idempotency omission could lead operators to click twice after a slow request. **Fix:** disable the button once the request begins, no retries, and after an uncertain result keep the form locked until explicit reconciliation/reload. Request backend idempotency.
4. **Risk:** Admin cost entered in a generic draft could end up in localStorage or error telemetry. **Fix:** no draft persistence for creation; no logging of form values; cost included only by server-derived role and only if entered.
5. **Risk:** price per variant might be mistaken as tax-exclusive or rupees might be posted as paise. **Fix:** every control and review says “GST included”; use shared integer-paise parser; test `₹499.50` exactly as 49,950 paise and forbid floating point in payload.
6. **Risk:** variant metadata shape could drift because OpenAPI is `object`. **Fix:** strict request/response runtime schemas are source-backed; add DASH-BR-044 and do not claim contract/live verified; do not introduce fields absent from the inspected parser.
7. **Risk:** empty category response could encourage bypassing with an invented ID. **Fix:** disable review and give a direct Categories link; do not provide a free-text category field.
8. **Risk:** adding variant to active product might immediately affect app/web or quote behavior if backend ignores active. **Fix:** POST literal inactive, show that backend remains final, check returned DTO; do not expose activation in the same request and raise contract request for transactional/idempotent safeguard.
9. **Risk:** an Admin-only cost control could be hidden in the client but still submitted by a Catalog operator. **Fix:** server-derived role passed from `requirePermission`, strict builder excludes cost when unauthorized, component tests inspect exact request body.
10. **Risk:** tested components could be presented as live acceptance. **Fix:** keep Phase 08 IN PROGRESS; report no authenticated create/add-variant, audit, product-public-API, website, inventory, or screenshot proof while the browser has no operator session.

#### Continuation handoff

Do not mark Phase 08 complete. Keep archive/restore withheld under DASH-BR-026 and CSV commit withheld under DASH-BR-024. Phase 09 remains in progress; its live upload/a11y/session requirements continue to be unverified. After this local safe creation slice, the next Phase 08 acceptance work still needs an authorized test operator and an explicit, disposable test-record cleanup plan; no DB reset or production-looking data is to be created. Phase 10 remains blocked until Phase 08 and Phase 09 have evidence-based handoffs.

#### Continuation evidence and handoff

- Focused catalogue tests passed: **5 files / 45 tests** across API resource, create model, create form, product editor, and product queue behavior.
- Fresh `pnpm verify` passed: pinned contract check (`v1.2.0-draft.1`, SHA `d7d6830f60ea17296bb2e50569ecd43b0646d5d6008457bd944ee23a0b2cf144`), strict TypeScript, ESLint, Vitest **46 files / 229 tests**, and Next.js 16.3.8 production build including `/products/new`.
- Skeptical-review findings were converted into hard boundaries: inactive-only create payloads and validated responses; unattributed reconciliation rather than claiming success; no automatic retry and no form-value persistence; Admin-only cost derived from the server-side role; positive GST-inclusive rupee input converted to integer paise; and inactive categories/invalid data fail closed. The live proof limitation remains explicit, not waived.
- No authenticated mutation or signed-in browser/a11y screenshot was available. Current browser state is `/login?next=%2F`; no operator creation, backend reset, product, variant, stock, checkout, audit, or customer state change was performed. Local test evidence does not demonstrate backend audit or customer storefront visibility.
- Phase 08 remains **IN PROGRESS**. Next: obtain an authorized local operator session and agree on a disposable test fixture plus cleanup path, then run create → add variant → guarded stock adjustment → customer API/website visibility and audit checks. Do not attempt archive/restore (DASH-BR-026) or `dryRun=false` catalogue import (DASH-BR-024). Phase 09 also remains open, so Phase 10 cannot start.

### 17. Local development acceptance continuation (2026-10-08 IST)

#### Re-ground and decision

- The running development gateway, dashboard, and PostgreSQL health endpoints now return 200. `LOCAL_DEV.md` identifies this as the non-production backend and documents local role provisioning through `scripts/create-admin.ts`; the phase instructions require real-backend Playwright evidence. The owner’s repeated instruction to continue therefore authorizes use of fresh, clearly identified local test operators and non-PII project-owned test assets, not any production operation.
- The acceptance run must create one product whose ID, title, SKUs, audit reasons, media filenames, and test-user emails carry a timestamped `phase08`/`phase09` marker. The run must disable only its exact test users at the end. Products have no deletion endpoint because order snapshots are durable; the product must therefore be archived after the public-storefront proof. Media must remain in the content-addressed local dev library, marked as a local QA fixture with a recorded rights/evidence note; it is not a user-facing claim that an owner approved real campaign material.
- This does not excuse unsafe dashboard functionality. Archive/restore and CSV commit remain absent from dashboard navigation under DASH-BR-024/026. A direct, authenticated backend archive/restore probe is acceptance evidence about the existing endpoint and its audit shape only; it must not be described as a dashboard flow or a reason to unwithhold that control.

#### Exact live acceptance design

1. Fresh Admin signs in through the dashboard BFF and enrolls TOTP. Use `/products/new` to create a two-variant inactive record, capture the review dialog at 375/768/1440, and assert the literal inactive/zero-stock response.
2. Use the actual reviewed product and price dialogs to activate product and one stocked variant. Use the Inventory dialog to submit a signed receipt with a 3–300 character reason. If the backend returns MFA_REQUIRED, assert the BFF’s one-time step-up dialog and retry path. Query the admin inventory and audit APIs to verify before/after where the backend returns it.
3. Query unauthenticated `GET /v1/products` and the local Vite storefront after activation, then make an authenticated archive → restore → final archive API probe to prevent the test item from remaining customer-visible. Assert and report that archive audit rows lack before/after and that the dashboard deliberately has no archive button.
4. Fresh Admin uploads the project’s non-PII catalogue image and generated product-motion video under unique QA filenames. Record a local-only rights holder and evidence note, approve the image, set its UUID as video poster, approve the video, then inspect direct public immutable-cache headers and a byte-range response. Archive is not invoked because backend Studio usage reporting is incomplete and the UI withholds it.

#### Pre-mortem update and skeptical review

| Failure | Control |
|---|---|
| A test leaves a customer-visible product behind | Every product begins inactive; final cleanup archives it, and public API is rechecked after archive. |
| A pre-existing TOTP enrolment makes a run irreproducible | Provision fresh timestamped accounts, capture the enrolment secret only in the Playwright process, then disable the exact accounts. |
| Test credentials leak into source or console artifacts | Generate the password in the invoking shell, pass it only as a transient process environment variable, and neither write nor print it. |
| A media test publishes customer/confidential material | Use only explicitly identified non-PII local project QA image/video; UI acknowledgement and recorded local QA provenance are exercised. |
| Endpoint probing is represented as dashboard UI coverage | Test names and phase report separate direct backend archive/restore evidence from the withheld UI control. |
| A successful user flow hides an audit gap | Assert exact audit actions and record whether before/after exists, rather than treating an audit row alone as proof. |

#### Tests before implementation

- Add a local-only Playwright acceptance spec, skipped without transient test environment values. It must prove the real BFF/UI product-create, activation, inventory/MFA, public catalogue/storefront, audit, media upload/review, cache, and Range paths. The test is evidence code, not production UI logic. Run it first with fresh local credentials; any failure is investigated before any app code is changed.
