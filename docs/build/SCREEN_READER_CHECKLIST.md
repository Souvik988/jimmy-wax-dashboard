# Screen-reader acceptance session

A person has to do this once before go-live. Automated checks (axe, the keyboard sweep) catch most structural problems but cannot tell
whether the page *makes sense when heard*. Allow about 60 minutes. Use a disposable local operator (never real customer data).

## Setup
- **Windows:** NVDA (free, nvaccess.org) with Chrome or Edge. Speech viewer on (NVDA menu → Tools → Speech viewer) so you can copy what was announced.
- **Mac/iOS (optional second pass):** VoiceOver with Safari.
- Sign in at the dashboard, complete authenticator set-up, and use a window of at least 1280 px.
- Do everything **with the keyboard and the screen reader only**. Do not use the mouse. Turn the monitor off if you can.

## How to record
For each task note: ✅ done unaided · ⚠ done with difficulty (say why) · ❌ could not do. Paste the confusing announcement from the
speech viewer. Anything ⚠ or ❌ becomes a defect with the page and the exact announcement.

## Tasks (each should take 1–5 minutes)
| # | Task | What "good" sounds like |
|---|---|---|
| 1 | Sign in, including the authenticator code | Field labels are read ("Work email", "Password", "Authenticator code"); errors are announced without moving focus away; after success you hear the page title. |
| 2 | Use the skip link, then open the primary navigation and go to **Orders** | First Tab says "Skip to main content". Navigation is a landmark with groups; the current page is announced ("current page"). |
| 3 | Open an order, add a note | Page heading is announced; status badges are read as text, not just colour; the note field has a label; success is announced (live region). |
| 4 | **Shipping centre**: edit shipping settings, review changes, apply with a reason | The review dialog announces its title and traps focus; before/after pairs are read in order; closing returns focus to the button that opened it. |
| 5 | **Shipping centre**: add and remove a delivery PIN prefix | Each "Remove …" checkbox names the prefix; an invalid prefix error is announced when you press Review. |
| 6 | **Products**: edit a variant's details; archive and restore a disposable product | Dialog title, field labels, the reason box with its character count; the archive result is announced. |
| 7 | **Catalogue** → CSV tools: choose a file, run the dry run, read the changes | The report is announced when it appears ("Dry-run report"); the list of changes is navigable as a list; "Apply this exact import" is reachable and labelled. |
| 8 | **Media library**: find an image, read its details and usage | Thumbnails have meaningful names or are hidden if decorative; filter controls are labelled; results count is announced. |
| 9 | **Studio**: open a page, add a block, move it up, change a field, save | Block list reads as a list with position ("2 of 5"); Move up/down buttons name the block; validation errors are tied to their fields. |
| 10 | **Studio → Releases**: validate, read the warnings | Warnings and errors are distinguishable by text, not colour; the publish step announces the MFA prompt. |
| 11 | **Finance**: read the GSTR-1 tables | Tables announce caption, column headers and the cell's row/column as you move; warnings are read before the tables. |
| 12 | Trigger an error on purpose (e.g. a stale edit) | The error is announced where you are; you are told what to do next. |

## Checks to do on every page
- One `h1`; headings are in order (no jumping from h1 to h4).
- Landmarks exist: banner, navigation, main.
- Every button and link has a name that makes sense out of context ("Edit details" repeated 5 times is a defect unless the row name is included).
- Dialogs: focus goes in, stays in, Esc closes, focus returns.
- Anything that updates without a page load (toasts, saved/failed messages, loading states) is announced.
- Images that carry meaning have alt text; decorative ones are silent.
- Colour is never the only signal.

## Already covered by automation (so you can focus on the above)
| Check | Where | Status |
|---|---|---|
| axe WCAG 2 A/AA/2.2 AA (serious/critical) on 40 signed-in routes at 375/768/1440 | `tests/e2e/responsive-a11y.local.spec.ts` | see `docs/build/evidence/responsive/summary.json` |
| Keyboard-only: skip link first, visible focus on every stop, no keyboard trap | same spec | same |
| No horizontal scrolling at 375 px | same spec | same |
| Scrollable regions are keyboard-reachable | fixed in `insights.tsx` | verified by axe rule `scrollable-region-focusable` |
| Dialogs use the native `<dialog>` element (focus management by the browser) | `src/components/ui/overlays.tsx` | unit-tested in several suites |

## Sign-off
| Tester | Assistive tech + browser | Date | Result | Defects raised |
|---|---|---|---|---|
| | | | | |
