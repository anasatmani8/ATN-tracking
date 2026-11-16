import { addDays, localDateOf, localTimeOf, offsetMs, weekStartOf, zonedToInstant, isValidDate } from './time';
import { fromKg, toKg, weightValue, parseDecimal } from './units';
import { analyzeRecords, elapsedMs, headlineRecords, restRemainingMs, setVolumeKg, workoutTotals } from './workout';
import type { HistorySet, SetLike } from './types';
import { suggestProgression, type ProgressionSession } from './progression';
import { allowedUnits, createScanDebouncer, isValidBarcode, recipeSnapshot, scaleNutrients, sumNutrients, type NutrientSnapshot } from './nutrition';
import { averageOverLoggedDays, inQuietHours, sleepDuration, sleepMinutesByWakeDate, validateSleep, wakeDateOf, type SleepEntry } from './recovery';
import { adherence, dailyProgress, nextAction } from './review';

const set = (o: Partial<SetLike> & { id: string }): SetLike => ({
  kind: 'working', reps: 10, loadKg: null, loadMode: 'external', durationSec: null, distanceM: null, rir: null, completedAt: 1000, ...o,
});
const DB = { loadConvention: 'per_implement' as const, implementCount: 2 };
const TOTAL = { loadConvention: 'total' as const, implementCount: 1 };

describe('time', () => {
  test('local date depends on zone, not device', () => {
    const ms = Date.UTC(2026, 0, 1, 2, 30); // 02:30Z
    expect(localDateOf(ms, 'America/Los_Angeles')).toBe('2025-12-31');
    expect(localDateOf(ms, 'Asia/Tokyo')).toBe('2026-01-01');
    expect(localTimeOf(ms, 'Asia/Tokyo')).toBe('11:30');
  });
  test('date arithmetic', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(weekStartOf('2026-11-18', 1)).toBe('2026-11-16'); // Wed → Mon
    expect(weekStartOf('2026-11-18', 0)).toBe('2026-11-15');
    expect(isValidDate('2026-02-30')).toBe(false);
  });
  test('spring forward: nonexistent 02:30 shifts forward', () => {
    const r = zonedToInstant('2026-03-08', '02:30', 'America/New_York');
    expect(r.kind).toBe('gap');
    expect(localTimeOf(r.ms, 'America/New_York')).toBe('03:30');
  });
  test('fall back: repeated 01:30 picks earlier by default, later on request', () => {
    const a = zonedToInstant('2026-11-01', '01:30', 'America/New_York');
    const b = zonedToInstant('2026-11-01', '01:30', 'America/New_York', 'later');
    expect(a.kind).toBe('ambiguous');
    expect(b.ms - a.ms).toBe(3600000);
    expect(offsetMs(a.ms, 'America/New_York')).toBe(-4 * 3600000);
  });
  test('exact resolution round-trips', () => {
    const r = zonedToInstant('2026-07-04', '18:45', 'Europe/Paris');
    expect(r.kind).toBe('exact');
    expect(localDateOf(r.ms, 'Europe/Paris')).toBe('2026-07-04');
    expect(localTimeOf(r.ms, 'Europe/Paris')).toBe('18:45');
  });
});

describe('units', () => {
  test('kg/lb toggle twice leaves canonical value intact', () => {
    const kg = 22.5;
    const shownLb = weightValue(kg, 'lb');
    const shownKg = weightValue(kg, 'kg');
    expect(shownKg).toBe('22.5');
    expect(shownLb).toBe('49.6');
    expect(kg).toBe(22.5);
  });
  test('lb input round-trips through canonical kg', () => {
    for (const lb of [45, 2.5, 135, 0.25, 227.5]) expect(Math.round(fromKg(toKg(lb, 'lb'), 'lb') * 100) / 100).toBe(lb);
  });
  test('decimal parsing accepts comma and rejects junk', () => {
    expect(parseDecimal('12,5')).toBe(12.5);
    expect(parseDecimal('')).toBeNull();
    expect(parseDecimal('-3')).toBeNull();
    expect(parseDecimal('1e3')).toBeNull();
  });
});

describe('workout totals', () => {
  test('two 12 kg dumbbells × 10 = 240 kg', () => {
    expect(setVolumeKg(set({ id: 'a', loadKg: 12 }), DB)).toBe(240);
  });
  test('22 kg total load × 10 = 220 kg', () => {
    expect(setVolumeKg(set({ id: 'a', loadKg: 22 }), TOTAL)).toBe(220);
  });
  test('warm-ups, bodyweight, assisted, unrated and timed sets are excluded from volume but counted', () => {
    const t = workoutTotals([
      { ...set({ id: '1', loadKg: 12 }), ...DB },
      { ...set({ id: '2', loadKg: 12, kind: 'warmup' }), ...DB },
      { ...set({ id: '3', loadMode: 'bodyweight', reps: 8 }), loadConvention: 'bodyweight', implementCount: 1 },
      { ...set({ id: '4', loadMode: 'assisted', loadKg: 20, reps: 6 }), loadConvention: 'bodyweight', implementCount: 1 },
      { ...set({ id: '5', loadMode: 'added', loadKg: 10, reps: 5 }), loadConvention: 'bodyweight', implementCount: 1 },
      { ...set({ id: '6', reps: null, durationSec: 60 }), loadConvention: 'none', implementCount: 1 },
      { ...set({ id: '7', loadKg: 50, completedAt: null }), ...TOTAL },
    ]);
    expect(t.workingSets).toBe(5);
    expect(t.totalReps).toBe(10 + 8 + 6 + 5);
    expect(t.volumeKg).toBe(240 + 50);
    expect(t.setsExcludedFromVolume).toBe(3);
  });
  test('timers derive from persisted timestamps', () => {
    expect(elapsedMs({ startedAt: 1000, endedAt: null, pausedMs: 500, pausedAt: null }, 5000)).toBe(3500);
    expect(elapsedMs({ startedAt: 1000, endedAt: null, pausedMs: 500, pausedAt: 3000 }, 9000)).toBe(1500);
    expect(restRemainingMs(10_000, 90, 40_000, null)).toBe(60_000);
    expect(restRemainingMs(null, 90, 0, null)).toBeNull();
  });
});

const hs = (o: Partial<HistorySet> & { id: string; sessionId: string }): HistorySet => ({
  ...set(o), exerciseId: 'bench', inputType: 'weight_reps', ...TOTAL, sessionStartedAt: o.completedAt ?? 0, ...o,
});

describe('personal records', () => {
  const history = [
    hs({ id: 's1', sessionId: 'A', loadKg: 60, reps: 8, completedAt: 100 }),
    hs({ id: 's2', sessionId: 'B', loadKg: 65, reps: 6, completedAt: 200 }),
    hs({ id: 's3', sessionId: 'C', loadKg: 70, reps: 5, completedAt: 300 }),
    hs({ id: 's4', sessionId: 'D', loadKg: 70, reps: 5, completedAt: 400 }), // tie → earliest keeps it
    hs({ id: 's5', sessionId: 'D', loadKg: 70, reps: 7, completedAt: 410 }),
    hs({ id: 'w', sessionId: 'D', loadKg: 100, reps: 1, kind: 'warmup', completedAt: 405 }),
  ];
  test('heaviest load and most reps at that load, with deterministic ties', () => {
    const { current, events } = analyzeRecords(history);
    const head = headlineRecords(current, 'bench');
    expect(head[0]).toMatchObject({ type: 'heaviest_load', value: 70, setId: 's3' });
    expect(head[1]).toMatchObject({ type: 'most_reps_at_load', value: 7, atLoadKg: 70, setId: 's5' });
    expect(events.map((e) => `${e.type}:${e.setId}`)).toEqual(['heaviest_load:s2', 'heaviest_load:s3', 'most_reps_at_load:s5']);
  });
  test('deleting the record holder promotes the replacement', () => {
    const { current } = analyzeRecords(history.filter((s) => s.sessionId !== 'C' && s.sessionId !== 'D'));
    expect(headlineRecords(current, 'bench')[0]).toMatchObject({ value: 65, setId: 's2' });
  });
  test('like-for-like: exercises and performance types never mix', () => {
    const { current } = analyzeRecords([
      ...history,
      hs({ id: 'p1', sessionId: 'E', exerciseId: 'pullup', inputType: 'bodyweight_reps', loadConvention: 'bodyweight', loadMode: 'bodyweight', reps: 12, completedAt: 500 }),
      hs({ id: 'p2', sessionId: 'E', exerciseId: 'pullup', inputType: 'bodyweight_reps', loadConvention: 'bodyweight', loadMode: 'added', loadKg: 10, reps: 5, completedAt: 510 }),
      hs({ id: 'pl', sessionId: 'E', exerciseId: 'plank', inputType: 'duration', loadConvention: 'none', reps: null, durationSec: 90, completedAt: 520 }),
    ]);
    expect(headlineRecords(current, 'pullup').map((r) => [r.type, r.value])).toEqual([
      ['heaviest_load', 10], ['most_reps_at_load', 5], ['most_reps', 12],
    ]);
    expect(headlineRecords(current, 'plank')).toMatchObject([{ type: 'longest_duration', value: 90 }]);
    expect(headlineRecords(current, 'bench')[0].value).toBe(70);
  });
});

describe('progression', () => {
  const cfg = { enabled: true, incrementKg: 2.5, minRir: 2 };
  const sess = (id: string, startedAt: number, sets: Partial<SetLike>[], o: Partial<ProgressionSession> = {}): ProgressionSession => ({
    sessionId: id, startedAt, exerciseId: 'bench', repMin: 8, repMax: 10, discomfort: false,
    sets: sets.map((s, i) => set({ id: `${id}${i}`, loadKg: 60, reps: 10, rir: 2, ...s })), ...o,
  });
  const good = [{}, {}, {}];
  test('two qualifying sessions → smallest increment, never auto-applied', () => {
    const s = suggestProgression('bench', [sess('B', 2, good), sess('A', 1, good)], cfg);
    expect(s).toMatchObject({ action: 'increase', reason: 'ready', currentLoadKg: 60, suggestedLoadKg: 62.5 });
    expect(s.supporting).toHaveLength(2);
  });
  test('boundaries', () => {
    const base = sess('A', 1, good);
    const r = (b: ProgressionSession, c = cfg) => suggestProgression('bench', [b, base], c);
    expect(suggestProgression('bench', [base], cfg).reason).toBe('not_enough_history');
    expect(r(sess('B', 2, [{}, {}, { reps: 9 }]))).toMatchObject({ action: 'hold', reason: 'below_target' });
    expect(r(sess('B', 2, [{}, {}, { rir: 1 }]))).toMatchObject({ action: 'hold', reason: 'effort_high' });
    expect(r(sess('B', 2, [{}, {}, { rir: null }]))).toMatchObject({ action: 'none', reason: 'missing_effort' });
    expect(r(sess('B', 2, [{}, { loadKg: 62.5 }, {}]))).toMatchObject({ action: 'none', reason: 'load_varied' });
    expect(r(sess('B', 2, good, { repMax: 12 }))).toMatchObject({ action: 'none', reason: 'rep_range_changed' });
    expect(r(sess('B', 2, good, { exerciseId: 'db_bench' }))).toMatchObject({ action: 'none', reason: 'changed_movement' });
    expect(r(sess('B', 2, good, { discomfort: true }))).toMatchObject({ action: 'none', reason: 'discomfort' });
    expect(r(sess('B', 2, good), { ...cfg, enabled: false })).toMatchObject({ action: 'none', reason: 'disabled' });
    expect(r(sess('B', 2, [{ reps: 11, rir: 3 }, {}, {}]))).toMatchObject({ action: 'increase' });
    expect(r(sess('B', 2, [{ kind: 'warmup', reps: 3, rir: null, loadKg: 40 }, {}, {}]))).toMatchObject({ action: 'increase' });
  });
});

const food: NutrientSnapshot = { basis: 'per_100g', servingG: null, servingMl: null, servingLabel: null, kcal: 200, proteinG: 10, carbsG: null, fatG: 5, source: 'test' };

describe('nutrition', () => {
  test('150 g of 200 kcal / 10 g protein per 100 g → 300 kcal, 15 g', () => {
    expect(scaleNutrients(food, 150, 'g')).toEqual({ kcal: 300, proteinG: 15, carbsG: null, fatG: 7.5 });
  });
  test('household serving without a stated mass is never converted', () => {
    expect(allowedUnits(food)).toEqual(['g']);
    expect(scaleNutrients(food, 1, 'serving')).toBeNull();
    const cup: NutrientSnapshot = { ...food, basis: 'per_serving', servingLabel: '1 cup' };
    expect(allowedUnits(cup)).toEqual(['serving']);
    expect(scaleNutrients(cup, 100, 'g')).toBeNull();
    expect(scaleNutrients({ ...cup, servingG: 240 }, 120, 'g')?.kcal).toBe(100);
  });
  test('unknown stays unknown and marks totals partial', () => {
    const t = sumNutrients([scaleNutrients(food, 100, 'g')!, { kcal: 50, proteinG: 1, carbsG: 2, fatG: null }]);
    expect(t.kcal).toBe(250);
    expect(t.partial).toEqual({ kcal: false, proteinG: false, carbsG: true, fatG: true });
  });
  test('recipe yield', () => {
    const snap = recipeSnapshot([{ name: 'x', snapshot: { ...food, carbsG: 20 }, qty: 400, unit: 'g' }], 4)!;
    expect(snap).toMatchObject({ basis: 'per_serving', kcal: 200, proteinG: 10, carbsG: 20, fatG: 5 });
    expect(recipeSnapshot([], 4)).toBeNull();
  });
  test('barcode check digit and scan debounce', () => {
    expect(isValidBarcode('3017620422003')).toBe(true);
    expect(isValidBarcode('3017620422004')).toBe(false);
    expect(isValidBarcode('036000291452')).toBe(true);
    let now = 0;
    const d = createScanDebouncer(2000, () => now);
    expect(d.accept('1')).toBe(true);
    expect(d.accept('1')).toBe(false); // lookup in flight
    d.release();
    now = 500;
    expect(d.accept('1')).toBe(false); // same code inside window
    now = 5000;
    expect(d.accept('1')).toBe(true);
  });
});

describe('recovery', () => {
  const tz = 'Europe/Paris';
  const night = (date: string, o: Partial<SleepEntry> = {}): SleepEntry => {
    const startAt = zonedToInstant(addDays(date, -1), '23:30', tz).ms;
    const endAt = zonedToInstant(date, '07:00', tz).ms;
    return { id: date, kind: 'night', startAt, endAt, tz, manualDurationMin: null, awakeMin: null, confirmedAsleep: false, wakeDate: wakeDateOf(endAt, tz), ...o };
  };
  test('23:30 → 07:00 with 30 min awake = 7 h on the wake day', () => {
    const e = night('2026-06-10', { awakeMin: 30 });
    expect(sleepDuration(e)).toEqual({ minutes: 420, measure: 'sleep', provenance: 'derived' });
    expect(e.wakeDate).toBe('2026-06-10');
  });
  test('bare start/end is time in bed until confirmed', () => {
    expect(sleepDuration(night('2026-06-10'))?.measure).toBe('time_in_bed');
    expect(sleepDuration(night('2026-06-10', { confirmedAsleep: true }))?.measure).toBe('sleep');
    expect(sleepDuration(night('2026-06-10', { manualDurationMin: 400 }))).toMatchObject({ minutes: 400, provenance: 'manual_duration' });
  });
  test('DST nights use real elapsed time', () => {
    expect(sleepDuration(night('2026-03-29'))?.minutes).toBe(390); // spring forward: 6.5 h
    expect(sleepDuration(night('2026-10-25'))?.minutes).toBe(510); // fall back: 8.5 h
  });
  test('travel: wake date follows the zone the user woke in', () => {
    const endAt = Date.UTC(2026, 5, 10, 22, 0); // 07:00 June 11 in Tokyo
    expect(wakeDateOf(endAt, 'Asia/Tokyo')).toBe('2026-06-11');
    expect(wakeDateOf(endAt, 'America/New_York')).toBe('2026-06-10');
  });
  test('missing nights are excluded from averages; naps are opt-in', () => {
    const entries = [night('2026-06-10', { awakeMin: 30 }), night('2026-06-12', { manualDurationMin: 480 }),
      { ...night('2026-06-12'), id: 'nap', kind: 'nap' as const, manualDurationMin: 30 }];
    const noNaps = averageOverLoggedDays(sleepMinutesByWakeDate(entries, false), 7);
    expect(noNaps).toEqual({ average: 450, loggedDays: 2, rangeDays: 7 });
    expect(averageOverLoggedDays(sleepMinutesByWakeDate(entries, true), 7).average).toBe(465);
    expect(averageOverLoggedDays(new Map(), 7)).toEqual({ average: null, loggedDays: 0, rangeDays: 7 });
  });
  test('validation', () => {
    const n = night('2026-06-10');
    const now = n.endAt! + 1000;
    expect(validateSleep(n, now)).toBeNull();
    expect(validateSleep({ ...n, endAt: n.startAt }, now)).toBe('end_before_start');
    expect(validateSleep({ ...n, awakeMin: 450 }, now)).toBe('awake_exceeds');
    expect(validateSleep({ ...n, startAt: n.endAt! - 25 * 3600000 }, now)).toBe('too_long');
    expect(validateSleep({ ...n, startAt: null, endAt: null, manualDurationMin: 1500 }, now)).toBe('bad_duration');
    expect(validateSleep(n, n.endAt! - 3600000)).toBe('in_future');
  });
  test('quiet hours wrap midnight', () => {
    expect(inQuietHours('23:30', '22:00', '07:00')).toBe(true);
    expect(inQuietHours('06:59', '22:00', '07:00')).toBe(true);
    expect(inQuietHours('12:00', '22:00', '07:00')).toBe(false);
    expect(inQuietHours('12:00', null, null)).toBe(false);
  });
});

describe('review', () => {
  test('adherence denominator excludes cancelled and follows rescheduled dates', () => {
    const sched = [
      { localDate: '2026-11-16', status: 'completed' as const },
      { localDate: '2026-11-18', status: 'cancelled' as const },
      { localDate: '2026-11-20', status: 'planned' as const },
      { localDate: '2026-11-24', status: 'planned' as const }, // moved to next week
    ];
    expect(adherence(sched, '2026-11-16', '2026-11-22')).toEqual({ eligible: 2, completed: 1, state: 'in_progress' });
    expect(adherence(sched, '2026-11-23', '2026-11-29').eligible).toBe(1);
    expect(adherence([], '2026-11-16', '2026-11-22').state).toBe('unscheduled');
  });
  test('daily count only scores enabled actions with criteria', () => {
    const base = { workout: null, water: { enabled: true, goalMl: null, totalMl: 500 }, sleep: { enabled: true, goalMin: null, minutes: null }, checkin: { due: false, done: false } };
    expect(dailyProgress(base).total).toBe(0);
    const p = dailyProgress({
      workout: { scheduled: true, completed: true },
      water: { enabled: true, goalMl: 2500, totalMl: 3500 },
      sleep: { enabled: true, goalMin: 420, minutes: 400 },
      checkin: { due: false, done: false },
    });
    expect([p.done, p.total]).toEqual([2, 3]);
  });
  test('next action is explainable and neutral', () => {
    const base = { adherence: { eligible: 3, completed: 3, state: 'complete' as const }, remainingPlanned: 0, prCount: 0, sleepLoggedDays: 7, waterLoggedDays: 7, nutritionLoggedDays: 7, trackers: { sleep: true, water: true, nutrition: true }, daysElapsed: 7, hasProgressionReady: false, soreness: null };
    expect(nextAction(base).code).toBe('keep_going');
    expect(nextAction({ ...base, soreness: 5, remainingPlanned: 2 }).code).toBe('ease_in');
    expect(nextAction({ ...base, remainingPlanned: 1 }).code).toBe('finish_planned');
    expect(nextAction({ ...base, sleepLoggedDays: 1 }).code).toBe('log_sleep');
    expect(nextAction({ ...base, adherence: { eligible: 0, completed: 0, state: 'unscheduled' } }).code).toBe('schedule_week');
  });
});
