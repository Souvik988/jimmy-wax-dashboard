# Phase 06 — Orders

Status: **THINKING / no Phase 06 application code written** · 2026-10-07 IST.

## Re-grounding and verified scope

Read the Phase 05 handoff, the Phase 06 prompt, API index, current OpenAPI, the implementation-status warning in `03_BACKEND_CONTRACT.md`, and the source routes behind the generic OpenAPI objects. The browser remains BFF-only; prices are integer paise, GST is included, API timestamps are UTC and displayed in IST, and no API operation is inferred from a screen requirement.

Verified operations: list/detail/status/cancel/COD collection under `/v1/admin/orders`; list/add notes; packing slip; resend confirmation; dated CSV export; customer reveal; invoice; list/process refunds. `shipping` creation/transition is Phase 07 only. The actual list accepts only `status`, `paymentStatus`, `q`, opaque `cursor`, and `limit`; `q` is an order-number prefix, not phone, email, coupon, PIN or date search. Detail response contains order totals, line totals, address, payment attempts and refunds, but no status timeline or per-line discount allocation. Support receives a redacted address; reveal is a separate audited customer operation.

Live probe (2026-10-07): created a named COD local fixture through the documented customer OTP → cart → address → quote → idempotent order flow while checkout was temporarily enabled, then restored `checkout_enabled=false` and `checkout_policy_confirmed=false`. The fixture is `placed` / `cod_due` at version 1 and is intentionally retained for lifecycle E2E. A disposable admin was disabled after observing the exact admin shapes: list `{items,nextCursor}`; list item `{id,orderNumber,status,paymentStatus,paymentMethod,totalPaise,createdAt,version,demo}`; detail `{id,orderNumber,status,paymentStatus,paymentMethod,version,subtotalPaise,discountPaise,taxPaise,shippingPaise,codFeePaise,taxInclusive,totalPaise,currency,address,createdAt,lines,paymentAttempts,refunds}`; detail line `{sku,productName,variantTitle,unitPricePaise,quantity,lineTotalPaise}`; notes `{items}` and packing `{orderNumber,placedAt,paymentMethod,collectOnDeliveryPaise,shipTo,items,from}`. This proves the public customer `Order` schema is broader than the admin-detail DTO: coupon code, shipping discount, tax breakdown and line discount are absent from this admin route.

Lifecycle proof (2026-10-07): a separate disposable fulfillment operator moved that fixture `placed → confirmed → processing` through the actual admin route, with returned version 2 then 3, and was disabled immediately. The source transition map confirms `processing → shipped`; the UI intentionally does not expose it because shipment creation/dispatch belongs to Phase 07. Cancellation remains MFA-guarded for the admin/fulfillment permission path and has a reason plus current version in the dashboard resource call.

## 1. Users and jobs

| Role | Jobs | Fast and safe means |
|---|---|---|
| support | find order; identify state; add internal note; explain status; request audited contact reveal | never expose street/phone accidentally; clear read-only transition state |
| fulfillment | confirm; start processing; collect COD; print packing slip; resend confirmation | only legal backend transitions, current version required, no optimistic stock/money change |
| finance | find payment/refund state; inspect totals; export date range; process refund in Phase 07 | exact backend totals, MFA for export/refund, no invented tax allocation |
| admin | triage across all roles; cancel with MFA; inspect audit consequences; handle conflicts | reason and customer impact are explicit, refetch after every write |

## 2. State and data flow

```text
URL filters -> cursor list query -> loading | empty | denied | unavailable | page
  row open -> server-guarded detail -> independently loaded notes/packing/invoice as allowed
  stale list after a definitive mutation -> invalidate list + detail; no optimistic financial state
```

```text
status action -> legal action shown from known current status -> reason where required
  -> {to, expectedVersion} -> backend
  -> 200 authoritative DTO -> invalidate
  -> 409 conflict -> preserve draft, refetch detail, show latest state; no retry
```

```text
support address -> masked snapshot -> optional reveal reason -> audited POST
  -> reveal response only in current screen memory -> never URL/local storage/cache preference
```

## 3. Decisions to validate before code

- Only expose list filters the backend accepts. Saved views may compose status/payment-status only; unavailable requested filters are recorded rather than approximated client-side.
- The UI will offer confirmed/processing only after validating the actual response and legal source transition map. Shipping is visibly delegated to Phase 07, never faked as a button.
- Detail totals use server fields only. The current DTO has no coupon share, GST component per line, status history or returns; it will disclose that limitation instead of reconstructing it.
- Address redaction is graceful: support sees fulfilment context (name/city/state/PIN) and an explicit audited reveal route only if its exact customer identifier is present in a verified response. Otherwise no reveal control is invented.

## 4. Pre-mortem

1. A partial cursor page is sorted locally — retain fixed backend order.
2. Two operators transition the same order — include version; conflict refetches, never retries.
3. Support sees sensitive address — parser separates redacted/complete shapes; action requires backend reveal and reason.
4. Totals are recomputed incorrectly — render server paise fields only.
5. An illegal lifecycle button appears — derive from a finite, verified transition map and backend remains authority.
6. A resend implies delivery — say “queued”, not sent.
7. An export leaks a broad period — explicit half-open dates and actual 400-day bound.
8. Notes appear customer-visible — label internal and isolate from outbound communications.
9. A print route becomes an unprotected data URL — fetch via BFF and keep content in the current document only.
10. A customer test order mutates a local business record unexpectedly — use named disposable fixtures, record IDs only in test process, and clean/disable test operators.

## 5. Security, performance and accessibility budgets

PII is not logged, stored in URL state, copied into local storage, or rendered from raw errors. Reasons and note bodies stay POST JSON. Read access in the UI is only a hint; backend roles/MFA/concurrency are authority. Target list response render under 100 ms for 50 rows, 250 ms filter-feedback target after debounce, and no more than one active search request. Every row/action is keyboard reachable; j/k never steals typing focus; cards replace tables at 375px; status has text/icon/colour; print view is semantic and uses print CSS.

## 6. Test plan

- `order-models.test.ts`: live DTO parsers reject malformed paise/version/address shapes.
- `order-lifecycle.test.tsx`: legal action availability, conflict/no-retry and internal-note semantics.
- `orders-detail.test.tsx`: totals render backend values and masked-address state.
- `orders-live.spec.ts`: create a disposable customer order through the documented customer API, list, search, detail, note, confirm/process, packing print emulation and cleanup evidence.
- `orders-roles-live.spec.ts`: support masking/no transition; fulfillment transition/packing; finance export/refund boundary; admin cancellation MFA.
- `orders-conflict-live.spec.ts`: two browser contexts cause a real expected-version conflict.

## 7. Thin slices

1. Create live parsers from a disposable probe and record any undocumented fields.
2. Replace the Phase 04 Orders reference with the real routed list/detail shell and supported URL filters.
3. Add read-only detail/totals/notes and role-redacted address states.
4. Add verified legal lifecycle actions and conflict UI.
5. Add packing, export and resend only after their real payloads are observed.
6. Run role, conflict, mobile/print, accessibility and customer-order E2E evidence; then document the handoff.

## Skeptical review findings and changes

1. **The prompt asks for phone/email/PIN/date/coupon filters but the route does not accept them.** They are explicitly excluded and will become a backend request if still needed.
2. **The prompt asks for a timeline and coupon/GST allocation, but detail does not return them.** No synthetic timeline/calculation will be rendered.
3. **The prompt conflates shipping with Orders.** Shipment creation/ship is held for Phase 07; Phase 06 can only represent the current backend order status.
4. **Customer reveal may require a customer ID absent from the order DTO.** Do not add the control until a live shape proves an ID pathway.
5. **Refund processing is Phase 07 scope and needs finance/MFA.** Phase 06 shows read-only refunds from the order detail; no process button until the dedicated fulfilment/refund phase.

## Build evidence to date

- The Orders queue now links to a server-guarded record route. The detail uses narrow runtime schemas, real paise totals, server item lines, payment attempts, redaction-aware address output, and notes. It clearly discloses missing allocation/timeline fields instead of deriving them.
- Lifecycle controls expose only `placed → confirmed` and `confirmed → processing`; each sends `expectedVersion` and waits for the authoritative response. A version conflict is a distinct no-retry state with an explicit “Load current order” action. Shipping, RTO/returns and refund processing remain withheld for their dedicated phases.
- Internal notes POST only the note body, are displayed as operator-only, and invalidate the notes query on acknowledged success. The packing-slip route requires `orders:fulfil`, fetches through the BFF, and has print CSS. Resend-confirmation reports only that email is queued.
- `pnpm typecheck`, `pnpm lint`, and the full Vitest suite pass: 15 files / 58 tests. Next evidence is authenticated browser coverage, print emulation, explicit role denial, and a two-context backend version conflict.

## Continued build and verification — 2026-10-07 IST

- The order record now renders the backend-provided refund entries (status, integer-paise amount and reason) as read-only evidence. It deliberately has no "process refund" control: backend processing requires Finance/MFA and is owned by Phase 07's fulfilment/refund workflow.
- Corrected action-error styling so errors have a visible border and text treatment, not colour alone. The packing slip uses the shared money formatter and its print media rules remove application chrome as well as the print button.
- A local dashboard BFF probe initially returned a safe 500 after an operator login. Boundary probes established: direct gateway login returned 200 with the documented MFA object; BFF login returned 500; both succeeded after the dashboard was launched with the documented ephemeral `DASHBOARD_SESSION_SECRET`, `BACKEND_ORIGIN` and local non-Secure cookie flag. The cause was a dev process started without its required session-key environment, not backend authentication. All disposable probe/E2E operator accounts were disabled immediately after use.
- Real live checks passed: the existing Orders queue flow (filters, MFA CSV export, responsive/axe evidence) and a new fulfilment-role flow that opens a real order, verifies the truthful allocation disclosure, loads its protected packing slip, emulates print media, and captures `docs/build/evidence/phase-06/packing-slip-print.png`. The print test confirms sidebar, top bar and print button are absent in the print medium.
- Quality gates after this slice: targeted component/style tests, TypeScript and ESLint pass. The full suite and production build need re-run after remaining Phase 06 slices.

## Phase closeout — 2026-10-07 IST

- Final fresh `pnpm verify` passed: contract lock, `tsc`, ESLint, 18 Vitest files / 67 tests, and the Next production build.
- Real-backend E2E additions passed: COD customer-order lifecycle (1), cancellation with stock/audit checks (1), support redaction plus stale-version race (2), and responsive detail/print/axe (1). The checkout was left disabled; the one policy-confirmation flag persists by backend design. Temporary operators were disabled.
- Screenshot evidence: `docs/build/evidence/phase-06/order-detail-375.png`, `order-detail-768.png`, `order-detail-1440.png`, `packing-slip-print.png`.
- Acceptance remains intentionally partial for ship (Phase 07), audited support reveal and non-COD/discount/return invoice reconciliation because of DASH-BR-009, and successful invoice issuance because seller GST configuration is absent and the current GET permission is unsafe (DASH-BR-008). No data was fabricated to mask those gaps.
- Phase 07 handoff: manual courier is the primary route; ship only backend `processing` orders; load shipments and returns from their own endpoints; finance owns refund processing and backend MFA; provider-specific controls remain hidden unless live provider status is configured, with persistent mock-tested/not-live disclosure.
