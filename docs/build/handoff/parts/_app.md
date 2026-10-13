# SESSION PROMPT: MOBILE APP (`jimmy&wax_app`, Flutter)

You are the **app** session. Goal: make the app render everything the operator publishes from the dashboard's Experience Studio (app channel), keep today's hand-tuned design as the fallback, and make the app production-ready for Android and iOS.

__SHARED__

## 1. Current state (verified)
- Flutter app; almost all UI lives in `lib/main.dart` (about 6,700 lines; `HomeScreen` near line 879, `HeroBanner` ~1333, `_HeroCampaign` ~1538, `CategoryShortcutStrip` ~4930, `BenefitsRow` ~5491), plus `lib/features/{auth,catalog,checkout,home,location,mascot,product_details,startup}`, `lib/core/data/*`, `lib/app/config/app_config.dart`.
- `lib/core/data/experience.dart` parses the published bundle into `ExperienceBundle` and keeps the **home** blocks this build can draw (`supportedBlocks` = hero_carousel, category_shortcuts, product_rail, benefits_row, testimonials, care_ritual, announcement_bar). Covered by `test/live_bundle_parse_test.dart` (fixture `test/fixtures/live_app_bundle.json`).
- **New (added by the dashboard session):** `lib/core/data/experience_repository.dart` fetches the bundle (`GET /v1/experience/app` with `x-jw-client: app/<version>; platform=<p>; caps=<supported>`, ETag and `If-None-Match`, last-good on failure, `null` means built-in design) or the draft from `/v1/experience/app/preview?token=` when given a preview token. `AppConfig.experiencePreviewToken` reads `--dart-define=EXPERIENCE_PREVIEW_TOKEN=...`. Seven tests in `test/experience_repository_test.dart`; plan in `docs/EXPERIENCE_ADAPTER_PLAN.md`.
- **Nothing calls the repository yet: the app still always draws its built-in design.** Publishing in the dashboard does not change the app until you finish the work below.
- Tests run only through a junction without `&` in its path: `New-Item -ItemType Junction -Path C:\jwapp2 -Target 'C:\Users\MSI\OneDrive\Desktop\jimmy&wax_app'; cd C:\jwapp2; flutter test`. `flutter analyze` is clean for the new files.

## 2. Tasks (in this order; commit after each; verify visually on an emulator or device because the home screen is hand-tuned)
**A1. Wire the bundle into the app.** Create the repository in `main()` from `AppConfig` (live mode in all builds; preview token only in non-production builds; **refuse a preview token when `APP_ENV=production`**); fetch at start-up in the background without blocking the splash; hold the `ExperienceBundle?` in `StoreRuntime` (a `ValueNotifier`); refresh on app resume (at most every 60 s, conditional GET); persist the last good bundle to disk (for example `shared_preferences` or a file) so cold starts and offline show the last published design instantly; `null`, an error or `enabled:false` (kill switch) means exactly today's screen.

**A2. Render the home blocks.** Make `HomeScreen` iterate `bundle.home` in order and draw each supported block with the existing widgets, falling back to the built-in section when the bundle is null:

| Block | Draw with | Data |
|---|---|---|
| `app.hero_carousel` | `HeroBanner` / `_HeroCampaign` | slides: image (`mediaOf`), headline, subhead, action |
| `app.category_shortcuts` | `CategoryShortcutStrip` | categories and images (built-in image if none) |
| `app.product_rail` | the Best Sellers rail | `ExpBlock.productIds` already resolved server-side |
| `app.benefits_row` | `BenefitsRow` | icon and label items |
| `app.testimonials` | `features/home/testimonial_section.dart` | ids resolved through `bundle.testimonials` |
| `app.care_ritual` | `features/home/care_ritual_section.dart` | ids resolved through `bundle.careGuides` |
| `app.announcement_bar` | new thin bar above the search field | `bundle.announcements` |

Then add the remaining app block types to `supportedBlocks` and implement them: `app.promo_cards, app.banner, app.rich_text, app.faq, app.trust_strip, app.spacer` (props in `blocks.schema.json`). Rules: the server never sends held-back types, but skip unknown types defensively; honour `Action` (product, category, collection, page/screen, external URL through `url_launcher`, https only) with real navigation; `MediaRef` (`mediaId` resolved through `bundle.media`; `bundledKey` is an asset shipped in the app, otherwise a cached network image with a placeholder; `semanticLabel` is the alt text, or excluded when decorative; focal point becomes `Alignment`); `VisibilityRules`; `BlockStyle`; copy may contain only server-substituted variables (no client-side price or GST text).

**A3. Other pages, navigation, chrome, tokens.**
 - `pages.category`, `pages.product`, `pages.cart`: blocks above and below the native content (same block renderer) and `nativeSections` visibility on the product page.
 - `bundle.navigation`: `bottomTabs` (3 to 5 tabs: key, label, icon, visible, action) and `profileMenu` (sections account, help, legal, custom).
 - `bundle.chrome`: `header.showDeliverTo`, `header.searchPlaceholder`, `splash.wordmark`, `storePausedMessage`, `help` (`faqGroupId`, `supportEmail`, `supportPhone`, `whatsapp`), brand `slots` media.
 - `bundle.tokens`: map colour roles, type, radii and motion onto `AppColors` and the theme **only where a token exists**, with today's values as defaults; contrast must stay accessible (the dashboard warns operators, but still clamp unreadable combinations).

**A4. Store state and version policy.** Show the store pause and closed-checkout state from `GET /v1/store-settings` (`ordersPaused`, `pauseMessage`, `checkoutOpen`). Implement the **app version policy** (force update or soft update) using the backend's public endpoint (ask the backend session if it is missing; the dashboard edits it under Settings, Platform, App versions): a blocking "Update required" screen and a dismissible "Update available" banner.

**A5. Production readiness.** `--dart-define=API_ORIGIN=https://<api-domain>` (https enforced outside development) and `APP_ENV=production`; no preview catalogue (`ENABLE_PREVIEW_CATALOG`) and no preview token in release builds (assert in `AppConfig.resolve` and test it). Android: package id, signing via a local `key.properties` that is never committed, `minSdk`, R8 and proguard, Play Data-safety answers, deep links. iOS: bundle id, signing, ATS, privacy manifest. Permission strings only for features used (location is the optional "deliver to"). Crash reporting and analytics only with the owner's consent and a privacy-policy link. Accessibility (TalkBack and VoiceOver labels, 200% text scale, contrast), performance (cold start, image caching, no jank on the home scroll), offline behaviour, secure token storage (already `flutter_secure_storage`).

**A6. Tests.** Widget tests per block with fixtures at 360x800 and 411x914 and text scale 1.0 and 1.3; repository tests (present); integration test: a published bundle changes the home order and copy; the kill switch gives the built-in design; an offline cold start shows the last good bundle. Add a debug-only way to point the app at a preview token and show the release number. Keep `flutter analyze` and `flutter test` (through the junction) green. **Verify visually** on an emulator for: the built-in fallback, a bundle with every block, a long-text bundle and a small phone; attach screenshots to your report.

## 3. Acceptance
1. A release published from the dashboard changes the app home (order, copy, images, announcement) within one refresh; rollback and the kill switch revert it.
2. Draft preview works: dashboard Studio, App, Preview, run the printed `flutter run --dart-define=...EXPERIENCE_PREVIEW_TOKEN=...` command and see the draft.
3. All 13 app block types render; unknown types are skipped; null, offline or malformed bundles never crash or blank the screen.
4. A release build refuses preview tokens and non-https APIs; no secrets in the repo; analyzer and tests green; screenshots attached.
