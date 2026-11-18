import type { LocalDate } from './time';

export interface ScheduledLike {
  localDate: LocalDate;
  status: 'planned' | 'completed' | 'skipped' | 'cancelled';
}

export interface Adherence {
  /** Eligible scheduled workouts in the range: everything except cancelled. A rescheduled workout counts in the week it moved to. */
  eligible: number;
  completed: number;
  state: 'unscheduled' | 'in_progress' | 'complete';
}

export function adherence(scheduled: ScheduledLike[], from: LocalDate, to: LocalDate): Adherence {
  const inRange = scheduled.filter((s) => s.localDate >= from && s.localDate <= to && s.status !== 'cancelled');
  const completed = inRange.filter((s) => s.status === 'completed').length;
  return {
    eligible: inRange.length,
    completed,
    state: inRange.length === 0 ? 'unscheduled' : completed >= inRange.length ? 'complete' : 'in_progress',
  };
}

export interface DailyItem {
  key: 'workout' | 'water' | 'sleep' | 'checkin';
  done: boolean;
}

export interface DailyInput {
  workout: { scheduled: boolean; completed: boolean } | null;
  water: { enabled: boolean; goalMl: number | null; totalMl: number };
  sleep: { enabled: boolean; goalMin: number | null; minutes: number | null };
  checkin: { due: boolean; done: boolean };
}

/**
 * Daily count such as "2 of 3 complete". Only enabled, scheduled actions with
 * a measurable criterion are scored: a rest day adds nothing, and a tracker
 * without a user-set goal is shown but not scored.
 */
export function dailyProgress(i: DailyInput): { items: DailyItem[]; done: number; total: number } {
  const items: DailyItem[] = [];
  if (i.workout?.scheduled) items.push({ key: 'workout', done: i.workout.completed });
  if (i.water.enabled && i.water.goalMl) items.push({ key: 'water', done: i.water.totalMl >= i.water.goalMl });
  if (i.sleep.enabled && i.sleep.goalMin) items.push({ key: 'sleep', done: i.sleep.minutes != null && i.sleep.minutes >= i.sleep.goalMin });
  if (i.checkin.due) items.push({ key: 'checkin', done: i.checkin.done });
  return { items, done: items.filter((x) => x.done).length, total: items.length };
}

export interface ReviewInput {
  adherence: Adherence;
  /** Planned workouts still open in the reviewed week. */
  remainingPlanned: number;
  prCount: number;
  sleepLoggedDays: number;
  waterLoggedDays: number;
  nutritionLoggedDays: number;
  trackers: { sleep: boolean; water: boolean; nutrition: boolean };
  daysElapsed: number;
  hasProgressionReady: boolean;
  soreness: number | null;
}

export type NextActionCode =
  | 'schedule_week'
  | 'ease_in'
  | 'finish_planned'
  | 'review_progression'
  | 'log_sleep'
  | 'log_water'
  | 'log_meals'
  | 'keep_going';

/** One explainable next step chosen from recorded data, in a fixed priority order. */
export function nextAction(r: ReviewInput): { code: NextActionCode; evidence: Record<string, number> } {
  if (r.adherence.eligible === 0) return { code: 'schedule_week', evidence: {} };
  if (r.soreness != null && r.soreness >= 4) return { code: 'ease_in', evidence: { soreness: r.soreness } };
  if (r.remainingPlanned > 0) return { code: 'finish_planned', evidence: { remaining: r.remainingPlanned, completed: r.adherence.completed, eligible: r.adherence.eligible } };
  if (r.hasProgressionReady) return { code: 'review_progression', evidence: {} };
  const low = (n: number) => n < Math.ceil(r.daysElapsed / 2);
  if (r.trackers.sleep && low(r.sleepLoggedDays)) return { code: 'log_sleep', evidence: { logged: r.sleepLoggedDays, days: r.daysElapsed } };
  if (r.trackers.water && low(r.waterLoggedDays)) return { code: 'log_water', evidence: { logged: r.waterLoggedDays, days: r.daysElapsed } };
  if (r.trackers.nutrition && low(r.nutritionLoggedDays)) return { code: 'log_meals', evidence: { logged: r.nutritionLoggedDays, days: r.daysElapsed } };
  return { code: 'keep_going', evidence: { completed: r.adherence.completed, eligible: r.adherence.eligible } };
}

/** Body-weight trend: simple exponentially smoothed series, only over logged days. */
export function smoothedTrend(points: { date: LocalDate; value: number }[], alpha = 0.25): { date: LocalDate; value: number }[] {
  const out: { date: LocalDate; value: number }[] = [];
  let prev: number | null = null;
  for (const p of [...points].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    prev = prev == null ? p.value : prev + alpha * (p.value - prev);
    out.push({ date: p.date, value: prev });
  }
  return out;
}
