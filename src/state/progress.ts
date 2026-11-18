import { toSleepEntry } from '@/data/recovery';
import { adherence, nextAction, type NextActionCode } from '@/domain/review';
import { averageOverLoggedDays, sleepMinutesByWakeDate, sumByDay } from '@/domain/recovery';
import { addDays, dateRange, daysBetween, weekStartOf, type LocalDate } from '@/domain/time';
import { analyzeRecords, setVolumeKg, type PersonalRecord } from '@/domain/workout';
import type { AppCtx } from './app';

export async function loadProgress(app: AppCtx, rangeDays: number) {
  const { training, recovery, nutrition, prefs, today } = app;
  const from = addDays(today, -rangeDays + 1);
  const all = await training.historySets();
  const inRange = all.filter((s) => s.localDate >= from && s.localDate <= today);
  const { current, events } = analyzeRecords(all);
  const names = new Map(all.map((s) => [s.exerciseId, s.name]));
  const sessions = new Set(inRange.map((s) => s.sessionId));
  // Weekly buckets aligned to the user's week start.
  const weeks: LocalDate[] = [];
  for (let w = weekStartOf(from, prefs.startOfWeek); w <= today; w = addDays(w, 7)) weeks.push(w);
  const sessionDate = new Map(inRange.map((s) => [s.sessionId, s.localDate]));
  const perWeek = weeks.map((w) => {
    const end = addDays(w, 6);
    const ids = [...sessionDate].filter(([, d]) => d >= w && d <= end).map(([id]) => id);
    const vol = inRange.filter((s) => s.localDate >= w && s.localDate <= end).reduce((a, s) => a + setVolumeKg(s, s), 0);
    return { week: w, sessions: ids.length, volumeKg: vol };
  });
  const sched = await training.listScheduled(from, today);
  const lifts = new Map<string, { id: string; name: string; sessions: Set<string>; volumeKg: number }>();
  for (const s of inRange) {
    const l = lifts.get(s.exerciseId) ?? { id: s.exerciseId, name: s.name, sessions: new Set(), volumeKg: 0 };
    l.sessions.add(s.sessionId);
    l.volumeKg += setVolumeKg(s, s);
    lifts.set(s.exerciseId, l);
  }
  const water = await recovery.listWater(from, today);
  const sleep = await recovery.listSleep(from, today);
  const wByDay = sumByDay(water, (w) => w.amount_ml, (w) => w.local_date);
  const sByDay = sleepMinutesByWakeDate(sleep.map(toSleepEntry), prefs.sleepAvgIncludesNaps);
  const weights = await recovery.listMeasurements('weight', from, today);
  const recent = events.filter((e) => {
    const d = all.find((s) => s.id === e.setId)?.localDate;
    return d != null && d >= from;
  });
  return {
    from, sessionCount: sessions.size, perWeek,
    adherence: adherence(sched.map((s) => ({ localDate: s.local_date, status: s.status })), from, today),
    records: current.filter((r) => r.type === 'heaviest_load' || r.type === 'most_reps' || r.type === 'longest_duration').map((r) => ({ ...r, name: names.get(r.exerciseId) ?? r.exerciseId })),
    recentPrs: recent.map((r) => ({ ...r, name: names.get(r.exerciseId) ?? r.exerciseId })),
    lifts: [...lifts.values()].map((l) => ({ id: l.id, name: l.name, sessions: l.sessions.size, volumeKg: l.volumeKg })).sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name)),
    water: { byDay: wByDay, avg: averageOverLoggedDays(wByDay, rangeDays) },
    sleep: { byDay: sByDay, avg: averageOverLoggedDays(sByDay, rangeDays) },
    weights,
    nutritionDays: new Set((await nutrition.listLogs(from, today)).map((l) => l.local_date)).size,
  };
}

export interface WeeklyReview {
  weekStart: LocalDate;
  weekEnd: LocalDate;
  daysElapsed: number;
  adherence: ReturnType<typeof adherence>;
  remainingPlanned: number;
  sessions: { id: string; title: string; localDate: LocalDate }[];
  prs: (PersonalRecord & { name: string })[];
  coverage: { sleep: number; water: number; nutrition: number };
  next: { code: NextActionCode; evidence: Record<string, number> };
  checkin: Awaited<ReturnType<AppCtx['recovery']['getCheckin']>>;
}

export async function loadWeeklyReview(app: AppCtx, weekStart: LocalDate): Promise<WeeklyReview> {
  const { training, recovery, nutrition, prefs, today } = app;
  const weekEnd = addDays(weekStart, 6);
  const upTo = weekEnd < today ? weekEnd : today;
  const daysElapsed = Math.max(1, daysBetween(weekStart, upTo) + 1);
  const sched = await training.listScheduled(weekStart, weekEnd);
  const adh = adherence(sched.map((s) => ({ localDate: s.local_date, status: s.status })), weekStart, weekEnd);
  const all = await training.historySets();
  const names = new Map(all.map((s) => [s.exerciseId, s.name]));
  const weekSets = all.filter((s) => s.localDate >= weekStart && s.localDate <= weekEnd);
  const weekSessionIds = new Set(weekSets.map((s) => s.sessionId));
  const history = (await training.listHistory(200)).filter((s) => s.local_date >= weekStart && s.local_date <= weekEnd);
  const prs = analyzeRecords(all).events.filter((e) => weekSessionIds.has(e.sessionId)).map((e) => ({ ...e, name: names.get(e.exerciseId) ?? '' }));
  const days = dateRange(weekStart, upTo);
  const sleepDays = new Set((await recovery.listSleep(weekStart, upTo)).map((s) => s.wake_date)).size;
  const waterDays = new Set((await recovery.listWater(weekStart, upTo)).map((w) => w.local_date)).size;
  const nutritionDays = new Set((await nutrition.listLogs(weekStart, upTo)).map((l) => l.local_date)).size;
  const checkin = await recovery.getCheckin(weekStart);
  // Is any slot in the active plan ready for a load increase?
  let ready = false;
  const active = (await training.listPrograms()).find((p) => p.active);
  if (active && prefs.progressionEnabled) {
    for (const x of active.doc.days.flatMap((d) => d.exercises)) {
      const r = await training.progression(x.exerciseId, x.slotId, { enabled: true, incrementKg: prefs.incrementKg, minRir: prefs.minRir });
      if (r.suggestion.action === 'increase' && r.decision == null) { ready = true; break; }
    }
  }
  const remainingPlanned = sched.filter((s) => s.status === 'planned').length;
  return {
    weekStart, weekEnd, daysElapsed: days.length, adherence: adh, remainingPlanned,
    sessions: history.map((s) => ({ id: s.id, title: s.title, localDate: s.local_date })),
    prs, coverage: { sleep: sleepDays, water: waterDays, nutrition: nutritionDays }, checkin,
    next: nextAction({
      adherence: adh, remainingPlanned, prCount: prs.length, sleepLoggedDays: sleepDays, waterLoggedDays: waterDays, nutritionLoggedDays: nutritionDays,
      trackers: { sleep: prefs.trackers.sleep, water: prefs.trackers.water, nutrition: prefs.trackers.nutrition }, daysElapsed, hasProgressionReady: ready, soreness: checkin?.soreness ?? null,
    }),
  };
}
