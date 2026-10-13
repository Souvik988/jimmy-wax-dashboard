# Dashboard decision log

## Recovery note — 2026-10-07

The prior file contained 14,072 bytes and every byte was NUL. No sibling backup or alternate data stream was found. This is a reconstruction, not a byte-for-byte recovery: ADR-001–003 are confirmed by `00_MASTER_PROMPT.md`; later IDs and decision topics were reconstituted from `DASH_PROGRESS.md`, `DASH_RISKS.md`, phase thinking files, and the current contract/source evidence. ADR-004 is reserved because its topic and wording are not preserved in available sources. Where the original rationale could not be recovered, the entries below state only the evidence-backed operative decision. Do not treat this reconstructed prose as the original approval record.

## ADR-001 — BFF session boundary

**Decision:** Keep backend access tokens server-side in the encrypted, HTTP-only dashboard session; route browser operations through the same-origin BFF. The browser must not receive access or refresh tokens.

**Evidence:** `00_MASTER_PROMPT.md` §6; Phase 03 implementation and security evidence in `DASH_PROGRESS.md`.

## ADR-002 — Studio store and framework-free `studio-core`

**Decision:** Keep Studio editing state separate from query/server state, and place schema, validation, diff, merge, and related pure document logic in a framework-free `studio-core` layer.

**Evidence:** `00_MASTER_PROMPT.md` §6; Studio remains unimplemented and must follow the ordered phases 10–15.

## ADR-003 — Preview strategy is a gate

**Decision:** Treat preview fidelity/transport as a recorded strategy decision before shipping Studio preview; do not imply that the dashboard preview changes the app or website before client adapters exist.

**Evidence:** `00_MASTER_PROMPT.md` §10 and §13; client integration status in the owner’s current prompt.

## ADR-004 — Reserved; source text unavailable

**Decision:** None reconstructed. The original ID’s topic and wording were absent from the available files and prior evidence summary. Keep the ID reserved; do not infer a decision from numbering.

## ADR-005 — Forms and runtime validation

**Decision:** Use the shared React Hook Form + Zod form/validation approach for operator input, with server errors mapped back to fields.

**Evidence:** `00_MASTER_PROMPT.md` §6; Phase 04 scope and implementation notes in `DASH_PROGRESS.md`.

## ADR-006 — Accessible shared component layer

**Decision:** Build the dashboard’s own reusable accessible component layer on semantic tokens, CSS variables, Tailwind and Radix primitives rather than letting each feature invent controls.

**Evidence:** `DASH_PROGRESS.md`, Phase 02.

## ADR-007 — Generated API types and contract lock

**Decision:** Generate types from the pinned OpenAPI document and verify its digest so contract changes cannot silently drift from the dashboard.

**Evidence:** `contract.lock.json`; `DASH_PROGRESS.md`, Phase 01; `pnpm contract:check`.

## ADR-008 — Tests distinguish unit evidence from live verification

**Decision:** Use unit/component tests for deterministic behavior and mark backend integration as verified only when exercised against the running real backend. A passing test double is not live-stack evidence.

**Evidence:** Phase reports in `DASH_PROGRESS.md`; current resume protocol.

## ADR-009 — Centralized money and time primitives

**Decision:** Represent money as integer paise and centralize INR and IST formatting/parsing; feature components do not improvise currency or timezone behavior.

**Evidence:** `00_MASTER_PROMPT.md` §5; `DASH_PROGRESS.md`, Phase 02; `src/lib/format`.

## ADR-010 — No fabricated connectivity state

**Decision:** Operational screens show backend-derived data or explicit loading, empty, denied, unavailable, and error states; no mock business values ship as if live.

**Evidence:** `00_MASTER_PROMPT.md` §3; Phase 01 and Phase 08 evidence in `DASH_PROGRESS.md`.

## ADR-011 — Client adapters gate Studio delivery claims

**Decision:** Do not claim Studio changes affect the mobile app or website until those clients implement and verify the bundle adapters.

**Evidence:** Owner decisions in `00_PASTE_THIS_FIRST.md` §2; `DASH_PLAN.md` guardrails.

## ADR-012 — Semantic light/dark dashboard themes

**Decision:** Dashboard themes use semantic tokens with light/dark behavior; this does not authorize changing the app/website brand palettes or fonts.

**Evidence:** `DASH_PROGRESS.md`, Phase 02; owner decisions in `00_PASTE_THIS_FIRST.md` §2.

## ADR-013 — Incomplete feature routes stay unreachable from navigation

**Decision:** Do not make a future-phase or partial workflow reachable through primary navigation until its user-facing states and safeguards are coherent.

**Evidence:** `00_PASTE_THIS_FIRST.md` §3; Phase 02 handoff and Phase 08 status in `DASH_PROGRESS.md`.

## ADR-014 — Normalize forwarded headers

**Decision:** Normalize `Headers` objects before forwarding BFF requests; object spread is not a safe way to preserve authorization headers.

**Evidence:** `DASH_PROGRESS.md`, Phase 03, including the regression test and live role evidence.

## ADR-015 — Retry an MFA-refused request only after verified step-up

**Decision:** Preserve the exact pending request and replay it once only after a definitive MFA-required refusal and successful backend-verified step-up. Do not retry after an ambiguous network result.

**Evidence:** `DASH_PROGRESS.md`, Phase 03, real step-up E2E and unit tests.

## ADR-016 — Invitation codes belong in the form body, not URLs

**Decision:** Collect one-time invitation codes in the request body and never place them in query strings or navigation URLs.

**Evidence:** `DASH_PROGRESS.md`, Phase 03 invitation flow and acceptance evidence.

## ADR-017 — Derive sign-in return paths from router state

**Decision:** Use the stable pathname/router state for safe return navigation rather than unstable render-time location access.

**Evidence:** `DASH_PROGRESS.md`, Phase 03 hydration and return-path fix.

## ADR-018 — Forward only sanitized CSV attachment metadata

**Decision:** The BFF may forward a validated attachment filename only; it must not relay arbitrary upstream response headers.

**Evidence:** `DASH_PROGRESS.md`, Phase 04; CSV attachment sanitization tests.

## ADR-019 — Scope query data and local preferences by operator

**Decision:** Key authenticated query state and safe local preferences by operator identity so one operator’s retained state is not reused for another.

**Evidence:** `DASH_PROGRESS.md`, Phase 04; saved-view and preference implementation.

## ADR-020 — Never sort a partial cursor page in the browser

**Decision:** Preserve backend ordering for cursor-paginated data; only offer sorting that the API documents and performs server-side.

**Evidence:** `DASH_PROGRESS.md`, Phase 04; Phase 08 product-list behavior.

## ADR-021 — Overview figures retain backend definitions

**Decision:** Render overview metrics with the backend’s documented period and definition; do not recalculate superficially similar totals in the dashboard.

**Evidence:** `DASH_PROGRESS.md`, Phase 05 and its overview contract observations.

## ADR-022 — Store pause is a public, non-dismissible signal

**Decision:** Reflect the authoritative public pause state persistently; operators cannot dismiss the signal while the store remains paused.

**Evidence:** `DASH_PROGRESS.md`, Phase 05 and store pause propagation evidence.

## ADR-023 — Readiness details come only from backend evidence

**Decision:** Show only readiness/configuration facts actually returned by the backend; do not infer provider, payment or operational readiness from missing data.

**Evidence:** `DASH_PROGRESS.md`, Phase 05; `docs/build/DASH_RISKS.md` readiness records.

## ADR-024 — Treat invoice retrieval as sensitive issuance

**Decision:** Guard invoice access as a potentially state-changing/sensitive action, including role and step-up checks, until the backend contract cleanly separates retrieval from issuance.

**Evidence:** `DASH_PROGRESS.md`, Phase 06; DASH-BR-008 and R-024.

## ADR-025 — Do not reconstruct missing order allocations or history

**Decision:** Display only fields returned by the order contract; do not synthesize customer identity, lifecycle history, or per-line financial allocations.

**Evidence:** `DASH_PROGRESS.md`, Phase 06; DASH-BR-009 and R-025.

## ADR-026 — Change local checkout test state only through audited flows

**Decision:** Any local checkout activation used for acceptance must use the documented audited operator flow; do not bypass it with direct database edits.

**Evidence:** `DASH_PROGRESS.md`, Phase 06 checkout lifecycle evidence and local state notes.

## ADR-027 — Separate manual shipping from provider capability

**Decision:** Treat manual courier entry as its own supported path; expose provider-specific controls only when the backend reports the provider configured and reachable. Shiprocket remains unverified live.

**Evidence:** Owner decision in `00_PASTE_THIS_FIRST.md` §2; `DASH_PROGRESS.md`, Phase 07; DASH-BR-018.

## ADR-028 — Withhold return receipt until inventory guards are corrected

**Decision:** Do not expose the return-receipt/restock operation while its backend route lacks the required `inventory:write` and AAL2 enforcement.

**Evidence:** `DASH_PROGRESS.md`, Phase 07; DASH-BR-016 and R-026.

## ADR-029 — Do not offer package overrides without persisted contract support

**Decision:** Do not let the dashboard imply manual package overrides persist when the shipment contract does not store them.

**Evidence:** `DASH_PROGRESS.md`, Phase 07; DASH-BR-012.

## ADR-030 — Keep shipping settings/PIN writes read-only until guarded

**Decision:** Do not expose shipping settings or delivery-area writes without backend-enforced reason and caller-supplied version/concurrency guards.

**Evidence:** `DASH_PROGRESS.md`, Phase 07; DASH-BR-019 and R-030.

## ADR-031 — Keep refunds read-only until payment readiness and safe processing exist

**Decision:** Do not offer refund processing while the payment provider is unconfigured or the operator cannot establish an eligible captured payment and safe backend processing contract.

**Evidence:** Owner decision in `00_PASTE_THIS_FIRST.md` §2; `DASH_PROGRESS.md`, Phase 07; DASH-BR-017/018.

## ADR-032 — Do not repurpose stock deltas to edit low-stock thresholds

**Decision:** Existing low-stock thresholds remain read-only until a supported threshold-update operation exists.

**Evidence:** `DASH_PROGRESS.md`, Phase 08; DASH-BR-021 and R-033.

## ADR-033 — Keep catalogue cost fields Admin-only

**Decision:** Follow the binding role matrix and backend response; do not expose cost price to Finance through catalogue reads without an approved safe contract.

**Evidence:** `DASH_PROGRESS.md`, Phase 08; DASH-BR-023 and R-035.

## ADR-034 — Require a server-bound review before CSV price overwrite

**Decision:** Do not commit catalogue CSV price overwrites until dry-run review is bound server-side to a preview/version and the write has reason and idempotency safeguards.

**Evidence:** `DASH_PROGRESS.md`, Phase 08; DASH-BR-024 and R-031.

## ADR-035 — Never replay an uncertain stock adjustment

**Decision:** Reconcile uncertain stock writes through authoritative inventory and movement reads; do not replay the same signed delta automatically or present an unguarded retry.

**Evidence:** `DASH_PROGRESS.md`, Phase 08; inventory adjustment tests and R-036.

## ADR-036 — Withhold unguarded product archive/restore actions

**Decision:** Keep archive and restore controls unavailable until the backend mutation supports a current-version precondition, an operator reason, and safe idempotent/ambiguous-outcome handling. Do not rely on a confirmation dialog to replace backend concurrency or audit safeguards.

**Evidence:** Phase 08 source inspection; DASH-BR-026; see Phase 08 continuation notes in `DASH_PROGRESS.md`.

## ADR-037 — Demand-load the full variant timestamp list

**Decision:** Do not fetch the unfiltered, unpaginated `GET /admin/catalog/variants` list on every product-record visit. Fetch it only after an operator selects Edit price, and do not show the price form until the matching variant and `updatedAt` are verified. A failed read exposes no price write and includes the request reference.

**Rationale:** The shared endpoint is currently the only documented source for the variant timestamp required by PATCH, but it reads the entire catalogue. The explicit click avoids scaling every product detail load with all variants. This accepts one deliberate read step before price editing until a product-scoped/cursor API exists.

**Evidence:** DASH-BR-028 / R-038, `product-editor.test.tsx`, and `phase-08-thinking.md` implementation adjustment.

## ADR-038 — Keep taxonomy writes within their backend guards

**Decision:** Category creation may be offered after review and with no automatic retry; reconcile an ambiguous result through a fresh complete category read. Keep category update, reorder and delete unavailable because the backend has no revision precondition. Collections may be created after review and updated only with the current `expectedRev`; keep collection deletion and resolved-product preview unavailable until the API documents safe reference checks and a typed preview.

**Rationale:** A client diff or confirmation cannot replace backend concurrency guards. Category counts also exclude archived products; collection deletion does not check Experience Studio references; the only collection resolver query is not in OpenAPI.

**Evidence:** DASH-BR-022, DASH-BR-030–033, R-039–042, and Phase 08 section 13 in `phase-08-thinking.md`.

## ADR-039 — Keep CSV import in dry-run-only mode

**Decision:** Catalogue CSV export is an explicit download; import accepts a bounded raw UTF-8 CSV file only for `dryRun=true`. Parse the source-backed 200/422 report, never persist or log file contents, and do not expose a commit control until the backend binds a reviewed preview to versions, reason and idempotency.

**Rationale:** The built route accepts a raw text body and returns useful 422 row errors, while OpenAPI incorrectly documents JSON/200. The existing commit can overwrite current prices with no safe preview binding. The export endpoint is complete/unpaged and memory-buffered.

**Evidence:** DASH-BR-024, DASH-BR-034–035, R-031/R-043, and Phase 08 section 14 in `phase-08-thinking.md`.

## ADR-040 — Sequence Phase 09 before Phase 08 closeout at owner direction

**Decision:** Start Phase 09 while Phase 08 remains explicitly incomplete, then return to Phase 08 before Phase 10. Do not waive Phase 08 acceptance or enable its unsafe archive/restore or CSV commit paths.

**Rationale:** The owner asked to “continue with next,” and the master plan permits Phases 05–09 to be reordered with a documented justification. Media is a prerequisite for catalogue media attachment and Studio work. This sequencing avoids stalling useful independent work without falsely closing Phase 08.

**Evidence:** Owner instruction in the current task; `docs/build/DASH_PLAN.md` sequencing exception; Phase 08 acceptance table in `DASH_PROGRESS.md`.

## ADR-041 — Preserve media rights evidence in the only supported backend field

**Decision:** Until the backend exposes distinct rights-holder and provenance-evidence fields, require both at upload and compose them into the documented `license` field (including optional font licence), capped at 300 characters. Explicitly label this as a workaround and never imply the API stores separate structured records. Require an explicit confirmation that the owner has authorized immediate public retrieval before sending bytes.

**Rationale:** Dropping provenance/consent evidence would make the UI materially less safe, while inventing unsupported query fields would fail the real contract. The existing license string is the only source-backed write field. The backend public route makes an asset retrievable before approval, so public-use authority must be confirmed before upload.

**Evidence:** DASH-BR-037, DASH-BR-042, `media-validation.ts`, `media-library.test.tsx`, R-044/R-047.

## ADR-042 — Withhold media archive and bundled-path controls

**Decision:** Do not expose archive/restore or bundledKey mapping in the Media Library. Usage does not include Experience Studio references and the archive mutation has no version/reason/idempotency safeguards. `bundledKey` is accepted by PATCH but omitted from reads, not Admin/MFA protected, and cannot be verified as a safe app asset path.

**Evidence:** DASH-BR-039–040, Phase 09 backend source review, R-046–047.

## ADR-043 — Cap dashboard media upload at 15 MiB pending BFF streaming

**Decision:** The dashboard accepts images and videos up to 15 MiB and fonts up to 2 MiB, uploads sequentially per browser session, requires a valid Content-Length at the BFF, and rechecks the actual byte count after reading. The backend's larger video allowance is intentionally not surfaced. Do not claim streaming or cross-operator concurrency safety.

**Rationale:** The BFF currently buffers mutation bodies with `request.arrayBuffer()`. This gives a hard per-request bound before the buffer is allocated, while retaining a post-read integrity bound. It does not address concurrent uploads across multiple operators/processes.

**Evidence:** DASH-BR-043, `src/server/auth/proxy.ts`, `media-model.test.ts`, R-045.

## ADR-044 — Create catalogue records inactive and reconcile uncertain writes without retry

**Decision:** Offer reviewed product creation and add-variant using only the source-backed `catalog:write` routes. Require explicit stable IDs, an active backend category and positive GST-inclusive prices; send `active:false` for the product and all newly created variants. Do not accept initial stock or attach media in these flows. Since the backend has no idempotency key and add-variant has no version/reason guard, never replay an ambiguous POST. Perform at most one explicit authoritative read for reconciliation and label any matching row as unattributed, not confirmed success. Keep archive/restore and CSV commit unavailable.

**Rationale:** These routes exist and are audited, so the dashboard can create inactive draft catalogue records without changing current purchase eligibility. But a confirmation dialog cannot replace missing backend idempotency or concurrency guards; inactive defaults and no-retry behavior reduce customer impact without claiming those safeguards exist.

**Evidence:** DASH-BR-044, R-048, `phase-08-thinking.md` section 16. Creation has not been exercised against the local backend because no operator session or safe fixture cleanup path is available.

## ADR-045 — Read an invoice with GET, issue it with POST and a reason

**Decision:** The order screen shows an invoice with `GET /admin/orders/{id}/invoice`, which is read-only (404 when none has been issued). Issuing uses `POST` on the same path with a reason of 3–300 characters, and only for `orders:fulfil` operators with a fresh MFA step-up. Roles that can read orders may view an issued invoice; the backend blanks the buyer's street address for roles without `orders:fulfil`. The BFF guard now applies to the POST only.

**Rationale:** Backend 1.3.0 fixed DASH-BR-008: GET used to issue an immutable, numbered financial record as a side effect. The old "Open or issue" confirmation phrase is gone because viewing no longer has consequences; issuing now needs a reason that lands in the audit log.

**Evidence:** DASH-BR-008, `order-invoice.tsx`, `tests/unit/order-detail.test.tsx`, `tests/unit/admin-operation-policy.test.ts`, `tests/e2e/order-detail-live.spec.ts`.

## ADR-046 — Preview library media through the authenticated route

**Decision:** `/api/media/{sha}/{file}` now requires a signed-in operator with `media:read` and fetches `GET /v1/admin/media-files/{sha}/{file}`. Responses are `private, max-age=300`, never shared-cache. Draft, rejected and archived assets are therefore previewable by operators and stay invisible to everyone else.

**Rationale:** Backend 1.4.0 made the public media URL approved-only (DASH-BR-042). The previous pass-through to the public URL would have broken every draft preview. Rights details no longer travel in the upload URL: they go in the `X-JW-Upload-Meta` header (base64url JSON), which the BFF forwards after validating its format and size.

**Evidence:** DASH-BR-036, -037, -042, `src/app/api/media/[sha]/[file]/route.ts`, `tests/unit/media-public-route.test.ts`, `tests/unit/media-upload.test.ts`, `tests/e2e/taxonomy-media-guards-live.local.spec.ts`.

## ADR-047 — Expose the revision-guarded writes the backend now enforces

**Decision:** Media archive/restore (`expectedUpdatedAt` + reason), category edit (`expectedRev`), category reorder (`expectedRevs` for every category) and delete, and collection delete (`expectedRev` + reason) are available to `catalog:write` / `media:write` operators. Only changed fields are sent. A stale revision (409 `CART_VERSION_CONFLICT`) reloads the latest copy and asks the operator to look again; a blocked delete or archive (409 `ILLEGAL_STATE`) lists exactly what still references the record. Bundled-key mapping stays read-only: it needs Admin plus MFA and the app owns the list of valid asset paths.

**Rationale:** DASH-BR-026, -032, -033, -040 and -041 are resolved in backend 1.3.0/1.4.0, so the reasons these controls were withheld no longer apply.

**Evidence:** `category-list.tsx`, `collection-delete.tsx`, `media-library.tsx`, `tests/unit/category-management.test.tsx`, `tests/unit/media-library.test.tsx`, live spec above.

## ADR-048 — Process refunds only where the backend says they can succeed

**Decision:** "Process refund" appears only for operators with `refunds:write`, only on rows where the backend reports `processable: true`, and only after a typed confirmation. Rows it cannot process show the backend's `blockedReason` in plain language, and the page states whether a payment gateway is connected from `paymentCapability`. A gateway failure leaves the refund `failed` and the operator may retry; the backend's idempotency key makes a retry safe.

**Rationale:** DASH-BR-017 and -018 are resolved: the capability and per-row eligibility are exposed to Finance, so the page no longer has to guess. COD refunds stay manual by design.

**Evidence:** `returns-refunds.tsx`, `tests/unit/refund-processing.test.tsx`. Not exercised against a real gateway: this needs Razorpay sandbox credentials.

## ADR-049 — Keep the query cache across the first session load

**Decision:** The shell remounts the page's data cache when the operator changes or signs out, but not on the first "Checking session" to signed-in transition. Nested dialogs no longer close the dialog that contains them.

**Rationale:** A live run showed a form opened in the first moments after load being wiped when the session check finished, and a reason prompt closing the drawer behind it (React bubbles a nested dialog's `close` event to its parent). Both lost operator input or hid error detail.

**Evidence:** `app-shell.tsx`, `overlays.tsx`, `tests/unit/dialog-nesting.test.tsx`.
