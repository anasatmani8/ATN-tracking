import type { ExerciseMeta, HistorySet, SetLike } from './types';

/**
 * Total external load moved per rep, in kg, or null when the set has no
 * rated external load (pure bodyweight, assisted, or load left blank).
 */
export function externalLoadKg(set: SetLike, meta: Pick<ExerciseMeta, 'loadConvention' | 'implementCount'>): number | null {
  if (set.loadKg == null || set.loadKg <= 0) return null;
  if (set.loadMode === 'bodyweight' || set.loadMode === 'assisted') return null;
  if (meta.loadConvention === 'none') return null;
  const mult = meta.loadConvention === 'per_implement' ? Math.max(1, meta.implementCount) : 1;
  return set.loadKg * mult;
}

export const isCompletedWorking = (s: SetLike) => s.completedAt != null && s.kind === 'working';

/** reps × external load for one completed working set; 0 when excluded. */
export function setVolumeKg(set: SetLike, meta: Pick<ExerciseMeta, 'loadConvention' | 'implementCount'>): number {
  if (!isCompletedWorking(set) || !set.reps || set.reps <= 0) return 0;
  const load = externalLoadKg(set, meta);
  return load == null ? 0 : set.reps * load;
}

export interface WorkoutTotals {
  workingSets: number;
  totalReps: number;
  volumeKg: number;
  /** Working sets that could not contribute to volume (bodyweight, assisted, timed, unrated). */
  setsExcludedFromVolume: number;
}

export function workoutTotals(sets: (SetLike & Pick<ExerciseMeta, 'loadConvention' | 'implementCount'>)[]): WorkoutTotals {
  const t: WorkoutTotals = { workingSets: 0, totalReps: 0, volumeKg: 0, setsExcludedFromVolume: 0 };
  for (const s of sets) {
    if (!isCompletedWorking(s)) continue;
    t.workingSets += 1;
    t.totalReps += s.reps ?? 0;
    const v = setVolumeKg(s, s);
    if (v > 0) t.volumeKg += v;
    else t.setsExcludedFromVolume += 1;
  }
  t.volumeKg = Math.round(t.volumeKg * 1000) / 1000;
  return t;
}

export type RecordType = 'heaviest_load' | 'most_reps_at_load' | 'most_reps' | 'longest_duration' | 'longest_distance';

export interface PersonalRecord {
  exerciseId: string;
  type: RecordType;
  value: number;
  /** For most_reps_at_load: the load the reps were done at. */
  atLoadKg?: number;
  setId: string;
  sessionId: string;
  achievedAt: number;
  /** >1 when the load was entered per implement (e.g. a pair of dumbbells); value is the total. */
  implementCount: number;
}

/** Deterministic history order: completion time, then session start, then id. */
export function chronological<T extends HistorySet>(sets: T[]): T[] {
  return [...sets].sort(
    (a, b) =>
      (a.completedAt ?? 0) - (b.completedAt ?? 0) ||
      a.sessionStartedAt - b.sessionStartedAt ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

interface Candidate {
  type: RecordType;
  value: number;
  atLoadKg?: number;
  /** Records only compare within the same key (exercise + type + load bucket). */
  key: string;
}

const loadKey = (kg: number) => String(Math.round(kg * 1000));

function candidates(s: HistorySet): Candidate[] {
  if (!isCompletedWorking(s)) return [];
  const out: Candidate[] = [];
  if (s.inputType === 'weight_reps' || s.inputType === 'bodyweight_reps') {
    const load = externalLoadKg(s, s);
    const reps = s.reps ?? 0;
    if (reps <= 0) return out;
    if (load != null) {
      out.push({ type: 'heaviest_load', value: load, key: 'heaviest_load' });
      out.push({ type: 'most_reps_at_load', value: reps, atLoadKg: load, key: `reps@${loadKey(load)}` });
    } else if (s.inputType === 'bodyweight_reps' && s.loadMode === 'bodyweight') {
      out.push({ type: 'most_reps', value: reps, key: 'most_reps' });
    }
  } else {
    if (s.durationSec && s.durationSec > 0 && s.inputType === 'duration')
      out.push({ type: 'longest_duration', value: s.durationSec, key: 'longest_duration' });
    if (s.distanceM && s.distanceM > 0) out.push({ type: 'longest_distance', value: s.distanceM, key: 'longest_distance' });
  }
  return out;
}

export interface RecordAnalysis {
  /** Current holders, derived from the full history. Earliest set wins ties. */
  current: PersonalRecord[];
  /** Sets that beat every earlier comparable set at the time they were logged. */
  events: PersonalRecord[];
}

/**
 * Derive records from history. Always recomputed after edits, deletes or sync,
 * so deleting a record holder promotes the next best set automatically.
 * A first-ever value for a key is a baseline, not a PR event.
 */
export function analyzeRecords(history: HistorySet[]): RecordAnalysis {
  const best = new Map<string, PersonalRecord>();
  const events: PersonalRecord[] = [];
  for (const s of chronological(history)) {
    for (const c of candidates(s)) {
      const k = `${s.exerciseId}|${c.key}`;
      const prev = best.get(k);
      if (prev && c.value <= prev.value) continue;
      const rec: PersonalRecord = {
        exerciseId: s.exerciseId,
        type: c.type,
        value: c.value,
        atLoadKg: c.atLoadKg,
        setId: s.id,
        sessionId: s.sessionId,
        achievedAt: s.completedAt ?? s.sessionStartedAt,
        implementCount: s.loadConvention === 'per_implement' ? Math.max(1, s.implementCount) : 1,
      };
      best.set(k, rec);
      // reps-at-load only counts as an event once that load has been lifted before.
      if (prev) events.push(rec);
    }
  }
  return { current: [...best.values()], events };
}

/** The headline records for one exercise: heaviest load and most reps at that load. */
export function headlineRecords(current: PersonalRecord[], exerciseId: string): PersonalRecord[] {
  const mine = current.filter((r) => r.exerciseId === exerciseId);
  const heaviest = mine.find((r) => r.type === 'heaviest_load');
  const out: PersonalRecord[] = [];
  if (heaviest) {
    out.push(heaviest);
    const reps = mine.find((r) => r.type === 'most_reps_at_load' && r.atLoadKg != null && loadKey(r.atLoadKg) === loadKey(heaviest.value));
    if (reps) out.push(reps);
  }
  for (const t of ['most_reps', 'longest_duration', 'longest_distance'] as const) {
    const r = mine.find((x) => x.type === t);
    if (r) out.push(r);
  }
  return out;
}

/** Elapsed active time of a session derived only from persisted timestamps. */
export function elapsedMs(s: { startedAt: number; endedAt: number | null; pausedMs: number; pausedAt: number | null }, now: number): number {
  const end = s.endedAt ?? s.pausedAt ?? now;
  return Math.max(0, end - s.startedAt - s.pausedMs);
}

/** Remaining rest in ms (<= 0 when over), derived from the persisted start. */
export function restRemainingMs(restStartedAt: number | null, restSec: number | null, now: number, pausedAt: number | null): number | null {
  if (restStartedAt == null || restSec == null) return null;
  return restStartedAt + restSec * 1000 - (pausedAt ?? now);
}
