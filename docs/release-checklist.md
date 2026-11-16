# First-release scope checklist and release gates

Legend: **Pass (auto)** = verified by automated tests (unit/integration, server, or web e2e). **Pass (web)** = verified by driving the web build in Chromium. **Blocked** = needs an installed native build on a device, which could not be produced in the build environment (no Android SDK download, no macOS, no signing credentials). **Not built** = not implemented in this release. Device columns must be filled in by the person who installs the release candidate.

| Feature | Automated / web evidence | iOS device | Android device |
| --- | --- | --- | --- |
| Guest first run, onboarding (every step skippable, plan suggestion with reason, blank plan, no plan, tracker choice) | Pass (web e2e) | Blocked | Blocked |
| Five labeled tabs, profile entry, persistent Resume across tabs | Pass (web e2e) | Blocked | Blocked |
| Today: date nav/backdating, workout/rest/missed/skip/move, daily count, neutral state, quick water/sleep/meal | Pass (web e2e, domain tests) | Blocked | Blocked |
| Starter programs ×5, editor (create, duplicate, reorder, add, remove, sets/reps/rest), activate on weekdays | Pass (repo tests, web) | Blocked | Blocked |
| Schedule: reschedule moves weeks, skip, cancel, deterministic ids | Pass (repo tests) | Blocked | Blocked |
| 52 reviewed exercises with equipment, pattern, input type, original cues; custom exercises | Pass (catalog in code, web) | Blocked | Blocked |
| Workout preview with sticky Start | Pass (web) | Blocked | Blocked |
| Live logger: prefill from history, one-tap set, rest timer once, elapsed timer, pause/resume, warm-up, RIR, notes, swap (session/plan), skip, add exercise/set, undo, discard, finish once | Pass (repo tests, web e2e) | Blocked | Blocked |
| Draft and timer state survive force-close | Pass (repo test with DB reopen, web e2e reload) | Blocked | Blocked |
| Survive device restart | Logic identical to force-close (timestamps) | Blocked | Blocked |
| Rest-timer local notification | Implemented (native only) | Blocked | Blocked |
| Summary: 3 metrics, records, per-exercise sets, linked schedule, edit, delete, recalculation | Pass (repo tests, web e2e) | Blocked | Blocked |
| Records: heaviest / reps at load / bodyweight reps / duration / distance, deterministic ties, re-derived after delete | Pass (domain + repo + e2e) | Blocked | Blocked |
| Progression suggestions with reasons; accept/adjust/dismiss; never automatic | Pass (domain boundaries + repo) | Blocked | Blocked |
| Units kg/lb, mL/fl oz, km/mi, cm/in; toggling leaves data intact | Pass (domain, repo, e2e) | Blocked | Blocked |
| Nutrition diary, configurable meal names, search (50 attributed staples + own foods), recent, favorites, custom foods, quick add, copy day, saved meals | Pass (repo tests, web) | Blocked | Blocked |
| Recipes with yield; snapshots unaffected by recipe/food edits | Pass (repo test, web e2e) | Blocked | Blocked |
| Meal plan counts zero until logged; log with changed portion | Pass (repo test, web e2e) | Blocked | Blocked |
| Unknown nutrients stay unknown; totals marked partial; meal-only view | Pass (domain, web) | Blocked | Blocked |
| Barcode: typed lookup, invalid code, unknown code → manual entry, debounce | Pass (domain, provider tests, web e2e) | Blocked | Blocked |
| Barcode camera scan and camera-denied path | Implemented | Blocked | Blocked |
| Live barcode provider (Open Food Facts) | Code + tests; **disabled** pending publisher review | — | — |
| Water: presets, custom, undo, history, goal optional | Pass (repo, web e2e) | Blocked | Blocked |
| Sleep: bed/wake, manual duration, awake time, time-in-bed vs sleep, naps, quality, notes, edit, wake-date attribution, DST, travel | Pass (domain DST/travel tests, repo, web e2e) | Blocked | Blocked |
| Body weight trend and measurements (optional, hideable) | Pass (web) | Blocked | Blocked |
| Reminders with quiet hours, permission requested in context, denial state, deep link with fallback | Implemented; web shows unsupported state | Blocked | Blocked |
| Progress 7/30/90, logged-day counts, sparse charts, table views, chart summaries | Pass (web) | Blocked | Blocked |
| Weekly review with explainable next action; weekly check-in | Pass (domain, web) | Blocked | Blocked |
| Settings: units, week start, increments, trackers, targets, theme, presets, meal names | Pass (web) | Blocked | Blocked |
| Export JSON + per-table CSV via share sheet, including hidden tracker data | Pass (repo test, web e2e download) | Blocked | Blocked |
| Local erase | Implemented | Blocked | Blocked |
| Demo mode separate from guest/account data | Pass (web) | Blocked | Blocked |
| Account sign-up/in, guest merge prompt, sync status, conflicts UI, sign-out choices, reauthenticated deletion | Server logic Pass (Postgres tests); app UI implemented | Blocked (needs backend + device) | Blocked |
| Sync: two devices, offline edits, duplicates, conflicts, delete-while-offline, account isolation, erased account blocks stale device | Pass (server tests on local Postgres with auth stub) | Blocked | Blocked |
| Real Supabase project end-to-end | Blocked (no project credentials) | Blocked | Blocked |
| Dark mode, large text, small/large phones | Pass (web screenshots 375/430 px, e2e overflow check at 150% text) | Blocked | Blocked |
| VoiceOver / TalkBack, switch/keyboard navigation | Labels, roles and states set; web aria verified by tests | Blocked | Blocked |
| Set/water save latency p95 ≤ 200 ms | Web headless 246 ms tap-to-visible including test-driver overhead (not a device figure) | Blocked | Blocked |
| HealthKit / Health Connect | Not built (roadmap, behind a future flag) | — | — |
| Optional share image | Not built | — | — |

## Release gates

1. `npm run check` green; `npm run export:web && npm run e2e` green (CI runs both).
2. Fresh install and upgrade from the previous build on one iPhone and one Android phone (release-like `preview` build): run the acceptance scenarios in `e2e/` by hand, plus camera scan, camera denied, reminders, notification denied, airplane mode, device restart mid-workout, VoiceOver/TalkBack, largest text, dark mode.
3. Measure set and water logging on representative phones (record device, OS, build, p95 tap-to-confirmation). Target ≤ 200 ms, no duplicates.
4. With a staging Supabase project: two physical devices, offline edits, conflict, delete-while-offline, second account isolation, export, account deletion, stale device cannot upload.
5. Publisher sign-off on privacy policy, data-safety and privacy-label answers, health apps declaration, listing copy and licences.
6. Only then submit (`eas submit`), with the publisher's explicit authorization.

## Publisher tasks (cannot be done from the repository)

| Task | Owner |
| --- | --- |
| Final app name, bundle id / package, support email, privacy policy URL, terms URL, account-deletion web page | Publisher |
| Apple Developer Program account, App Store Connect app record, signing (EAS can manage) | Publisher |
| Google Play Console account, app record, upload key / Play App Signing | Publisher |
| Expo account + `eas init` (project id) | Publisher or delegate |
| Supabase project (region, plan, backups), apply migration, deploy `delete-account`, email templates/SMTP | Publisher or delegate |
| Decide on live barcode provider after licence/privacy review | Publisher |
| Store screenshots on device sizes, review demo account (if cloud enabled) | Publisher or delegate |
| Legal review of claims, policies and licences for target markets | Publisher |
