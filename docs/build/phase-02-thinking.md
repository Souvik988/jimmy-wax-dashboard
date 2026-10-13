# Phase 02 thinking — design system, application shell and component library

Status: **COMPLETE** · 2026-10-06 IST

## 1. Re-grounding and users/jobs

### Contract and scope boundary

This phase uses **no backend operations**. The Phase 1 `/api/health` BFF is the only live status source and is not made a dependency of visual primitives. The Studio design system is customer-facing and distinct from dashboard tokens. The Bakaloo reference informs dense navigation, clear status and command navigation; its ambiguous status colour and action-heavy tables are constraints to avoid.

Website evidence is brand reference, not an API: warm ink `#14110E`, walnut `#2A1711`, brass `#C99534`, ivory `#F4E9D5`, Playfair/Inter tokens and a conflicting Manrope design note. The binding phase requirement selects Playfair headings plus Inter UI; neither becomes a Studio token decision.

### Operator day: 12 frequent tasks and shell path

1. Check store/backend readiness — top-bar status.
2. Open orders queue — sidebar group first item.
3. Find order/customer/SKU — `Ctrl/Cmd+K` (navigation stub only until Phase 4).
4. Pack/fulfil — Orders & Fulfilment group.
5. Inspect or create manual shipment — Orders & Fulfilment group.
6. Find product, price or stock — Catalogue group.
7. Work with approved media — Catalogue group when Phase 9 exists.
8. Open customer/review context — Customers group.
9. Draft promotion/message — Marketing group.
10. Read analytics, finance or audit evidence — Insights group.
11. Work in Studio — Studio group, desktop only.
12. Safely configure platform — Settings group, later MFA-gated.

Unbuilt destinations remain clearly labelled, non-navigating items; no blank/mock feature route is reachable.

### Each role: five recurring jobs and safety definition

| Role | Five jobs | Fast and safe |
| --- | --- | --- |
| Admin | assess store; enter queues; find setting; retain context; understand integration availability | worded/icon status, predictable focus, no false claim of access |
| Support | open orders; customer context; moderate reviews; shipment status; notes/tags | phone-ready nav, search entry, no finance/settings shortcut |
| Catalog | catalogue; inventory; media; SKU search; Studio read workspace | identifiers survive long names, clear GST-inclusive money, declared read scope |
| Fulfilment | orders; shipments; inventory; phone operation; health check | 44px touch controls, readable density, colour-independent state |
| Finance | payments/refunds; analytics; audit; coupons; shipping cost context | tabular figures, centralized paise format, explicit destructive confirmation |
| Designer | Studio; media; imagery; navigation preview; recover after error | desktop minimum, focus-safe dialog, no silent draft discard |

## 2. State and data flow

```
route -> shell -> Phase 03 permission resolver (unknown | allowed | denied)
allowed -> content; unknown -> non-interactive shell; denied -> NotAllowedState
unimplemented destination -> NotReadyState (never fake content)
```

```
closed -> opening(trigger captured) -> open -> closing -> trigger restored
open -> submit pending -> success/error; invalid -> focus first invalid field
open -> Escape -> only top overlay closes; dirty draft -> explicit discard confirmation
```

```
uninitialized -> loading -> populated | empty | error
populated -> refresh -> populated(stale) | offline(last known + timestamp) | error(last known retained)
protected action -> denied | step-up-required placeholder | conflict
```

All reusable components receive state as props; they neither fetch, cache, retry, infer roles nor log data. Later hooks supply request IDs/retry/updated time.

```
shortcut -> ignored in editable target | palette opens/focus query
query -> static commands + non-sensitive route recents
Enter -> command -> palette closes/focus moves; Escape -> initiator restored
```

The initial palette deliberately has no customer/order search or sensitive entity history. Toast undo is only a feature-owned backend compensation after server success—not UI rewind for an irreversible change.

## 3. Deep-think decisions

### Repeated components: contracts and states

| Family | Contract | States |
| --- | --- | --- |
| Button/IconButton | `variant`, `size`, `loading`, `disabled`, `asChild`; icon label required | default, focus, disabled, loading, destructive |
| Input/Textarea/MoneyInput/Select | label, description, error, required, disabled, readOnly; money boundary is integer paise | empty, filled, invalid, disabled, long value |
| Checkbox/Switch/Radio/Tabs | native semantics, visible label, controlled/uncontrolled value | selected/unselected, disabled, invalid, keyboard focus |
| Combobox/MultiSelect/Date/DateRange | controlled values and explicit zone; no pretend remote results | empty, loading, no-match, disabled, selected; full mechanics Phase 4 |
| Dialog/Drawer/Popover/Tooltip | labelled trigger/content, close callback, modal/side | closed, open, pending, validation error, Escape, reduced-motion |
| Toast | title, detail, severity, action, duration | info/success/warning/error, bounded stack |
| Badge/StatusPill/Avatar/CopyableId | human text + optional icon; initials fallback; explicit copy | normal, long, unknown/copy error |
| Card/StatCard/Skeleton | heading/children; stat value/change/period | loading, populated, unavailable/error—not false zero |
| Empty/Error/NotAllowed | title, explanation, primary/retry; sanitized request ID | empty, error, offline, denied, conflict, stale |
| DataTable/Filter/Pagination | typed columns/rows/sort/selection/density; opaque `nextCursor` | loading, empty, error, selected, long cells, 100-row virtualisation threshold |
| JsonViewer | finite/redacted serializable text only | collapsed, redacted, invalid-data indication |
| Confirm/Reason/StepUp dialogs | phrase; 3–300-character reason; consequence text | idle, invalid, pending, backend error, cancelled; StepUp is honest placeholder |

### Theme, density, quality and a11y

Use **warm light and dark** themes, light default for long table work. Dark-only was rejected for fatigue/table separation; system-only was rejected because shared workstations need stable defaults. Body target is ≥7:1 where feasible and never below 4.5:1; focus/status boundaries ≥3:1; status always also has text/icon. Semantic variables enable `html[data-dashboard-theme='dark']`, never literal colours in components.

Density is **36px compact** for desktop read-only scans, **44px regular** default/mixed queues, and **52px comfortable** details/exceptions/mobile. Direct touch controls remain ≥44px. At <1024px navigation is a drawer; Studio communicates its desktop requirement. At 200% zoom, layout collapses to one column.

Premium means an intentional 4px rhythm, restrained brass accent, sparing editorial display type, tabular figures, direct empty/error prose and 160–240ms micro / 240–360ms panel motion. Gradients, glass, neon, anonymous icon controls, pulsing data, oversized headings and fake dashboard imagery are rejected. Landmarks are skip-link, banner, navigation, main; one h1; 2px focus ring; modal-only focus trapping; reduced-motion support. Ctrl/Cmd+K never intercepts editable targets; no single-key global commands.

### Fonts

Use `next/font/google` with Playfair Display and Inter plus `display: swap`, so fonts are built into the app rather than loaded from a client-side third party. If build-time retrieval fails, surface it and resolve rather than restoring remote CSS imports that conflict with strict CSP.

## 4. Pre-mortem and controls

1. Token drift into literal colour — semantic variables only, both themes in lab.
2. Dialog leaks focus — focus-trapped primitive and Tab/Escape/restore test.
3. Pending action double-submits — loading button disables activation; features add backend idempotency later.
4. Toast lies about success — only feature callers issue success after confirmation.
5. Stale/offline numbers look current — explicit label/timestamp; no invented zero.
6. PII reaches command history/console — routes only, no persistence/logging from primitives.
7. Emoji/long/mixed text breaks rows — min-width-zero/overflow rules, tabular numeric cells, fixtures.
8. Role appears able to access a screen — metadata plus denied state; Phase 3 enforces.
9. IST date hydrates differently — one timezone formatter and fixed-instant tests.
10. Big queue is slow — 50-row <100ms target and virtualise at 100 rows/measured breach.

## 5. Security and privacy

No customer payload or direct browser API calls are added. Controls: no `dangerouslySetInnerHTML`; JsonViewer renders redacted text; no analytics/third-party scripts/remote icon CDN/token storage/console logging; error UI contains only sanitized copy and request ID; CopyableId writes only on user action; the client cannot decide authorization or MFA. Dialog copy must state consequence and require affirmative input where destructive.

## 6. Budgets

- Shell adds no feature data fetching; target <150 KB gzip before later feature chunks, when measurable.
- 50-row static table render <100ms; virtualisation mandated at 100 rows or an observed breach.
- Feedback <100ms; 160–240ms micro and 240–360ms panel motion; no data-refresh animation.
- Every action keyboard reachable/actionable/escapable; touch controls ≥44px.
- `/dev/components`: zero serious/critical axe findings; body ≥7:1 where feasible / AA floor 4.5:1; UI boundary/focus ≥3:1; usable at 200% and forced colors.

## 7. Test plan (named before coding)

Unit: `formatMoney converts paise to INR without floating drift`; `formatIst formats a fixed instant in Asia/Kolkata`; `formatRelativeIst uses supplied reference`; `money input accepts valid rupee text and rejects excess precision`; `reason dialog validates 3–300 Unicode chars`; `navigation has no reachable future route`.

Component: `button blocks duplicate activation while loading`; `icon button has accessible label`; `field exposes invalid description`; `status contains text`; `dialog traps/restores focus`; `drawer is labelled`; `state components expose next action/request ID safely`; `copyable ID requires a user action`; `table supports density/heading/selection`; `palette ignores editable target and restores focus`.

Integration: no new endpoint. Smoke-test existing `/api/health` against local gateway and preserve unavailable presentation. E2E/visual: keyboard skip/sidebar/palette/Escape/drawer; axe serious/critical zero; screenshots at 375/768/1440; 200% zoom viewport; Lighthouse accessibility ≥95 when audit tooling is permitted. Role enforcement testing belongs to Phase 3; Phase 2 only tests nav metadata.

## 8. Vertical slices

1. Tokens, `next/font`, money/IST helpers and unit tests.
2. Buttons, fields, choices and state components.
3. Overlays/confirmation, toast, focus tests.
4. Data display/table/filter/pagination/safe JSON/copy using dev-lab fixtures only.
5. Responsive shell, navigation declaration, status slot, palette and drawer.
6. `/dev/components`, a11y/keyboard/visual evidence, docs/handoff.

## Review findings and changes

1. The original grouped all role needs together; added role-specific jobs and mobile requirements.
2. Permission ownership was unclear; Phase 2 supplies visual metadata only and Phase 3 owns enforcement/deep links.
3. Remote stylesheet risk was missed; `next/font` is now the only font path.
4. Calendar/combobox mechanics lacked safe real schemas; they are controlled contracts here, full behavior Phase 4.
5. “Undo” could imply local reversal; it is now backend compensation only.
6. Health source and arbitrary data could be conflated; the shell accepts explicit state and never fabricates health.
7. Virtualisation was premature; profile first, mandate at threshold/breach.
8. Inter/Manrope website conflict was unresolved; binding phase requirement selects Inter and records the discrepancy.

## Handoff

Phase 3 attaches the BFF session/permission resolver to this data-driven navigation and uses `NotAllowedState` for denied deep links; it completes `StepUpDialog` with real MFA. Phase 4 owns real query/filter, server search and calendar data behavior. Studio/customer tokens must not reuse dashboard token namespaces.

## Completion evidence

- `pnpm test`: 6/6 unit tests passed.
- `pnpm test:e2e`: 2/2 passed, covering skip link/palette Escape restoration and axe serious/critical findings on the component lab.
- `pnpm build`: production compilation succeeded with `/`, `/dev/components` and `/api/health`.
- Real local HTTP smoke: `/` and `/dev/components` both returned 200 from port 3200.
- Responsive visual captures: `docs/build/evidence/phase-02/components-{375,768,1440}.png`.
- The first axe run found one nested button and three contrast issues; all were corrected before the final passing run.
