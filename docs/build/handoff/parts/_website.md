# SESSION PROMPT: WEBSITE (`jimmy_nd _wax_website`)

You are the **website** session. Goal: make the storefront render everything the operator publishes from the dashboard's Experience Studio (website channel), keep the built-in design as the fallback, and make the site production-ready (fast, accessible, SEO-correct, secure).

__SHARED__

## 1. Current state (verified)
Vite + React storefront: `src/App.tsx`, `src/pages/{Home,Shop,ProductDetail,Ritual,Story,Checkout,Orders}.tsx`, `src/components/*` (including `ScrubHero`, `ScrubFilm`, `PromoBlock`, `RitualBlock`, `JournalBlock`, `StoriesBlock`), `src/lib/{api,cart,catalog,experience,shop}.tsx`. `src/lib/experience.tsx` already:
- fetches `GET /v1/experience/web` with `x-jw-client: web/1; caps=...` and falls back silently to built-in content on any failure;
- supports **7 of 21** block types: `web.hero_film, web.marquee, web.chapter_mark, web.collection_grid, web.promo_film, web.closing_cta, web.announcement_bar`;
- supports the draft preview `?jw_preview=<token>`;
- uses the bundle only on the **Home** page and for the announcement bar. It does **not** yet apply design **tokens**, **navigation**, **chrome** (brand, veil, effects, SEO defaults, footer), page **SEO**, or any page other than Home.
The dashboard's end-to-end test `studio-to-website.local.spec.ts` (edit a hero headline in the Studio, publish, the site shows it, roll back, it reverts) passes and must keep passing.

## 2. Tasks (in this order; commit after each)
**W1. Block coverage: all 21 website blocks.** Implement the 14 missing ones in the existing visual language, driven by the props in `blocks.schema.json`: `web.ritual_steps, web.scrub_film, web.media_split, web.standards_grid, web.evidence_rail, web.atelier_film, web.reels_rail, web.journal_stack, web.testimonials, web.rich_text, web.image, web.product_grid, web.faq, web.spacer`. Rules: render blocks in the bundle's order; unknown types are skipped; `SUPPORTED_BLOCKS` (sent in `caps`) must list exactly what you can draw; every block honours `BlockStyle`, `VisibilityRules`, `Action` (product, collection, category, page, external URL, cart, and so on, mapped to real routes; never `javascript:` and no open redirects) and `MediaRef` (`mediaId` resolved through `bundle.media`, `alt` or decorative, `focal` point as `object-position`, video poster, reduced motion shows the poster). Product blocks use `resolved.productIds` and the live catalogue (`src/lib/catalog.tsx`), hide out-of-stock items as the schema says, and prices come from the API in paise (format with `Intl`; never hard-code rupee amounts or GST text; use the `{{store.*}}` variables the server already substitutes).

**W2. Tokens, navigation, chrome.** Apply `bundle.tokens` (design system: colour roles, palette, gradients, type families and scale, radii, shadows, motion easings, surfaces, backdrop, grain) by writing CSS custom properties on `:root` at runtime, with today's built-in values as defaults so a missing or failed bundle changes nothing. Apply `bundle.navigation` (`links`, `footerColumns`, `cart.label`) to `Nav.tsx` and `Footer.tsx`, and `bundle.chrome` (`brand.wordmark/mark`, `veil` intro, `effects` grain/cursor/smoothScroll, `seoDefaults.titleTemplate/description`, `footer` copy, brand `slots` media). Font families may reference uploaded font media (`mediaId`) through `@font-face`; always keep the fallback stack; avoid layout shift (`font-display: swap`, preload).

**W3. All pages from the bundle.** `pages.home|shop|product|ritual|story` supply blocks. `pages["custom:<slug>"]` must be served at **`/custom/<slug>`** (add the route; 404 when the bundle lacks it; the dashboard's "New custom page" form tells operators the page lives at `/custom/...`). `pages["product:<slug>"]` overrides the product template for that product. The `product` page's `nativeSections` list (`key`, `visible`) toggles the native sections of `ProductDetail`. Per-page `seo` sets `<title>`, meta description, canonical, Open Graph and Twitter tags, plus JSON-LD (`Product` on product pages, `Organization` on home). Titles must be unique per page.

**W4. Preview that works inside the dashboard.** The dashboard's Studio "Preview" tab frames `https://<site>/<path>?jw_preview=<token>` in an iframe (sandbox `allow-scripts allow-same-origin allow-forms allow-popups`). Make sure: `?jw_preview` works on every page and survives client-side navigation (carry the token); preview responses are never cached (service worker, CDN); a preview shows a small "Draft preview" ribbon; the site **allows framing only by the dashboard origin** (`Content-Security-Policy: frame-ancestors <DASHBOARD_PUBLIC_ORIGIN>` on preview responses, no `X-Frame-Options: DENY` there, and `frame-ancestors 'none'` for normal responses). The dashboard already allows `frame-src` for the storefront origin.

**W5. Caching, fallback, resilience.** Use `ETag`/`If-None-Match`; refresh on focus/visibility and at most every 60 s; keep the last good bundle in memory (and `sessionStorage` for instant repeat loads); never block first paint on the bundle (render built-in content, then swap without layout shift, or prerender home with the last published bundle at build/edge time if you adopt that); `enabled:false` (kill switch) or a network error means the built-in design; a malformed block must not break the page (an error boundary per block).

**W6. Commerce correctness (do not regress).** Cart, checkout (COD and prepaid), orders and auth dialogs use the public API; show the store-pause banner and `checkoutOpen` state from `GET /v1/store-settings`; totals come from the server quote, never computed client-side; handle `429`/`503` gracefully.

**W7. Production.** `VITE_API_ORIGIN=https://<api-domain>`; strict CSP (no inline scripts; `connect-src` only to the API origin; `img-src`/`media-src` to the API and media origin); HTTPS and HSTS at the host; `robots.txt` and sitemap (exclude drafts; `noindex` when `jw_preview` is present); performance budget (Lighthouse mobile at least 90 performance and 100 accessibility, best-practices and SEO on home, shop and product); image `srcset` from `media.variants`; lazy video; reduced motion respected; keyboard and screen-reader support (landmarks, focus management in the cart drawer and auth dialog, alt text).

**W8. Tests.** Unit tests for the bundle-to-block mapping per block type, using fixtures built from `jimmy&wax_dashboard/docs/backend-contract/blocks.schema.json`; Playwright end-to-end against a locally published bundle; at the end run the dashboard's `studio-to-website.local.spec.ts` and `studio-preview-live.local.spec.ts` (section 0b). `npm run build` (`tsc -b && vite build`) must pass.

## 3. Acceptance
1. All 21 block types render from a bundle, with one fixture and test per block; unknown types are skipped.
2. Changing tokens, navigation, chrome, SEO and each page in the Studio and publishing changes the live site; rollback and the kill switch revert it (prove with screenshots and the dashboard e2e spec).
3. Preview works inside the dashboard frame on every page; normal pages cannot be framed by anyone else.
4. `/custom/<slug>` and `product:<slug>` pages work; unknown slugs return 404.
5. Lighthouse and accessibility targets met; no console errors; the build passes.
6. Nothing in the repo contains secrets; production environment variables are documented.
