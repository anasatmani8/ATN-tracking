# Privacy and data-safety inputs

Prepared from the configuration in this repository. **The publisher must review these against the shipped build, their legal entity, their backend region and the current store forms before submitting.** Requirements checked on 2026-11-16 are listed at the end; re-check them at submission time.

## What the app collects

| Data | Where it lives | Sent off device? | Purpose |
| --- | --- | --- | --- |
| Workouts, sets, plans, exercises | Device SQLite | Only to the user's own account, if signed in | App functionality |
| Food diary, meal plan, recipes, custom foods | Device SQLite | Only to own account | App functionality |
| Water, sleep, body weight/measurements, check-ins (energy, soreness, notes) | Device SQLite | Only to own account | App functionality |
| Preferences, reminders | Device SQLite (reminders scheduled locally) | Prefs to own account; reminders sync as rows, notifications are local | App functionality |
| Email address and password (hashed by the auth provider) | Supabase Auth | Yes, only if the user creates an account | Account management |
| Auth tokens | iOS Keychain / Android Keystore via SecureStore | To the backend over TLS | Authentication |
| Barcode digits | Not stored unless the user saves the food | Only if the publisher enables the Open Food Facts provider; no user id is sent | Food lookup |
| Camera frames | Not stored | No | Barcode scanning on device |
| AI coach chat: the user's messages and the summaries the coach looks up (training, plan, food totals, water, sleep, body weight) | Device SQLite (chat history is never synced) | Only when the user opens chat, is signed in and has agreed on the consent screen: to the publisher's backend, which forwards it to the configured AI provider (Anthropic or OpenAI) as a processor. The provider receives a one-way hash of the user id, never the email | App functionality (personalized coaching) |
| Coach usage counts (requests and tokens per day) | Backend | Yes, with the account | Rate limiting and abuse prevention |

Not collected: location, contacts, photos, microphone, advertising ID, device identifiers for tracking, analytics, crash reports. No third-party SDKs for ads or analytics are included. The Android build removes `RECORD_AUDIO`, `AD_ID` and exact-alarm permissions; the iOS build declares only camera usage.

Logs: the app does not write health values, notes, identifiers or tokens to console logs or any analytics. If crash reporting is added later, it must scrub these fields and be re-reviewed (see roadmap).

## Retention and deletion

- **AI coach**: chat history and the change log stay on the device. Profile → Withdraw chat consent deletes them. The backend keeps no message content, only daily counts, removed with the account. The AI provider's own retention applies to what it receives (check the provider's API data terms and your agreement; choose zero-retention options if available) and must be named in the privacy policy.

- **Guest / local data**: stays on the device until the user erases it (Profile → Privacy and data → Erase) or uninstalls. Android cloud backup is disabled (`allowBackup=false`); iOS device backups may include the app's database as part of the user's own encrypted device backup.
- **Account data**: kept until the user deletes the account. In-app deletion: Profile → Account and sync → Delete account (re-enter password; requires a sign-in in the last 10 minutes). This erases all synced rows, deletes the auth user and blocks stale devices from uploading. The local copy on the deleting device is removed.
- **External request path**: Google Play requires a web URL where users can request deletion without the app. The publisher must publish this page (`ACCOUNT_DELETION_URL`) and handle requests (e.g. via the support email) within the stated timeframe.
- **Backups**: the backend provider's backups follow its plan's retention window; state it in the privacy policy.

## Apple App Store privacy ("nutrition label") draft

If **cloud sync is enabled**:

| Category | Type | Linked to user | Used for tracking | Purpose |
| --- | --- | --- | --- | --- |
| Health & Fitness | Health; Fitness | Yes | No | App Functionality |
| Contact Info | Email Address | Yes | No | App Functionality (account) |
| User Content | Other User Content (notes) | Yes | No | App Functionality |
| Identifiers | User ID | Yes | No | App Functionality |

If the **AI coach** is enabled, also declare User Content → Other User Content (coach messages), linked to the user, purpose App Functionality. Apple's guideline 5.1.2(i) requires disclosing and getting permission before sharing personal data with third-party AI; the in-app consent screen does this and names the provider.

If **local-only** (no backend configured): "Data Not Collected".

Tracking: none. No App Tracking Transparency prompt is needed.

## Google Play Data safety draft

With cloud sync enabled:

- Data collected: Health and fitness (Health info, Fitness info), Personal info (Email address), App activity (Other user-generated content: notes), App info (none), Device IDs (none).
- Data shared with third parties: none (the backend is a processor acting for the publisher). If the AI coach is enabled, the AI provider is also a processor acting for the publisher; Google counts transfers to service providers as not "shared", but declare Health and fitness info and App activity (messages) as collected, and review this with the current form.
- Collection is optional for the user: account creation is optional; all features work without it.
- Encrypted in transit: yes (TLS).
- Users can request deletion: yes (in app and via the deletion URL).

Local-only build: no data collected or shared.

## Health apps declaration (Google Play)

- Category: fitness / activity tracking, nutrition and weight management, sleep tracking (self-reported).
- No Health Connect access in this release (read-only Health Connect is on the roadmap behind a flag). When it is added, complete the Health Connect questions in the declaration and justify each data type.
- No medical functionality. In-app disclaimers: Profile → About, Recovery screens, weekly review and the discomfort note in the logger tell users the app is a personal log and to consult a qualified professional.

## Claims review checklist for the publisher

- [ ] No medical, diagnostic or treatment claims in the listing, screenshots or onboarding.
- [ ] No sleep-stage, recovery-score or sleep-disorder inferences (the app makes none).
- [ ] Nutrition baseline attribution (USDA FoodData Central, public domain) shown in app.
- [ ] Open Food Facts attribution (ODbL) shown in app if that provider is enabled.
- [ ] Fonts: Inter (SIL OFL 1.1); icons: Ionicons (MIT).

## Requirements checked (2026-11-16)

- Google Play: new apps must target API level 36 (this build targets 36). Health apps must complete the health apps declaration and provide a privacy policy; account deletion must be available in app and via a web link.
- Apple: uploads must be built with Xcode 26 / 26-series SDKs (EAS Build's current images satisfy this; confirm the image at build time). Apps with account creation must offer in-app account deletion.

Sources: [Google Play target API](https://support.google.com/googleplay/android-developer/answer/11926878), [Play health apps declaration / Health Connect](https://support.google.com/googleplay/android-developer/answer/12991134), [Play account deletion](https://support.google.com/googleplay/android-developer/answer/13327111), [Apple SDK minimum requirements](https://developer.apple.com/news/upcoming-requirements/), [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/).
