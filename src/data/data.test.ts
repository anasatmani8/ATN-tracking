import fs from 'fs';
import os from 'os';
import path from 'path';
import { analyzeRecords, elapsedMs, headlineRecords, restRemainingMs } from '@/domain/workout';
import { adherence } from '@/domain/review';
import { fromKg } from '@/domain/units';
import { zonedToInstant } from '@/domain/time';
import { sleepDuration } from '@/domain/recovery';
import { openNodeDb } from './db.node';
import { MIGRATIONS, migrate, SYNCED_TABLES } from './schema';
import { Store } from './store';
import { Training } from './training';
import { buildExport, exportCsvFiles, toCsv } from './export';
import { DEFAULT_PREFS, loadPrefs, savePrefs } from './prefs';
import { makeEnv } from './testkit';
import type { NutrientSnapshot } from '@/domain/nutrition';

const TZ = 'Europe/Paris';
const T0 = zonedToInstant('2026-11-16', '18:00', TZ).ms; // a Monday
const MIN = 60000;

async function startHome(env: Awaited<ReturnType<typeof makeEnv>>, at = T0) {
  const pid = await env.training.createFromTemplate('tpl_home3');
  await env.training.activateProgram(pid, [1, 3, 5], '2026-11-16');
  const sched = await env.training.listScheduled('2026-11-16', '2026-11-22');
  const sid = await env.training.startSession({ scheduledId: sched[0].id }, at, TZ);
  return { pid, sched, sid };
}

describe('training loop', () => {
  test('acceptance: guest, home plan, complete prefilled set, force-close, reopen, finish once', async () => {
    const file = path.join(os.tmpdir(), `kinset-${Date.now()}.db`);
    let env = await makeEnv({ path: file });
    const { sid, sched } = await startHome(env);
    expect(sched.map((s) => s.local_date)).toEqual(['2026-11-16', '2026-11-18', '2026-11-20']);
    let d = (await env.training.getSession(sid))!;
    expect(d.exercises[0].name).toBe('Goblet Squat');
    const set = d.exercises[0].sets[0];
    expect(set).toMatchObject({ reps: 8, prefill_source: 'plan', completed_at: null });
    await env.training.updateSet(set.id, { load_kg: 12.5 });
    expect(await env.training.completeSet(set.id, T0 + 2 * MIN)).toBe(true);
    expect(await env.training.completeSet(set.id, T0 + 3 * MIN)).toBe(false); // repeat tap: no second write, timer not restarted
    await env.training.updateSet(d.exercises[0].sets[1].id, { reps: 9, load_kg: 12.5 }); // draft row

    await env.db.close(); // force-close
    env = await makeEnv({ path: file });
    const active = (await env.training.getActiveSession())!;
    expect(active.id).toBe(sid);
    d = (await env.training.getSession(sid))!;
    expect(d.exercises[0].sets[0]).toMatchObject({ reps: 8, load_kg: 12.5, completed_at: T0 + 2 * MIN });
    expect(d.exercises[0].sets[1]).toMatchObject({ reps: 9, load_kg: 12.5, completed_at: null });
    expect(active.active_exercise_id).toBe(d.exercises[0].id);
    const now = T0 + 3 * MIN;
    expect(elapsedMs({ startedAt: active.started_at, endedAt: null, pausedMs: active.paused_ms, pausedAt: active.paused_at }, now)).toBe(3 * MIN);
    expect(restRemainingMs(active.rest_started_at, active.rest_sec, now, active.paused_at)).toBe(90_000 - MIN);

    expect(await env.training.finishSession(sid, T0 + 30 * MIN)).toBe('finished');
    expect(await env.training.finishSession(sid, T0 + 31 * MIN)).toBe('already');
    await env.training.uncompleteSet(set.id); // a stale undo after finishing must not touch history
    const totals = await env.training.sessionTotals(sid);
    expect(totals).toMatchObject({ workingSets: 1, totalReps: 8, volumeKg: 100 });
    const hist = await env.training.listHistory(10);
    expect(hist).toHaveLength(1);
    expect(hist[0]).toMatchObject({ id: sid, ended_at: T0 + 30 * MIN, local_date: '2026-11-16' });
    d = (await env.training.getSession(sid))!;
    expect(d.exercises.map((e) => e.status)).toEqual(['done', 'skipped', 'skipped', 'skipped', 'skipped']);
    expect(d.exercises[0].sets).toHaveLength(1); // unfinished drafts dropped
    const s = (await env.training.getScheduled(d.session.scheduled_id!))!;
    expect(s).toMatchObject({ status: 'completed', session_id: sid });
    expect(await env.training.getActiveSession()).toBeNull();
    await env.db.close();
    fs.unlinkSync(file);
  });

  test('reorder exercises within a session', async () => {
    const env = await makeEnv();
    const { sid } = await startHome(env);
    let d = (await env.training.getSession(sid))!;
    const names = d.exercises.map((e) => e.name);
    await env.training.moveExercise(d.exercises[0].id, 1);
    await env.training.moveExercise(d.exercises[0].id, -1); // the same row, now second, moves back to first
    await env.training.moveExercise(d.exercises[4].id, 1); // last: no-op
    d = (await env.training.getSession(sid))!;
    expect(d.exercises.map((e) => e.name)).toEqual(names);
    await env.training.moveExercise(d.exercises[2].id, -1);
    d = (await env.training.getSession(sid))!;
    expect(d.exercises.map((e) => e.name)).toEqual([names[0], names[2], names[1], names[3], names[4]]);
    expect(d.exercises.map((e) => e.position)).toEqual([0, 1, 2, 3, 4]);
  });

  test('pause freezes elapsed and rest timers', async () => {
    const env = await makeEnv();
    const { sid } = await startHome(env);
    const d = (await env.training.getSession(sid))!;
    await env.training.completeSet(d.exercises[0].sets[0].id, T0 + MIN);
    await env.training.pause(sid, T0 + 2 * MIN);
    await env.training.resume(sid, T0 + 12 * MIN);
    const s = (await env.training.getActiveSession())!;
    expect(elapsedMs({ startedAt: s.started_at, endedAt: null, pausedMs: s.paused_ms, pausedAt: s.paused_at }, T0 + 13 * MIN)).toBe(3 * MIN);
    expect(restRemainingMs(s.rest_started_at, s.rest_sec, T0 + 12 * MIN, null)).toBe(30_000);
  });

  test('undo, validation, discard and safe double start', async () => {
    const env = await makeEnv();
    const { sid } = await startHome(env);
    expect(await env.training.startSession({}, T0 + 5, TZ)).toBe(sid);
    const d = (await env.training.getSession(sid))!;
    const plank = d.exercises.find((e) => e.input_type === 'duration')!;
    expect(plank.sets[0].duration_sec).toBe(30);
    const set = d.exercises[0].sets[0];
    await env.training.updateSet(set.id, { reps: null as never });
    await expect(env.training.completeSet(set.id, T0)).rejects.toMatchObject({ code: 'missing_value' });
    await expect(env.training.updateSet(set.id, { reps: -1 })).rejects.toMatchObject({ code: 'invalid_value' });
    await env.training.updateSet(set.id, { reps: 8 });
    await env.training.completeSet(set.id, T0 + MIN);
    await env.training.uncompleteSet(set.id);
    const s = (await env.training.getActiveSession())!;
    expect(s.rest_started_at).toBeNull();
    await expect(env.training.finishSession(sid, T0 + MIN)).rejects.toMatchObject({ code: 'no_completed_sets' });
    await env.training.discardSession(sid);
    expect(await env.training.getSession(sid)).toBeNull();
    expect((await env.training.listScheduled('2026-11-16', '2026-11-16'))[0].status).toBe('planned');
  });

  test('previous performance prefills the next session; swap affects this session only unless asked', async () => {
    const env = await makeEnv();
    const { sid, pid, sched } = await startHome(env);
    let d = (await env.training.getSession(sid))!;
    for (const s of d.exercises[0].sets) {
      await env.training.updateSet(s.id, { load_kg: 14, reps: 10, rir: 2 });
      await env.training.completeSet(s.id, T0 + MIN);
    }
    await env.training.finishSession(sid, T0 + 20 * MIN);
    // Next Home A is the 4th occurrence; start it directly from the plan day.
    const prog = (await env.training.getProgram(pid))!;
    const sid2 = await env.training.startSession({ programId: pid, dayId: prog.doc.days[0].id }, T0 + 7 * 86400000, TZ);
    d = (await env.training.getSession(sid2))!;
    expect(d.exercises[0].sets.map((s) => [s.reps, s.load_kg, s.prefill_source])).toEqual([[10, 14, 'previous'], [10, 14, 'previous'], [10, 14, 'previous']]);
    // Swap exercise 2 for this session only.
    const press = d.exercises[1];
    const newSx = await env.training.replaceExercise(press.id, 'push_up', false);
    d = (await env.training.getSession(sid2))!;
    expect(d.exercises[1]).toMatchObject({ id: newSx, exercise_id: 'push_up', replaced_exercise_id: 'db_floor_press', plan_slot_id: press.plan_slot_id });
    expect((await env.training.getProgram(pid))!.doc.days[0].exercises[1].exerciseId).toBe('db_floor_press');
    await env.training.replaceExercise(d.exercises[2].id, 'inverted_row', true);
    const after = (await env.training.getProgram(pid))!;
    expect(after.doc.days[0].exercises[2].exerciseId).toBe('inverted_row');
    expect(after.revision).toBe(prog.revision + 1);
    // Editing the plan never rewrites the finished session.
    const old = (await env.training.getSession(sid))!;
    expect(old.exercises[2]).toMatchObject({ exercise_id: 'db_row', name: 'One-Arm Dumbbell Row' });
    expect(sched).toHaveLength(3);
  });

  test('acceptance: delete a workout holding a PR → replacement record; kg/lb toggle leaves data intact', async () => {
    const env = await makeEnv();
    const lift = async (load: number, day: number) => {
      const sid = await env.training.startSession({ title: 'Free' }, T0 + day * 86400000, TZ);
      const sx = await env.training.addExercise(sid, 'bb_bench_press');
      const d = (await env.training.getSession(sid))!;
      const set = d.exercises.find((e) => e.id === sx)!.sets[0];
      await env.training.updateSet(set.id, { load_kg: load, reps: 5 });
      await env.training.completeSet(set.id, T0 + day * 86400000 + MIN);
      await env.training.finishSession(sid, T0 + day * 86400000 + 10 * MIN);
      return sid;
    };
    await lift(60, 0);
    const best = await lift(70, 1);
    await lift(65, 2);
    const head = async () => headlineRecords(analyzeRecords(await env.training.historySets('bb_bench_press')).current, 'bb_bench_press');
    expect((await head())[0]).toMatchObject({ value: 70, sessionId: best });
    expect((await env.training.sessionRecords(best)).map((r) => r.type)).toContain('heaviest_load');
    await env.training.deleteSession(best);
    expect((await head())[0].value).toBe(65);
    expect(await env.training.listHistory(10)).toHaveLength(2);
    // Edit instead of delete: lowering the top set also changes the record.
    const sets = await env.training.historySets('bb_bench_press');
    await env.training.updateSet(sets.find((s) => s.loadKg === 65)!.id, { load_kg: 55 });
    expect((await head())[0].value).toBe(60);
    // Unit toggle twice: canonical values and totals are untouched.
    const before = await env.db.all('SELECT id, load_kg FROM session_sets ORDER BY id');
    await savePrefs(env.store, { weightUnit: 'lb' });
    await savePrefs(env.store, { weightUnit: 'kg' });
    expect(await env.db.all('SELECT id, load_kg FROM session_sets ORDER BY id')).toEqual(before);
    expect((await loadPrefs(env.store)).weightUnit).toBe('kg');
    expect(Math.round(fromKg(60, 'lb') * 10) / 10).toBe(132.3);
  });

  test('dumbbell, bodyweight, warm-up and timed sets in one session', async () => {
    const env = await makeEnv();
    const sid = await env.training.startSession({ title: 'Mixed' }, T0, TZ);
    const done = async (exId: string, f: Parameters<Training['updateSet']>[1], kind: 'working' | 'warmup' = 'working') => {
      const sx = await env.training.addExercise(sid, exId);
      const setId = kind === 'warmup' ? await env.training.addSet(sx, 'warmup') : (await env.training.getSession(sid))!.exercises.find((e) => e.id === sx)!.sets[0].id;
      await env.training.updateSet(setId, f);
      await env.training.completeSet(setId, T0 + MIN);
    };
    await done('db_bench_press', { load_kg: 12, reps: 10 });
    await done('db_bench_press', { load_kg: 6, reps: 10 }, 'warmup');
    await done('pull_up', { reps: 8 });
    await done('plank', { duration_sec: 60 });
    await done('bb_back_squat', { load_kg: 22, reps: 10 });
    await env.training.finishSession(sid, T0 + 30 * MIN);
    expect(await env.training.sessionTotals(sid)).toEqual({ workingSets: 4, totalReps: 28, volumeKg: 240 + 220, setsExcludedFromVolume: 2 });
  });

  test('progression: suggest, never auto-apply, accepted load prefills next time', async () => {
    const env = await makeEnv();
    const pid = await env.training.createFromTemplate('tpl_home3');
    const day = (await env.training.getProgram(pid))!.doc.days[0];
    const run = async (n: number, rir: number | null) => {
      const sid = await env.training.startSession({ programId: pid, dayId: day.id }, T0 + n * 86400000, TZ);
      const d = (await env.training.getSession(sid))!;
      for (const s of d.exercises[0].sets) {
        await env.training.updateSet(s.id, { load_kg: 14, reps: 12, rir });
        await env.training.completeSet(s.id, T0 + n * 86400000 + MIN);
      }
      await env.training.finishSession(sid, T0 + n * 86400000 + 20 * MIN);
      return d.exercises[0].sets;
    };
    const cfg = { enabled: true, incrementKg: 2.5, minRir: 2 };
    const slot = day.exercises[0].slotId;
    await run(0, 2);
    expect((await env.training.progression('db_goblet_squat', slot, cfg)).suggestion.reason).toBe('not_enough_history');
    await run(2, 2);
    const p = await env.training.progression('db_goblet_squat', slot, cfg);
    expect(p.suggestion).toMatchObject({ action: 'increase', suggestedLoadKg: 16.5 });
    expect(p.decision).toBeNull();
    // Not applied automatically: a new session still prefills the previous load.
    const noAccept = await env.training.startSession({ programId: pid, dayId: day.id }, T0 + 3 * 86400000, TZ);
    expect((await env.training.getSession(noAccept))!.exercises[0].sets[0]).toMatchObject({ load_kg: 14, prefill_source: 'previous' });
    await env.training.discardSession(noAccept);
    await env.training.decideProgression('db_goblet_squat', p.basisKey, 'accepted', 16.5, T0 + 3 * 86400000);
    expect((await env.training.progression('db_goblet_squat', slot, cfg)).decision).toBe('accepted');
    const next = await env.training.startSession({ programId: pid, dayId: day.id }, T0 + 4 * 86400000, TZ);
    expect((await env.training.getSession(next))!.exercises[0].sets[0]).toMatchObject({ load_kg: 16.5, reps: 12, prefill_source: 'suggestion' });
  });

  test('schedule: reschedule moves weeks, cancelled leaves the denominator, cross-midnight uses start date', async () => {
    const env = await makeEnv();
    const pid = await env.training.createFromTemplate('tpl_fb3');
    await env.training.activateProgram(pid, [1, 3, 5], '2026-11-16');
    let week = await env.training.listScheduled('2026-11-16', '2026-11-22');
    expect(week.map((s) => s.title)).toEqual(['Full Body A', 'Full Body B', 'Full Body C']);
    await env.training.reschedule(week[2].id, '2026-11-24');
    await env.training.setScheduledStatus(week[1].id, 'cancelled');
    await env.training.ensureSchedule('2026-11-16'); // must not recreate the moved or cancelled days
    week = await env.training.listScheduled('2026-11-16', '2026-11-22');
    expect(adherence(week.map((s) => ({ localDate: s.local_date, status: s.status })), '2026-11-16', '2026-11-22')).toMatchObject({ eligible: 1, completed: 0 });
    const next = await env.training.listScheduled('2026-11-23', '2026-11-29');
    expect(next.filter((s) => s.status !== 'cancelled')).toHaveLength(4);
    expect(next.find((s) => s.moved_from === '2026-11-20')).toBeTruthy();
    // Cross-midnight workout: history uses the start date.
    const late = zonedToInstant('2026-11-16', '23:40', TZ).ms;
    const sid = await env.training.startSession({ scheduledId: week[0].id }, late, TZ);
    const d = (await env.training.getSession(sid))!;
    await env.training.updateSet(d.exercises[0].sets[0].id, { load_kg: 40 });
    await env.training.completeSet(d.exercises[0].sets[0].id, late + 30 * MIN);
    await env.training.finishSession(sid, late + 45 * MIN);
    expect((await env.training.getSession(sid))!.session.local_date).toBe('2026-11-16');
    // Switching plans cancels the old plan's open days and schedules the new one.
    const other = await env.training.createFromTemplate('tpl_fb2');
    await env.training.activateProgram(other, [2, 6], '2026-11-17');
    const all = await env.training.listScheduled('2026-11-17', '2026-11-30');
    expect(all.filter((s) => s.status === 'planned' && s.program_id === pid).map((s) => s.local_date)).toEqual(['2026-11-24']);
    expect(all.filter((s) => s.status === 'planned' && s.program_id === other)).toHaveLength(4);
  });
});

const yogurt: NutrientSnapshot = { basis: 'per_100g', servingG: null, servingMl: null, servingLabel: null, kcal: 200, proteinG: 10, carbsG: null, fatG: 5, source: 'user' };

describe('nutrition', () => {
  test('acceptance: plan tomorrow → zero intake → log with changed portion → math; recipe edit keeps history', async () => {
    const env = await makeEnv();
    const n = env.nutrition;
    const foodId = await n.saveFood({ name: 'Skyr', snapshot: yogurt });
    const recipeId = await n.saveRecipe({ name: 'Bowl', servingsYield: 2, ingredients: [{ name: 'Skyr', snapshot: yogurt, qty: 300, unit: 'g' }] });
    const recipe = (await n.getRecipe(recipeId))!;
    const planned = await n.plan('2026-11-17', 'Lunch', n.recipeAsInput(recipe, 1));
    expect((await n.dayTotals('2026-11-17')).entries).toBe(0);
    expect((await n.dayTotals('2026-11-17')).kcal).toBe(0);
    const logId = await n.logPlanned(planned, T0, TZ, { qty: 1.5, unit: 'serving' });
    expect(await n.logPlanned(planned, T0, TZ)).toBe(logId); // idempotent
    let t = await n.dayTotals('2026-11-17');
    expect(t).toMatchObject({ kcal: 450, proteinG: 22.5, entries: 1 });
    expect(t.partial.carbsG).toBe(true);
    expect(t.partial.kcal).toBe(false);
    // Edit the recipe and the food: the historical entry is unchanged.
    await n.saveRecipe({ id: recipeId, name: 'Bowl', servingsYield: 1, ingredients: [{ name: 'Skyr', snapshot: { ...yogurt, kcal: 999 }, qty: 100, unit: 'g' }] });
    await n.saveFood({ id: foodId, name: 'Skyr', snapshot: { ...yogurt, kcal: 1 } });
    t = await n.dayTotals('2026-11-17');
    expect(t.kcal).toBe(450);
    // 150 g example and portion edit from the entry's own snapshot.
    const id = await n.log('2026-11-16', 'Breakfast', { name: 'Skyr', sourceKind: 'food', sourceId: foodId, snapshot: yogurt, qty: 150, unit: 'g' }, T0, TZ);
    expect(await n.getLog(id)).toMatchObject({ kcal: 300, protein_g: 15, carbs_g: null });
    await n.editLog(id, { qty: 100 });
    expect((await n.getLog(id))!.kcal).toBe(200);
    await expect(n.editLog(id, { unit: 'serving' })).rejects.toMatchObject({ code: 'unit_not_convertible' });
    // Same id twice (scanner repeat / double tap) is one entry.
    await n.log('2026-11-16', 'Breakfast', { name: 'Skyr', sourceKind: 'food', sourceId: foodId, snapshot: yogurt, qty: 100, unit: 'g' }, T0, TZ, id);
    expect(await n.listLogs('2026-11-16')).toHaveLength(1);
    // Copy creates independent entries.
    expect(await n.copyDay('2026-11-16', '2026-11-18', T0, TZ)).toBe(1);
    const copy = (await n.listLogs('2026-11-18'))[0];
    await n.editLog(copy.id, { qty: 50 });
    expect((await n.getLog(id))!.qty).toBe(100);
    // Deleting the logged entry reopens the plan.
    await n.deleteLog(logId);
    expect((await n.listPlanned('2026-11-17', '2026-11-17'))[0]).toMatchObject({ status: 'planned', log_id: null });
    expect((await n.recentItems()).map((r) => r.name)).toEqual(['Skyr']);
    expect((await n.searchFoods('sky')).map((f) => f.name)).toEqual(['Skyr']);
    expect((await n.searchFoods('chicken')).length).toBeGreaterThan(1);
  });
});

describe('recovery', () => {
  test('acceptance: two 250 mL, undo one → exactly 250', async () => {
    const env = await makeEnv();
    await env.recovery.addWater(250, '2026-11-16', T0, TZ);
    const second = await env.recovery.addWater(250, '2026-11-16', T0 + 1, TZ);
    expect(await env.recovery.waterTotal('2026-11-16')).toBe(500);
    await env.recovery.removeWater(second);
    expect(await env.recovery.waterTotal('2026-11-16')).toBe(250);
    await expect(env.recovery.addWater(0, '2026-11-16', T0, TZ)).rejects.toMatchObject({ code: 'invalid_amount' });
  });

  test('acceptance: 23:30 → 07:00 with 30 min awake is 7 h on the wake day; zone change keeps attribution', async () => {
    const env = await makeEnv();
    const startAt = zonedToInstant('2026-11-15', '23:30', TZ).ms;
    const endAt = zonedToInstant('2026-11-16', '07:00', TZ).ms;
    const id = await env.recovery.saveSleep({ kind: 'night', startAt, endAt, tz: TZ, manualDurationMin: null, awakeMin: 30, confirmedAsleep: false, quality: 4, notes: '' }, endAt + MIN);
    const row = (await env.recovery.getSleep(id))!;
    expect(row.wake_date).toBe('2026-11-16');
    expect(sleepDuration({ startAt: row.start_at, endAt: row.end_at, manualDurationMin: null, awakeMin: row.awake_min, confirmedAsleep: false })?.minutes).toBe(420);
    // The device later moves to another zone: stored date and zone do not change.
    expect((await env.recovery.listSleep('2026-11-16'))[0]).toMatchObject({ tz: TZ, wake_date: '2026-11-16' });
    await expect(env.recovery.saveSleep({ kind: 'night', startAt: endAt, endAt: startAt, tz: TZ, manualDurationMin: null, awakeMin: null, confirmedAsleep: false, quality: null, notes: '' }, endAt)).rejects.toMatchObject({ code: 'end_before_start' });
    // Correction keeps the same row.
    await env.recovery.saveSleep({ id, kind: 'night', startAt, endAt, tz: TZ, manualDurationMin: null, awakeMin: 45, confirmedAsleep: false, quality: 4, notes: '' }, endAt + MIN);
    expect(await env.recovery.listSleep('2026-11-16')).toHaveLength(1);
  });

  test('weekly check-in is one row per week', async () => {
    const env = await makeEnv();
    await env.recovery.saveCheckin('2026-11-16', { energy: 3, soreness: 2, notes: '' }, T0, TZ);
    await env.recovery.saveCheckin('2026-11-16', { energy: 4, soreness: 2, notes: 'ok' }, T0, TZ);
    expect(await env.recovery.listCheckins()).toMatchObject([{ energy: 4, notes: 'ok' }]);
  });
});

describe('prefs, export, migrations', () => {
  test('prefs merge with defaults', async () => {
    const env = await makeEnv();
    expect(await loadPrefs(env.store)).toEqual(DEFAULT_PREFS);
    await savePrefs(env.store, { trackers: { ...DEFAULT_PREFS.trackers, body: true }, targets: { ...DEFAULT_PREFS.targets, waterMl: 2500 } });
    const p = await loadPrefs(env.store);
    expect(p.trackers.body).toBe(true);
    expect(p.targets).toMatchObject({ waterMl: 2500, kcal: null });
  });

  test('export is complete, includes hidden-tracker data, excludes tombstones', async () => {
    const env = await makeEnv();
    await savePrefs(env.store, { trackers: { nutrition: false, water: false, sleep: false, body: false } });
    await env.recovery.addWater(300, '2026-11-16', T0, TZ);
    const gone = await env.recovery.addWater(100, '2026-11-16', T0, TZ);
    await env.recovery.removeWater(gone);
    await env.recovery.addMeasurement('weight', 80.5, '2026-11-16', T0);
    await env.nutrition.log('2026-11-16', 'Lunch', { name: '=cmd, "x"', sourceKind: 'quick', sourceId: null, snapshot: { ...yogurt, basis: 'per_serving' }, qty: 1, unit: 'serving' }, T0, TZ);
    const { sid } = await startHome(env);
    const d = (await env.training.getSession(sid))!;
    await env.training.completeSet(d.exercises[0].sets[0].id, T0 + MIN);
    await env.training.finishSession(sid, T0 + 5 * MIN);
    const b = await buildExport(env.db, T0);
    expect(Object.keys(b.tables).sort()).toEqual([...SYNCED_TABLES].sort());
    expect(b.tables.water_logs).toHaveLength(1);
    expect(b.tables.measurements[0]).toMatchObject({ value: 80.5 });
    expect(b.tables.session_sets).toHaveLength(1);
    expect(b.tables.sessions[0]).not.toHaveProperty('rev');
    expect(b).toMatchObject({ format: 'kinset-export', formatVersion: 1, schemaVersion: MIGRATIONS.length });
    const files = exportCsvFiles(b);
    expect(Object.keys(files)).toEqual(expect.arrayContaining(['water_logs.csv', 'food_logs.csv', 'sessions.csv', 'session_sets.csv', 'programs.csv', 'prefs.csv']));
    expect(files['food_logs.csv']).toContain(`"'=cmd, ""x"""`);
    expect(toCsv([])).toBe('');
  });

  test('old-schema upgrade keeps data and a newer database is refused', async () => {
    const db = openNodeDb();
    await migrate(db, 1);
    const store = new Store(db, false);
    await store.put('water_logs', { id: 'w1', local_date: '2026-01-01', amount_ml: 250, logged_at: 1, tz: 'UTC' });
    expect(await migrate(db)).toBe(1);
    expect(await db.first('SELECT amount_ml FROM water_logs WHERE id = ?', ['w1'])).toEqual({ amount_ml: 250 });
    await db.run(`INSERT INTO progression_decisions (id, exercise_id, basis_key, decision, decided_at, created_at, updated_at) VALUES ('p','e','k','dismissed',1,1,1)`);
    await db.exec('PRAGMA user_version = 99');
    await expect(migrate(db)).rejects.toThrow(/newer/);
  });

  test('outbox: written in the same transaction, only for account partitions, drafts stay local', async () => {
    const guest = await makeEnv();
    await guest.recovery.addWater(250, '2026-11-16', T0, TZ);
    expect(await guest.db.all('SELECT * FROM outbox')).toHaveLength(0);
    const acct = await makeEnv({ sync: true });
    const { sid } = await startHome(acct);
    const before = (await acct.db.all<{ tbl: string }>('SELECT tbl FROM outbox')).map((o) => o.tbl);
    expect(before.every((t) => t === 'programs' || t === 'scheduled_workouts')).toBe(true);
    const d = (await acct.training.getSession(sid))!;
    await acct.training.completeSet(d.exercises[0].sets[0].id, T0 + MIN);
    expect(await acct.db.all(`SELECT * FROM outbox WHERE tbl LIKE 'session%'`)).toHaveLength(0);
    await acct.training.finishSession(sid, T0 + 5 * MIN);
    const ops = await acct.db.all<{ kind: string; tbl: string }>(`SELECT kind, tbl FROM outbox WHERE tbl LIKE 'session%'`);
    expect(ops).toEqual([{ kind: 'session_complete', tbl: 'sessions' }]);
    // A failed transaction leaves neither the row nor an operation.
    const n = (await acct.db.all('SELECT * FROM outbox')).length;
    await expect(acct.store.tx(async () => {
      await acct.store.put('water_logs', { id: 'boom', local_date: '2026-11-16', amount_ml: 1, logged_at: 1, tz: TZ });
      throw new Error('crash');
    })).rejects.toThrow('crash');
    expect(await acct.db.first('SELECT id FROM water_logs WHERE id = ?', ['boom'])).toBeNull();
    expect((await acct.db.all('SELECT * FROM outbox')).length).toBe(n);
  });
});
