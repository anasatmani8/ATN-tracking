# Build status

Last updated: 2026-11-16. Branch: `claude/friendly-hawking-wgaa6c`.

**Stage reached: running development app (web build, verified by automated tests). Not a release candidate.** No native iOS or Android binary has been built or installed; no store listing exists.

## Environment and assumptions

- Started from an empty repository. Scaffolded with `create-expo-app@latest` → Expo SDK 58.0.25, React Native 0.88.1, React 19.3, TypeScript 6 strict, Expo Router 58. Native module versions pinned to the SDK's `bundledNativeModules.json`; `package-lock.json` committed.
- Build container: Linux, Node 22, PostgreSQL 16 binaries, Chromium. **No Android SDK** (the download host is blocked by the network policy), **no macOS/Xcode**, **no Docker**, **no Expo/Apple/Google/Supabase credentials**. Therefore: no native compile, no device install, no real Supabase project.
- Reference screenshots were used for layout direction only (royal-blue Today header, completion count, habit rows, violet workout hero, rounded preview with sticky Start, single-exercise logger, three-stat summary). No names, logos, photos or text from them are used. Icon and mark are original (`assets/brand/mark.svg`).
- Default region assumptions: units and week start from device locale (US → imperial, Sunday start), changeable in onboarding and Profile.
- Barcode live lookups ship **disabled**; local lookups against saved foods always work.
- Baseline foods: 50 staples, rounded generic values attributed to USDA FoodData Central (public domain).

## Milestones

| # | Milestone | State |
| --- | --- | --- |
| 1 | Foundation: architecture, routes, data contracts, migrations, tokens, demo data | Done (web); native build blocked |
| 2 | Training loop: onboarding, Today, plans, preview, logger, resume, history, summary, records, progression; offline scenario | Done; verified by tests and web e2e |
| 3 | Daily logs and review: nutrition, meal plan, recipes, barcode boundary, water, sleep, body, check-ins, reminders, weekly review, export | Done; reminders/camera need device verification |
| 4 | Cloud and hardening: auth, sync, isolation, deletion, migration | Server + engine verified on local Postgres; app wiring implemented; real backend and two physical devices not verified |
| 5 | Release candidate | Not reached (blocked on device builds, credentials and publisher actions) |

## Verification evidence (this session)

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `npm run typecheck` | Pass, 0 errors |
| Lint | `npm run lint` | Pass, 0 problems |
| Unit + repository tests | `npm test` | 3 suites, 50 tests pass |
| Server RLS / authorization / sync | `npm run test:server` (Postgres 16, Supabase auth stub + real migration) | 9 tests pass |
| Web build | `npm run export:web` | Builds; single bundle, works offline after load |
| Web e2e acceptance | `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npm run e2e` | 8 tests pass (375×667, en-GB, Europe/Paris) |
| Native config | `npx expo prebuild --platform android|ios --no-install` | Generates cleanly; manifest has only CAMERA and POST_NOTIFICATIONS, removes RECORD_AUDIO/AD_ID/exact alarm, `allowBackup=false`; Info.plist has camera string only |
| Android target | `react-native/gradle/libs.versions.toml` | targetSdk 36, compileSdk 37, minSdk 24 |

Measured (web, headless Chromium, not a device): one-tap set completion to visible rest timer 246 ms including Playwright overhead.

Simulator-only/web-only evidence is labelled as such in `docs/release-checklist.md`; no physical-device evidence exists yet.

## Defects found and fixed during verification

- Completing a set straight after typing could be rejected: the blur-triggered save raced the completion. Saves per row are now serialized and `updateSet` reads inside its transaction.
- Onboarding could bounce back to itself: in-memory prefs lagged the write. `setPrefs` now resolves after state reflects it.
- Rate limiter in the barcode provider could throttle the very first lookup.
- Dumbbell records showed the pair total ("28 kg"); now shown as entered ("14 kg ×2").
- "Undo" on a set toast could edit a finished workout; undo is now limited to in-progress sessions.
- Toggle chips, radios, tabs and set checkboxes now expose `role`/`aria-*` state (was missing on web).

## Known gaps

- HealthKit / Health Connect: not built (roadmap; subsequent milestone per brief).
- Optional workout share image: not built.
- Exercise demo media: none bundled, so no media controls are shown.
- Strings are English only (externalized; date/number formatting is locale-aware).
- In-session exercise reordering uses the list sheet for navigation; reordering is in the plan editor.

## Next actions

1. Publisher: create Expo, Apple and Google accounts/app records; choose final name and identifiers; provide support email and policy URLs.
2. `npx eas-cli init`, then `eas build --profile preview --platform all`; install on one iPhone and one Android phone; walk `docs/release-checklist.md` and fill the device columns.
3. Create a staging Supabase project, apply `supabase/migrations/0001_sync.sql`, deploy `delete-account`, set `EXPO_PUBLIC_SUPABASE_*`, repeat the sync scenarios on two devices.
4. Measure set/water logging latency on representative phones; record p95.
5. Publisher review of privacy/data-safety inputs and store listing; then `eas build --profile production` and, with authorization, `eas submit` to TestFlight and the Play internal track.

## Blockers and who can resolve them

| Blocker | Resolver |
| --- | --- |
| Native builds and device installs (no Android SDK / macOS here; no EAS account) | Publisher (EAS account) or a developer machine with Android Studio / Xcode |
| Signing credentials, store accounts, TestFlight / internal testing | Publisher |
| Real backend for sync and account deletion | Publisher or delegate (Supabase project) |
| Legal: policies, data-safety answers, claims, licences | Publisher |
