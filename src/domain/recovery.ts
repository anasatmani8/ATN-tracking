import { localDateOf, type LocalDate } from './time';

export interface SleepEntry {
  id: string;
  kind: 'night' | 'nap';
  startAt: number | null;
  endAt: number | null;
  tz: string;
  /** Explicit duration typed by the user, minutes. Wins over start/end. */
  manualDurationMin: number | null;
  awakeMin: number | null;
  /** User confirmed the start/end span was actual sleep. */
  confirmedAsleep: boolean;
  wakeDate: LocalDate;
}

export type SleepMeasure = 'sleep' | 'time_in_bed';

export interface SleepDuration {
  minutes: number;
  /** A bare start/end span is only time in bed. */
  measure: SleepMeasure;
  provenance: 'manual_duration' | 'derived';
}

export function sleepDuration(e: Pick<SleepEntry, 'startAt' | 'endAt' | 'manualDurationMin' | 'awakeMin' | 'confirmedAsleep'>): SleepDuration | null {
  if (e.manualDurationMin != null) return { minutes: e.manualDurationMin, measure: 'sleep', provenance: 'manual_duration' };
  if (e.startAt == null || e.endAt == null) return null;
  const elapsed = (e.endAt - e.startAt) / 60000;
  if (e.awakeMin != null) return { minutes: Math.max(0, elapsed - e.awakeMin), measure: 'sleep', provenance: 'derived' };
  return { minutes: elapsed, measure: e.confirmedAsleep ? 'sleep' : 'time_in_bed', provenance: 'derived' };
}

export type SleepError = 'need_times_or_duration' | 'end_before_start' | 'too_long' | 'awake_exceeds' | 'bad_duration' | 'in_future';

export function validateSleep(
  e: Pick<SleepEntry, 'startAt' | 'endAt' | 'manualDurationMin' | 'awakeMin'>,
  now: number,
): SleepError | null {
  if (e.manualDurationMin != null) {
    if (!(e.manualDurationMin > 0) || e.manualDurationMin > 24 * 60) return 'bad_duration';
    if (e.awakeMin != null && e.awakeMin < 0) return 'awake_exceeds';
    return null;
  }
  if (e.startAt == null || e.endAt == null) return 'need_times_or_duration';
  if (e.endAt <= e.startAt) return 'end_before_start';
  if (e.endAt - e.startAt > 24 * 3600000) return 'too_long';
  if (e.endAt > now + 60000) return 'in_future';
  if (e.awakeMin != null && (e.awakeMin < 0 || e.awakeMin * 60000 >= e.endAt - e.startAt)) return 'awake_exceeds';
  return null;
}

/** Overnight sleep belongs to the day the user woke up, in the zone they woke in. */
export const wakeDateOf = (endAt: number, tz: string): LocalDate => localDateOf(endAt, tz);

export interface DayAverage {
  /** null when nothing was logged in the range. */
  average: number | null;
  loggedDays: number;
  rangeDays: number;
}

/** Average over days that have a log. Unlogged days are excluded, never counted as zero. */
export function averageOverLoggedDays(perDay: Map<LocalDate, number>, rangeDays: number): DayAverage {
  const n = perDay.size;
  if (n === 0) return { average: null, loggedDays: 0, rangeDays };
  let sum = 0;
  for (const v of perDay.values()) sum += v;
  return { average: sum / n, loggedDays: n, rangeDays };
}

export function sleepMinutesByWakeDate(entries: SleepEntry[], includeNaps: boolean): Map<LocalDate, number> {
  const out = new Map<LocalDate, number>();
  for (const e of entries) {
    if (e.kind === 'nap' && !includeNaps) continue;
    const d = sleepDuration(e);
    if (!d) continue;
    out.set(e.wakeDate, (out.get(e.wakeDate) ?? 0) + d.minutes);
  }
  return out;
}

export function sumByDay<T extends { localDate: LocalDate }>(rows: T[], value: (r: T) => number): Map<LocalDate, number> {
  const out = new Map<LocalDate, number>();
  for (const r of rows) out.set(r.localDate, (out.get(r.localDate) ?? 0) + value(r));
  return out;
}

export function validateWaterMl(ml: number): boolean {
  return Number.isFinite(ml) && ml > 0 && ml <= 5000;
}

/** Is a "HH:MM" time inside a quiet window that may wrap midnight? */
export function inQuietHours(time: string, start: string | null, end: string | null): boolean {
  if (!start || !end || start === end) return false;
  return start < end ? time >= start && time < end : time >= start || time < end;
}
