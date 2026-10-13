# Phase 07 — Fulfilment, shipments, returns and refunds

Status: IN PROGRESS — thinking and contract re-grounded; shipment queue, manual creation, register, detail and customer tracking verified; return/refund and provider-adjacent surfaces remain. Date: 2026-10-07 IST.

## 0. Re-grounding and contract evidence

Phase 06 handoff: manual courier entry is primary; only backend `processing` orders may ship; shipment and return state comes from dedicated endpoints; finance owns provider refunds; checkout remains off. DASH-BR-008/009 remain open and do not justify synthesizing order events or allocations. The backend contract implementation-status section overrides the historical Shiprocket proposals: the adapter is mock-tested only, NDR actions and reverse pickup are not implemented, and `SHIPPING_PROVIDER=none` is the local safe default. `04_SHIPROCKET_SPEC.md` is design intent, not proof of a live Shiprocket account.

The following operations are present in `docs/backend-contract/api-index.md` and `openapi.yaml`. OpenAPI is generic for most of this family, so the live response observations below are recorded separately from source inspection. Role and MFA notes below are cross-checked with the running route source (`adminRoutes.ts`, `adminB10Routes.ts`) and permission matrix; where api-index is blank or differs, the discrepancy is called out rather than treated as permission.

| Operation | Contract / live permission | Real evidence or safe use |
|---|---|---|
| `GET /v1/admin/shipping/provider` | `shipping:read` | Live 200; provider `manual`, `configured:false`, `reachable:null`, null wallet balance, empty provider pickup locations; includes settings and overview. |
| `GET /v1/admin/shipping/ready` | `shipping:read` | Live 200; `{items,nextCursor}`. Item keys: `id,orderNumber,customerName,city,pincode,lines,paymentMethod,codAmountPaise,totalPaise,package{weightGrams,lengthMm,widthMm,heightMm},volumetricGrams,serviceable,ageHours,warnings[]`. Values containing order/customer data were not retained. |
| `GET /v1/admin/shipping/settings`, `PUT .../settings` | read `shipping:read`; write `shipping:write` | GET live 200 with `pickupLocation,pickupPin,defaultWeightGrams,defaultLengthMm,defaultWidthMm,defaultHeightMm,courierRule,preferredCouriers[],autoShip,bulkConfirmThreshold,requireProviderCheck,stuckAfterHours`. No write was attempted during re-grounding. |
| `GET /v1/admin/shipping/pickup-locations` | `shipping:read` | Live 503 while provider is unconfigured; route throws `POLICY_NOT_CONFIGURED`. Do not reinterpret as an empty successful list. |
| `GET /v1/admin/shipping/pins`, `PUT .../pins` | Actual GET `orders:read`; actual write `settings:write` + AAL2 | Live GET 200 `{items:[{prefix,note}]}` (four configured rows; their values not copied). OpenAPI/api-index omit GET permission and the write permission. |
| `POST /v1/admin/shipping/serviceability/check` | `shipping:read` | Live 200 with `{pin:string,allowListed:boolean,allowListConfigured:boolean,provider:null,note:string?}`. With the local demo PIN the allow-list matched. This route may update the provider cache when a provider is configured; the local `manual` mode does not call a provider. |
| `GET /v1/admin/shipments/overview` | `shipping:read` | Live 200 with `activeShipments,exceptions,stuck,webhook{pendingEvents,eventsWithErrors,lastReceivedAt},stalledRequests`. |
| `GET /v1/admin/shipments` | `shipping:read` | Initially live 200 `{items:[],nextCursor:null}`. Source DTO is `id,orderId,orderNumber?,provider,courier,awb,trackingUrl,status,rawStatus,chargesPaise,codAmountPaise,weightGrams,etd,pickupScheduledAt,lastEventAt,ndrCount,rtoState,hasLabel,createdAt` (there is no `rawStatusId`). The gated acceptance flow later created the sole named manual fixture shipment; current live row now reflects its delivered status. Supported query keys: `cursor,limit,status,courier,q,exception,stuck`. |
| `GET /v1/admin/shipments/{id}` | `shipping:read` | Source confirms shipment DTO above plus `events[{status,description,occurredAt,source}]`; no ID was available for a safe live detail probe. |
| `GET /v1/admin/shipments/{id}/label` | `shipping:read` | PDF, private/no-store; provider-backed dependency. Manual shipments have no label and return 404 `NOT_FOUND`; never expose any private storage/provider URL. |
| `POST /v1/admin/orders/{id}/shipments` (manual), `GET .../shipments` | Actual create `orders:fulfil`; read `orders:read` | Create body `{courier,trackingNumber,trackingUrl?}`; 201 `{id,orderId,status:'label_created'}`. Source locks order, requires `processing`, creates initial event, moves order to `shipped`, queues `order.shipped`, audits. GET returns `{items:[shipment with event list]}`. The gated local acceptance test created exactly one shipment on the verified `demo:true` retained order. |
| `POST /v1/admin/shipments/{id}/events` | Actual `orders:fulfil` | Body `{status,description?,occurredAt?}`; 204. Source accepts the six manual status enum values but does not enforce a forward-only shipment transition. Live mutation deferred to the named test shipment. |
| `POST /v1/admin/orders/{id}/shipments/plan`, `POST /v1/admin/orders/{id}/ship` | `shipping:write`; provider only | Existing provider path, not the manual fallback. Planning returns order/package/options/recommendation/wallet/warnings; ship accepts courier/package overrides and reason, and has resumable shipment-request state. Never call while `configured:false`. |
| `POST /v1/admin/shipments/bulk`, `GET .../bulk/{jobId}`, `POST .../manifest` | writes `shipping:write`; poll `shipping:read` | Provider workflow only. Bulk body has `orderIds[]` and strategy; over configured threshold requires AAL2. A manifest is a binary PDF and only for provider shipments. No jobs/manifests are created in manual mode. |
| `POST /v1/admin/shipments/{id}/cancel` | `shipping:write` + AAL2 | Backend route requires a provider dependency even though domain cancellation does not call the provider for a manual shipment. It is unavailable when provider is `manual`; hide it and request a backend correction before promising manual cancellation. |
| `GET /v1/admin/returns?status=` | Actual `orders:read` | Live 200 `{items:[]}`; no records existed. Source row keys: `id,orderId,orderNumber,status,reason,items[{sku,name,quantity}],createdAt`; hard limit 100, no cursor. |
| `POST /v1/admin/returns/{id}/decide`, `POST .../receive` | Actual `orders:fulfil` | Decide body `{approve,note}` (note 3–300); 204. Receive returns `{id,status,refundValuePaise,refundQueued,manualRefundRequired}`; it only accepts approved returns, restocks exactly once and queues an online-paid refund. **Critical mismatch:** receive changes inventory but the route does not require `inventory:write` or AAL2. Do not expose/call it until fixed; see DASH-BR-016. |
| `GET /v1/admin/refunds`, `POST /v1/admin/refunds/{id}/process` | Actual read `payments:read`; write `refunds:write` + AAL2 | Live GET 200 `{items:[]}`. Source row keys: `id,orderId,amountPaise,status,reason,createdAt`; hard limit 100, no cursor. Process requires a configured gateway and captured online payment; current backend returns `UNSUPPORTED_PAYMENT_METHOD` when gateway is absent. No process call is made without an eligible real test refund. |
| `POST /v1/orders/{id}/returns` | Customer-authenticated | Contract exists; delivered order, inside configured return window, item quantities bounded by delivered quantities. Used only to create a return against a Phase 07 named local test fixture if policy is configured. |
| `GET /v1/admin/settings` | `settings:read` (admin in current role matrix) | Existing Phase 05 parser includes nullable `returnWindowDays`. Use only to show the authoritative policy to roles permitted by that operation; do not change the policy in Phase 07. |

Initial live probes used a short-lived local admin operator and read-only GETs, plus the read-scoped serviceability check in manual mode. The probe account was disabled; credentials and bearer tokens were not printed or retained. At that point, no operational setting, shipment, return, refund, order or provider credential was mutated, and all three record lists were empty. The later explicitly gated acceptance test changed only the named synthetic Phase 06 COD order and created one shipment; the current record is manual/delivered. Returns and refunds remain empty, and the local outbox does not prove SMS delivery.

### Continuation re-ground and changed evidence (2026-10-07)

- Re-read the Phase 07 acceptance file, Phase 06 handoff, `DASH_PLAN.md`, current parity and this thinking record; checked current implementation status before extending the phase.
- Re-verified checkout is off from the public health/policy BFF and provider is `manual/configured:false`. The fulfillment role correctly cannot read admin-only `/admin/store-status`; the acceptance test now uses the existing safe public policy instead.
- The retained order UUID/order number and `demo:true` marker matched the expected Phase 06 fixture. The authoritative recipient label is **Phase Six Fixture**, not the older assumption “Phase 06 local test”; the preflight caught this before a write and the guard was corrected to the backend-observed synthetic value.
- The live ready endpoint rejects `limit=100`; the acceptance preflight now uses the normal contract-safe `limit=20` page.
- The manual write was accepted once (201). An ambiguous Playwright dialog-close selector interrupted the first run after the write; the test resumed by matching exact test courier + tracking number and did not resubmit. It then recorded `in_transit`, `out_for_delivery`, and `delivered` only as explicitly labeled local verification events.
- The customer API returned the same manual tracking ID, courier, number, delivered state and four event statuses. The fixture is now delivered and cannot be reused as a processing order without a separate approved fixture; the test is rerun-safe and creates nothing when the same test shipment exists.
- A settings-only preflight was rejected with 403 for fulfillment; no guard widening was added. The test checks only accessible operation contracts and relies on server authorization.

### Continuation design and skeptical review before remaining implementation

The remaining user-approved Phase 07 surface stays in this existing Shipping Center rather than adding unrelated navigation: a backend-backed return register with `orders:fulfil` decision confirmation; read-only finance refunds; and return policy shown only to roles allowed by `settings:read`. Return receipt stays absent because source proves the current route changes inventory without `inventory:write` + AAL2. Refund processing stays absent until a documented permission-appropriate payment-provider capability is available and an eligible captured payment exists. Provider-only operations remain capability-gated; local mode is manual and the owner parks Shiprocket.

Skeptical continuation review (changes applied to the plan):

1. **A “Return received” status could imply restocking.** Show approved as approved only, with a persistent receipt/restock security notice; no receive button or BFF call.
2. **A return decision can notify the customer through the outbox.** Require an explicit approve/decline dialog and a backend-valid 3–300 character note; explain this is not a refund or restock.
3. **A generic finance screen could make an absent gateway look usable.** Keep refunds read-only and state processing is withheld; do not probe a process endpoint just to learn configuration.
4. **Refund integration status is not available to finance by the role map.** Do not route around `integrations:read`; raise a backend request for safe processor capability in a `payments:read` response.
5. **No cursor on returns/refunds could mislead operators into assuming completeness.** Label both lists “Most recent 100”; keep only server-supported return status filtering and never invent client pagination.
6. **Admin settings include sensitive merchant fields.** Parse with the existing narrow settings schema but render only `returnWindowDays`; do not serialize the complete settings response into UI or logs.
7. **The delivered local fixture cannot test a new return under unset return policy.** Try only the customer API request expected to fail `POLICY_NOT_CONFIGURED`; do not change policy or manufacture a return/refund fixture.

Remaining slices: (4) return/refund runtime contracts and role-specific same-origin reads; (5) return list + decision, with receipt withheld and customer-visible consequence confirmation; (6) refunds read-only with no processing action; (7) provider/policy visibility and capability-gated settings/PIN surfaces only where safe and in scope; (8) full role, keyboard, responsive, accessibility and `pnpm verify` evidence.

Implementation plan for the continuation (all read/write boundaries remain the existing same-origin BFF):

1. **Runtime contracts first:** add `returnPageSchema`, `refundPageSchema`, `returnDecisionInputSchema`, `getReturns(status?)`, `decideReturn(id,input)`, and `getRefunds()` in `src/lib/api/resources/shipping.ts`. Test observed envelopes, integer-paise string/number handling, date offset, quantity bounds, valid status filters, trimmed 3–300 character decision notes, and exact API path/body calls.
2. **Return/refund view:** add a focused component + stylesheet under `src/features/shipping/`. The route server-checks `orders:read`, derives `orders:fulfil`, `payments:read`, and `settings:read` permissions, and passes booleans only; client queries are independently keyed/retried. Reuse `getSettings()` but render only nullable `returnWindowDays` for `settings:read` roles. Refunds query is never called for roles lacking `payments:read`.
3. **Decision:** a requested return can be approved/declined only by `orders:fulfil`. Open a keyboard-accessible dialog with exact decision, explicit customer notification consequence, and a required 3–300 character note. On 204 invalidate and trust the server; on ambiguous network result do not auto-retry—keep an “outcome unknown; refresh status before retry” notice. The response does not prove send delivery.
4. **Withheld actions:** never render or call receive; approved rows explain the missing backend `inventory:write` + AAL2 guard. Refunds remain read-only because gateway capability is not returned to `payments:read`; do not call process or infer that the backend payment provider is live. Mark rows “most recent 100”, because the endpoints have no cursor.
5. **Live verification:** with fresh roles, verify returns read under `orders:read`, refund read only under `payments:read`, no hidden-role BFF calls, and `settings:read` policy display only where allowed. Customer return request is read-only test evidence expected to fail `POLICY_NOT_CONFIGURED` while the setting is null; no policy write, receive, refund or synthetic return record.

## 1. Users and jobs

| Role | Five common jobs | Fast and safe means |
|---|---|---|
| Fulfillment | review `processing` queue; enter manual courier/tracking; record scan milestones; resolve delivery exception without auto-cancelling; decide/receive approved returns | One authoritative queue, COD due shown from server paise, no shipment before current backend processing state, immediate server confirmation, no blind retries, restock/refund consequences stated before receive. |
| Support | look up order tracking; read shipment events; read return status/reason; explain a failed/RTO state; hand the case to fulfillment/finance | Read-only controls, no street/phone beyond endpoint response, no ability to add events/decide/receive/refund, clear owner of next action. |
| Finance | review pending refund list; compare refund amount/status with server record; process an eligible captured online refund; confirm COD returns require a manual external cash/bank transfer; inspect provider state | Integer paise only, no process control without `refunds:write` and AAL2, never label a COD manual refund as processed by the app, gateway absence is a disabled capability not a retry prompt. |
| Admin | inspect provider health; manage allowed shipping settings; review shipments/returns/refunds; cancel an eligible provider shipment with reason + MFA; audit customer-impacting actions | Capability-driven provider panel, explicit effect/irreversibility before writes, re-fetch after mutation, no exposed secret, current API state wins. |
| Catalog / designer | no Phase 07 operational jobs | No Phase 07 navigation or calls; backend denial is expected and UI hiding is only a convenience. |

## 2. State and data flow

```text
shipping queries (provider, ready, overview, settings)
  -> loading | populated | empty | denied | unavailable(requestId) | schema-conflict
  -> each query is isolated; a broken provider card does not erase the manual ready queue
```

```text
manual order: processing + COD/paid eligible
  -> review server package/warnings and COD total
  -> confirm courier + tracking number + optional HTTPS tracking URL
  -> POST manual shipment (orders:fulfil)
  -> 201 {id, orderId, label_created}; order becomes shipped; outbox queues shipment message
  -> GET order shipments / shipment detail confirms authoritative tracking
  -> append event -> {label_created, in_transit, out_for_delivery, delivered, failed, returned_to_origin}
  -> only out_for_delivery/delivered move the order; returned_to_origin never auto-cancels or refunds
  -> delivered is terminal for this manual endpoint; customer sees tracking from GET /v1/orders/{id}/shipments
```

```text
shipment create timeout/connection loss
  -> outcome unknown; disable submit and reconcile order shipment list
  -> if matching active shipment exists, show it; if not, allow an operator-reviewed retry
  -> never blindly replay; manual POST has no documented idempotency key
```

```text
return request (customer): delivered + within return window + valid remaining quantities
  -> requested -> fulfillment approve or reject with note
  -> approved -> receive is blocked in dashboard pending backend inventory:write + AAL2 guard
      -> after backend fix only: backend restocks once, queues online refund (not paid out)
      -> after backend fix only: COD result says manualRefundRequired; no gateway refund implied
  -> if every unit is received, backend may close order as returned
```

```text
provider state:
GET provider configured=false -> manual-only panel, no plan/AWB/wallet/pickup/bulk/manifest/cancel controls
GET provider configured=true -> provider area appears with reachable state and permanent
  “Mock-tested only; not verified against live Shiprocket” notice
  -> provider unavailable/timeout -> disable provider writes; manual tracking remains available
```

Every page has independent loading, empty, permission-denied, API error with request ID, offline, and malformed-contract states. Cursors remain opaque and server ordered. A 409/ILLEGAL_STATE refreshes details without retrying or fabricating success. The route source has no forward-only guard for manual shipment events, so the UI will constrain choices and explicitly document the backend safeguard gap.

## 3. Deep-think questions and decisions

1. **Manual vs provider world:** Common pieces are order identity, server package preview, event timeline, current status and customer tracking. Manual create requires courier/tracking data and manual event entry. Provider-only pieces are courier quote, serviceability against carrier, AWB/pickup, wallet, labels/manifests, bulk jobs and provider cancellation. Rejected a shared “Ship now” button with hidden different semantics; mode is explicit and derived only from `configured`.
2. **Provider = manual:** Show the ready queue and manual entry form as the primary action. Show “Provider not connected — enter courier and tracking manually.” Do not render empty provider tables as if they are pending configuration, and do not call provider-only endpoints to fill the screen. `pickup-locations` 503 is a capability boundary, not a generic empty state.
3. **Shipment state and exceptions:** Manual backend enum is exactly `label_created`, `in_transit`, `out_for_delivery`, `delivered`, `failed`, `returned_to_origin`. UI guides monotonic progression; failed may be reviewed before a later shipment, and returned-to-origin is an exception, not a refund/cancel. There is no manual NDR/re-attempt action. Provider statuses include more fields, but those controls remain provider-gated. Rejected inventing NDR counters/actions in the manual mode.
4. **Return and refund ownership:** Server allows one open return, requires delivered status and configured window, bounds quantities, requires a note to decide, and only receives an approved return. Receiving is the single restock point and is status guarded, but its route omits `inventory:write`/AAL2 despite changing stock; therefore this dashboard keeps Receive blocked until the backend corrects its guard. Online-paid receipt queues, but does not process, refund; COD requires a separate manual transfer. Rejected a “refund now” button on receive and any frontend stock adjustment. `returnWindowDays` is readable via admin settings only under current role map; raise a request for safe read visibility to fulfillment.
5. **Double shipment/lost update:** Manual route locks the order and rejects a second active shipment, but has no documented idempotency key; on ambiguous network result reconcile first. Provider flow has resumable shipment request/idempotency state and backend per-order results. Settings overrides use backend validators/audit; user must not see optimistic state. Rejected automatic resubmission on timeout.

Other fixed owner choices: no B2B/riders/wallet/loyalty; COD amount equals backend `totalPaise` (₹25 COD fee already included), GST is included, no money arithmetic in the dashboard; do not edit shipping fee/return policy in this phase; manual courier entries are not claims of Shiprocket delivery; no SMS/SMTP success claim.

## 4. Ten-item pre-mortem

1. **Duplicate manual shipment after timeout:** one order gets two tracking records or a customer gets duplicate messages. Control: pending state, no auto retry, reconcile GET first, show active shipment and backend conflict.
2. **Wrong parcel weight or size:** courier cost or delivery fails. Control: show backend-computed package + warnings; manual API cannot persist an override, so withhold edit until a contract exists; provider override requires reason.
3. **PII in queue/search/URLs:** customer address enters logs or saved views. Control: no customer search or PII URL state, show only endpoint fields needed for fulfillment, no raw response logging, screenshots use named fixtures and are scrubbed.
4. **RTO mistaken for returned goods:** operator cancels/refunds before receiving parcel. Control: persistent exception explanation; RTO never changes order or money automatically; returns receipt is separate.
5. **Double restock:** repeated receive adds inventory twice. Control: action confirmation, pending lock, backend status guard, verify single inventory movement in live test.
6. **COD return shown as online refund:** finance reports a refund that was never paid. Control: render `manualRefundRequired` and `refundQueued` separately; no status synthesized from receipt.
7. **Provider appears operational when merely configured:** failed credential or fake provider is mistaken for Shiprocket. Control: provider status is authoritative; gate every control on configured and reachable; persistent mock-only disclosure; never show credentials.
8. **Event is recorded out of order:** backend manual event route accepts any enum value. Control: UI offers only safe next choices and requires confirmation; request server-side transition validation; record backend drift.
9. **A role bypasses expected actions:** a support user changes shipment or a finance user receives inventory. Control: exact UI permission map, BFF, real 403 role tests, no client token; backend remains enforcement point.
10. **Dense queue fails on mobile or keyboard:** a courier operator cannot safely ship on a phone. Control: 375px cards, 44px targets, labeled status text, focus restoration on dialogs, axe + keyboard path and three responsive captures.

## 5. Security and privacy

- All browser calls use typed same-origin API resources/BFF; bearer/refresh tokens remain in encrypted httpOnly server session; mutating calls require CSRF. No raw backend origin or third-party script.
- The ready queue returns customer name, city and pincode. Render only the minimum necessary in the list; address/phone stays in the authorized order/shipping detail. No PII in query strings, logs, copied analytics or persisted drafts.
- Manual tracking URL must be HTTPS as enforced by backend; render it as an external link only after strict URL parsing and with safe rel attributes. Never render private label/storage URLs.
- Reasons are mandatory where backend requires them; MFA step-up only mirrors actual permission guards. Shipment cancel is `shipping:write` + AAL2; PIN allow-list changes are `settings:write` + AAL2; refund is `refunds:write` + AAL2; high-count provider bulk also steps up.
- Customer-facing order/shipment/return changes wait for backend response and audit/outbox semantics. Never claim an email was sent; say queued where the route does.
- Idempotency/reconciliation follows endpoint behavior, not a UI-generated guarantee. Do not retry network-ambiguous writes automatically.

## 6. Performance and accessibility budgets

- Initial visible queue: first 50 rows/cards render within 100 ms after data resolves on a mid-range laptop; one debounced search at a time; abort stale reads; never load all shipment rows.
- Search feedback target ≤250 ms locally; server response budget p95 ≤700 ms on the seeded local stack (record observed value; do not claim production SLO).
- Operational mobile controls at 375px: no horizontal page overflow, action hit area ≥44×44 CSS px, no required hover interaction, primary add-shipment action visible without precision gestures.
- Every action reachable by keyboard; dialogs trap/restore focus; status has text + icon + colour; reduced motion is respected. Axe serious/critical violations: zero at 375 and desktop.
- Print label opens a same-origin protected endpoint only in a new tab, with no external URL exposure. Manual shipment has no label; print packing slip remains separate from provider label.

## 7. Test plan (names fixed before implementation)

Unit/component tests:
- `shipping-models.test.ts`: reject missing cursor envelope, malformed paise, malformed status/time, or insecure tracking URL; preserve nullable provider fields.
- `shipment-event-policy.test.ts`: safe manual event choices, terminal states and RTO do not offer cancel/refund.
- `shipping-capability-gate.test.tsx`: provider controls absent when `configured:false`, provider-only controls disabled when unreachable, mock-only disclosure is visible if configured.
- `shipping-center.test.tsx`: independent loading/empty/error/denied states and no fake zero/empty replacement after parse failure.
- `return-receive.test.tsx`: separate “stock restocked”, “refund queued”, and COD “manual transfer required”; no duplicate optimistic mutation.
- `refund-processing.test.tsx`: finance+aal2 gating, unavailable gateway state, no blind retry after an ambiguous response.

Real backend/browser tests:
- `shipping-live-read.spec.ts`: fresh fulfillment/admin/support/finance sessions verify real allow/deny reads and 403 writes; no denied BFF call leaks.
- `manual-shipment-acceptance.local.spec.ts`: explicit mutation flag plus hardcoded retained synthetic order ID; requires `demo:true`, exact order number/recipient, checkout off, manual provider and no unrelated shipments before writing. Reconciles existing unique test tracking on rerun, creates at most once, records local-verification statuses to delivered, verifies customer API parity, and never claims message delivery.
- `manual-shipment-duplicate-live.spec.ts`: second active shipment is refused and a stale/ambiguous result reconciles by read.
- `returns-live.spec.ts`: request return as customer and fulfillment decides; verify receive remains unavailable pending backend fix; if local return window is null, capture `POLICY_NOT_CONFIGURED` and do not change policy.
- `refund-provider-unavailable-live.spec.ts`: prove no process control/call is offered when gateway is absent; never create/process a fake customer refund.
- `shipping-fake-provider-live.spec.ts`: only if `SHIPPING_PROVIDER=fake` is already safely available or can be enabled without resetting/overwriting local backend state; label all evidence “fake provider, not Shiprocket”.

Visual evidence: `shipping-center-{375,768,1440}.png`, `shipment-detail-{375,768,1440}.png`, `returns-{375,768,1440}.png`; keyboard walk and axe at phone and desktop sizes. Before any test writes, use a unique local test label and document what state it changes.

## 8. Thin vertical slices

1. Add strict schemas/resources for read operations, unit tests first, and probe the same-origin BFF with read roles. Do not add navigation to mutation-only shells.
2. Build the ready-to-ship queue and manual add-shipment confirmation using only backend package/COD data; run the real named-order manual shipment flow.
3. Add shipment list/detail, status timeline, safe manual event entry and tracking/customer parity. Provider-only label/cancel remain hidden in manual mode.
4. Add return list/decision/receipt with role/action boundaries and single-restock evidence; use an online refund fixture only if a real provider-backed eligible fixture is available.
5. Add finance refund queue/processing states and provider-not-configured honest state; no mutation if there is no eligible captured payment.
6. Add provider settings/capability surface, only show provider actions when configured; exercise only fake provider in local tests, and keep live Shiprocket claims false.
7. Finish role matrix, keyboard/mobile/print, full `pnpm verify`, evidence and handoff. Record any impossible acceptance as a backend/configuration exception with request ID and owner impact.

## 9. Skeptical review findings and changes

1. **Initial plan implied one generic shipment create flow.** Backend has two distinct APIs and permissions; split manual create (`orders:fulfil`) from provider plan/ship (`shipping:write`) and mode-gate the latter.
2. **Initial plan assumed manual event progression was enforced.** Source shows enum validation only; add a constrained UI choice model, no free-form status, and raise DASH-BR-010 for server-side transition enforcement.
3. **Initial plan placed cancel in common shipment actions.** `cancel` route requires a provider in manual mode despite domain support for manual records; hide manual cancellation and request correction (DASH-BR-011).
4. **Initial plan assumed package override applies to manual.** The manual create schema has no package/reason fields; display computed values/warnings but do not pretend an override persisted, and request the field (DASH-BR-012).
5. **Initial plan assumed return policy is visible to fulfillment.** Current safe settings endpoint uses `settings:read`, absent from fulfillment; show authoritative value to admin only for now and ask for a non-sensitive readonly `returnWindowDays` in the returns/read policy response (DASH-BR-013).
6. **Initial plan assumed every operation was fully documented.** `pins`, events, returns and refund permissions/request schemas differ or are omitted in api-index/OpenAPI; document exact source-backed guards and raise DASH-BR-014.
7. **Initial plan assumed returns/refunds are cursor lists.** Live empty envelopes and source cap both endpoints at 100 without a cursor; UI will label the cap and not invent a next page, while asking for cursor support in DASH-BR-015.
8. **Initial plan treated an absent refund provider as a temporary error.** Source returns `UNSUPPORTED_PAYMENT_METHOD`; refund process remains unavailable and no financial fixture is manufactured (DASH-BR-017 if the live contract does not document it).
9. **Initial plan assumed the backend guarded return receipt like inventory writes.** Source confirms a stock increment behind only `orders:fulfil`, with no AAL2 check. Block the dashboard action and request `inventory:write` + AAL2 on the backend route (DASH-BR-016).
10. **Initial plan assumed provider settings can be safely explored by writes.** Writes alter dispatch, serviceability or bulk threshold; perform read-only probes only until owner-reviewed values and safe fixture state exist.

These changes keep the phase buildable while distinguishing real manual capabilities from provider-only functionality and API behavior not yet guarded by the backend.

## 10. Continuation and closeout

### Continuation re-ground and closeout (2026-10-07)

- Re-read Phase 07 acceptance/handoff, shipping route source and the current return/refund UI before finishing the settings/PIN/serviceability slice. Exact read paths and payload parsers are in `src/lib/api/resources/shipping.ts`; only endpoints in OpenAPI/api-index are used.
- Source confirms shipping settings GET/PUT use `shipping:read`/`shipping:write`; PIN GET uses `orders:read`, while PIN PUT uses `settings:write` + AAL2. Both write routes lack a required audit reason and caller-supplied version precondition. No write is exposed or attempted; DASH-BR-019 / ADR-030 records the gap.
- `ShippingTools` displays backend settings and PIN rows, defaults to no user-entered test values, requires PIN/weight/COD-or-prepaid/declared value, and calls the existing serviceability endpoint. Only manual mode is live locally; it returns the backend allow-list result with `provider:null`. Configured-provider response/caching is disclosed; provider reads appear only after backend-reported configured+reachable state. Shiprocket remains explicitly unverified.
- Targeted unit coverage passed for model/resource/query contracts and the new delivery tool (5 files / 34 tests). Full `pnpm verify` passed: contract hash `d7d6830f60ea17296bb2e50569ecd43b0646d5d6008457bd944ee23a0b2cf144`, strict TypeScript, ESLint, 29 files / 116 tests and production build.
- The attempted latest live role rerun did not reach Playwright: Docker Desktop returned engine API 500, `/readyz` timed out, and PostgreSQL operator setup hung before insert. The identified process was stopped. Do not claim live role/browser evidence for the newly mounted settings/PIN views; replace stale `shipping-center-*.png` screenshots when the stack is healthy. Previous live probe shapes remain valid evidence for the endpoints, but not fresh browser rendering.

#### Skeptical review findings and changes for Delivery Tools

1. **A default parcel weight/value could look like a real destination-specific quote.** Require the operator to enter PIN, weight, payment collection and declared value; do not seed any amount or weight into the form.
2. **A serviceability button could silently contact a provider or write a cache.** State this before submit, disable provider checks if the provider is unreachable, and keep booking/guarantee language out of the result.
3. **Appending a fixed mask could corrupt a six-digit backend PIN prefix.** Render a six-character prefix with a right-pad mask only for shorter prefixes; preserve exact server value for full-length prefixes.
4. **Settings and PIN writes look like normal CRUD but alter dispatch/eligibility without audit reasons or concurrency guards.** Keep them read-only for every role and record DASH-BR-019.
5. **Mutation state can leave an old result beside changed form inputs.** Reset result/error state whenever test inputs change, and never automatically retry the POST.

## 11. Handoff notes

Phase 08 must know: the ready queue uses backend package fields/defaults, and product shipping attributes may be incomplete; do not silently substitute dashboard catalogue data. Phase 08 owns product shipping fields only if the backend schema exposes them; never make the shipping queue infer package dimensions from local catalogue snapshots. Dashboard shipping settings/PIN changes remain withheld under DASH-BR-019 / ADR-030. Phase 16 may reuse shipment/return order references but must not duplicate tracking or return history. Phase 18 may reuse `refundValuePaise` and refund entries as integer paise; processing remains Finance/MFA and gateway-dependent. Phase 19 owns shipping fee, PIN policy and return-window edits. Phase 20 must re-run the role matrix and manual flow; only test a fake provider if already safely configured, and keep Shiprocket live verification pending an actual account and owner-approved dry-run. Restore and verify Docker Desktop/gateway readiness without resetting the backend before new live screenshots and role evidence.
