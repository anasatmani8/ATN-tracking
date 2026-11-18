import type { Db } from './db';

const C = `created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER, rev INTEGER NOT NULL DEFAULT 0`;

/**
 * Forward-only migrations. Never edit a shipped entry; append a new one.
 * Synced tables share: id (client UUID), created_at/updated_at (UTC ms),
 * deleted_at (tombstone) and rev (last server revision seen, 0 = never synced).
 */
export const MIGRATIONS: string[] = [
  // v1 — base schema
  `
  CREATE TABLE prefs (id TEXT PRIMARY KEY, value TEXT NOT NULL, ${C});
  CREATE TABLE exercises (id TEXT PRIMARY KEY, name TEXT NOT NULL, equipment TEXT NOT NULL, pattern TEXT NOT NULL,
    input_type TEXT NOT NULL, load_convention TEXT NOT NULL, implement_count INTEGER NOT NULL DEFAULT 1, cues TEXT NOT NULL DEFAULT '', ${C});
  CREATE TABLE programs (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', doc TEXT NOT NULL,
    template_id TEXT, active INTEGER NOT NULL DEFAULT 0, weekdays TEXT NOT NULL DEFAULT '[]', revision INTEGER NOT NULL DEFAULT 1, ${C});
  CREATE TABLE scheduled_workouts (id TEXT PRIMARY KEY, local_date TEXT NOT NULL, program_id TEXT, day_id TEXT, title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'planned', session_id TEXT, moved_from TEXT, ${C});
  CREATE INDEX idx_sched_date ON scheduled_workouts(local_date);
  CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER,
    tz TEXT NOT NULL, local_date TEXT NOT NULL, paused_ms INTEGER NOT NULL DEFAULT 0, paused_at INTEGER, scheduled_id TEXT, program_id TEXT,
    day_id TEXT, notes TEXT NOT NULL DEFAULT '', active_exercise_id TEXT, rest_started_at INTEGER, rest_sec INTEGER, rest_exercise_id TEXT, ${C});
  CREATE INDEX idx_sessions_status ON sessions(status, started_at);
  CREATE INDEX idx_sessions_date ON sessions(local_date);
  CREATE TABLE session_exercises (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, position INTEGER NOT NULL, exercise_id TEXT NOT NULL,
    name TEXT NOT NULL, input_type TEXT NOT NULL, load_convention TEXT NOT NULL, implement_count INTEGER NOT NULL DEFAULT 1,
    equipment TEXT NOT NULL, target_sets INTEGER, rep_min INTEGER, rep_max INTEGER, target_duration_sec INTEGER, rest_sec INTEGER,
    status TEXT NOT NULL DEFAULT 'pending', replaced_exercise_id TEXT, plan_slot_id TEXT, discomfort INTEGER NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '', ${C});
  CREATE INDEX idx_sx_session ON session_exercises(session_id, position);
  CREATE INDEX idx_sx_exercise ON session_exercises(exercise_id);
  CREATE TABLE session_sets (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, session_exercise_id TEXT NOT NULL, exercise_id TEXT NOT NULL,
    position INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'working', reps INTEGER, load_kg REAL, load_mode TEXT NOT NULL DEFAULT 'external',
    duration_sec INTEGER, distance_m REAL, rir INTEGER, completed_at INTEGER, prefill_source TEXT, ${C});
  CREATE INDEX idx_sets_sx ON session_sets(session_exercise_id, position);
  CREATE INDEX idx_sets_exercise ON session_sets(exercise_id, completed_at);
  CREATE INDEX idx_sets_session ON session_sets(session_id);
  CREATE TABLE foods (id TEXT PRIMARY KEY, name TEXT NOT NULL, brand TEXT, barcode TEXT, source TEXT NOT NULL, basis TEXT NOT NULL,
    serving_g REAL, serving_ml REAL, serving_label TEXT, kcal REAL, protein_g REAL, carbs_g REAL, fat_g REAL, ${C});
  CREATE INDEX idx_foods_name ON foods(name);
  CREATE INDEX idx_foods_barcode ON foods(barcode);
  CREATE TABLE recipes (id TEXT PRIMARY KEY, name TEXT NOT NULL, servings_yield REAL NOT NULL, ingredients TEXT NOT NULL, ${C});
  CREATE TABLE saved_meals (id TEXT PRIMARY KEY, name TEXT NOT NULL, items TEXT NOT NULL, ${C});
  CREATE TABLE food_logs (id TEXT PRIMARY KEY, local_date TEXT NOT NULL, meal_slot TEXT NOT NULL, logged_at INTEGER NOT NULL, tz TEXT NOT NULL,
    name TEXT NOT NULL, source_kind TEXT NOT NULL, source_id TEXT, qty REAL NOT NULL, unit TEXT NOT NULL, snapshot TEXT NOT NULL,
    kcal REAL, protein_g REAL, carbs_g REAL, fat_g REAL, planned_meal_id TEXT, ${C});
  CREATE INDEX idx_food_logs_date ON food_logs(local_date);
  CREATE TABLE planned_meals (id TEXT PRIMARY KEY, local_date TEXT NOT NULL, meal_slot TEXT NOT NULL, name TEXT NOT NULL,
    source_kind TEXT NOT NULL, source_id TEXT, qty REAL NOT NULL, unit TEXT NOT NULL, snapshot TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'planned', log_id TEXT, ${C});
  CREATE INDEX idx_planned_date ON planned_meals(local_date);
  CREATE TABLE water_logs (id TEXT PRIMARY KEY, local_date TEXT NOT NULL, amount_ml INTEGER NOT NULL, logged_at INTEGER NOT NULL, tz TEXT NOT NULL, ${C});
  CREATE INDEX idx_water_date ON water_logs(local_date);
  CREATE TABLE sleep_logs (id TEXT PRIMARY KEY, wake_date TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'night', start_at INTEGER, end_at INTEGER,
    tz TEXT NOT NULL, manual_duration_min INTEGER, awake_min INTEGER, confirmed_asleep INTEGER NOT NULL DEFAULT 0, quality INTEGER,
    notes TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'manual', ${C});
  CREATE INDEX idx_sleep_date ON sleep_logs(wake_date);
  CREATE TABLE measurements (id TEXT PRIMARY KEY, local_date TEXT NOT NULL, kind TEXT NOT NULL, value REAL NOT NULL, measured_at INTEGER NOT NULL,
    source TEXT NOT NULL DEFAULT 'manual', ${C});
  CREATE INDEX idx_meas ON measurements(kind, local_date);
  CREATE TABLE checkins (id TEXT PRIMARY KEY, week_start TEXT NOT NULL, local_date TEXT NOT NULL, energy INTEGER, soreness INTEGER,
    notes TEXT NOT NULL DEFAULT '', ${C});
  CREATE INDEX idx_checkins_week ON checkins(week_start);
  CREATE TABLE reminders (id TEXT PRIMARY KEY, kind TEXT NOT NULL, time TEXT NOT NULL, weekdays TEXT NOT NULL DEFAULT '[0,1,2,3,4,5,6]',
    enabled INTEGER NOT NULL DEFAULT 1, ${C});
  CREATE TABLE outbox (seq INTEGER PRIMARY KEY AUTOINCREMENT, op_id TEXT NOT NULL UNIQUE, tbl TEXT NOT NULL, row_id TEXT NOT NULL,
    kind TEXT NOT NULL, base_rev INTEGER NOT NULL DEFAULT 0, payload TEXT, created_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at INTEGER NOT NULL DEFAULT 0, last_error TEXT, status TEXT NOT NULL DEFAULT 'pending');
  CREATE INDEX idx_outbox_row ON outbox(tbl, row_id);
  CREATE TABLE sync_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE conflicts (id TEXT PRIMARY KEY, tbl TEXT NOT NULL, row_id TEXT NOT NULL, local_data TEXT NOT NULL, remote_data TEXT NOT NULL,
    remote_rev INTEGER NOT NULL, created_at INTEGER NOT NULL);
  `,
  // v2 — progression decisions (accept / adjust / dismiss) so a choice survives restarts and syncs.
  `
  CREATE TABLE progression_decisions (id TEXT PRIMARY KEY, exercise_id TEXT NOT NULL, basis_key TEXT NOT NULL, decision TEXT NOT NULL,
    load_kg REAL, decided_at INTEGER NOT NULL, ${C});
  CREATE INDEX idx_prog_dec ON progression_decisions(exercise_id, decided_at);
  `,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

/** Tables replicated to the account. Everything else (outbox, sync_meta, conflicts) is device-local. */
export const SYNCED_TABLES = [
  'prefs', 'exercises', 'programs', 'scheduled_workouts', 'sessions', 'session_exercises', 'session_sets', 'foods', 'recipes',
  'saved_meals', 'food_logs', 'planned_meals', 'water_logs', 'sleep_logs', 'measurements', 'checkins', 'reminders', 'progression_decisions',
] as const;
export type SyncedTable = (typeof SYNCED_TABLES)[number];

export async function migrate(db: Db, upTo = MIGRATIONS.length): Promise<number> {
  const row = await db.first<{ user_version: number }>('PRAGMA user_version');
  const from = row?.user_version ?? 0;
  if (from > MIGRATIONS.length) throw new Error(`Database schema v${from} is newer than this build (v${MIGRATIONS.length}).`);
  for (let v = from; v < upTo; v++) {
    await db.tx(async () => {
      await db.exec(MIGRATIONS[v]);
      await db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
  return from;
}
