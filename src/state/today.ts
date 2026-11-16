import type { FoodLog } from '@/data/nutrition';
import type { Checkin, SleepLog } from '@/data/recovery';
import type { Scheduled, SessionRow } from '@/data/training';
import { sumNutrients, type NutrientTotals } from '@/domain/nutrition';
import { sleepDuration, type SleepDuration } from '@/domain/recovery';
import { dailyProgress } from '@/domain/review';
import { weekdayOf, weekStartOf, type LocalDate } from '@/domain/time';
import { logNutrients } from '@/data/nutrition';
import { toSleepEntry } from '@/data/recovery';
import type { AppCtx } from './app';

export interface DayView {
  date: LocalDate;
  scheduled: Scheduled | null;
  completedSession: SessionRow | null;
  active: SessionRow | null;
  waterMl: number;
  lastWaterId: string | null;
  night: (SleepLog & { duration: SleepDuration | null }) | null;
  napMinutes: number;
  meals: FoodLog[];
  nutrition: NutrientTotals;
  plannedMeals: number;
  checkinDue: boolean;
  checkin: Checkin | null;
  progress: ReturnType<typeof dailyProgress>;
}

/** Everything the Today screen shows for one date, read from the same tables the owning tabs use. */
export async function loadDay(app: AppCtx, date: LocalDate): Promise<DayView> {
  const { training, recovery, nutrition, prefs } = app;
  if (date >= app.today) await training.ensureSchedule(app.today);
  const sched = (await training.listScheduled(date, date)).filter((s) => s.status !== 'cancelled');
  const scheduled = sched.find((s) => s.status === 'planned') ?? sched[0] ?? null;
  const done = (await training.listHistory(50)).filter((s) => s.local_date === date);
  const completedSession = (scheduled?.session_id ? done.find((s) => s.id === scheduled.session_id) : null) ?? done[0] ?? null;
  const water = await recovery.listWater(date);
  const sleeps = await recovery.listSleep(date);
  const nightRow = [...sleeps].reverse().find((s) => s.kind === 'night') ?? null;
  const night = nightRow ? { ...nightRow, duration: sleepDuration(toSleepEntry(nightRow)) } : null;
  const napMinutes = sleeps.filter((s) => s.kind === 'nap').reduce((a, s) => a + (sleepDuration(toSleepEntry(s))?.minutes ?? 0), 0);
  const meals = await nutrition.listLogs(date);
  const planned = (await nutrition.listPlanned(date, date)).filter((p) => p.status === 'planned').length;
  const weekStart = weekStartOf(date, prefs.startOfWeek);
  const checkin = await recovery.getCheckin(weekStart);
  const checkinDue = prefs.checkinWeekday != null && weekdayOf(date) === prefs.checkinWeekday;
  const waterMl = water.reduce((a, w) => a + w.amount_ml, 0);
  const progress = dailyProgress({
    workout: scheduled ? { scheduled: scheduled.status !== 'skipped', completed: scheduled.status === 'completed' } : null,
    water: { enabled: prefs.trackers.water, goalMl: prefs.targets.waterMl, totalMl: waterMl },
    sleep: { enabled: prefs.trackers.sleep, goalMin: prefs.targets.sleepMin, minutes: night?.duration?.minutes ?? null },
    checkin: { due: checkinDue, done: !!checkin },
  });
  return {
    date, scheduled, completedSession, active: await training.getActiveSession(), waterMl, lastWaterId: water.at(-1)?.id ?? null, night, napMinutes,
    meals, nutrition: sumNutrients(meals.map(logNutrients)), plannedMeals: planned, checkinDue, checkin, progress,
  };
}

export const DAY_TABLES = ['scheduled_workouts', 'sessions', 'water_logs', 'sleep_logs', 'food_logs', 'planned_meals', 'checkins', 'prefs', 'programs'];
