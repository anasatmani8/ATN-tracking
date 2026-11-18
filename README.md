# Kinset

> **New here? Publishing the app for the first time? Read [`docs/START-HERE.md`](docs/START-HERE.md)** — a step-by-step guide from this repository to the App Store and Google Play.

A fitness log for adults who train on their own: today's plan, fast set logging, meals, water, sleep, body metrics and a weekly review. It works fully offline with no account. Optional account sync backs data up and keeps devices in step.

"Kinset" is a working name. Display name, identifiers, colours, support email and policy URLs are configurable (see [Configuration](#configuration)).

- Expo SDK 58 · React Native 0.88 · TypeScript (strict) · Expo Router
- SQLite on device (`expo-sqlite`), auth tokens in the platform keystore (`expo-secure-store`)
- Optional Supabase Auth + Postgres for sync, with row-level security

Status, verification evidence and open items: [`docs/build-status.md`](docs/build-status.md).

## Quick start (no cloud keys needed)

```bash
npm ci
npm run web                 # browser preview at http://localhost:8081
npx expo run:android        # development build on an emulator/device (Android SDK required)
npx expo run:ios            # development build on a simulator/device (macOS + Xcode required)
```

Native modules (SQLite, camera, notifications, secure store) mean Expo Go is not enough on devices; use a development build (`npx expo run:*` locally, or `eas build --profile development`).

Demo data: on the last onboarding step, or in Profile → "Explore with sample data". Demo data lives in its own database and never mixes with your own entries.

## Checks

| Command | What it runs |
| --- | --- |
| `npm run typecheck` | `tsc --noEmit` in strict mode |
| `npm run lint` | ESLint (Expo config, React Compiler rules) |
| `npm test` | Domain rules and SQLite repositories (Jest, `better-sqlite3`) |
| `npm run test:server` | Starts a throwaway Postgres, applies the sync migration, runs RLS / authorization / two-device sync tests |
| `npm run export:web && npm run e2e` | Builds the web bundle and runs the Playwright acceptance scenarios against it |
| `npm run check` | typecheck + lint + unit + server tests |

`test:server` needs PostgreSQL 14+ binaries (`initdb`, `postgres`) on the machine. In CI a Postgres service container is used (see `.github/workflows/ci.yml`).

The e2e suite uses Playwright's Chromium. If your environment has a preinstalled Chromium, point to it with `PW_CHROMIUM_PATH=/path/to/chromium`.

## Project layout

```
src/
  app/            Expo Router routes only (tabs, workout, nutrition, recovery, progress, settings)
  screens/        Screen-private components (set editor, portion form, progression card)
  components/     Shared UI: tokens-driven primitives, chart, exercise picker, feedback (dialogs/toasts)
  domain/         Pure rules: time zones/DST, units, workout totals, records, progression, nutrition, sleep, review
  data/           SQLite schema + migrations, write store with outbox, repositories, catalogs, export, barcode provider
  sync/           Sync engine (push/pull), guest-data attach, Supabase client and transport
  state/          App provider (partitions, prefs, sync triggers), live queries, reminders, loaders
  theme/          Design tokens (colour palettes, type ramp, spacing, radii, elevation)
  i18n/           Externalized strings (English) and locale-aware formatting
supabase/
  migrations/     Postgres schema, RLS policies and sync RPCs
  functions/      delete-account Edge Function
  tests/          Local auth stub used only by the server tests
e2e/              Playwright acceptance scenarios (web build)
docs/             Architecture, status, release checklist, privacy inputs, store listing, screenshots
```

Architecture and data contracts: [`docs/architecture.md`](docs/architecture.md).

## Configuration

App name, identifiers, support email and policy links live in **`app.settings.json`** (editable on github.com; used by cloud builds). For local experiments, `.env.local` (see `.env.example`) can override the same values. Nothing in either is secret.

| Variable | Purpose |
| --- | --- |
| `APP_NAME`, `APP_SLUG`, `APP_SCHEME` | Display name, slug, deep-link scheme |
| `IOS_BUNDLE_ID`, `ANDROID_PACKAGE` | Store identifiers (preview/dev builds get `.preview` / `.dev` suffixes) |
| `SUPPORT_EMAIL`, `PRIVACY_URL`, `TERMS_URL`, `ACCOUNT_DELETION_URL` | Shown in Profile → About; required for store submission |
| `EAS_PROJECT_ID` | Set after `eas init` |
| `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Enables accounts and sync. Leave empty for a local-only build (account UI is hidden) |
| `EXPO_PUBLIC_BARCODE_PROVIDER` | `off` (default) or `openfoodfacts` after the publisher has reviewed licence, attribution, limits and privacy |
| `APP_VARIANT` | `development`, `preview` or `production` (set by the EAS profiles) |

Brand colours and type live in `src/theme/index.ts`; the icon is rendered from `assets/brand/mark.svg` with `npm run icons`.

## Cloud sync (optional)

See [`supabase/README.md`](supabase/README.md) for creating a project, applying the migration, deploying the account-deletion function and pointing the app at it.

## Builds

EAS profiles are in `eas.json`:

| Profile | Use |
| --- | --- |
| `development` / `development-simulator` | Dev client for devices / iOS simulator |
| `preview` | Internal distribution (APK, ad-hoc iOS) for testers |
| `production` | Store builds (AAB, App Store), auto-incremented build numbers |

```bash
npx eas-cli@latest login
npx eas-cli@latest init                       # writes the project id; put it in EAS_PROJECT_ID
npx eas-cli@latest build --profile preview --platform all
npx eas-cli@latest build --profile production --platform all
npx eas-cli@latest submit --profile production --platform ios      # TestFlight
npx eas-cli@latest submit --profile production --platform android  # Play internal track (draft)
```

Signing credentials, store accounts and listing approval belong to the publisher; see [`docs/release-checklist.md`](docs/release-checklist.md). Do not submit to a store without that sign-off.

## Support and release

- Release steps, gates and the per-platform scope checklist: [`docs/release-checklist.md`](docs/release-checklist.md)
- Privacy and data-safety inputs: [`docs/privacy-and-data-safety.md`](docs/privacy-and-data-safety.md)
- Store copy and review notes: [`docs/store-listing.md`](docs/store-listing.md)
- Later integrations: [`docs/roadmap.md`](docs/roadmap.md)
