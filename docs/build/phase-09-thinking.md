# Phase 09 — Media library and provenance

**Status:** Ritual and implementation complete; local quality gates pass; authenticated/live acceptance remains open. **Date:** 2026-10-07 IST.

## 0. Re-grounding and exact operation set

- Re-read `PHASE_09_media-library.md`, the Phase 08 acceptance/handoff in `DASH_PROGRESS.md`, `DASH_PLAN.md`, `DASH_NEXT_ACTION.md`, the owner ground rules, `docs/backend-contract/03_BACKEND_CONTRACT.md` implementation-status/deviations section, `api-index.md`, OpenAPI, and Experience Studio Spec §5.3 MediaRef. ADR-040 documents the owner's explicit sequencing instruction: execute Phase 09 now, leave Phase 08 incomplete, and resume Phase 08 before Phase 10.
- The dashboard contract snapshot is pinned at `v1.2.0-draft.1`, SHA-256 `d7d6830f60ea17296bb2e50569ecd43b0646d5d6008457bd944ee23a0b2cf144`.

| Operation in api-index/OpenAPI | Permission documented there | Source-grounded behavior / discrepancy |
|---|---|---|
| `POST /v1/admin/media` | `media:write` | OpenAPI request is a generic optional JSON object, but the running Express handler accepts raw bytes and metadata query parameters (`filename`, `alt`, `provenance`, `folder`, `license`) and returns 201 new / 200 duplicate. No idempotency guard documented or found. |
| `GET /v1/admin/media` | `media:read` | Cursor page plus `q`, `kind`, `tag`, `folder`, `approval`, `provenance`, `archived`; default excludes archived. No in-use/unused filter. |
| `GET /v1/admin/media/{id}` | `media:read` | Returns `MediaRow`; OpenAPI DTO is generic. |
| `PATCH /v1/admin/media/{id}` | `media:write` | Strict patch includes `alt`, `decorative`, focal points, tags, folder, role, provenance, license, posterMediaId, bundledKey. No expectedVersion/ETag. `bundledKey` accepted but omitted from `MediaRow`, and handler does not enforce Admin-only. |
| `POST /v1/admin/media/{id}/approve` | `media:write` | Handler additionally requires `role=admin`; accepts optional note/packagingAttested. Approval requirements vary by kind/provenance. |
| `POST /v1/admin/media/{id}/reject` | `media:write` | Handler additionally requires `role=admin`; requires 3–300 character note. |
| `POST /v1/admin/media/{id}/archive` | `media:write` | Refuses if current backend usage list is non-empty; handler has no reason/version/idempotency guard. Usage excludes Studio documents. |
| `POST /v1/admin/media/{id}/restore` | `media:write` | Restores archived asset, no expected-version/reason/idempotency guard. |
| `GET /v1/admin/media/{id}/usage` | `media:read` | `{items}` currently includes product/category/media_poster refs only, not Studio docs. |
| `GET /v1/media/{sha}/{file}` | public | Immutable public URL, supports byte ranges. Experience API storage lookup does not verify a DB row or approval state; a known stored SHA is retrievable before approval. |

Built backend source was inspected in `apps/commerce-api/src/adminB8Routes.ts`, `packages/commerce-domain/src/media.ts`, `packages/integrations/src/library.ts`, and `apps/experience-api/src/app.ts`. Source confirms implementation behavior, not a live asset result. Current read-only checks returned `/healthz` 200, `/readyz` 200 and unauthenticated `/v1/admin/media` 401. No authenticated Phase 09 request has been made: test operator credentials are unavailable, and no temporary operator or business row is being created. Do not invent generic OpenAPI object shapes; runtime-parse the source-confirmed DTO and keep the mismatch in DASH-BR-036 onward.

## 1. Users and jobs

| Role | Five common jobs | Fast and safe means |
|---|---|---|
| Admin | inspect all assets; upload; edit descriptive metadata; approve/reject; inspect usage and archive/restore | Rights/provenance evidence is visible before review; approval is deliberately Admin-only to mirror the handler; no approval claim is made from a client badge; every mutation reconciles with a fresh read. |
| Catalog | find product imagery; upload a packshot; edit alt/tags/focal point; inspect usage; submit a ready asset for Admin review | Can manage uploads/metadata, cannot approve/reject or use a bundled mapping action; no fabricated reviewer controls. |
| Designer | find approved assets; upload imagery/video/font; edit editorial metadata; inspect references; hand off pending material for review | Approved/non-archived selection is strict; no publishing implied; media IDs and URLs remain backend-owned. |
| Support | look up an asset linked from a customer-support case; check current status/usage; copy a URL only when needed | Read-only; no upload, archive, approval, or metadata controls. Never upload customer photos/PII to the public library. |
| Finance | inspect a referenced invoice/brand asset if relevant; check status/usage; distinguish asset evidence from financial proof | Read-only; no access to private filesystem paths, customer-upload media, or approval controls. |
| Fulfillment | inspect package/label media only if present; check status and approved variants; report stale links | Read-only under the role matrix; no upload/review/archive controls. |

The core jobs are find, upload, describe, review, and understand where-used. A fast path uses server filters and cursor pagination, not a client search over an incomplete page. A safe path never treats “approved” as “private until published,” never claims rights from provenance type alone, and never deletes/archives an item based on incomplete usage.

## 2. State and data flow

```text
Library route (media:read)
  -> GET cursor page + supported server filters
  -> loading -> page with per-row approval/provenance/archived state
  -> empty | error(requestId + retry) | offline | 403 permission-denied | contract-drift
  -> filter change resets cursor; nextCursor is opaque; no local in-use filter

Upload per file (media:write)
  -> local magic-byte preflight + backend-supported type/size check
  -> required alt OR explicit decorative; provenance enum; rights-holder/evidence fields
  -> warn that upload creates a publicly retrievable content-addressed URL even while draft
  -> POST raw bytes + supported metadata query; per-file progress/cancel/error
  -> 201 new | 200 duplicate(existing asset; do not imply metadata was updated)
  -> unknown/network outcome: no automatic retry; refresh/search by filename/hash only if safe; request ID shown
  -> draft/pending -> Admin review -> approved OR rejected(note)

Detail
  -> GET media/{id} + GET usage
  -> edit supported PATCH fields -> response replaces local view
  -> no concurrency token exists: serialize one mutation per media ID; on uncertainty, refetch; do not retry blindly
  -> where-used has only current backend refs and must disclose missing Studio coverage
  -> archive: disabled if any reported ref; otherwise withhold until complete ref coverage + guarded backend contract

Public retrieval (separate from approval)
  -> URL in MediaRow -> storage GET -> immutable bytes / Range for video
  -> no DB/approval check in current source
  -> approval changes review state, not public retrievability
```

The server is authoritative for MIME sniffing, image decode, variants, duplicate detection, approval, archive guards and usage. The client only preflights to reduce avoidable failures. Image input is re-encoded to WebP after EXIF/GPS stripping; video/font are preserved. Supported types are JPEG/PNG/WebP, MP4/WebM, WOFF2/TTF/OTF. Backend caps are 15 MiB image, 100 MiB video, 2 MiB font; SVG/GIF are unsupported. Video dimensions/duration remain null. The BFF buffers mutation bodies with `arrayBuffer()`. ADR-043 therefore sets a dashboard 15 MiB cap for images/video, 2 MiB for fonts, requires valid Content-Length before buffering, double-checks bytes after read, and serializes each browser's queue. Cross-operator concurrency remains unbounded and streaming is not claimed.

## 3. Deep-think questions and decisions

1. **Legal/brand risk and safe gates.** Require provenance enum, rights-holder and evidence input before upload, preserve backend `license` text without pretending it has a separate rightsHolder schema, and prohibit automatic review. Request independent rightsHolder/provenanceNote fields from backend. The owner/Admin alone confirms ownership/consent and generated-packaging attestation. Rejected assets stay visible with their reason. Alternative rejected: allowing “original” or “generated” alone to imply rights; those are origin classifications, not proof of license or consent.
2. **Large upload and contract ambiguity.** POST is raw bytes plus metadata query in source, despite the JSON OpenAPI placeholder. Validate per-type limits and magic bytes client-side, use XHR for progress/cancel, then let the server sniff and process. No client chunking because the backend has no resumable/chunk API. Upload max must be capped more tightly at BFF until its 100 MiB memory-buffer risk is addressed. SVG is rejected, not previewed or sanitized by the dashboard. Alternative rejected: multipart form or JSON/base64 because the source handler accepts raw bytes and base64 expands data/memory.
3. **Bundled versus uploaded.** Explain “bundled in the app” as a path already shipped inside the installed Flutter binary; “uploaded” is a public content-addressed backend URL. Do not offer `bundledKey` editing until the backend makes it Admin-only, returns the field, and provides verifiable app paths. No local absolute filesystem path is exposed. Alternative rejected: accepting arbitrary paths because the UI cannot prove the app binary contains the file.
4. **Alt as easiest safe path.** Require meaningful alt for images unless the operator explicitly marks decorative; the explicit toggle clears the text so accidental stale alt is not retained. Video requires a poster before approval and alt should describe its meaning; fonts need license. Do not auto-fill filename as alt. Show the check at upload and detail save/approval. Alternative rejected: a default decorative state, which silently suppresses accessibility text.
5. **Unknown video facts.** Show “Duration and dimensions not provided by backend” when null; do not infer duration from browser metadata or imply the server stores a probe. Preview may play supported media with controls, but metadata remains “not reported.” Alternative rejected: client-side guessed dimensions/duration as authoritative library data.

## 4. Ten-item pre-mortem

| Production failure | Control |
|---|---|
| Pending asset URL is copied and shared publicly | Persistent warning on upload/detail; explicitly say approval does not gate public URL. Never present pending as private. |
| Unlicensed image or recognizable person is approved | Require holder/evidence input, admin-only review, explicit reviewer note; never infer consent or attest packaging on owner’s behalf. |
| Duplicate upload appears to save changed alt/rights | Highlight duplicate and show returned existing metadata; require explicit PATCH to update supported metadata. |
| A 100 MiB upload multiplies memory in browser, BFF and backend | Per-type file caps and at most one large upload at a time; BFF request cap/streaming tracked as a release risk; no parallel 100 MiB fan-out. |
| Browser trusts extension/MIME and accepts disguised SVG/script | Client uses extension only for hints; exact magic-byte preflight; backend sniff remains authoritative; unsupported SVG never rendered. |
| Catalog/Designer sees an approval button api-index says allowed but backend rejects | Gate review to Admin because the handler is stricter; report api-index mismatch and do not repeatedly submit. |
| Asset is archived while a Studio document still references it | Withhold archive/restore controls until usage includes all draft/published Studio docs and backend enforces guarded reference checks. |
| Partial cursor page is called “unused” after local filtering | Do not implement in-use/unused filter on partial data; request server filter or complete typed export. |
| Simultaneous metadata/review requests overwrite reviewer intent | Serialize UI mutations per item; refetch after every transition; no automatic retries; request backend ETag/version and atomic review contract. |
| Keyboard/assistive user cannot upload, inspect progress or resolve errors | Labelled file picker/dropzone fallback, per-file live status, focusable remove/cancel/retry controls, focus-restoring drawer/dialog, 44px controls, axe and keyboard E2E. |

## 5. Security and privacy

- Only same-origin BFF routes use encrypted httpOnly session cookies; access/refresh tokens never enter browser state or logs. Upload/mutation requests retain CSRF checks; no third-party scripts or external asset hosts are introduced.
- The public media URL is intentionally cacheable and current source does not gate approval. Treat every uploaded byte as public and immutable from the moment it is stored. Do not upload customer photos, faces without explicit consent, credentials, private documents, or confidential unreleased assets. A one-year immutable URL cannot be “made private” by a dashboard status toggle.
- Backend magic-byte sniffing, image decoding/re-encoding and EXIF stripping are authoritative. Do not use `dangerouslySetInnerHTML`, render SVG, or create arbitrary font CSS from user-supplied paths. Video uses native controls with a safe MIME returned by the backend.
- Rights holder and provenance evidence are legal/consent data. Avoid logging or screenshotting them; do not place in query strings except the backend currently only accepts metadata query and these fields are explicitly supported; request a JSON metadata endpoint/body with safer length/PII handling. Query logging risk is tracked. Keep text short, server validation enforced, and no client telemetry.
- No Admin-only operation is made available to Catalog/Designer merely because api-index says `media:write`; the backend denial remains authoritative. Do not simulate MFA or broaden session permissions.
- Disable archive until Studio usage refs are complete and server guards are atomic/versioned/reasoned. `bundledKey` is not editable until admin-only enforcement and DTO return are implemented.
- Never automatically retry an upload after timeout because there is no idempotency key. A duplicate 200 response can only be interpreted as an existing item; it is not evidence that metadata changed.

## 6. Performance and accessibility budgets

- 50 visible cards/list rows should render within 100 ms after response on a mid-range laptop. Keep backend cursor pagination; lazy-load thumbnails; virtualize once result count exceeds 200 only if the framework permits accessible list semantics and stable keyboard focus.
- Upload one file at a time; never run multiple videos simultaneously. Show byte and percent progress when computable; cancellation is explicit. Dashboard caps are 15 MiB for images/videos and 2 MiB for fonts; BFF requires Content-Length and performs a post-read size check. Cross-operator memory pressure remains a deployment risk until streaming/backpressure is implemented.
- No large asset Blob is retained in a query cache. Revoke object URLs on removal/unmount; remote thumbnail fetches use native lazy loading and immutable URLs. Use media variants at the smallest sufficient width.
- Layout must work at 375/768/1440 px; no horizontal page overflow. All filter, upload, selection, drawer, review and archive controls are keyboard accessible with visible focus and 44×44 primary target. Drop/paste are enhancements to a conventional file input.
- Screen-reader status announcements identify the filename and current state, not color alone. Rejection reason and unknown video metadata are text. Dialog/drawer opening moves focus; closing returns focus to trigger. Respect reduced motion; ensure native video controls remain reachable.
- Axe serious/critical target zero on upload, library list and detail at 375px/1440px; keyboard-only run must complete select → metadata → upload → reopen item → read status without pointer.

## 7. Test plan (names before implementation)

Unit/resources:
- `media-resource.test.ts`: exact documented paths/query, strict DTO parsing, response status/duplicate handling, no invented usage refs or inUse filter.
- `media-upload-validation.test.ts`: literal magic-byte/type and per-kind size boundaries; unsupported SVG/GIF; required alt/decorative, provenance and rights evidence.
- `media-view-model.test.ts`: status labels, unknown duration/dimensions, duplicate behavior, public-exposure warning, non-empty usage/archive eligibility policy.
- `media-upload-transport.test.ts`: raw bytes + supported metadata, CSRF, progress, abort, timeout/ambiguous result, safe error/requestId; no browser token.
- `media-list.test.tsx`: cursor pages, supported filters, permission controls, empty/offline/error/conflict/rejected states, no partial-page inUse fiction.
- `media-detail.test.tsx`: metadata editing, Admin-only review, reject reason, usage incompleteness disclosure, archive withheld, focus behavior.
- `media-library-a11y.test.tsx`: labels/live region/keyboard upload and review controls.

Integration/E2E (only with authorized session and approved-to-upload public test assets):
- `media-library-live-read.spec.ts`: GET list/detail/usage by permitted roles, confirm actual DTO and permission denial.
- `media-upload-live.spec.ts`: upload real non-PII image/video, verify new and duplicate 201/200, backend MIME and returned URLs; leave pending unless owner confirms legal rights/review.
- `media-approval-live.spec.ts`: verify Admin success only after explicit owner attestation; verify Catalog/Designer backend denial; check reject note.
- `media-public-serving-live.spec.ts`: curl-equivalent immutable cache headers, correct MIME, Range 206 and invalid Range 416; explicitly verify and report that pending public URL is retrievable.
- `media-archive-usage-live.spec.ts`: observe refusal on in-use fixture only if existing safe fixture is available; do not mutate/archive without complete Studio references and safe backend guard.
- Playwright viewports 375/768/1440 + axe; keyboard-only upload/status and modal focus path. Do not create test accounts or change backend data absent authorization/credentials.

## 8. Vertical slices

1. Parse exact media DTO and implement safe cursor/query resources; prove strict success and drift/error handling with tests.
2. Build protected, read-only media library: grid/list, server filters/search, cursor controls, lazy thumbnails, status/provenance, loading/empty/offline/denied/conflict states. No fake rows.
3. Add raw-byte upload intake with local preflight, required rights/alt/provenance evidence, sequential progress/cancel, per-file errors, duplicate distinction, public-exposure warning and no blind retry. Restrict cap to BFF-safe size pending proxy hardening.
4. Add detail/preview/metadata and where-used with honest incomplete-usage disclosure; preview unknown video dimensions/duration as unknown.
5. Add Admin-only approval/rejection matching handler, but keep actual submit disabled absent owner-confirmed rights/packaging evidence and live guard proof. Do not offer archive or bundled mapping while backend gaps persist.
6. Run focused/full verify, responsive/keyboard/axe checks, safe live probes where credentials and fixture authority exist; record no-go criteria honestly and hand off to Phase 08.

## 9. Skeptical review findings and changes

1. **Original plan assumes approval protects public access.** It does not: storage GET bypasses approval. Change: persistent public-exposure warning; no confidential uploads; measure pending URL behavior in a safe test only.
2. **Original plan asks for separate rights-holder and provenance note fields unsupported by the API.** Change: request fields in DASH-BR-037; ADR-041 uses a clearly labelled, source-backed workaround composing holder and evidence into the existing `license` field, limits text to 300 characters, and requires explicit owner authorization for immediate public retrieval. Do not imply these are separate structured records.
3. **Original plan accepts API-index media:write for approval, but source adds Admin-only.** Change: Admin-only UI until docs and runtime are aligned; report contract drift, test negative role path.
4. **Original plan suggests archive refusal from usage, but usage omits Studio docs.** Change: no archive control until backend usage and guard cover all Experience refs; no client-side “unused” inference.
5. **Original plan suggests bundling path mapping, but PATCH response omits `bundledKey` and route has no Admin-only guard.** Change: keep mapping out of reachable UI; request a returned, Admin/MFA-protected field and app-path verification.
6. **Accepting the full 100 MiB video cap through BFF could exhaust memory.** Change: ADR-043 sets 15 MiB image/video and 2 MiB font limits; the BFF rejects missing/invalid Content-Length and oversized requests before `arrayBuffer`, checks actual bytes after buffering, and uploads sequentially. Cross-operator memory pressure still needs streaming/backpressure.
7. **The page spec asks for in-use filter although API cannot filter.** Change: do not client-filter one cursor page; request a server filter or complete server summary.
8. **Upload transport lacks idempotency and metadata query can enter logs.** Change: no blind retry; surface unknown outcome, keep evidence short and prohibit personal contact details, request raw binary metadata headers/body and upload idempotency semantics. BFF buffers query metadata only as required by the existing backend route.

These changes preserve Phase 09's core value without inventing backend guarantees. If the backend lacks a safe essential field/guard, the corresponding write control remains unavailable and is called out in the phase report.

## 9.1 Implementation evidence and remaining acceptance

- Implemented strict media parsers/resources, query keys, public content-addressed proxy, 15 MiB BFF boundary, media workspace, server filters/cursor pages, file preflight, rights/public-exposure acknowledgement, sequential upload progress/cancel, detail and metadata editing, usage disclosure, Admin-only approve/reject. Archive/restore and bundled mapping remain intentionally absent.
- Focused suite passed: 5 files / 19 tests. Full `pnpm verify` passed contract check, typecheck, ESLint, 44 files / 212 tests and `next build`. Contract SHA remained `d7d6830f60ea17296bb2e50569ecd43b0646d5d6008457bd944ee23a0b2cf144`.
- Read-only runtime evidence: backend `/healthz` and `/readyz` 200; unauthenticated backend media list 401; dashboard `/api/health` 200 and unauthenticated `/media` redirects to login (307). The browser showed the sign-in form at its available narrow viewport, not the signed-in library. No upload, approval, valid content URL, Range/cache, axe, or signed-in keyboard/responsive verification has been performed.
- No test files were uploaded, no operator or media row was created, and no rights/packaging attestation was made. Those live tests require a test operator session plus owner-approved non-PII assets with rights for immediate public retrieval.

## 10. Handoff

Phase 09 remains open until the owner supplies an authorized local operator session and disposable, non-PII image/video assets whose documented rights permit immediate public retrieval, then live headers/Range, axe, keyboard and viewport checks are run. Do not ask for passwords in chat. Phase 08 must be resumed before Phase 10 under ADR-040. Phase 10 must consume strictly parsed approved, non-archived MediaRows only, require alt or explicit decorative state, and must not assume pending URLs are private. The MediaPicker API should expose typed `mediaId`, `alt/decorative`, image variant URL and status; it must not use `bundledKey` until the backend returns and guards it. All media usage in Studio is missing from current backend usage output and archive guards, so do not claim accurate usage/archive safety until DASH-BR-040 is resolved.
