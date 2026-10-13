# Phase 01 thinking — orientation, audit and foundations

Status: **reviewed before implementation** · 2026-10-06 IST

## Re-grounding evidence

The authoritative contract pack is `docs/backend-contract/`, generated 2026-10-06. The OpenAPI SHA-256 is `d7d6830f60ea17296bb2e50569ecd43b0646d5d6008457bd944ee23a0b2cf144`; `api-index.md` enumerates 228 operations. `03_BACKEND_CONTRACT.md` says B8–B13 are built and its older gap/proposal sections are historical. The current dashboard has one client component with hard-coded orders, metrics and a `Mock API` banner; it has no auth, API client or BFF.

Exact phase operations verified in the contract: `GET /healthz`, `GET /readyz`, and `GET /v1/store-settings` (`getStoreSettings`, public). Live calls through `http://localhost:8080` returned 200 after starting the documented stack. The store-settings response has concrete scalar fields, not an untyped object; its post-reset state is `checkoutOpen:false`.

## 1. Users and jobs

| Role | Phase-01 job | Fast and safe means |
|---|---|---|
| admin | Establish a trustworthy operator console | sees real connectivity, no fabricated business numbers, knows which contract governs builds |
| support | Know whether the console can safely be used | clear reachability/offline status without a misleading retry loop |
| catalog | Prepare a stable foundation for catalogue work | generated types catch drift before a write surface exists |
| fulfillment | Confirm shipping work will not masquerade as provider integration | manual/provider distinction is architectural, documented and testable |
| finance | Trust the future money model | paise and GST-inclusive conventions are fixed centrally before screens are added |
| designer | Know Studio promises are honest | dashboard distinguishes Studio authoring from client rendering availability |

The five repeated jobs are: enter safely, determine backend availability, understand capability boundaries, find a documented local setup path, and detect API drift before acting.

## 2. State and data flow

```
Browser → GET /api/health → Next server route → gateway /healthz
        ← { connected | unavailable, checkedAt, requestId? } ←

Browser → future mutation + X-CSRF header → Next BFF Origin check
        → encrypted httpOnly session decrypt → bearer call to gateway
        ← typed response / normalised error envelope → UI state
```

```
health state: initial → checking → connected
                             ↘ unavailable → retrying → connected | unavailable
store settings: idle → loading → ready | empty | forbidden | offline | malformed
```

Phase 01 has no customer data. Empty means an absent optional public configuration; error displays the request ID when supplied; offline means the BFF cannot reach the gateway; permission-denied is reserved for future authenticated routes; conflict is not applicable to these GETs; stale means the last successful health state is visually marked as stale rather than reused as fresh.

## 3. Deep-think questions and decisions

### Project failure controls

1. **Scope failure:** excluded domains creep in from the reference. `DASH_PARITY.md` records every reference decision, and navigation will be role/capability driven.
2. **Security failure:** browser receives backend credentials. ADR-003 fixes a server-only BFF boundary before auth is built.
3. **Contract-drift failure:** generated types silently age. ADR-007 couples SHA lock, generation and CI-equivalent checks.
4. **Studio-complexity failure:** draft/editor code expands into generic JSON bags. JSON Schema-driven document boundaries and sequential Studio phases keep the engine first.
5. **Quality failure:** polished mock screens hide missing integrations. Connectivity-first UI, no shipped mock values and phase evidence prevent this.

### Existing prototype disposition

Keep the warm premium visual language, responsive sidebar concept, keyboard-palette intent and Studio desktop safety notice as design references. Rebuild the component tree because its data is hard-coded, global CSS is one large file, navigation is client-local state, it has no accessible route architecture, and `Mock API` is permanently asserted instead of observed.

### Stack choices

| Concern | Options considered | Decision and reason |
|---|---|---|
| Server state | TanStack Query; SWR | TanStack Query: mutations, invalidation and offline/retry controls fit an admin console better. |
| Tables | TanStack Table; MUI Data Grid | TanStack Table: headless, small, no conflicting visual system. |
| Forms | React Hook Form + Zod; Formik + Yup | React Hook Form + Zod: strong TS inference and minimal rerenders. |
| Primitives | Radix; hand-built | Radix wrapped locally: keyboard/a11y baseline without theme lock-in. |
| Styling | Tailwind + variables; CSS modules only | Tailwind plus CSS variables: shared primitives and brand tokens with route-local escape hatches. |
| API types | openapi-typescript; handwritten interfaces | generated types: contract review is mechanical. |
| Tests | Vitest/RTL/Playwright; Jest/Cypress | Vitest/RTL/Playwright + axe: native Vite/Next ecosystem and real-browser accessibility. |

### Trust boundary

The browser is untrusted for authorization and never sees API tokens. The BFF validates input and origin, reads the encrypted server session, forwards only required requests, normalises errors, redacts logs, and returns data permitted for the UI. The backend remains the authorization/MFA/concurrency authority. Cookie encryption keys and API tokens are server environment values only.

### Drift strategy

Commit source OpenAPI, generated types and a hash lock. `contract:check` compares the source hash against the lock; `contract:generate` regenerates types and lock together. A scheduled CI job will compare OpenAPI operation paths against `api-index.md` headings/counts and report mismatch; it does not auto-accept a change.

### Whole-project definition of done

- All planned routes are permission-gated in the BFF and client UX, with real-stack evidence.
- No token/PII leaks into storage, HTML, logs, screenshots or telemetry.
- Every mutation carries backend-required reason, concurrency token and/or idempotency key.
- Every visible feature has loading, empty, error, offline, forbidden and conflict states as applicable.
- Money is paise, GST inclusive; dates are rendered in IST.
- Keyboard flows and axe checks pass; mobile operational pages remain usable.
- The Studio validates schema, previews clearly, creates immutable releases and has rehearsed rollback/kill-switch evidence.
- App/website rendering adapters and a seed-equality comparison are independently verified.
- `pnpm verify`, real-stack integration and Playwright suites pass with written evidence.

## 4. Pre-mortem

| Failure | Specific control |
|---|---|
| A stale health indicator says connected | timestamp each result and poll only while visible; show stale state after timeout |
| A backend reset leaves a broken UI with old mock values | no mock fallback in production route; terminal unavailable state |
| A BFF forwards requests to arbitrary URLs | fixed gateway origin from server config; no caller-supplied host |
| Refresh race revokes every operator session | one shared server refresh promise and rotation tests |
| Generated types are updated without review | lock/hash mismatch fails verification |
| Admin body `object` leads to unsafe field assumptions | endpoint parser introduced before first consumer; record unknown fields |
| A role sees hidden but executable controls | server guard always enforced; BFF only emits allowed action metadata after `me` |
| A future retry double-submits a refund/order | no automatic mutation retry; idempotency key and disabled/in-progress state |
| PII appears in a visual regression image | synthetic fixtures and masked UI by default |
| Studio data is published without a client able to render it | client-capability and release gate; explicit unavailable copy |

## 5. Security and privacy

Phase 01 exposes only health and public store configuration. Still, gateway location and request IDs are operational data: BFF logs only route/method/status/request ID and never headers/body. Health routes are GET-only and do not use user identity. Config must not include secrets; the UI whitelists only expected public settings fields. CSP will deny third-party script execution in Phase 02/03. The local generated credentials are discarded and not documented.

## 6. Performance and accessibility budgets

- Health badge: 1 network call on load, timeout at 4 seconds, recovery polling no faster than 30 seconds while visible.
- Connectivity visual update: under 100 ms after response; no layout shift.
- Initial shell goal: below 150 KB gzip before lazy feature routes.
- Controls: 44×44 px minimum, visible 3:1 focus ring, non-colour text/icon status, logical keyboard order, labelled retry control, `aria-live=polite` only for state transitions.
- Operational tables from Phase 04: 50 rows interactive in under 100 ms and virtualise beyond 200 rows.

## 7. Test plan

1. `health-route returns connected gateway status` (integration).
2. `health-route returns unavailable without leaking network internals` (unit).
3. `public store settings parser accepts known scalar policy` (unit).
4. `contract-check rejects changed source hash` (unit/script).
5. `generated OpenAPI schema compiles` (typecheck).
6. `shell announces connected backend` (component).
7. `shell announces unavailable backend and recovers without reload` (Playwright real stack).
8. `health badge is keyboard reachable and axe clean` (Playwright + axe).
9. `all six local roles can be created; no credentials appear in artifacts` (local integration procedure).
10. `verify command runs types, lint, unit and build` (CI-equivalent).

## 8. Build slices

1. Replace tooling and repository layout; pin contract and generated types.
2. Add server configuration, BFF health route and public store-settings typed probe.
3. Replace hard-coded mock status with a real accessible connection indicator.
4. Add contract, unit and browser test infrastructure.
5. Verify against live gateway, document setup and hand off to Phase 02.

## Review findings and changes

1. **Weakness:** an unauthenticated browser health call bypasses the BFF design. **Change:** browser calls only `/api/health`; BFF calls the gateway.
2. **Weakness:** public settings may still change shape. **Change:** parse and whitelist scalar policy fields; handle malformed data explicitly.
3. **Weakness:** health polling could create a retry storm. **Change:** use visibility-aware 30-second polling and exponential manual retry.
4. **Weakness:** generated types alone do not validate untyped admin bodies. **Change:** treat those as `unknown` until per-feature Zod schemas are added.
5. **Weakness:** role-account acceptance could expose generated passwords. **Change:** create them with stdout discarded and document only recreation mechanics.
6. **Weakness:** the initial mock overview can remain reachable accidentally. **Change:** remove it from the production route rather than merely overlay a connection badge.

## Handoff to Phase 02

Phase 02 may rely on the contract lock, generated types and BFF health shape once Phase 01 verification passes. It must build the real shell from zero—do not revive hard-coded KPI/order content. Preserve the warm editorial direction only through tokenised components, and make connected/unavailable state available in the global shell.
