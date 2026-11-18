# Roadmap (not in production navigation)

Each item stays out of release builds until it is implemented, verified on devices and its policy work is done.

| Item | Notes / prerequisites |
| --- | --- |
| Apple HealthKit (read-only: sleep, body mass) | Feature flag; entitlement + usage strings; provenance on each imported row (`source`); overlap/duplicate resolution before imported values count; disconnect with choice to purge imported copies; App Review health data rules |
| Android Health Connect (read-only: sleep, weight) | Feature flag; Health Connect declaration questions in Play health apps declaration; per-type permission rationale screen; same provenance/dedupe/purge rules |
| Live barcode provider | Code exists (`openFoodFactsProvider`) behind `EXPO_PUBLIC_BARCODE_PROVIDER`; enable after licence (ODbL) attribution review, coverage check for target markets, rate-limit plan and privacy-policy wording |
| Exercise demo media | Only cleared, accurate media; media controls appear only when a demo exists |
| Share image for workouts | Generated locally; private data opt-in |
| Wearables | After Health integrations |
| Community / chat, coach accounts | Moderation, reporting, abuse policies, separate data model |
| Progress photos | Local-first storage, excluded from backups unless opted in, explicit consent for sync |
| AI-assisted input | Privacy review, on-device vs server processing decision |
| Payments | Store billing integration, restore purchases, paywall review |
| Crash reporting | Only with scrubbing of health values, notes, identifiers and tokens, with tests |
| Additional languages | Strings are externalized in `src/i18n/en.ts`; add tables and pass to `setLocale` |
