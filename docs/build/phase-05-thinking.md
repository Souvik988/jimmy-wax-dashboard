# Phase 05 — Overview, health, alerts and store controls

Status: **COMPLETE** · Re-grounded and implemented 2026-10-07 IST · contract `v1.2.0-draft.1` SHA-256 `d7d6830f60ea17296bb2e50569ecd43b0646d5d6008457bd944ee23a0b2cf144`.

## Re-grounding and exact contract scope

- Read the Phase 04 handoff, current plan/progress, `03_BACKEND_CONTRACT.md` implementation-status deviations, API index, OpenAPI, and the Phase 05 prompt. Phase 04 is accepted as a documented exception: its real mutation proofs stay with the safe consuming flows (uploads Phase 09, idempotent Studio publication Phase 15). This does not relax any Phase 05 safety proof.
- Re-read the binding rules: no fake operating data; integer paise and IST; separate pause from checkout; browser uses only the BFF; backend guards MFA, reasons and permissions; no promise that unconfigured Razorpay/SMS/SMTP works; Shiprocket stays parked/manual-first.
- Operations verified to exist: `GET /v1/admin/dashboard` (`orders:read` in running route); `GET /v1/admin/health` (`ops:read`); `GET`/`PUT /v1/admin/store-status` (`settings:read` / `settings:write`; no MFA on PUT); `GET /v1/admin/settings` (`settings:read`); `POST /v1/admin/checkout/activate` (`settings:write`, MFA, `{confirm:true,reason,expectedVersion}`); `POST /v1/admin/checkout/disable` (`settings:write`, reason, deliberately no MFA); `GET /v1/admin/integrations` (`integrations:read`); `GET /v1/admin/audit` (`audit:read`); and `GET /v1/admin/analytics/sales` (`analytics:read`). All are generic objects in OpenAPI, so live shape probes are mandatory before their parser/UI is written.
- The running source clarifies important contract details: dashboard is last 30 IST calendar days (not “today”); it contains status-grouped totals, low stock, payment exceptions, refunds and outbox counts. Health adds derived alerts. Integration test operations must never be used merely to paint “working”; current phase is status-only. Store pause and checkout disable do not require step-up but still require `settings:write`; checkout activation does require step-up, a reason and a version.
- Live shape probes against the gateway completed with two separate disposable admin accounts, both disabled in `finally`; no response values, credentials, tokens or customer data were retained. All reads returned 200. `dashboard` is `{definitions:{window,currency,ordersByStatus},ordersByStatus:[{status,count,totalPaise}],lowStockVariants,paymentExceptions,refundsOpen,outbox:{pending,deadLetters,oldestPendingSeconds}}`. `health` is `{outbox:{dead,pending},email:{failed,pending},shippingEvents:{unprocessed},bulkJobs:{active},stuckShipmentRequests,lowStockVariants,provider,paymentProvider,alerts:string[]}`. `store-status` is `{ordersPaused,pauseMessage,checkoutOpen,codEnabled,onlinePaymentsEnabled}`. `settings` is `{settings:{shippingFeePaise,freeShippingThresholdPaise,codEnabled,codMaxOrderPaise,onlinePaymentsEnabled,paymentWindowMinutes,checkoutEnabled,checkoutPolicyConfirmed,checkoutAuthority,codFeePaise,gstRateBps,taxInclusive,returnWindowDays,merchantLegalName,merchantGstin,merchantState,merchantAddress,brandName,supportEmail,supportPhone,ordersPaused,pauseMessage,version},readiness:{allOk,checks:[{id,ok,detail}]}}`. `integrations` returns `{items:[{name,configured,facts,lastCheck}]}`. `audit` returns `{items:[{id,actorId,actorRole,action,resourceType,resourceId,reason,before,after,requestId,createdAt}]}`. `analytics/sales` returns `{range:{from,to},definitions:{sales,aov},totals:{orders,revenuePaise,aovPaise,discountPaise},series:[{bucket,orders,subtotalPaise,discountPaise,shippingPaise,taxPaise,revenuePaise,aovPaise}],byPaymentMethod:[{method,orders,revenuePaise}]}`.

## 1. Users and jobs

| Role | Five jobs affected by this phase | Fast and safe means |
|---|---|---|
| admin | orient to sales/queues; diagnose health; pause new orders; assess checkout readiness; audit what changed | critical state is readable in seconds, destructive controls state their consequence, no provider is represented as live without evidence |
| support | see permitted order queues; understand whether the store is paused; find priority work; report a technical state; avoid unsupported settings controls | reduced queue-first view, no leaked health/audit/integration data, clear “not permitted” rather than empty cards |
| fulfillment | inspect order/stock-related queues; see pause/checkout state; decide whether to pack; flag low stock; act on assigned work later | freshness is visible, no accidental checkout activation, actionable queue links retain their filters |
| finance | see sales/revenue definitions when permitted; watch payment exceptions; inspect own audit feed; understand checkout state | paise are never recomputed in the browser; financial states use labels plus text, not colour alone |
| catalog/designer | understand only the global store status relevant to their work; keep future permissions hidden | no fabricated KPI/health data or implied access to operational systems |

## 2. State machines and data flow

```text
Route server guard -> safe operator -> client overview shell
  -> independent query widgets (dashboard | sales | status | settings | health | integrations | audit)
  -> loading / ready / empty / denied / offline-or-error / stale
  -> 60-second visible-tab refetch or manual refresh
```

```text
Store status: server snapshot -> idle
  -> pause intent (optional 0–300-char message) -> consequence confirmation -> PUT once
  -> 200 -> invalidate store status/overview/public-policy banner -> success + audit refresh
  -> 403 -> denied state; 409/timeout -> retain value, refetch authoritative state, explain uncertainty

Checkout: readiness snapshot -> locked(reason list) | ready-but-off | on
  -> activation reason (3–300), version, confirm=true -> MFA_REQUIRED -> existing step-up -> exact retry once
  -> 204 -> refetch settings/status/public policy
  -> disable reason -> fast consequence confirmation -> 204 -> same invalidation
```

```text
Global banner: authenticated shell reads status with a small dedicated query
  ordersPaused -> persistent text/icon banner with message, dismiss is forbidden
  checkoutOpen=false + not paused -> non-emergency status in overview, no global alarm
  query failure -> no invented state; show “store status unavailable” only within an operator-visible status region
```

An independently failed widget never blocks the other widgets. A 403 is a permission state, not zero; an empty queue is a real empty state; stale values retain their last updated time. The overview is a client component because it needs refresh, controls and current-session query behavior; its route guard stays server-side, and it receives only the safe operator identity/permissions.

## 3. Deep-think answers and decisions

### Morning/night signals and queues

The initial grid will use only metrics emitted/derivable from backend answers: order status counts for the defined 30-day window, status totals in integer paise, low-stock variants, payment exceptions, open refunds, and outbox pending/dead. “Today” cannot be asserted unless sales analytics returns an explicit daily definition; otherwise labels will say exactly what the backend defines. Queues are actionable only where a verified destination exists: Orders may link to Phase 04's read-only `/orders` status filter. All other queue cards explain that the operational detail is not released yet rather than linking to an unfinished route.

### Metric definition and timezone

Every metric carries the server's returned definition in a visible details affordance. No client-side summing of an ambiguous set is used for revenue. API timestamps are formatted IST. “Updated” refers to query response time, not an invented data cutoff. The alternative—fixed dashboard labels with locally calculated KPIs—was rejected because the dashboard query currently covers the last 30 IST calendar days.

### Emergency-control safety

Pause/resume require a short confirm dialog that repeats customer impact and offers an optional pause message up to the actual 300-character limit; no MFA is added because the backend deliberately keeps the action fast. Checkout activation requires readiness, reason, version, `confirm:true` and the existing MFA flow. Checkout disable stays fast but requires an explicit 3–300-character reason and confirmation. Buttons disable while a request is definitive; ambiguous failure does not retry or claim success. The alternative single “Store on/off” switch conflates fundamentally different customer outcomes and is rejected.

### Independent failures and reduced roles

Widgets are permission-gated by the safe server operator data and still treat backend 403 as authoritative. Support can see the dashboard queue where allowed but not health/settings/audit/integrations/sales unless the backend role grants it. A missing permission produces a compact unavailable state, not a generic HTTP error. Queries use phase-04 typed BFF transport, resource keys and bounded read retry. The alternative one aggregate request would make partial outages and least-privilege impossible to represent.

### Visual direction

The page uses the established warm dashboard tokens as a **quiet leather-workbench control board**: a restrained ink/ivory baseline, delineated “signal tape” for current state, dense but breathable cards, and a single warm brass accent reserved for actions that affect customers. It avoids a generic analytics wall, chart confetti, status-only colour and fabricated sparkline data. Motion is limited to existing loading/refresh feedback and respects reduced motion.

## 4. Ten-item pre-mortem and controls

1. **A 30-day figure is labelled “today.”** Render server definitions verbatim; do not derive alternate periods.
2. **A paused store is missed while navigating.** Add a non-dismissible global status banner fed by a dedicated status query; test state transition and failure state.
3. **An operator accidentally activates checkout.** Require readiness, version, confirm phrase/confirmation, reason and backend MFA; no optimistic toggle.
4. **A stale readiness version overwrites settings.** Submit backend `expectedVersion`; on 409 refetch and show a conflict path rather than retrying.
5. **A kill switch is hidden behind unnecessary MFA.** Preserve the backend's deliberately fast path but require a reason and customer-impact confirmation.
6. **A provider card implies Razorpay/SMS/SMTP works.** Show backend status fields and literal “configured — no safe live probe” wording; no success badge without an actual verified result.
7. **One failed endpoint blanks the whole page.** Each widget owns error/empty/denied/loading states; test a blocked endpoint while neighbors render.
8. **Reduced-role users infer privileged data from placeholders.** Render neither values nor counts for denied data; test each role against real backend results.
9. **Mobile operators cannot reach the emergency action or dialog.** 375px layout keeps controls vertical, focus enters dialogs, Escape/cancel returns focus, 200% zoom has no clipped confirmation.
10. **Refresh races with a store-control write.** Disable the relevant control while pending; invalidate/refetch on settled result; query results are never treated as success acknowledgement.

## 5. Security and privacy

- The browser sees only safe operator identity/permissions and same-origin BFF responses. No token, request body, customer record, audit-before/after blob or integration secret is serialized into local storage, URL or logs.
- Route protection runs server-side. Client permission checks only reduce exposure; every operation still receives backend enforcement.
- Reasons stay in request bodies, are length-validated, and never become a query parameter. Errors show request IDs and escaped messages.
- Audit entries are summarized from allowlisted display fields only; raw `before`/`after` data is not rendered in this phase because it can contain PII or secrets.
- Provider checks are status reads only. This phase never calls the integration-test endpoint, which can write an audit entry/send a real self-email or probe storage.

## 6. Performance and accessibility budgets

- Independent initial queries: render structural overview within 200 ms after hydration; each local response target p95 under 800 ms; manual refresh starts feedback immediately.
- Auto-refresh is 60 seconds only while the tab is visible; one query per widget/key; no retry for mutations and at most two bounded read retries.
- At 1440px the first scan has critical status and up to six metrics without scrolling; 375px uses a single-column order with actions before secondary cards. No fabricated chart if sales series is absent.
- WCAG 2.2 AA: 4.5:1 text, visible focus, status icon + text, aria-live refresh/error statuses, labelled buttons/dialogs, keyboard access to every card/action, focus restoration, no focus trap escape failure, and zero serious/critical axe violations at 375/768/1440.

## 7. Test plan (named before implementation)

- `overview-models.test.ts`: reject malformed generic API payloads; normalize safe dashboard/health/status/settings/sales/integration/audit models without broad casts.
- `overview-permissions.test.tsx`: role widgets reflect only safe operator permissions; a backend 403 is a denied card, never a zero.
- `store-controls.test.tsx`: pause/resume confirmation, 300-character bound, kill-switch reason, MFA activation handoff, no mutation retry after ambiguous failure.
- `overview-widgets.test.tsx`: independent loading, empty, error, offline and stale states; manual refresh and visible-tab refresh behavior.
- `overview-live.spec.ts`: disposable local admin real endpoints, status reads, readiness refusal details, pause/resume with public `/v1/store-settings` verification, and audit record evidence; restores initial local state in `finally`.
- `overview-roles-live.spec.ts`: real admin/support/catalog/fulfillment/finance/designer matrix and denied-endpoint check.
- `overview-accessibility-live.spec.ts`: real 375/768/1440 captures, keyboard dialogs and axe tags.

## 8. Thin vertical slices

1. Probe generic live responses; write Zod models and resource functions; record any drift before UI.
2. Add protected `/` overview shell, independent query cards and role matrix, leaving unavailable future queues unlinked.
3. Add public, non-dismissible pause banner and store status/readiness panel.
4. Add pause/resume, guarded activation and kill-switch controls using existing reason/MFA/conflict primitives.
5. Add health/integration/audit/sales widgets only if the real shapes are parsed; otherwise show an honest contract-unavailable state and raise a request.
6. Exercise real backend safely with restore-on-finally, update all build records and phase handoff.

## Skeptical review findings and changes

1. **The phase prompt calls dashboard figures “today,” but running source says 30 days.** The UI will not use “today” until a real daily analytic response supports it.
2. **The contract says checkout disable needs MFA while the operation description/source says deliberately not.** Running behavior wins; document this discrepancy if live probe confirms it, and preserve a reason/confirmation.
3. **A global banner query could add privileged state to every role.** It will be requested only when the safe operator has `settings:read`; all other roles see no inferred status.
4. **Integration status may contain operator-sensitive operational details.** It is admin-only by current role mapping and will use a narrow parser/display model.
5. **The audit endpoint returns broad before/after objects.** The first overview feed will show only actor role/action/resource/reason/time/request ID, not raw diffs.
6. **Pausing to test can affect a real local website tab.** The live test will capture initial state, execute only in the local stack, verify public reflection, and restore in `finally`; no reset/stock/checkout changes are permitted.
7. **A 204 checkout response lacks a body.** Success is acknowledged only after refetching settings and public status, never with an optimistic toggle.

## Verification outcome and Phase 06 handoff

- `overview-models.test.ts` covers all live generic-object parsers, including nullable checkout-prerequisite fields. A production build, TypeScript, ESLint and the full 55-test unit suite pass.
- The baseline browser suite passes 6/6 uncredentialed tests (11 credential-gated tests correctly skip without disposable credentials). The live Phase 05 run previously exercised pause → customer-public-store-status reflection → visible global banner → resume, restoring the initial local state; the public endpoint currently reports `ordersPaused:false` and `checkoutOpen:false`.
- Responsive evidence is retained at `docs/build/evidence/phase-05/overview-375.png`, `overview-768.png` and `overview-1440.png`; the live test records pause/resume network responses and performs axe WCAG 2.2 AA serious/critical checks. All Phase 05 disposable administrators were disabled after use.
- Exact metric definitions: all overview KPI cards describe the backend’s `dashboard.definitions` 30-day server window; sales has its own half-open `range`; “updated” means UI response time. Phase 06 must not rename these as daily or mix order-list counts with them.
- Reuse the shell-level `StorePauseBanner` for every later route. Dispatch `jw:store-status-updated` with a validated status after a successful store-status write, then refetch; never provide a dismiss affordance. Customer state remains authoritative at public `GET /v1/store-settings`.
- Phase 06 may link only to its implemented Order routes. Phase 05 currently links the verified Phase 04 status-filtered Orders reference and leaves fulfillment/refund/inventory queues unlinked until those workspaces are real.
