# Architecture and data contracts

## Layers and data flow

```
SQLite (durable) ──► repositories (src/data) ──► useLive() derived views ──► screens
       ▲                     │                         ▲
       │   one transaction:  ▼                         │ Store notifies changed tables
       └── row write + outbox op ── SyncEngine ◄──► Supabase RPCs (optional)
```

- **Domain** (`src/domain`) holds every calculation as pure functions: time zones and DST resolution, units, workout totals, external-load volume, records, progression, nutrition scaling, sleep duration, averages over logged days, adherence, daily progress, next action. No React, no I/O. Covered by `src/domain/domain.test.ts`.
- **Data** (`src/data`) is the only code that touches SQL. All writes go through `Store` (`store.ts`), which wraps them in a serialized transaction, writes the outbox operation in the same transaction for account partitions, and tells subscribers which tables changed after commit. Queries are parameterized; table names come from a fixed allowlist.
- **State** (`src/state`) owns the open database partition, preferences, sync triggers and live queries. `useLive(load, tables)` re-runs a loader whenever one of its tables changes, so Today, the owning tab and Progress always read the same rows.
- **Screens** render derived data and call repositories. They hold no business rules.

## Routes

| Route | Screen |
| --- | --- |
| `/(tabs)/index` | Today: date navigation, workout card (start/resume/rest/missed/skip/move), check-in, water/sleep/meals quick actions, daily count |
| `/(tabs)/train` | Week schedule, plans, starter plans, exercise library, history |
| `/(tabs)/nutrition` | Diary by meal slot with totals and partial markers, or the 7-day meal plan |
| `/(tabs)/recovery` | Water (presets, custom, entries, 7-day chart), sleep (14-night list, averages), body entry |
| `/(tabs)/progress` | 7/30/90-day training, records, lifts, recovery averages; weekly review entry |
| `/onboarding` | Goal, experience, days, equipment, units, plan choice, trackers, demo |
| `/workout/preview` | Ordered exercises with targets, sticky Start (`?scheduledId=` or `?programId=&dayId=`) |
| `/workout/active` | Live logger |
| `/workout/summary/[id]` | Recap, records, edit/delete |
| `/workout/edit/[id]`, `/workout/history` | History editing, paginated history |
| `/program/[id]`, `/program/template/[id]` | Plan editor, starter plan view |
| `/exercise`, `/exercise/[id]` | Library + custom exercise, exercise history and records |
| `/nutrition/add`, `/nutrition/entry/[id]`, `/nutrition/food`, `/nutrition/recipes`, `/nutrition/recipe/[id]`, `/nutrition/scan` | Food search and logging, entry edit / planned meal logging, custom food, recipes, barcode |
| `/recovery/sleep`, `/recovery/body` | Sleep editor, body metrics |
| `/progress/review` | Weekly review and check-in |
| `/settings`, `/settings/account`, `/settings/reminders`, `/settings/privacy` | Profile and settings |

Deep links use the `kinset://` scheme (configurable). Reminder notifications carry a route; each target screen shows a "no longer here" fallback when its entry is gone.

## Partitions

Each partition is its own SQLite file:

| File | Contents | Sync |
| --- | --- | --- |
| `kinset-guest.db` | Data created without an account | Never |
| `kinset-acct-<user id>.db` | Data for a signed-in account | Outbox → server |
| `kinset-demo.db` | Deterministic sample data, rebuilt on entry, deleted on exit | Never |

Signing in opens the account partition. If the guest partition has data, the user is asked whether to add it to the account; on yes, rows are copied and queued in one transaction (repeat-safe by id) and the guest copy is cleared. Signing out keeps the account file (queued changes upload on next sign-in) unless the user chooses to remove it. Account deletion or an `account_erased` response deletes the local account file and drops its queue.

## Tables

All synced tables share: `id TEXT` (client UUID, or a deterministic id where noted), `created_at`, `updated_at` (UTC ms), `deleted_at` (tombstone), `rev` (last server revision seen; 0 = never synced). Ownership: everything belongs to the single user of the partition; on the server every row is keyed by `user_id`.

| Table | Purpose | Notes / indexes |
| --- | --- | --- |
| `prefs` | One row per preference key (`id` = key, `value` JSON) | Per-key rows let two devices change different settings without conflict |
| `exercises` | Custom exercises | Built-in exercises are code constants (52 reviewed entries) |
| `programs` | Plans: `doc` JSON (days → slots with sets, rep range or duration, rest, alternatives), `active`, `weekdays`, `revision` | Template copies get fresh day/slot ids |
| `scheduled_workouts` | Dated occurrences: `local_date`, `day_id`, `status` planned/completed/skipped/cancelled, `session_id`, `moved_from` | id `sw_<program>_<original date>` so devices never duplicate a day; `idx_sched_date` |
| `sessions` | Workouts: `started_at`, `ended_at`, `tz`, `local_date` (start date), `paused_ms`, `paused_at`, rest timer fields, `scheduled_id`, `program_id`, `day_id` | `idx_sessions_status`, `idx_sessions_date` |
| `session_exercises` | Snapshot of the exercise as performed: name, input type, load convention, implement count, targets, `plan_slot_id`, `replaced_exercise_id`, `discomfort` | Editing a plan or exercise never rewrites these |
| `session_sets` | `kind` warmup/working, `reps`, `load_kg`, `load_mode` external/bodyweight/added/assisted, `duration_sec`, `distance_m`, `rir`, `completed_at`, `prefill_source` | `idx_sets_exercise (exercise_id, completed_at)` for history and records |
| `foods` | User foods: basis per 100 g / per 100 mL / per serving, serving mass or volume only when stated, nullable nutrients, `barcode`, `source` | `idx_foods_name`, `idx_foods_barcode` |
| `recipes` | `servings_yield`, `ingredients` JSON (each with its own nutrient snapshot) | |
| `saved_meals` | Named list of log inputs | |
| `food_logs` | Diary entries: `local_date`, `meal_slot`, `qty`, `unit`, frozen `snapshot` JSON, scaled nutrients (nullable), `planned_meal_id` | `idx_food_logs_date` |
| `planned_meals` | Meal plan items; contribute nothing until logged (`status`, `log_id`) | `idx_planned_date` |
| `water_logs` | One row per drink: `amount_ml`, `local_date`, `logged_at`, `tz` | `idx_water_date` |
| `sleep_logs` | `kind` night/nap, `start_at`/`end_at` instants and `tz`, or `manual_duration_min`, `awake_min`, `confirmed_asleep`, `quality`, `wake_date`, `source` | `idx_sleep_date` |
| `measurements` | `kind` weight/waist/hips/chest, canonical `value` (kg or m), `local_date` | `idx_meas` |
| `checkins` | One per week: id `checkin_<week start>`; energy, soreness, notes | |
| `reminders` | `kind`, `time` HH:MM, `weekdays` JSON, `enabled` | Scheduled on device only |
| `progression_decisions` | accepted / adjusted / dismissed per evidence key, with chosen load | Makes a decision stick until new sessions arrive |
| `outbox`, `sync_meta`, `conflicts` | Device-local sync bookkeeping | Never exported or synced |

Migrations are forward-only (`src/data/schema.ts`, `PRAGMA user_version`). A database newer than the build is refused rather than misread.

## Units and precision

Stored canonically: load kg (3 dp, so 0.25 lb round-trips), volume mL (integer), mass g, distance m (0.1 m), duration s, energy kcal. Unit preferences change display and input parsing only; switching never rewrites rows. Nutrient values are stored unrounded and rounded for display; unknown values stay `NULL` and make totals visibly partial ("≥").

## Time

- Instants are UTC ms. Every logged event also stores its IANA zone and the intended local date.
- Scheduled workouts store a local date only.
- A workout's calendar date is its start date in its own zone, so a session that crosses midnight stays on the day it started; plan adherence follows the linked scheduled occurrence.
- Overnight sleep is attributed to the wake date in the zone the user woke in. Times entered in a DST gap move forward to the next valid time (shown to the user); a repeated time asks which occurrence.
- Changing the device zone never moves stored dates.

## Rules (domain layer)

- **Totals**: completed working sets only. External-load volume = reps × total external load. `per_implement` exercises multiply the entered load by the implement count (two 12 kg dumbbells × 10 = 240 kg); `total` uses it as entered (22 kg × 10 = 220 kg). Warm-ups, unrated loads, bodyweight and assisted sets are excluded from volume but still count as sets and reps.
- **Records**: like-for-like by exercise and performance type: heaviest external load, most reps at a load, most bodyweight reps, longest duration, longest distance. History is replayed in a fixed order (completion time, session start, id); ties keep the earlier set; the first value is a baseline, not a record. Always re-derived after edits, deletes and sync.
- **Progression**: needs the last two comparable sessions of the same plan slot (or exercise) with the same movement, same rep range, the same load on every working set, every set at the top of the range and every set with at least the configured reps in reserve (default 2). Then it suggests the smallest configured increment. Below target or effort too high → hold. Missing history, missing effort, changed movement, discomfort or disabled → no increase. The UI shows the reason and the supporting sets; the user accepts, adjusts or dismisses. Nothing is applied automatically.
- **Nutrition**: scale from the snapshot basis; a household serving without a stated mass is never converted to grams.
- **Water**: sum of entries per diary date. **Sleep**: elapsed from instants minus awake time; a bare start/end is "time in bed" until the user confirms or enters awake time. Averages use logged days only and report the count.
- **Adherence**: eligible = scheduled occurrences in the range that are not cancelled (rescheduled ones count where they moved). Zero eligible shows an unscheduled week.

## Sync protocol

1. A local write and its outbox operation commit together. Unsent edits to the same row are coalesced; an operation that may have reached the server is never rewritten, since its `op_id` is the idempotency key. In-progress workouts are local drafts; finishing queues one `session_complete` operation carrying the session, its exercises and sets.
2. A cycle pulls, pushes in batches, then pulls again. Pull uses a per-user revision cursor. Remote rows are applied unless the row has queued local changes.
3. Server rules per row: unknown → insert; tombstoned → upsert rejected (`rejected_deleted`), delete is a no-op; delete always wins; upsert with a stale `base_rev` → `conflict` with the server copy.
4. On `conflict`, the device parks one operation and records both versions; the user chooses "keep this device" (re-sent on top of the server revision) or "keep other device". On `rejected_deleted`, the local copy and its queue are dropped.
5. Failures back off exponentially (2 s → 5 min) while preserving order. After 6 attempts the change is flagged; Today and Settings show the state. `auth` stops sync until sign-in; `erased` drops the queue and the local account copy.

Tests: `src/data/data.test.ts` (outbox atomicity, drafts stay local, migrations), `src/sync/sync.pg.test.ts` (anonymous and cross-account access, server validation, guest attach, two-device merge, lost responses and replays, interrupted batches, conflicts both ways, delete-while-offline, expired session, account erasure blocking stale devices).
