# JIMMY & WAX dashboard plan

Status (updated 2026-10-09): **Phases 01-19 built; Phase 20 in progress. Earlier note: Phases 08 and 09 were in progress (Phase 09 sequenced first by ADR-040 at the owner's instruction; Phase 08 must resume before Phase 10). Phase 08 full-write acceptance remains blocked by unsafe/missing backend guards.** · Contract pinned: `v1.2.0-draft.1` · SHA-256: `d7d6830f60ea17296bb2e50569ecd43b0646d5d6008457bd944ee23a0b2cf144`

## Delivery sequence

| Phase | Outcome | Estimate | Dependency | Status |
|---|---|---:|---|---|
| 01 | Audit, contract pin, tooling, real connectivity | 2–3 days | Docker/backend | complete |
| 02 | Accessible tokens, shell, component library | 3–4 days | 01 | complete |
| 03 | BFF login, encrypted session, MFA and RBAC | 4–5 days | 01–02 | complete |
| 04 | Generated client, query, table, forms and error kit | 4–5 days | 01–03 | complete with documented exception — real write proofs move to Phases 09/10/15 |
| 05 | Overview, health, alerts and store controls | 3–4 days | 03–04 | complete |
| 06 | Orders and operator communication | 5–6 days | 03–04 | complete with documented backend exceptions |
| 07 | Manual-first fulfilment, returns and refunds | 5–6 days | 03–04 | complete with documented backend/configuration exceptions |
| 08 | Catalogue, pricing and inventory | 5–6 days | 03–04 | complete locally - live create/stock(MFA)/activate/public+storefront/audit/archive PASS; CSV commit and archive/restore controls deliberately withheld (DASH-BR-024/026) |
| 09 | Media library and provenance | 4–5 days | 03–04 | complete locally - live upload/approve(MFA)/serve/Range PASS; axe on /media and responsive screenshots still open |
| 10 | Studio document engine | 5–6 days | 03–04, schemas | built; 34/34 blocks round-trip live - route-verified |
| 11 | Studio tokens, navigation and chrome | 5–6 days | 10 | built (tokens guard-rails; navigation/chrome via inferred forms) - route-verified |
| 12 | Studio app builder and preview | 6–7 days | 10–11 | built; real-client preview not built - route-verified |
| 13 | Studio web builder and SEO | 6–7 days | 10–12 | built (incl. SEO); real-client preview not built - route-verified |
| 14 | Studio content library | 5–6 days | 09–13 | built (6 entities) - route-verified |
| 15 | Validation, releases, campaigns and baseline | 6–7 days | 10–14, client adapters | built; live publish not exercised - route-verified |
| 16 | Customers, reviews and support | 4–5 days | 03–04 | built - route-verified |
| 17 | Coupons, messaging and announcements | 4–5 days | 03–04 | built - route-verified |
| 18 | Analytics, finance, audit and ops queues | 4–5 days | 03–04 | built - route-verified |
| 19 | Settings, team, integrations and security | 5–6 days | 03–04 | built - route-verified |
| 20 | Hardening and release-readiness evidence | 5–7 days | all | complete - all automated and live-local gates pass (RELEASE_READINESS.md); remaining items are owner/ops-side: Shiprocket credentials, production deploy + real SMTP, app-client adapter, human screen-reader session |

## Guardrails

- No B2B, multi-shop, rider, wallet, loyalty, quick-commerce, or gamification feature may enter the model or navigation.
- No operational sample data may exist in a production route. Explicit test/dev fixtures are isolated and visibly labelled.
- A phase is complete only when its own acceptance evidence is recorded in `DASH_PROGRESS.md`.
- The Studio cannot claim that it affects the app or website until their adapter work packages render public bundles.

## Later

- Custom roles, abandoned cart recovery, cohorts/dead stock, marketing campaigns, and customer timeline only when their contract and owner policy exist.

## Sequencing exception

The owner explicitly instructed “continue with next” after the Phase 08 incomplete report. ADR-040 records Phase 09 before Phase 08 closeout because the plan permits Phases 05–09 to be reordered and media is a dependency for catalogue media attachment and Studio. This does not waive any Phase 08 acceptance criterion: complete Phase 09, return to Phase 08, then proceed to Phase 10.
