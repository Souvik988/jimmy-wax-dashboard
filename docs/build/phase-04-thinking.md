# Phase 04 — Typed API layer, data fetching, tables, filters, forms and error handling

Status: **IMPLEMENTED; acceptance PARTIAL pending owner direction on safe mutation integration fixtures** · Re-grounded 2026-10-07 IST · Contract v1.2.0-draft.1, SHA-256 `d7d6830f60ea17296bb2e50569ecd43b0646d5d6008457bd944ee23a0b2cf144`.

## Re-grounding and contract evidence

- Read `docs/backend-contract/03_BACKEND_CONTRACT.md` §1 and its final “Implementation status and deviations” before relying on older proposals. Backend phases B8–B13 are built; OpenAPI + `api-index.md` + running behavior win. Read every API-index group and the order/export/customer/settings/store-status entries below.
- Phase 03 handoff: feature code uses `authFetch` and `src/server/auth/proxy.ts`; browser never reads tokens; backend enforces permissions; preserve exact one retry only after an explicit `MFA_REQUIRED`; do not put incomplete screens in navigation. The local refresh lock is process-local and remains a deployment risk.
- Ground rules re-read: single storefront; no B2B/riders/wallet/loyalty/quick-commerce; no demo fallbacks in business routes; paise remain integers; UTC becomes IST with the shared formatter; no direct browser-to-backend calls; error request IDs remain visible; no mutation is trusted to a UI-side guard.
- Phase 4 package APIs verified in `api-index.md` and OpenAPI: `GET /v1/admin/orders` (`adminListOrders`, requires `orders:read` per the running route), `GET /v1/admin/customers` (`getAdminCustomers`, `customers:read`), `GET /v1/admin/exports/orders.csv` (`getAdminExportsOrdersCsv`), `GET/PUT /v1/admin/store-status` (`getAdminStoreStatus` / `putAdminStoreStatus`), and `GET/PATCH /v1/admin/settings` (`adminSettings` / `adminUpdateSettings`). Studio document validation and conflict contract is deferred to Phase 10; use test doubles in this phase.
- OpenAPI declares order/customer/store/settings responses as generic objects. On the live local gateway, a temporary admin was created, MFA-enrolled for the guarded calls, and disabled immediately after the probe. No order/customer values or credentials were written to logs/docs. `GET orders?limit=20` returned keys `{items,nextCursor}` with 3 items and `nextCursor:null`; each order row contained `id,orderNumber,status,paymentStatus,paymentMethod,totalPaise,createdAt,version,demo`. `GET customers?limit=20` returned `{items,nextCursor}` with 3 items; customer payload values were deliberately not inspected or retained. `GET store-status` returned `ordersPaused,pauseMessage,checkoutOpen,codEnabled,onlinePaymentsEnabled`; a same-value PUT as AAL1 returned 200 without changing pause state. `GET settings` returned `{settings,readiness}`; a stale expected-version PATCH with a reason was rejected 409 before a write. `GET exports/orders.csv?from=2026-01-01&to=2026-01-02` under AAL2 returned 200 `text/csv; charset=utf-8`.
- **Contract drift DASH-BR-003:** `api-index.md` says the order CSV only needs `orders:read`, and the OpenAPI has no date query parameters or MFA description. The live `adminB11Routes.ts` additionally calls `mfa(req)`, requires `from` and `to`, and rejects ranges over 400 days; the domain emits a dated attachment. Backend status §0 explicitly says exports are MFA + audited. UI must enforce a bounded date range and flow through Phase 03 step-up; code must not claim CSV export works for AAL1. Settings stale-version conflict is 409 (`CART_VERSION_CONFLICT` per the binding error conventions); no update succeeded. Store pause is intentionally not MFA-gated.
- `ErrorCode` enum was checked in OpenAPI. Shared errors include `VALIDATION_FAILED`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `CART_VERSION_CONFLICT`, `ETAG_MISMATCH`, `DUPLICATE_REQUEST_MISMATCH`, `REQUEST_IN_PROGRESS`, `ILLEGAL_STATE`, `RATE_LIMITED`, `PAYLOAD_TOO_LARGE`, `INTERNAL`, `UNAVAILABLE`, `MFA_REQUIRED`, and `COUPON_INVALID`; server convention also supplies optional field/line/reason/paused detail. Never cast arbitrary server JSON into this union without runtime validation.

## 1. Users and jobs

This phase makes no permissions decisions of its own. The backend is authoritative; the role map only shapes navigation and safe UI affordances.

| Role | Five jobs enabled by the shared engine | “Fast and safe” means |
|---|---|---|
| admin | scan recent orders; find an order by number/status; export an order range; inspect store state; review/patch versioned settings in later phases | filters survive a shared link; export range and MFA are explicit; writes carry version/reason; no stale form overwrites another operator |
| support | locate an order; review customer list; share filtered view; export only if backend permits the role; preserve notes while moving between work | PII is minimized, denied actions remain visible as denied, list refresh never loses current search |
| fulfillment | find orders by state/payment; load next cursor page; share queue; inspect row freshness; later bulk actions | no operational mutation in this phase; selection state resets when query changes; no duplicate page rows |
| finance | find orders/payment exceptions; inspect integer-paise totals; export bounded dates; review payment status; share filtered view | numbers are server values, exports require reauth, totals are never recomputed in browser |
| catalog | reuse query/table primitives for later catalogue read screens; understand empty/offline state; save a local table preference; use field errors; use stable resource keys | no order permission is assumed; forbidden endpoint gets a clear 403 rather than a fabricated empty state |
| designer | reuse data/error/form foundations for Studio read/edit workflows; understand ETag conflicts; preserve draft; load Studio lists later; inspect field errors | schema/document versions stay distinct from settings/order `expectedVersion`; no publish action is added here |

## 2. State and data flow

```text
Browser feature -> typed api client -> authFetch (same-origin cookie + CSRF + explicit MFA wait)
    -> Next BFF /api/backend/admin/* -> encrypted session -> backend refresh coordinator
    -> gateway 8080 -> authorized endpoint -> {data, x-request-id, rate headers}
```

```text
Query key(resource, normalized filters) -> loading -> success(items, cursor)
       |                                  |             |-> empty (actual items.length === 0)
       |                                  |             |-> next page; dedupe by stable id
       |                                  |-> error      |-> stale while refetching, label freshness
       |-> abort on filter change                         |-> cursor expired: show error + restart at page 1
       |-> offline/timeout: retain prior page as stale with timestamp + request reference, offer retry
```

```text
URL filters <-> parsed, bounded state <-> query key; change filter => abort old request, discard cursor/pages,
replace URL without leaking PII; back/forward restores filters. Search is debounced 300 ms; cursor itself is
opaque and never decoded or rewritten by the dashboard.
```

```text
Mutation state: idle -> validate -> confirm reason/impact if required -> dispatch once with expectedVersion,
If-Match, and/or idempotency key as contract requires -> success invalidates declared resource keys
  -> 409 (no blind retry) -> fetch current document and show version-aware conflict/reload/merge choices
  -> 403 MFA_REQUIRED -> existing step-up dialog -> exact request retried once after verified refusal only
  -> timeout/UNAVAILABLE (outcome may be ambiguous) -> preserve draft; explain uncertainty; reconcile/refetch
```

State model: `loading`, `empty`, `success`, `stale`, `offline`, `error`, `permission-denied`, `conflict`, and `saving` are separate states. Stale data never masquerades as fresh. Unauthorized is handed to the existing session-ended flow. 403 is not empty. Offline without a backend request ID says no request reached the service; server failures retain the supplied request ID. Half-open date ranges are serialized explicitly and rendered in IST with the UTC source in a tooltip.

## 3. Deep-think questions and decisions

### Backend conventions and one abstraction per convention

- Cursor pagination: `useCursorList` wraps TanStack Query `useInfiniteQuery`; endpoint functions accept `cursor` as opaque text and `limit` 1–50. Filter changes form a different key and restart pagination. No offset or guessed `total` is displayed; “load more” is based only on `nextCursor`.
- ETag/If-Match: `apiPut` can supply a quoted opaque ETag/revision header and preserve it from safe BFF responses. The Studio conflict UI remains endpoint-neutral and test-double-backed until Phase 10 supplies document shape. No auto-merge/auto-retry for changed authored content.
- expectedVersion: mutation builders require a resource-specific typed version in the request body for settings/order/inventory flows. A stale 409 surfaces a conflict state; reload is safe, merge is an explicit reviewed action. No global “last write wins.”
- Idempotency-Key: create/publish helpers generate one UUID when that endpoint's contract says a key is supported, retain the same key/body only for a user retry after definitive refusal, and never synthesize it for mutations whose outcome is ambiguous or endpoint is not documented as idempotent. Query/mutation request identity is not a substitute for backend idempotency.
- Reason fields: an explicit reason-request control enforces the documented 3–300 character boundary, is submitted only in the body, and is bound to a specific mutation intent. Never attach a reason to a read or infer permission from showing the dialog.
- CSV: `apiDownload` uses the same-origin BFF, reads only allowlisted `Content-Disposition`, sanitizes filenames, does not parse the CSV into JavaScript rows, revokes object URLs, and keeps export date-range/MFA guards visible. The current browser `response.blob()` buffers the response, and the backend builds one full CSV string before `res.send`; it is not end-to-end streaming. The 400-day cap reduces but does not eliminate memory risk (DASH-BR-004/R-018).
- Multipart/binary: a replayable `File`/`Blob` upload helper uses XHR progress + AbortController-compatible cancellation semantics and the same-origin CSRF cookie; it never logs file names/contents or bypasses the BFF. Retry is an explicit user action with the same selected file, not automatic after an ambiguous server result.

### Three concurrency mechanisms and auto-retry

`If-Match` Studio doc revision, `expectedVersion` settings/order/inventory, and non-versioned endpoints are distinct types. The conflict presenter receives `{strategy, attempted, current, requestId}`. For documents, offer field-level diff and “reload” or an explicit merge to a new save. For scalar settings, show changed fields and reload; a merge is submitted only after user review. No automatic retry for any 409. The only retry exception is an explicit `MFA_REQUIRED` precondition refusal already handled by Phase 03, once after verified MFA. Never retry after network timeout or 5xx where outcome is unclear. For endpoints without a version, use idempotency only if documented and still refetch before repeating.

### Query keys and invalidation

Central map: `orders.list(filters)` -> invalidates all order lists and `orders.detail(id)`; order notes invalidate that order's notes only unless backend mutation changes list summary. `customers.list(filters)` -> customer list/detail; `settings` -> settings + store-status only on confirmed write; `storeStatus` -> store status + overview health only on confirmed write. `experience.document(channel,kind,key)` -> document/revisions/diff/validation; media updates invalidate asset/detail/usage; catalogue changes invalidate product/category/collection/inventory as explicitly mapped. No mutation gets wildcard cache reset. On server 409 or ambiguous timeout, refetch exact current resource and keep the user draft.

### Partial failure

This proof slice has no bulk writes. Future per-line `error.lines` are rendered in an accessible summary and associated with row identifiers only when a contract field provides them. A successful HTTP response does not imply all rows succeeded; each result is keyed by resource ID, successful rows refresh their keys, failed rows remain selected, and the UI reports counts plus request ID. Never optimistically mark all rows successful.

### Error taxonomy

| Error | Surface | Retry policy |
|---|---|---|
| `VALIDATION_FAILED` + `fields` | Map server field paths to RHF/Zod fields; focus first invalid field; preserve other inputs | no retry |
| `UNAUTHENTICATED` | existing session-ended/re-auth flow | user signs in; no silent retry |
| `FORBIDDEN` | `NotAllowedState` with safe explanation | no retry |
| `MFA_REQUIRED` | existing global step-up dialog, action context retained | exact repeatable request once after verified MFA only |
| `NOT_FOUND` | detail not-found state; list row may have been deleted, remove only after refetch | no retry |
| `CART_VERSION_CONFLICT`, `ETAG_MISMATCH`, `ILLEGAL_STATE` | conflict/transition state with current version and request ID | no automatic retry |
| `DUPLICATE_REQUEST_MISMATCH`, `REQUEST_IN_PROGRESS` | blocking mutation-state notice; keep original key/body distinct | no retry; reconcile first |
| `RATE_LIMITED` | persistent cooldown using `Retry-After`; disable only affected action | retry when allowed |
| `PAYLOAD_TOO_LARGE` | file/form field error | no retry until changed |
| `COUPON_INVALID` | reason-specific inline feedback (later marketing module) | no retry |
| `UNAVAILABLE`, `INTERNAL`, retryable 5xx | offline/service error with request ID when present and last successful data clearly marked stale | retry reads with bounded backoff; never silently retry mutations |

### Filters, views and performance

Use resource + normalized query object as query key (never token, PII, or URL string). Saved views are scoped by the safe operator ID in localStorage key `jw:data-table:v1:<resource>:<operatorId>`; versioned parser discards invalid data. Avoid storing raw customer searches/phone numbers in a saved view; allowed filter keys are explicit and query input is not persisted by default. Search debounce 300 ms; abort superseded fetches; prefetch only low-sensitivity row-detail routes after hover/focus once the detail route exists. Read freshness 15 seconds for orders, 60 seconds for settings/status; no stale-while-revalidate label is hidden. List target: 50 rows render in <100 ms after response on reference desktop; first response <800 ms p95 on local gateway; no duplicate query for Strict Mode; table uses paginated real rows, not client-side full-dataset sort.

## 4. Ten-item pre-mortem and control

1. **Wrong rows after filter changes:** an old cursor response lands after a new query. Abort old fetches, key every filter, and reset pages when URL filters change.
2. **Duplicate order appears across pages:** backend cursor boundary and client append race. Stable-ID dedupe on page merge; test a duplicate fixture in a test double.
3. **Export leaks a filename/body or consumes excessive memory:** BFF strips attachment header or UI logs CSV; backend and browser each buffer. Allowlist only safe disposition metadata, never log content, bound date range at 400 days, and keep backend streaming as an open request.
4. **CSV export is presented as non-MFA:** index omitted runtime guard. Follow running handler, preserve Phase 03 `MFA_REQUIRED`, date range bounded to ≤400 days; keep contract request open.
5. **Double submit creates duplicates:** rapid clicks create two requests. Disable while in-flight; use documented idempotency key on supported creates; test two clicks and ambiguous timeout separately.
6. **A stale edit silently erases another operator’s change:** UI confuses settings expectedVersion and Studio ETag. Distinct types, 409 conflict dialog, no auto-retry, deliberately stale live settings request.
7. **PII ends up in URL, local storage, telemetry, or screenshots:** saved views/search persistence is too broad. Allowlist only non-sensitive filter keys; no request/response logging; test URL and local/session storage with representative customer data.
8. **Permission failure renders “no data”:** query error swallowed by empty state. Explicit state union; real 403 test asserts the blocked state and request ID when supplied.
9. **Offline retry storms or mutation repeats:** React Query retries every operation. Retry only idempotent reads with bounded attempts; mutation retry false unless a documented exact idempotency protocol is used.
10. **Dense table inaccessible on a phone/keyboard:** sortable header, selection and filter controls lack labels/focus. Semantic table, visible caption, unique checkbox names, responsive card fallback or horizontal-scroll hint, focusable actions, axe + 375 px keyboard walkthrough.

## 5. Security and privacy

- Browser feature client may call only `/api/backend/...`; credentials are same-origin cookies and CSRF; no bearer tokens in query keys, props, local storage, or logs.
- BFF path segments remain allowlisted and backend auth remains in `proxyAdminRequest`; only safe response headers are forwarded. For CSV, add `content-disposition` to allowlist only after verifying/sanitizing `attachment; filename=`; never forward `set-cookie` or arbitrary backend headers.
- Zod validates untrusted JSON response shape before feature use. `unknown` remains unknown until parsed; broad OpenAPI object must not become a cast.
- Search query/filters are URL-safe only when non-PII; do not persist customer name/phone/email. Saved view JSON includes schema version and role/operator namespace and is treated as untrusted on read.
- Export is sensitive: require date range, step-up, no automatic repeated download, safe response filename, no local persistence; browser download is an explicit operator action.
- Mutation intent carries only the backend-required reason/version/idempotency key; reason never appears in URL. Error rendering escapes server text and displays safe request IDs only.
- CSP remains nonce-based; no third party scripts/telemetry. Keep operations on one storefront and disallow audience/shop switching.

## 6. Performance and accessibility budgets

- First orders page: p95 <800 ms against local backend with gateway reachable; render ≤50 row cells under 100 ms at 1440 px; use skeletons only on first load and retain clearly stale rows during background refresh.
- Filter input: 300 ms debounce; superseded request aborted promptly; no N+1 row fetch; no more than one query per normalized key.
- Export: no CSV text parsing or debug logging; browser download starts within 1 second of response headers for local test.
- WCAG 2.2 AA target; body text 4.5:1, focus visible, no color-only status, semantic caption/header scopes, keyboard path to each filter/sort/page/export, accessible loading status, error alert, focus after conflict dialog. At 375 px, order queue remains usable without clipped controls; table may horizontally scroll with a visible keyboard-accessible wrapper label.
- Reduced-motion respected; no animation required for the table. Respect browser zoom to 200% without overlaying the sticky bulk bar.

## 7. Test plan — test names before implementation

Unit:
- `api-error.test.ts`: parses known and unknown error codes, fields/lines/reason/paused/retryAfter/requestId without leaking body.
- `api-url.test.ts`: rejects unsafe path/query and encodes bounded query params.
- `query-keys.test.ts`: canonical filter order and resource invalidation map.
- `cursor-pages.test.ts`: opaque cursor, filter reset, duplicate ID dedupe, deleted-row revalidation.
- `conflict-policy.test.ts`: ETag vs expectedVersion vs none; no blind retry.
- `download.test.ts`: sanitized attachment filename, no CSV parsing, URL revocation.
- `form-errors.test.ts`: server field errors map to form and focus first invalid field.
- `upload.test.ts`: progress, cancellation, selected file retention, explicit retry.
Component/e2e:
- `orders-list.states.spec.ts`: loading, actual empty, permission denied, offline/request-id, stale refresh.
- `orders-list.filters-url.spec.ts`: status/search URL, back/forward, debounce, filter clears cursor.
- `orders-list.pagination.spec.ts`: load-more and duplicate row handling.
- `orders-list.keyboard-mobile.spec.ts`: tab/enter/checkbox at 375/768/1440 and axe.
- `orders-export.mfa.spec.ts`: explicit date range, AAL1 step-up, one successful bounded download, no repeated request.
- `settings-stale-version.integration.spec.ts`: actual 409 and unchanged values after stale expectedVersion.
- `store-status-noop.integration.spec.ts`: same-value AAL1 put returns actual shape/status, with checkout and pause unchanged.
- role cases: admin/support/fulfillment/finance allowed list; catalog/designer denied by backend; no permission hint treated as authority.
- `studio-etag-conflict.mock.spec.ts`: test double only, until Phase 10 real document endpoints are in contract.

## 8. Thin vertical slices

1. Typed response/error contracts over generated OpenAPI + runtime Zod; URL-safe BFF-only transport and safe CSV response metadata.
2. Shared query provider, resource keys/invalidation, opaque cursor hook, read retry/offline rules, and unit tests.
3. Improve the existing table primitive; add stateful URL-filter hook, saved-view parser, RHF field-error bridge, conflict/reason primitives, upload helper with tests.
4. Build unlinked read-only `/orders` reference from live data only; search/status URL state, cursor pages, IST/money formatting, honest states and bounded MFA export.
5. Real gateway integration tests for orders/customers/store status/CSV and stale settings conflict; real role-denial tests; desktop/mobile screenshots and axe.
6. Write add-resource recipe/invalidation map; update progress, parity, decisions, risks, request log, and Phase 05 handoff.

## Review findings and changes

1. **I initially treated OpenAPI prose as complete for the CSV.** The real handler has extra MFA/date rules; corrected the request log plan and UI contract to require both, and opened DASH-BR-003 rather than hiding the drift.
2. **“Use `useInfiniteQuery`” did not specify what happens when a server cursor expires.** Added explicit restart-from-first-page affordance; do not retry the invalid cursor forever.
3. **A blanket settings invalidation would refetch unrelated or sensitive data.** Added per-resource explicit invalidation and only refetch after confirmed write; ambiguous result retains draft then reconciles.
4. **Saving every filter in localStorage risks leaking customer lookup PII.** Excluded query text and all customer identifiers from saved views; use operator-scoped, allowlisted view schema.
5. **The order table’s existing `DataTable` only toggles `aria-pressed`; it does not sort, and per-row checkbox labels are indistinguishable.** Phase 4 must replace misleading sort toggles with real server-sort only where contract supports it, or remove sortable affordance; every selection label includes a safe row number/order number.
6. **The BFF currently strips `Content-Disposition`, which breaks a safe download filename.** Forward only sanitized/allowlisted attachment metadata; keep all other backend headers blocked.
7. **“Retry retryable” is unsafe as a universal rule.** Retry only read-only query requests with bounded attempts; mutation retry is disabled absent explicit contract idempotency and exact body/key retention.
8. **The generic object type encouraged trust-by-cast.** Treat it as `unknown` and parse endpoint payloads at the client boundary. Orders get a Zod schema from the real route; customer PII shape is not used in Phase 4 and remains unparsed until Phase 16.
9. **The endpoint's real ordering/query contract was absent from OpenAPI.** Source/live probe showed status, paymentStatus, q(max 40), opaque cursor and fixed createdAt/id descending order; recorded DASH-BR-005 and intentionally did not show client-side sort controls.
10. **Local-storage reads during render could go stale across tabs or operators.** Query cache is scoped/remounted by operator; draft availability uses an external-store subscription and invalidatable cached read; sensitive drafts remain deny-by-default. The cache is explicitly cleared in unit-test teardown.

## Verification ledger and acceptance status

- `pnpm verify`: PASS — contract SHA unchanged, TypeScript strict check, ESLint, 13 Vitest files / 51 tests, and Next production build.
- Real backend Orders E2E: PASS — 7 Playwright tests across admin/support/catalog/fulfillment/finance/designer; allowed roles read live cursor data, denied roles make no list request; screenshot + axe check passed. Evidence in `docs/build/evidence/phase-04/orders-{375,768,1440}.png`.
- Live CSV: AAL2 order export returned 200 `text/csv`; the latest browser run downloaded successfully. UI validates explicit dates and 400-day bound. The endpoint is not streaming.
- Real stale-settings update: 409 returned for deliberately stale `expectedVersion`, with no successful write. Same-value store-status PUT returned 200 and left checkout/pause unchanged. A two-context successful-write race was intentionally not produced because it would mutate store policy.
- Real Studio `If-Match` endpoint does not exist in this phase; test double covers 409 policy as instructed. Reverify against the real document route in Phase 10.
- Unit coverage exists for cursor merge, safe query keys, conflict policy, draft privacy, form-field mapping, upload progress/cancel/response schema, and idempotency-key helper. No safe real-backend upload or idempotent create integration was run; the live test would create durable backend data. A disposable, cleanup-proven fixture or explicit owner direction is needed to meet the phase's “each convention” integration criterion.
- The project folder has no `.git` metadata, so the phase's requested small commits could not be created; all local files remain in the shared workspace.
- DASH-BR-003–005 and R-018–020 document the contract and test limitations. Phase 04 cannot be marked COMPLETE until the owner chooses whether to authorize disposable real-backend mutation fixtures or accept deferral to the consuming phases.

## Handoff

Phase 05 should use the shared query provider and resource key map; call the health/dashboard operations through the typed BFF client; include loading/stale/offline/permission states; keep store pause and checkout gates separate and do not mutate them while observing. Phase 06 may extend the Phase 4 read-only order list into the real order workflow. Keep DASH-BR-003–005 open until the backend contract documents CSV MFA/date/limit/attachment, order list parameters/schema/fixed ordering, and buffered-export limitation. Phase 09/15 should add safe real upload/idempotency integrations when those flows exist; Phase 10 must replace the Studio conflict test double with real `ETag` behavior. Phase 05 code has not started because the Phase 04 owner decision is pending.
