# Dashboard progress

## Phase 01 — Orientation, audit, decisions and repository foundations

**Status: COMPLETE** · 2026-10-06 IST

### Built

- Replaced the fabricated operator overview with an accessible foundation route driven by `/api/health`.
- Added a server-side gateway probe for `/healthz` and `/v1/store-settings`; the browser never calls the backend origin directly.
- Added a strict Zod parser for public store policy, linked to generated OpenAPI `StoreSettingsPublic` types.
- Pinned OpenAPI v1.2.0-draft.1 by SHA-256 and generated `src/lib/api/generated/schema.ts` from the local contract pack.
- Pinned the foundation toolchain: Next 16.3.8, TanStack Query/Table, React Hook Form, Zod, Radix, Tailwind, Vitest, Testing Library, Playwright and axe.
- Added `pnpm verify`: contract lock → typecheck → lint → unit tests → production build.
- Created repository layout, ADRs, local-development runbook, risks, backend request ledger, plan and parity/API coverage matrix.
- Started the local backend stack, verified the live gateway, and created local accounts for all six required operator roles without retaining credentials.

### Evidence

- Contract: `contract.lock.json`; `pnpm contract:check` verifies SHA `d7d6830f60ea17296bb2e50569ecd43b0646d5d6008457bd944ee23a0b2cf144`.
- Live gateway: `GET /healthz` → 200 `{ "status": "ok" }`; `GET /readyz` → 200 `{ "status": "ready" }`; `GET /v1/store-settings` → 200 with GST-inclusive, checkout-off policy.
- BFF: `GET http://localhost:3200/api/health` returned `backend:"connected"` and the live public policy.
- Failure/recovery: gateway listener was stopped; the same BFF endpoint returned `backend:"unavailable"`; gateway was restarted and the endpoint recovered to `connected` without dashboard reload.
- Gates: TypeScript passed; ESLint passed; Vitest passed (`2/2`); Next production compilation/typecheck completed and emitted `.next/BUILD_ID`.

### Acceptance

| Criterion | Result |
|---|---|
| Required `docs/build` planning, risks, parity, requests and local-dev records | PASS — files recorded in this directory |
| `pnpm verify` clean-clone equivalent | PASS locally; contract check, typecheck, lint, 2 unit tests and production build completed |
| Generated API types compile and typed store-settings BFF probe works | PASS — generated schema, contract-linked parser, live BFF evidence |
| Prototype does not make an unfounded Mock API claim | PASS — no mock content or label remains on `/` |
| Backend unavailable/recovery UI path is real | PASS — live BFF failure/recovery evidence above |

### Verified vs not verified

Verified: local gateway reachability, public policy parse, BFF isolation, toolchain gates, and local role creation.

Not verified: encrypted session login/MFA/RBAC (Phase 03), any authenticated operation, visual screenshot capture (the current browser security policy rejected the previously opened local tab reload), client Studio bundle rendering, and Shiprocket live capability.

### Contract observations

- Contract pack and its implementation status describe B8–B13 as built; the project-root brief is historical.
- Contract pack says 190 backend tests in the status narrative, while the owner brief says 191. This count discrepancy is recorded for future full-suite evidence; it has no Phase 01 feature impact.
- Public `StoreSettingsPublic` permits nullable free-shipping/COD limits while the live seed currently supplies integer values. Future UI must support null rather than assume local seed shape.

### Handoff to Phase 02

Build the component library and real shell on top of the BFF health contract. Do not reintroduce hard-coded KPIs/orders or `Mock API`. Preserve the current connected/unavailable state in the shell. The running local services are available at gateway `8080` and dashboard `3200`.

## Phase 02 — Design system, tokens, application shell and component library

**Status: COMPLETE** · 2026-10-06 IST

### Built

- Added semantic warm light/dark dashboard tokens, spacing, radii, shadows, z-indexes, type scale, motion and forced-colors/reduced-motion rules in `src/styles/dashboard-tokens.css`.
- Added centralized INR paise and explicit IST/relative-time utilities; no component performs ad-hoc money/date formatting.
- Added a typed, accessible component inventory for controls, fields, choices, dates, money entry, tabs, feedback states, cards, table/filter/pagination contracts, copy/redacted JSON, overlays, confirmations, reason collection, StepUp placeholder, popover/tooltip and bounded toast region.
- Added a responsive, data-driven application shell: warm sidebar groups, breadcrumb top bar, safe non-navigating future destinations, mobile drawer under 1024px, skip link, command palette and explicit `No operator session` state.
- Reworked `/` to use the new shell while retaining the live Phase 1 BFF connection/policy evidence.
- Added a development-only component lab at `/dev/components`; its fixtures are explicitly non-operational visual-test data.

### Evidence

- Unit: `pnpm test` passed **6/6** tests (money, IST/relative time and Phase 1 policy parser).
- Accessibility/E2E: `pnpm test:e2e` passed **2/2** Playwright tests: keyboard skip/palette/Escape focus restoration and zero axe serious/critical violations on `/dev/components`.
- Production: `pnpm build` completed with `/`, `/dev/components` and dynamic `/api/health`; `pnpm verify` completed contract lock, typecheck, lint, unit tests and production build.
- Live local smoke: `GET http://localhost:3200/` and `GET http://localhost:3200/dev/components` both returned 200 and expected shell/lab markers.
- Responsive captures: `docs/build/evidence/phase-02/components-375.png`, `components-768.png`, `components-1440.png`.

### Acceptance

| Criterion | Result |
|---|---|
| Every listed component exists with a living component page and accessibility test | PASS — `/dev/components`; axe evidence above. Calendar and combobox are honest controlled inputs, with server/search mechanics reserved for Phase 4. |
| Shell supports keyboard-only navigation, skip link, palette and Escape | PASS — Playwright keyboard walkthrough. |
| Money/date helpers are unit-tested | PASS — 4 deterministic formatter/parser tests. |
| Responsive screenshots at 375/768/1440 | PASS — evidence PNGs above. |
| Lighthouse accessibility ≥95 | NOT VERIFIED — Playwright/axe passed, but a Lighthouse runner is not configured in this repository. |

### Verified vs not verified

Verified: visual token application, shell/mobile drawer boundary, live BFF home-state preservation, keyboard path, axe serious/critical violations, unit formatting, local HTTP routes, production build and screenshots.

Not verified: Lighthouse numeric score; persisted theme preference; session/role filtering and protected deep links (Phase 03); real query/filter/combobox result sources and calendar range mechanics (Phase 04); real 50+ row performance profile against authenticated data.

### Handoff to Phase 03

Attach the encrypted BFF session and server-derived permission resolver to `src/components/layout/app-shell.tsx`; use `NotAllowedState` for denied deep links and replace only the explicit `No operator session` label after a verified session exists. Keep browser tokens absent. Complete `StepUpDialog` only through the real MFA state machine. Do not turn Phase 2 planned sidebar entries into reachable feature routes until their phases have complete states.

## Phase 03 — Authentication, sessions, MFA step-up and role-based access

**Status: COMPLETE** · 2026-10-07 IST

### Built

- Added server-only AES-256-GCM operator-session envelopes in `jw_operator_session` (httpOnly, SameSite=Strict; Secure by default outside explicit local HTTP) plus same-origin/CSRF proof for mutations. Access and rotating refresh tokens stay inside the encrypted server cookie and backend BFF calls.
- Added backend auth client, BFF login/logout/session/MFA/enrollment/recovery/invitation/password and session-list/revoke routes, with sanitized error shapes and no-store responses. `/api/auth/session` emits only safe operator identity and role data.
- Added exact six-role permission/navigation matrix, role-aware shell, safe relative `next` handling, route guard, and a real backend operation probe proving forbidden role calls return 403.
- Added TOTP setup/verification, recovery-code one-time display/saved gate, account security and active-session controls, password-change form, idle warning/logout, session-expired re-auth dialog, and one-time invitation code entry.
- Connected `MFA_REQUIRED` to a global step-up dialog. `authFetch` holds the failed request and retries once only after MFA verification; cancel returns the original refusal, and there is no retry after a network ambiguity. New-tab MFA enrollment resumes the pending request only after the original tab confirms the elevated session.
- Replaced invite-token query parsing with a labeled code field. The backend email supplies a one-time code; the dashboard no longer places it in request URLs or framework access logs.
- Fixed a live BFF bug where spreading `Headers` into a plain object dropped `Authorization`; added regression tests. Also fixed time-format runtime exception, MFA input native pattern, and AppShell hydration mismatch found while dogfooding these screens.

### Evidence

- `pnpm typecheck`, `pnpm lint`, and `pnpm test`: PASS; Vitest **23/23** (7 files), including encrypted session/CSRF/role/coordinator checks, `Headers` forwarding, IST formatting, and MFA cancel/no-retry plus verify/retry-once.
- Real local backend role E2E: **6/6 passed**. Each role’s exact nav was checked; token-free BFF responses, encrypted-cookie attributes, local/session storage, MFA enrollment/recovery gate, and role-specific forbidden BFF calls were checked. Operator accounts were disposable and their credentials were not retained.
- Real step-up E2E: **1/1 passed**. Actual backend returned MFA_REQUIRED for the development-only invalid-platform probe; enrollment in a second tab, explicit session check, then the exact request retried once to a deterministic `400 VALIDATION_FAILED` (no mutation).
- Invitation E2E: **1/1 passed** against the actual backend acceptance operation: safe `{email,role}` response, one-time replay rejected, then separate sign-in succeeded. The backend deliberately redacts email-outbox payloads after delivery, so the local E2E used a temporary, schema-faithful hashed-token invitation fixture rather than extracting a delivered email token.
- Session lifecycle E2E: **1/1 passed** against the real BFF/backend: revoke another device → its next protected request receives 401 → session-expired dialog → password re-auth resumes the same page → both sign-outs clear their encrypted session cookies.
- Baseline browser suite: **6 passed, 9 credential-gated skips** (CSP/token-storage check, cross-origin CSRF rejection, invite URL behavior, signed-out deep link, keyboard shell and axe component lab). The gated tests were then individually run with disposable real operators as above.
- Authenticated account-security screenshots at 375/768/1440 px: `docs/build/evidence/phase-03/account-security-375.png`, `account-security-768.png`, `account-security-1440.png`.
- The development CSP test confirms nonce-based scripts, `frame-ancestors 'none'`, and no `unsafe-inline`. The local gateway was ready throughout these real-backend checks.

### Acceptance

| Criterion | Result |
|---|---|
| Access/refresh tokens absent from JS-readable storage, rendered auth responses and browser URLs | PASS — role E2E scans local/session storage and BFF responses; encrypted cookie is httpOnly; invitation input has no token query; CSP/CSRF boundary tests pass. |
| Exact allowed navigation and backend denial of forbidden role operations | PASS — all six real roles, plus real 403 FORBIDDEN BFF probes for every non-admin role. Future operational page-level NotAllowed states remain for the phase that creates those routes. |
| MFA step-up dialog and one-time retry without losing action context | PASS — real MFA_REQUIRED → second-tab enrollment → check session → same request returns 400 validation with exactly two dispatches and no mutation. |
| Unit tests for auth/session behavior | PASS — 23 Vitest tests including AES-GCM/session parser, CSRF, role map, refresh single-flight and step-up behavior. |
| E2E login, enrollment, logout, revoke-other-session and forced re-login | PASS — role, step-up and lifecycle E2E; invitation and sign-out paths also pass. |
| Cross-origin mutating BFF request rejected | PASS — hostile-Origin logout returns 403 CSRF_REJECTED before backend dispatch. |
| Invitation acceptance is one-use and never signs in implicitly | PASS — real backend accept response contains only `{email,role}`, replay fails, then a distinct login succeeds. |
| Screenshots and keyboard/mobile coverage | PASS — account-security 375/768/1440 captures; shell keyboard/axe tests pass. Lighthouse numeric score remains not configured. |

### Verified vs not verified

Verified: real login/session/me; all six roles; cookie, storage and safe response boundaries; MFA enrollment and aal2 step-up; exact single retry; logout; revocation and forced re-auth; invitation accept/replay; hostile-Origin CSRF; nonce CSP; page responsiveness captures; strict TypeScript/lint/unit/build gates (see final `pnpm verify`).

Not verified: TLS/Secure-cookie behavior on a deployed host; horizontal/multi-instance refresh coordination (the coordinator is process-local); a real backend concurrent-tab refresh storm; rate-lockout countdown under a live 429; password-change E2E; operational page-level forbidden-route states (those feature routes are intentionally not built yet); Lighthouse numeric score; provider/SMTP delivery. Invitation-create returned 201 and its raw code was queued, but the local worker redacted the payload before it could be used, so acceptance E2E used a direct one-time hashed fixture and documented that method.

### Contract observations and requests

- **DASH-BR-001:** OpenAPI documents invite accept as 200/untyped and api-index incorrectly says it signs in. Actual handler returns 201 `{email,role}` and no tokens/session. UI uses accept-then-login.
- **DASH-BR-002:** API prose says ten recovery codes; actual implementation returns eight. UI renders returned array without a fixed count.
- Local real `GET /v1/admin/me` initially returned 401 because the shared fetch helper dropped a `Headers` instance; forwarding now normalizes with `new Headers()` and has a regression test.
- No new backend endpoint is required by Phase 03.

### Decisions and risks

- ADR-014 header normalization; ADR-015 exact MFA retry after a definitive refusal; ADR-016 invitation codes are entered in the body, not URLs; ADR-017 stable pathname rendering.
- R-002 is mitigated for one process but still open for multi-instance deployment. R-006 and R-007 mitigated. R-016 and R-017 mitigated.

### Handoff to Phase 04

Use only `src/server/auth/proxy.ts` and browser `authFetch` for protected calls; never call the backend from feature code or read tokens. `authFetch` supplies same-origin credentials/CSRF, detects session end/MFA_REQUIRED, and retries a repeatable request exactly once after verification. Use the typed permission map as a UI hint only; backend remains authority. Build shared resource API/query/table/form/error primitives without exposing unfinished feature routes. Exercise cursor lists, CSV, reasons, If-Match, expectedVersion, idempotency and partial failure against only operations in the contract. Preserve Phase 03 deployment caveat: one Next process per refresh lock until a shared coordinator is designed.

## Phase 04 — Typed API layer, data fetching, tables, filters, forms and error handling

**Status: COMPLETE WITH DOCUMENTED EXCEPTION — safe mutation integrations move to their consuming phases** · 2026-10-07 IST

### Built

- Added a same-origin typed API client, parsed/sanitized errors, query keys/invalidation, opaque-cursor hooks, runtime order schemas, no-blind-retry conflict policy, server-field error mapping, versioned operator-scoped saved views, safe opt-in drafts, form leave protection, and upload progress/cancel helper.
- Added saved table preferences, optional documented-server-sort only, row selection/bulk-action slot, and an unlinked read-only Orders reference with URL filters and bounded MFA export. It is not in navigation and does not claim order lifecycle is complete.
- Extended the BFF to forward only a sanitized CSV attachment filename. Added the Phase 04 resource recipe and documented live contract drift.

### Evidence

- `pnpm verify`: PASS — contract SHA unchanged, typecheck, ESLint, 13 Vitest files / 51 tests, and Next 16.3.8 production build.
- Real-backend browser suite: **7/7 passed** for admin, support, catalog, fulfillment, finance, and designer; allowed roles loaded real order pages and denied roles issued no order-list call. Screenshots: `docs/build/evidence/phase-04/orders-375.png`, `orders-768.png`, `orders-1440.png`; axe serious/critical violations: 0 on the 375px Orders view.
- Live backend: Orders and customers returned `{items,nextCursor}`; store status returned documented live fields; same-value AAL1 store-status PUT left state unchanged; deliberately stale settings version returned 409 without a successful write; AAL2 order export returned 200 `text/csv`.
- Local disposable admin accounts used in role E2E were disabled after the run. No order, customer, store, stock, or checkout state was changed. Backend was started without reset; checkout/stock were not modified.
- Backend source evidence: `backend/apps/commerce-api/src/adminRoutes.ts` confirms supported order query keys and fixed sort; `adminB11Routes.ts` confirms export MFA/date rules and full-string CSV response. The contract gaps are DASH-BR-003–005.

### Acceptance

| Criterion | Result |
|---|---|
| Each convention has a unit test and at least one real-backend integration test | PARTIAL — cursor/list, CSV, stale settings, and store-status observation are integrated; ETag uses the instructed test double. Idempotent create and multipart upload have unit tests only because a live proof would create backend records; phase remains partial pending permission for disposable fixtures or acceptance of deferral to Phases 09/15. |
| Read-only Orders reference proves list, filters, URL state and CSV export | PASS — real backend E2E and responsive evidence above. |
| Conflict flows with deliberately stale update in two browser contexts | PARTIAL — live stale `expectedVersion` returned 409 without mutation; a two-context successful-write race was not run because it would alter store settings. Studio ETag remains a test double until Phase 10. |
| Feature code cannot call `fetch` directly | PASS — ESLint `no-restricted-globals` applies to `src/features/**`; feature calls use the typed same-origin client. |

### Verified vs not verified

Verified: strict typecheck, lint, unit suite, production build, live cursor Orders, live role allow/deny, URL filters, bounded CSV/MFA path, live stale-settings 409, store-status no-op, responsive screenshots and axe. Not verified/implemented: real mutation integrations for upload/idempotency, two-context successful-write race, Studio ETag on a real endpoint, 50-row render budget, Lighthouse score, true large-export streaming, or the planned OpenAPI-generated MSW/recorded-fixture harness. Current backend and browser both buffer CSV; see DASH-BR-004/R-018. The generic reason/mutation orchestration and future per-line bulk-failure UX remain to be integrated by the feature phases that introduce those writes.

### Requests, decisions and risks

- Backend requests: DASH-BR-003 (CSV MFA/dates/range/attachment), DASH-BR-004 (bounded streaming export), DASH-BR-005 (orders query/page schema and fixed order).
- Decisions: ADR-018 sanitized attachment metadata; ADR-019 operator-scoped query/local preference data; ADR-020 no browser sort of cursor subsets.
- Risks: R-009 performance profiling remains open; added R-018 buffered export, R-019 list/export contract drift, R-020 safe mutation integration deferral, and R-021 missing fixture harness.

### Handoff

The owner continued with the documented safe default: real upload/idempotency evidence belongs to the safe consuming flows (Phases 09/15) and real Studio ETag evidence belongs to Phase 10. The phase remains complete with that exception, which is tracked in `DASH_PLAN.md`, `DASH_NEXT_ACTION.md`, R-020 and R-021. Phase 05 is permitted to use the shared API engine.

## Phase 05 — Overview, health, alerts and store controls

**Status: COMPLETE** · 2026-10-07 IST

### Built

- Replaced the foundation home with the protected, role-aware Store command centre. Independent runtime-parsed queries power dashboard metrics/queues, server-defined sales, store status and readiness, health, integrations, and allowlisted recent audit activity.
- Added an operationally honest response design: no browser-computed “today” claims, no fabricated graph data, no provider success claims, no raw audit blobs, and independent loading, empty, denied, unavailable and retry states.
- Added customer-impacting controls with explicit consequence dialogs: pause/resume with optional 300-character public message; MFA/version/reason/typed confirmation for activation; fast reason/typed confirmation for the deliberately non-MFA kill switch.
- Added a shell-level, non-dismissible pause banner fed by safe public BFF policy plus an immediate in-tab update signal and authoritative refetch.
- Added strict Zod schemas for the live generic response envelopes, including nullable readiness-setting fields, and failure-line rendering for backend `POLICY_NOT_CONFIGURED` activation refusals.
- Suppressed the Next development diagnostic portal, which otherwise becomes a framework—not application—first Tab stop under concurrent local test navigation. The production focus order is unchanged.

### Evidence

- Live shape probes using disposable local admins established every Phase 05 response envelope; all temporary admins were disabled afterwards. Exact shapes are in `phase-05-thinking.md`.
- Live browser run: pause → gateway public `GET /v1/store-settings` reflected `ordersPaused:true` → global banner appeared → resume restored the initial state. The current public response confirms `ordersPaused:false` and `checkoutOpen:false`. The writes leave immutable audit entries by backend design.
- Role matrix: each of admin, support, catalog, fulfillment, finance and designer was individually exercised against the real overview endpoints; forbidden overview endpoints were not dispatched. Admin received health/integrations/audit; reduced roles received only their permitted widgets.
- Responsive evidence: `docs/build/evidence/phase-05/overview-375.png`, `overview-768.png`, `overview-1440.png`; live overview axe check found zero serious/critical WCAG 2.2 violations.
- Quality gates: `pnpm typecheck`, `pnpm lint`, and `pnpm build` PASS; Vitest **14 files / 55 tests** PASS; baseline Playwright **6 passed / 11 credential-gated skips** PASS. The shell keyboard/palette test passes under parallel execution after excluding the development-only Next portal.

### Acceptance

| Criterion | Result |
|---|---|
| Independent loading, empty, error, offline and permission states | PASS — every widget has its own query boundary and state component; reduced-role browser matrix confirms denied data is neither requested nor rendered. Runtime-shape tests cover malformed responses. |
| Pause/resume reaches the real backend and public customer policy | PASS — real dashboard write, public gateway reflection, banner appearance and restoration evidence above. |
| Activation refusal explains backend readiness failures verbatim | PASS — readiness checks are rendered before submit; `POLICY_NOT_CONFIGURED.lines[].detail` is now rendered verbatim in the action error, with no client-invented remedy. |
| Every role receives only permitted overview widgets | PASS — real six-role endpoint/request matrix; no unpermitted overview endpoint was called. |

### Verified vs not verified

Verified: live response shapes, per-widget parsing, pause/resume/public reflection, global banner, six-role endpoint suppression, responsive presentation, unit/runtime contracts, production build, baseline browser accessibility and keyboard behavior.

Not verified: a live checkout activation refusal was not forced by corrupting local stock/PIN/settings state; its authoritative lines are parser- and UI-covered from the documented response shape. Website port 5174 was not used for a customer-browser assertion because its Studio adapter is outside this phase; the public gateway state was checked instead. A Lighthouse numeric score and fresh-database versus populated seed comparison remain unconfigured/not performed.

### Requests, decisions and risks

- Backend requests: DASH-BR-006 (checkout-disable MFA documentation) and DASH-BR-007 (concrete overview schemas).
- Decisions: ADR-021 through ADR-023.
- Risks: R-022 pause propagation and R-023 generic overview-contract drift added; R-008 Shiprocket remains intentionally deferred to Phase 07.

### Handoff to Phase 06

Use `StorePauseBanner` globally, and preserve the server-defined 30-day metric language. Orders remains the only verified queue target from this phase. Build its lifecycle/detail/notes/packing/export/communication on the Phase 04 typed table layer; do not treat Phase 05 queue counts as a daily report or client-sort cursor data. The checkout remains off and orders are not paused in the local backend.

## Phase 06 — Orders

**Status: COMPLETE WITH DOCUMENTED BACKEND EXCEPTIONS** · 2026-10-07 IST

### Built

- Replaced the Phase 04 read-only reference with a real order queue, detail, internal notes, legal status transitions, cancellation, resend-queued feedback, protected packing slip, and read-only invoice/refund state. UI actions are role-aware and backend responses remain authoritative.
- Added a server-side invoice boundary: direct invoice issuance is rejected by the dashboard BFF unless the session has `orders:fulfil` and AAL2; UI additionally requires an explicit immutable-issue confirmation.
- COD lifecycle E2E created a named local customer fixture through the documented customer API, then used the dashboard to confirm and start processing it. A separate cancellation flow checked reason, COD no-refund behavior, inventory restoration and audit evidence.
- Two-context stale-version checks prove competing updates return 409 without changing the order. Support sees the backend-redacted order and cannot reach the invoice BFF route.
- The print stylesheet hides dashboard chrome and leaves only the packing slip. Responsive order detail captures and a WCAG 2.2 axe check were recorded.

### Evidence

- Fresh `pnpm verify`: contract lock SHA `d7d6830f…`, TypeScript, ESLint, Vitest **18 files / 67 tests**, and Next 16.3.8 production build all passed.
- Real-backend browser evidence: lifecycle **1 passed**, cancellation/stock/audit **1 passed**, role-redaction plus two-context conflict **2 passed**, responsive detail/print/axe **1 passed**. The Phase 04 six-role read/deny matrix and Orders queue/CSV E2E remain supporting evidence.
- Screenshots: `docs/build/evidence/phase-06/order-detail-{375,768,1440}.png` and `packing-slip-print.png`; axe found 0 serious/critical violations at 375px. The print capture excludes navigation, top bar and print controls.
- The local checkout remains disabled after the audited test activation/disable cycle. The local backend persists `checkout_policy_confirmed=true` from the activation; this is expected backend state, not a lingering enabled checkout.
- Cancellation evidence used a named COD fixture: the order became cancelled, refund list stayed empty, admin inventory showed the restock, and admin audit contained `order.cancel` with the supplied reason. All disposable operator accounts were disabled after testing.
- Invoice call reached the real backend only after the dashboard guard; with no merchant GST profile it returned `503 POLICY_NOT_CONFIGURED`, and invoice count remained zero. No invoice number was created.

### Acceptance

| Criterion | Result |
|---|---|
| Find/open, confirm and process an order; ship only through Phase 07 | PARTIAL — list/detail and real `placed → confirmed → processing` passed; shipment is deliberately handed to Phase 07. |
| Detail totals reconcile to backend for plain COD, coupon, free-shipping, online-paid and partial returns | PARTIAL — plain COD total rendered from the server matches the customer quote/order paise; coupon/free-shipping/online/partial-return cases were unavailable in local configuration and are not recomputed. See DASH-BR-009. |
| Support contact is masked; reveal is audited | PARTIAL — support redaction and denial of invoice access pass. Reveal control is withheld because order DTO has no customer ID; see DASH-BR-009. |
| Packing slip is clean in print | PASS — real protected route, print emulation and `packing-slip-print.png`. |
| Customer API order can be operated end to end in dashboard | PASS — real COD fixture placed through customer API and confirmed/processed in the UI. |
| Role/concurrency/action safeguards | PASS — support denied, fulfilment lifecycle/cancel path, MFA, reason, expectedVersion conflict/no-write, COD restock and audit all exercised against the real backend. |

### Verified vs not verified

Verified: live supported order filters, queue/detail, COD quote-to-order money, notes/list display, confirm/process, cancellation with reason/MFA, expectedVersion conflict, support masking, BFF invoice denial, CSV export, protected packing slip/print, audited stock restoration and responsive accessibility check.

Not verified: audited support reveal (missing customer ID), successful invoice issue (merchant GST profile absent), coupon/free-shipping/online/partial-return order total variants (local fixtures/providers absent), and actual invoice PDF rendering. Backend invoice GET remains a security/contract issue despite the BFF mitigation. Lighthouse score is not configured.

### Requests, decisions and risks

- Backend requests: DASH-BR-008 (invoice GET mutates and has broad `orders:read` access); DASH-BR-009 (order detail lacks customer ID, status/communication history and per-line financial allocations).
- Decisions: ADR-024 (sensitive invoice boundary), ADR-025 (do not synthesize missing detail fields), ADR-026 (local test checkout changes only through audited readiness/operator flow).
- Risks: R-024 invoice-issuance/PII contract issue; R-025 incomplete order DTO reconciliation/history.

### Handoff to Phase 07

Use the existing Orders detail and its current-version order state. Manual shipment creation is the primary local path; only ship an order when its backend state is `processing`. The order DTO lacks shipment/return history and per-line financial allocation; use the dedicated shipment/return endpoints and do not duplicate or reconstruct those records. Refund processing belongs to finance with backend MFA. Checkout is off; the local test session left the backend’s policy-confirmed flag true. Phase 07 must first probe the real provider, ready, shipment, return and refund operation shapes, and must disclose provider support as mock-tested only—not live Shiprocket verified.

## Phase 07 — Fulfilment, shipments, returns and refunds

**Status: COMPLETE WITH DOCUMENTED BACKEND/CONFIGURATION EXCEPTIONS** · 2026-10-07 IST

### Re-grounding evidence

- Read the Phase 07 prompt, Phase 06 handoff, ground rules, api-index shipping/returns/refunds sections, OpenAPI, backend contract implementation-status section and root `04_SHIPROCKET_SPEC.md` (design intent only).
- Live read-only backend probes used a temporary admin operator, disabled immediately after. No credentials, bearer tokens or customer values were retained. No backend reset or operational write occurred.
- Live shapes observed: provider `manual/configured=false/reachable=null`; ready queue `{items,nextCursor}` with package/COD/customer-minimum fields; shipping settings; provider status overview; pins `{items:[{prefix,note}]}`; shipment overview counts; empty shipments `{items,nextCursor:null}`; empty returns/refunds `{items:[]}`. Provider pickup-location GET returned 503 when unconfigured. Manual-mode serviceability POST returned an allow-list result with `provider:null`.
- Backend source inspection confirmed manual shipment create/event schemas, shipment DTO, return/refund rows and role guards because the live shipment/return/refund lists contained no records.
- `docs/build/phase-07-thinking.md` contains the required users/jobs, state flows, deep-think answers, ten-item pre-mortem, security/accessibility budgets, test names, slices and skeptical review changes.

### Built and verified so far

- Implemented the backend-driven ready queue and manual-only shipping center; verified provider capability from the live API. The queue renders server package/COD values, warnings and explicit no-label/no-booking semantics.
- Implemented manual shipment creation with guarded ambiguous-outcome reconciliation, shipment register filters/cursor, detail/timeline, safe next-event options, customer-visibility acknowledgement, and no manual cancel/label actions.
- Added a one-shot opt-in local acceptance spec. Its read-only preflight verified provider `manual/configured:false`, public checkout policy off, the exact retained `demo:true` order, backend recipient label `Phase Six Fixture`, processing status and absence of unrelated shipments. It created one manual shipment (`Phase 7 Local Test Courier` / `PHASE7-5396FAA7`), safely resumed after a test-selector interruption without duplicate creation, recorded three clearly labeled local verification events, and finished delivered.
- Customer gateway API tracking returned the same shipment, tracking data and `label_created → in_transit → out_for_delivery → delivered` events. This verifies the API timeline, not a real courier scan or SMS delivery.
- Built the safe delivery-tools surface: live settings and PIN read models, explicit read-only explanations where write preconditions are missing, manual-mode serviceability form with all required user inputs, and provider pickup locations only when the provider is configured and reachable. Provider copy says mock-tested only/not verified against live Shiprocket.
- Return/refund centre is implemented with requested/approved/declined state views, note-required decisions, conflict/ambiguous-response reconciliation without replay, most-recent-100 disclosure, and read-only Finance/Admin refund records. Receive and refund-process controls are absent.
- The six-role live matrix passed for the earlier shipment register/detail and returns/refunds reads; shipment/support write denial and catalog/designer route denial were verified. Returns/refunds responsive screenshots are `docs/build/evidence/phase-07/returns-{375,768,1440}.png`; shipment register/detail screenshots remain in the same evidence folder. The `shipping-center-{375,768,1440}.png` filenames are stale/mislabeled captures from the returns route and are not evidence for Shipping Center; replace them on the next healthy-stack browser pass. These role screenshots predate mounting the new delivery-tools reads.
- Latest `pnpm verify` passed contract lock `d7d6830f60ea17296bb2e50569ecd43b0646d5d6008457bd944ee23a0b2cf144`, strict typecheck, ESLint, 29 unit files / 116 tests, and the Next.js 16 production build (including `/shipping/returns`).
- A fresh six-role rerun covering the newly mounted settings/PIN reads could not start: `docker ps`/`docker exec` returned Docker Engine API 500, `/readyz` timed out, and fresh operator setup stalled at PostgreSQL connect. Only the identified disposable setup child process was stopped; no test user creation completed. Do not claim this newest UI slice has live role/browser evidence. Earlier read-only probes did observe the exact settings/PIN/serviceability response shapes and manual-mode allow-list result.
- The retained synthetic local order `JW-20261007-5396FAA7` remains shipped/delivered. Do not reset/reuse it. No stock/checkout/provider configuration, return, refund, or real customer shipment was changed/created by this continuation.

### Safety blockers and decisions

- DASH-BR-016 / ADR-028: backend `POST /admin/returns/{id}/receive` restocks inventory but checks only `orders:fulfil`, not `inventory:write` + AAL2. The dashboard will not expose/call it until backend enforcement is corrected.
- Manual shipment event endpoint does not enforce forward-only transitions; the UI will only offer conservative next statuses while backend correction remains open (DASH-BR-014).
- Manual shipment cancel is provider-dependent; manual package overrides are not persisted by the manual create operation. Both controls are withheld (DASH-BR-011/012).
- `returnWindowDays` is not exposed to fulfillment; show only where `settings:read` permits and request safe policy visibility (DASH-BR-013).
- Shiprocket remains parked; no provider write or live-provider credential was used.
- DASH-BR-019 / ADR-030: `PUT /admin/shipping/settings` and `PUT /admin/shipping/pins` lack required audit reason and caller-supplied version preconditions; the dashboard presents reads only. No write was attempted.
- DASH-BR-017/018 / ADR-031: refund processing remains unavailable in the UI because Razorpay is not configured, Finance cannot see payment capability, and no eligible captured payment exists.
- A temporary fulfillment session initially received 403 from `/admin/store-status`, correctly reflecting `settings:read`; the gated test now checks checkout state through the already-existing safe public `/api/health` policy instead. No permission was widened.
- The contract prose had mentioned a `rawStatusId` shipment DTO field; `packages/commerce-domain/src/fulfilment.ts` confirms it is not returned. The runtime schema follows the source DTO.
- DASH-BR-018 is recorded: expose only a safe payment-provider capability to `payments:read`; no provider probe/write was attempted.

### Phase 07 report

**Built:** Manual-first shipping queue, create/register/detail/event flow; return decisions; read-only refund queue; read-only settings/PIN coverage; manual serviceability tester; provider pickup read gated on configured+reachable status.

**Acceptance:**

- Manual shipment through delivered and customer tracking API: **PASS** — gated local E2E against the retained synthetic order, event timeline and customer API parity; not a real courier scan/SMS. Evidence: `tests/e2e/manual-shipment-acceptance.local.spec.ts` and phase-07 shipment screenshots.
- Fake-provider lifecycle and webhook flow: **FAIL / deferred by owner state** — provider remains `manual/configured:false`, Shiprocket is parked, and changing backend provider state was not authorized or necessary for a safe dashboard build. No live-provider claim is made.
- Customer return request, approval, receipt/restock-once and online refund queue: **FAIL / safely blocked** — no configured return window/eligible online order; live receive route omits `inventory:write` + AAL2. Decision UI is unit-tested; no stock/refund mutation was attempted.
- Role coverage: **PARTIAL** — earlier live six-role matrix proves fulfillment/support read/write boundaries and Finance/Admin read-only refund access; Finance cannot process because Razorpay/gateway/payment eligibility are not configured. New settings/PIN browser role rerun is unverified due Docker Engine 500 and PostgreSQL connect timeout.
- Responsive/a11y surfaces: **PASS with scope note** — 375/768/1440 screenshots and serious/critical axe checks exist for returns and prior shipment views. New Delivery Tools has unit coverage but no fresh browser screenshot/axe evidence because the live stack became unavailable.

**Handoff to Phase 08:** Build catalogue and inventory only from verified contract operations and backend response fields; do not reuse the shipped Phase 06 synthetic order. Product shipping attributes can be incomplete, so shipping queue package values remain backend-authoritative. Preserve DASH-BR-019; no unsafe shipping or delivery-area write control may be introduced. Before any live-browser proof, restore/verify Docker Desktop and gateway readiness without resetting the backend. Re-run `tests/e2e/shipping-live-read.spec.ts` and the manual shipment acceptance only after preflight confirms the existing synthetic order and no duplicate write.

## Phase 08 — Catalogue, pricing and inventory

**Status: IN PROGRESS — PRODUCT, INVENTORY, TAXONOMY AND CSV SAFE-PATHS BUILT; LIVE ROLE/EXPORT/DRY-RUN VERIFIED; FULL WRITE ACCEPTANCE BLOCKED BY MISSING BACKEND SAFEGUARDS AND UNAPPROVED FIXTURE WRITES** · 2026-10-07 IST

### Re-grounding evidence

- Re-read the full dashboard master prompt, Phase 08 prompt, Phase 07 closeout/handoff, `DASH_PLAN.md`, `DASH_NEXT_ACTION.md`, and current parity.
- Read backend `03_BACKEND_CONTRACT.md` implementation status first, then api-index/OpenAPI product, category, collection, inventory, media, export, and audit operations. Inspected running backend source for actual parsers, guards, cursor order, product DTO, variant update, CSV import/export, stock movement, collection revision and audit behavior.
- Wrote `docs/build/phase-08-thinking.md` before Phase 08 code, including source-backed operation table, user jobs, state flows, 10-item pre-mortem, security/performance/accessibility budgets, tests, build slices, and seven skeptical review findings.
- An earlier local outage made `/readyz` time out and Docker Engine return 500; it recovered by starting the existing local services without resetting the database. Current read-only checks return gateway `/healthz` 200, `/readyz` 200, and dashboard `/api/health` 200. The final authenticated live role run passed 6/6. No product, category, collection, CSV commit, stock adjustment, checkout, or customer-facing data mutation was accepted.

### Contract/backend gaps recorded for this phase

- DASH-BR-020: generic catalogue/inventory OpenAPI shapes and missing inventory/variant role docs; live role reads and CSV safe paths now have evidence, but exact DTO/guard schemas and successful inventory write evidence remain open.
- DASH-BR-021: no write API for existing low-stock thresholds; show read-only.
- DASH-BR-022: category count excludes archived products while deletion counts them.
- DASH-BR-023: Finance cost-price access conflicts with the role matrix and Admin-only backend response; keep Admin-only.
- DASH-BR-024: CSV commit is not bound to dry-run, version, reason or idempotency; do not commit existing-price overwrites until corrected.
- DASH-BR-025: variant price change does not bump `rules_version`; checkout does revalidate live price and rejects stale quotes. Disclose and request consistency.

### Built and verified — earlier slices

- Added strict runtime schemas for products/variants, categories, inventory snapshots, cursor-paged movements and the documented stock-adjustment request/result, preserving integer paise, safe integer counts, conditional Admin cost fields, nullable media/metafields, and `available = onHand - reserved` reconciliation. Typed same-origin resources use only the documented paths.
- Added a protected `/products` route with a live-backend-only queue: URL-backed debounced search and server filters, category options from the documented endpoint, backend cursor pagination, responsive product/variant cards, GST-inclusive paise display, explicit on-hand/reserved/threshold labels, and distinct loading, empty, offline, contract-error and permission-denied states. No cost is rendered; no placeholder rows, stock controls, price controls or fake category choices appear.
- Added protected `/inventory` snapshot and append-only movement ledger. The inventory endpoint is explicitly treated as a complete non-cursor snapshot; only movement history follows the backend opaque cursor. Direct unauthenticated request to `http://localhost:3200/inventory` returned `307` to `/login?next=%2Finventory`.
- Added signed stock adjustment for roles with `inventory:write` (Admin/Fulfillment), with reason, current `expectedVersion`, a before/projected balance review, a client-side reserved-stock guard, the existing backend-controlled MFA step-up, and invalidation of the authoritative snapshot/open movement history. Stale 409 responses are never replayed. HTTP/network/contract ambiguity is reconciled by reads, has no retry control, shows request ID, and locks this variant's adjustment for the current page session. Thresholds remain read-only.
- Tests-first evidence: missing resource/component tests failed before implementation. Targeted catalogue/inventory suite passed **2 files / 17 tests**, covering exact adjustment endpoint/body/result, client validation, balances, complete-snapshot filtering, opaque ledger cursor, role-gated controls, projected values, reserved-stock prevention, stale conflict and uncertain-outcome lockout.
- Final `pnpm verify`: PASS — contract SHA `d7d6830f60ea17296bb2e50569ecd43b0646d5d6008457bd944ee23a0b2cf144`, strict TypeScript, ESLint with no warnings, **33 test files / 146 tests**, and Next 16.3.8 production build including `/products` and `/inventory`.
- Live response shapes/role matrix/screenshots/axe remain unverified for this Phase 08 slice. Latest `/readyz` returned `503 {"status":"not_ready"}`. No operator, catalogue, inventory, checkout, stock, provider or customer state was changed; no adjustment was submitted to the backend.

**Historical next slice:** source-build the versioned product editor and audited variant price changes using the documented `expectedVersion`/`expectedUpdatedAt` and reason guards; keep the route unlinked until its read/edit flows are coherent. In parallel, retry only bounded read-only readiness checks and later run authenticated inventory role/MFA/conflict tests against the existing backend after `/readyz` is healthy, without reset. Preserve DASH-BR-020–025; no low-stock threshold edits, Finance cost visibility, unsafe CSV commits, or false rules-version invalidation claims. No new route enters navigation until its owning workflow is complete.

### Product record and variant price review checkpoint

- Added `/products/[id]`, protected by `catalog:read`, with mutation controls gated by `catalog:write`. Product IDs are validated as the built backend's lowercase slugs; DASH-BR-027 remains open because OpenAPI still declares UUID path parameters.
- The editor exposes only product PATCH fields supported by the built backend: name, subtitle, description, category, benefits, suitable surfaces, box contents, tags, SEO title/description, active visibility and bounded display order. Product ID is explicitly immutable. Search-result preview is editorial only. Product version and updated time are shown; archived products have no edit/archive/restore actions.
- Safe descriptive drafts are operator-scoped and locally restorable; schema-invalid stored data is deleted. No price/reason/cost material is persisted. Dirty product edits and an open price form both use the shared leave-page guard.
- Product writes use a minimal exact diff and `expectedVersion`, and wait for a second explicit save click. Server field errors map inline. On version conflict the latest product is fetched, the draft is preserved, and an explicit “Review and merge” selection updates the baseline; a second diff review is still required. Ambiguous product writes trigger read-only reconciliation and are never retried automatically.
- Variant price/compare/availability writes are isolated per variant, use only `GET /admin/catalog/variants` followed by `PATCH /admin/catalog/variants/{id}`, and require the latest matching `updatedAt`, reason and exact review. The unpaged full variant list is read only after the operator selects Edit price (ADR-037/R-038); any read failure blocks the editor and shows the request reference. An uncertain price response locks review until a new timestamp is explicitly fetched; only operator-modified fields are preserved across that refresh. Quote copy warns of possible rejection/requote and does not claim a store `rules_version` bump (DASH-BR-025).
- Unsupported existing variant fields (SKU/title/shipping dimensions/weight/HSN/barcode/cost/threshold) remain read-only under DASH-BR-029. Cost is rendered only when Admin and the backend returned a value (DASH-BR-023). Archive/restore stays withheld under DASH-BR-026/R-037.
- TDD evidence: the draft-key test first failed because product resource keys were capped at 40 characters; after extending validation to 120, the six draft-protection tests pass. Product editor model, editor, products queue and draft-protection targeted suite: **4 files / 28 tests PASS**. Tests cover exact product PATCH, display order validation, read-only role/cost, conflict rebase without retry, exact paise diff, quote warning, missing timestamp, and uncertain price write requiring explicit fresh read.
- Final full `pnpm verify`: **PASS** — contract SHA `d7d6830f60ea17296bb2e50569ecd43b0646d5d6008457bd944ee23a0b2cf144`, strict TypeScript, ESLint, **35 test files / 166 tests**, and a Next.js 16 production build including `/products/[id]`.
- Live acceptance remains unverified: the latest read-only `http://localhost:8080/readyz` check timed out after four seconds; an earlier Phase 08 check returned `503 not_ready`. No role session, product/variant/stock write, audit row, browser screenshot or axe result is claimed. No backend reset or state mutation was attempted.

**Historical handoff:** proceed with category/collection workflows and safe export/dry-run only. Keep catalogue CSV commit that can overwrite existing prices disabled until DASH-BR-024 is resolved; keep archive/restore disabled until DASH-BR-026 is resolved. The continuation below supersedes the readiness and feature-slice status above.

### Continuation — taxonomy, CSV and live role evidence

- Built the protected `/catalogue` workflow: strictly parsed category/collection reads, reviewed category creation only, manual/smart collection creation, revision-checked full-replacement edits with conflict re-read and field-wise rebase, and backend-only product choices. Versionless category overwrite/order/delete, collection delete and undocumented resolver previews remain unavailable.
- Built explicit full-catalogue CSV export and bounded raw UTF-8 CSV dry-run only. Export is never prefetched; import is limited to 2 MB and always sends `dryRun=true`; the report must parse as `applied:false`; no commit control exists. The UI discloses the complete/unpaged export and browser Blob buffering; the Next BFF forwards the response stream. Uploaded rows are not persisted, logged, or locally echoed.
- Fixed a production-rendering defect found by live page checks: the store-pause banner referenced `document` while rendering on the server. A new SSR regression test reproduced the `ReferenceError` before the guard and passes after it.
- Current read-only smoke: gateway `/healthz` 200, `/readyz` 200; dashboard `/api/health` 200. Unauthenticated `/catalogue` returns 307 to login as expected.
- Live role Playwright run: **6/6 roles passed**. Allowed/denied page requests matched the role matrix; Catalog role saw no stock-adjust control and a same-origin inventory-adjust probe was denied by the backend with `FORBIDDEN`; Catalog role completed explicit CSV export followed by raw-body `dryRun=true` import report (`applied:false`). No catalogue/inventory commit endpoint accepted a mutation. The transient run stdout was not retained as a repository artifact; the runnable spec is `tests/e2e/auth-roles.spec.ts`.
- Fresh `pnpm verify`: contract SHA verified; TypeScript and ESLint passed; Vitest **39 files / 193 tests passed**; Next 16.3.8 production build passed and emitted `/catalogue`, `/products`, `/products/[id]`, and `/inventory` routes.
- Focused taxonomy and CSV coverage: taxonomy/resource/model suite **27 tests passed**; CSV/client/resource focused suite **26 tests passed**. These are included in the full 193-test run.

### Phase 08 acceptance status

| Criterion | Result |
|---|---|
| Create a two-variant product, set stock, verify public API and website, archive and restore | **NOT MET** — the reviewed, inactive product-create/add-variant UI is now implemented and component-tested, but no live product or stock fixture was created, customer API/website visibility was not checked, and archive/restore remains withheld because it has no expected-version, reason, or idempotency guard (DASH-BR-026). No persistent test record was created. |
| CSV round-trip, one exact price change, commit and verify | **PARTIAL / BLOCKED** — real export and dry-run were verified, but the backend report is aggregate-only and its commit is unbound to preview/version, reason, or idempotency and can overwrite prices (DASH-BR-024). Commit is intentionally absent. |
| Every mutation appears in audit with before/after | **NOT VERIFIED** — no catalogue or inventory mutation was submitted; current backend create/patch actions have varying audit detail, and some taxonomy actions lack before-state audit. |
| Role matrix: catalog edits, support/finance reads, fulfillment-only inventory adjustment | **PARTIAL PASS** — all six role page allow/deny paths were live-tested; Catalog's inventory write was backend-denied. No authorized catalogue edit or Fulfillment/Admin AAL2 stock adjustment was submitted, so write/audit/MFA acceptance remains unverified. |
| Real-backend Playwright flows and diff-before-save screenshots | **PARTIAL** — live role and CSV safe-path E2E passed; product create/archive/restore, stock adjustment and diff-dialog screenshot were not performed. |

### Verified vs not verified

Verified: current service readiness without reset; live role visibility/denial; catalogue export and dry-run transport/report; source-backed product create/add-variant API helpers and exact review/reconciliation component behavior; static type/lint/unit/production-build gates; responsive/keyboard logic at component level. Not verified: live create/add-variant/edit/archive/restore, actual catalogue audit before/after, successful inventory AAL2 adjustment or stale-version conflict, storefront customer API/website product visibility, diff-dialog browser screenshots, live taxonomy mutation semantics, or large-export memory behavior.

### Backend requests and decisions

- Backend requests remain DASH-BR-020–035 and DASH-BR-044; highest-priority acceptance blockers are DASH-BR-024 (server-bound CSV preview/guarded commit), DASH-BR-026 (versioned/reasoned/idempotent archive/restore with before/after audit), DASH-BR-044 (create/add-variant idempotency and concurrency guards), and DASH-BR-020 (precise schemas/permission documentation). DASH-BR-034/035 document CSV contract drift and unbounded export.
- ADR-034 keeps unsafe CSV commits disabled; ADR-036 withholds archive/restore; ADR-039 keeps import dry-run-only; ADR-044 narrows create/add-variant to reviewed inactive records with no retry after uncertainty. ADR-037 records explicit on-demand full-variant reads for guarded price editing.
- R-034 readiness risk is mitigated for this run; R-036 actual adjustment reconciliation, R-037 archive/restore, R-038 scale, R-039–042 taxonomy contract guards, R-043 unbounded export and R-048 ambiguous create/add-variant writes remain open.

### Handoff / owner decision

**Superseded by ADR-040:** the owner explicitly directed continuation to the next phase. Phase 09 now proceeds while Phase 08 remains incomplete; no Phase 08 acceptance criteria are waived. Return to Phase 08 before Phase 10. Preserve the current local database, do not submit unsafe catalogue/stock writes, and do not claim Phase 08 complete. Dashboard-only work cannot add backend-enforced concurrency, reason, idempotency, or audit guards; any backend scope expansion remains a separate owner decision.

## Phase 09 — Media library and provenance

**Status: IN PROGRESS — IMPLEMENTED; LOCAL QUALITY GATES PASS; LIVE MEDIA ACCEPTANCE BLOCKED ON AUTHORIZED SESSION + OWNER-APPROVED PUBLIC TEST ASSETS** · 2026-10-07 IST

- The owner-authorized sequencing exception is ADR-040. Phase 08 remains incomplete and is the mandatory next work after this phase, before Phase 10.
- Dashboard implementation: protected `/media` route and navigation; strict runtime DTO/filter/patch schemas and query keys; grid/list, debounced server search/filters and opaque cursor navigation; public same-origin asset proxy; magic-byte/per-kind preflight, bounded sequential upload with progress/cancel/uncertain outcome; rights evidence + immediate-public retrieval acknowledgement; detail image/video/font preview, metadata diff, incomplete usage warning, and Admin-only reasoned review. Archive/restore and `bundledKey` remain absent.
- Phase 09 operation set: `POST /v1/admin/media`; `GET /v1/admin/media`; `GET/PATCH /v1/admin/media/{id}`; `POST /v1/admin/media/{id}/approve|reject|archive|restore`; `GET /v1/admin/media/{id}/usage`; public `GET /v1/media/{sha}/{file}`. Each path exists in the pinned OpenAPI; request/response shapes and route/source discrepancies are tracked in DASH-BR-036–043.
- Built backend source accepts raw bytes plus metadata query (not the OpenAPI's generic JSON request), content-addresses uploaded files, magic-byte sniffs JPEG/PNG/WebP/MP4/WebM/WOFF2/TTF/OTF, and stores approval state separately from public URL retrieval. The current public handler serves any known stored SHA, including unapproved items; immutable caching and video range responses are source-confirmed, not yet live-probed.
- Source-confirmed blockers: approval/rejection checks `role=admin` although api-index says only `media:write`; rights holder/provenance note has no independent DTO field; `bundledKey` is accepted by PATCH but omitted from response and not Admin-only; usage omits Experience Studio references; in-use/unused is not a server filter. These are not papered over with client-side data or unpaged local filtering.
- BFF uses `request.arrayBuffer()` for mutation bodies. ADR-043 bounds the dashboard to 15 MiB per image/video and 2 MiB per font, rejects missing/invalid or oversized Content-Length before buffering, double-checks actual bytes, and uploads sequentially per browser session. This does not provide streaming or cross-operator concurrency control; DASH-BR-043 remains open.
- Public-media privacy is a risk: approval is not a visibility boundary. Never upload confidential/customer material or claim an asset is private while pending. Asset rights and packaging attestation are not to be assumed on the owner's behalf.
- Local evidence: `pnpm verify` passed contract check (v1.2.0-draft.1 SHA `d7d6830f60ea17296bb2e50569ecd43b0646d5d6008457bd944ee23a0b2cf144`), typecheck, lint, all 44 test files / 212 tests, and production build. Focused media suite: 5 files / 19 tests. Read-only runtime probes returned backend `/healthz` 200, `/readyz` 200, unauthenticated backend media list 401, dashboard `/api/health` 200, and unauthenticated dashboard `/media` 307 to `/login?next=%2Fmedia`. Local browser showed accessible sign-in labels at the available 375px view; it did not show the protected media screen.
- No authenticated media list/upload/review/archive request or public Range/cache probe has been made from this phase. The media endpoint's 401 confirms the missing authorized session; no credentials or approved-to-publish disposable test files are available. No backend reset, account creation, owner-media upload, or rights attestation was performed.
- Detailed state flow, security/performance/accessibility budgets, pre-mortem, named tests and skeptical review: `docs/build/phase-09-thinking.md`.
- Phase 09 backend requests recorded: DASH-BR-036–043. New decisions: ADR-041 (license-field evidence workaround/public acknowledgement), ADR-042 (withhold archive/bundle), ADR-043 (bounded BFF upload); R-044–047 recorded/updated, with R-045 partially mitigated.

### Phase 09 acceptance status

| Criterion | Result |
|---|---|
| Upload real image and video, list them, approve, verify immutable public serving and video Range | **NOT VERIFIED** — backend readiness is healthy and unauthenticated media returns 401; no authorized session or owner-approved public test assets. Unit tests cover upload bytes, validation, public route and 416 handling, but not the live backend. |
| Usage list is correct after a Studio document references media | **NOT YET TESTABLE** — Studio phases 10+ are not built, and current backend usage omits Studio references (DASH-BR-040). |
| Axe clean; keyboard-only upload and approval works | **PARTIAL / NOT ACCEPTED** — accessible labels, controls, Admin-only review and exact confirmation are component-tested (6 tests); no signed-in browser session, axe run, or end-to-end keyboard path was available. |
| Responsive evidence at 375/768/1440 and live operation-role boundaries | **NOT VERIFIED** — unauthenticated route protection was confirmed; authenticated media screen and role boundary need a supplied authorized test session. |

### Phase 09 handoff

Keep any unverified asset pending; never approve or package-attest owner media on the owner's behalf. Keep archive and bundled mapping disabled. Phase 10's MediaPicker must consume strictly parsed approved, non-archived media, require alt or explicit decorative state, and report the incomplete usage contract. Phase 09 remains open pending an authorized local operator session, owner-approved non-PII image/video whose rights permit immediate public retrieval, live headers/Range verification, and axe + signed-in keyboard/responsive evidence. Phase 08 remains incomplete; resume it before Phase 10.

### Phase 08 continuation — inactive product creation and add-variant (2026-10-07 IST)

- Added strict, source-backed product and variant create payload/response validation in `src/lib/api/resources/catalog.ts`, pure rupee-to-paise and metadata validation in `src/features/catalog/product-create-model.ts`, and the protected `/products/new` review flow. Both product and variants are sent inactive; variants start with zero stock. No initial stock, media attachment, activation, persistence of create-form values, archive/restore, or CSV commit control was added. Cost remains Admin-only.
- Added a reviewed add-variant action to product detail, gated by `catalog:write`, blocked while conflicting edits are open, and reconciled by a read after uncertain outcomes. Product creation and add-variant are single-submit operations: the backend endpoints lack idempotency/version/reason guards, so the dashboard never blindly retries and reports matching records after ambiguity as unattributed.
- Tests-first focused catalogue suite: **5 files / 45 tests passed**. Full `pnpm verify`: **PASS** — pinned contract SHA `d7d6830f60ea17296bb2e50569ecd43b0646d5d6008457bd944ee23a0b2cf144`; TypeScript strict and ESLint passed; Vitest **46 files / 229 tests passed**; Next.js 16.3.8 production build passed and emitted `/products/new` alongside catalogue, product, inventory, and media routes.
- Runtime read-only health was healthy earlier in this continuation; current browser is unauthenticated at `/login?next=%2F`. No authorized create/add-variant, stock, audit, public customer API, or website mutation/verification was performed. No operator was created, no database reset was run, and no persistent catalogue or inventory record was added. No signed-in screenshot or axe result is claimed.
- Acceptance remains **OPEN**. Product creation UI/component behavior is locally verified, but the required live product → variant → stock → public storefront flow is not demonstrated. CSV commit remains withheld (DASH-BR-024), archive/restore remains withheld (DASH-BR-026), and create/add-variant backend guard gaps remain tracked by DASH-BR-044. Phase 09 also remains open; Phase 10 must not start before both phases have evidence-based handoffs.
- Next safe acceptance step requires an authorized local operator session and an explicit disposable-fixture/cleanup plan. Preserve the current backend state; do not reset or create records merely to obtain a screenshot. If no session/fixture plan is available, continue only with non-mutating audit, accessibility, and component-level improvements and keep these criteria marked unverified.


## Phases 10-19 - built in one pass (2026-10-08 IST)

**Status: IMPLEMENTED with local and live-route evidence. Not "production-complete": see RELEASE_READINESS.md known limits and the still-open Phase 08/09 live acceptance items.**

- Studio engine (`src/features/studio/engine`): JSON-Schema subset validator and minimal-instance generator, recursive form renderer with widget registry (media picker, colour, stable ids, unions, arrays with reorder/duplicate/remove, variable insert and preview), dotted-path error mapping identical to the backend `fields` map.
- Document editor: block tree, channel/page palette rules, inspector with visibility rules and style, undo/redo, local draft recovery, presence heartbeat (20 s), revisions (restore as new draft), validation panel, JSON tab, import/export, conflict dialog on 409/412, ritual_steps XOR refinement.
- Releases/publishing (idempotency-keyed, scheduled, rollback, cancel, admin kill switch, preview links), campaigns (overlap warning), content library (6 entities), token guard-rails (WCAG contrast, type minimums).
- Customers, reviews, coupons, message templates, analytics, GST, audit, operations (outbox replay), store settings (diff + reason), team, integrations, flags, app versions.
- **Evidence:** `pnpm verify` PASS (49 files / 247 tests, build). Live: 34/34 block types saved and read back on the real backend; 19 routes load with zero console errors and zero serious/critical axe violations; real UI edit -> save draft -> restore; field-error display.
- **Incident disclosed:** an early version of the round-trip tool overwrote the *draft* of `app/page/home` under rate limiting. It was restored from the seeded revision 3 (now rev 20, same content). The live release was never touched. A draft-only `app/page/category` now exists with zero blocks (backend cannot delete standard pages, DASH-BR-047). The tool now backs off on 429 and verifies its restore.
- **Not verified:** publishing/rolling back a real release, kill switch, MFA-gated writes (local backend has MFA off), team invites, coupon redemption at checkout, role matrices for the new routes (admin only), mobile/tablet screenshots, keyboard-only walkthrough, real-client preview.


## Live acceptance round - Phases 08, 09, 15 and role matrix (2026-10-09 IST)

Run against the local development backend (`PG_HOST_PORT=55432`), disposable operators only, real MFA enrolment via the UI.

| Criterion | Result | Evidence |
|---|---|---|
| Phase 08: create a two-variant product via the reviewed UI, adjust stock (MFA step-up), activate, public API + storefront show it, audit rows have before/after, archive/restore/cleanup | **PASS** | `tests/e2e/catalog-media-live-acceptance.local.spec.ts` (Phase 08 test) via `tools/run-local-catalogue-media-acceptance.ps1` |
| Phase 09: upload image + video through the UI, review, approve (MFA step-up), public immutable serving and video Range | **PASS** | same spec (Phase 09 test). The image/video bytes were first uploaded in earlier attempts of this round, so the final run exercised the content-addressed "same bytes" path and skipped re-approval. |
| Studio publish, kill switch off/on, rollback of both channels with MFA | **PASS** | `tests/e2e/studio-publish.local.spec.ts`; both channels were rolled back to the seeded baseline (live: app #7, web #5, both "Rollback to #2") |
| Role matrix: 5 non-admin roles x 17 new routes (allowed render / denied -> /forbidden) and backend 401/403 on a denied API | **PASS** | `tests/e2e/role-matrix.local.spec.ts` |

Findings recorded during the round:
- The public catalogue read model is cached for a few seconds: an archived product stays in `/v1/products` briefly (tests poll; DASH-BR-050).
- Earlier failed attempts left 6 ACTIVE `phase08-*` QA fixtures publicly visible on the local dev store; all were archived via the admin API and none remain active.
- Archive/restore exist on the backend and succeed with AAL2, but still have no expected-version/reason/idempotency guards (DASH-BR-026 stays open), so the dashboard still exposes no archive/restore control.
- A draft-only empty `app/page/category` exists (backend cannot delete standard pages). Publishing now would publish an empty category page; the validator warns "This page has no blocks". Do not publish the app channel from this local store without reviewing that warning.

Still NOT verified: signed-in responsive screenshots at 375/768/1440 for the new routes, full keyboard-only walkthrough, real-client (app/website) rendering of Studio releases, customer-checkout use of a coupon, team invitation e-mail delivery, live Shiprocket.

### Addendum - responsive and keyboard evidence (2026-10-09)
- `tests/e2e/remaining-phases.local.spec.ts`: 26 tests PASS against the real backend (20 routes incl. /media: no console errors, zero serious/critical axe violations; no horizontal overflow at 375/768/1440; 60 screenshots in `docs/build/evidence/responsive/`; keyboard-only select/reorder/undo in the Studio editor; edit-save-restore; field-error display). Three login timeouts in one full run were backend login rate limiting and passed on re-run.
- Still open: screen-reader pass, MFA-required backend mode, non-admin write paths, real-client rendering of releases.


## Phase 20 closeout - write paths, MFA mode, coupon and invite evidence (2026-10-09 IST)

| Check | Result | Evidence |
|---|---|---|
| Non-admin WRITE enforcement: 24 write endpoints x 5 roles with invalid bodies; backend must deny exactly what the dashboard role table denies | **PASS 120/120** (MFA_REQUIRED counted as "allowed, needs step-up"; media approve/reject is admin-only in the backend, known DASH-BR-038) | `tools/role-write-matrix.local.ts` |
| Backend MFA mode | **Already the default** (`ADMIN_REQUIRE_MFA` defaults to true in `packages/config`); every live write above ran under it, with real TOTP step-up in the UI | studio-publish / studio-mfa-writes / catalog-media specs |
| MFA-gated UI writes: team invite (+ `admin.invite` e-mail outbox row), invite revoke, coupon create + deactivate, store-settings change and exact revert (reason + audit) | **PASS** | `tests/e2e/studio-mfa-writes.local.spec.ts` |
| Coupon at checkout: admin-created 10% coupon applied to a real customer cart (10% of 29,900 paise = 2,990), unknown code -> 422 COUPON_INVALID, deactivated code -> 422 | **PASS** (cart API; order placement not run because checkout is closed on this store) | scripted probe against `/v1/cart/coupon` |

Honest remainder (cannot be closed from the dashboard repo or this machine):
- Real app/website clients rendering a published Studio release (client adapter work packages).
- Live Shiprocket (needs provider credentials; adapter is mock-tested).
- A human screen-reader pass (axe + keyboard + semantic structure are automated; no NVDA/VoiceOver session was run).
- Production TLS/secret deployment and e-mail delivery through a real SMTP provider (local sender is the console/outbox).


## End-to-end: Studio -> published release -> REAL website (2026-10-09 IST)

`tests/e2e/studio-to-website.local.spec.ts` (PASS, 2.3 min): a fresh MFA-enrolled admin edits the web home hero headline in the Studio, saves the draft, publishes ONLY the website channel (MFA step-up), and the real storefront (`jimmy_nd _wax_website`, Vite on :5174, its own `ExperienceProvider` adapter) renders the new headline; rolling back to the seeded baseline makes the storefront revert; the draft is restored. The public bundle is cached about a minute in both directions (poll timeouts are 180 s).

Defects found and fixed by this test and the review that followed:
- **Line breaks were silently stripped**: single-line inputs removed the deliberate `\n` in headlines (the storefront renders them as line breaks). Headline fields and any value containing a newline now use a multi-line field.
- **Screen-reader names included counters and errors** ("Headline 33/120"): `Field` now wraps only the caption in the `<label>` when a control id exists, so hints are announced as descriptions. Unit tests (247) and the live Phase 08/09 flow still pass.
- Test-suite sign-in now backs off on backend rate limiting.

State after the run: web live = "Rollback to #2" (baseline copy), draft headline identical to the seeded one.

### Addendum - smoke suite stabilised (2026-10-09)
`tests/e2e/remaining-phases.local.spec.ts` now signs in once (reused session) and no longer waits for full network idle on polling panels: 26/26 passed on three consecutive runs (about 2.2 min each). Earlier flakes were login rate limiting and a page that never reached network idle.

### Addendum - Flutter app parses the live Studio bundle (2026-10-09)
The real app code (`jimmy&wax_app/lib/core/data/experience.dart`, `ExperienceBundle.fromJson`) parses a live `GET /v1/experience/app` response captured from the local backend (release "Rollback to #2") and yields home blocks: `test/live_bundle_parse_test.dart` + `test/fixtures/live_app_bundle.json` were added to the app repo and pass. Flutter tooling fails inside the `jimmy&wax_app` folder (the `&` in the path breaks native-asset build); the test was run from a copy at a plain path. Not covered: rendering on a device/emulator.

### Addendum - production container verified; proxy CSRF defect fixed (2026-10-09)
- The `Dockerfile` image builds and runs (`next start`, nonce-based CSP, health 200, protected routes 307). Playwright then ran 22 tests against the container on a MAPPED port (3299 -> 3200) with the BFF reaching the host backend: sign-in, every Phase 10-19 route, an edit-and-save write, and the keyboard test all pass.
- **Defect found by that run:** CSRF origin checks compared the browser Origin with `request.nextUrl.origin`, which is the internal listener under `next start`. Behind a reverse proxy, TLS terminator or port mapping every sign-in and write would have been rejected (403 CSRF_REJECTED). Fixed: the expected origin is `DASHBOARD_PUBLIC_ORIGIN` when set, otherwise the Host header with the request protocol. Unit tests cover port mapping, the explicit public origin, attacker origins and a missing origin. **Deployments behind TLS must set `DASHBOARD_PUBLIC_ORIGIN`** (documented in `.env.example`).

## 2026-10-13: production-readiness pass against contract 1.4.0

- Added `tools/contract-drift.local.ts` (+ `run-drift.ps1`): every read function run against the live backend. It caught Categories and Media failing on new backend fields (`rev`, `archivedProductCount`, `rightsHolder`, `bundledKey`, `updatedAt`, ...).
- Built the dashboard follow-ups from `BACKEND_REQUESTS_RESPONSE.md`: invoice GET/POST split, authenticated media route, upload metadata header, media archive/restore + `inUse`, category edit/reorder/delete, collection delete, gated refund processing, order history card, `x-slot` image guidance, ETag forwarding. See ADR-045..049.
- Fixed two live-found defects (nested dialog closing its parent; cache wipe on first session load). Added regression tests.
- Hardening: `noindex` header and metadata, `X-Powered-By` removed, pnpm pinned (`packageManager`), Dockerfile installs the pinned pnpm without corepack, `.gitignore`, CI workflow, README.
- Tooling: `start-prod-local.ps1`, `run-live-suite.ps1`; `run-live-spec.ps1` also exports the smoke sweep's variables.
- Verification: see `RELEASE_READINESS.md` (2026-10-13 addendum) and `DASH_NEXT_ACTION.md`.
