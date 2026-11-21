import { computeInsights, type InsightInput } from '@/domain/coach-insights';
import { zonedToInstant } from '@/domain/time';
import { buildExport } from './export';
import { loadPrefs, savePrefs } from './prefs';
import { makeEnv, type Env } from './testkit';

const TZ = 'Europe/Paris';
const TODAY = '2026-11-19'; // Thursday
const NOW = zonedToInstant(TODAY, '12:00', TZ).ms;
const ctx = { today: TODAY, tz: TZ, now: NOW };
const DAY = 86_400_000;

async function withHomePlan(env: Env) {
  const pid = await env.training.createFromTemplate('tpl_home3');
  await env.training.activateProgram(pid, [1, 3, 5], '2026-11-16');
  return (await env.training.getProgram(pid))!;
}

async function finishSquat(env: Env, pid: string, dayId: string, at: number, load: number, reps: number, rir: number) {
  const sid = await env.training.startSession({ programId: pid, dayId }, at, TZ);
  const d = (await env.training.getSession(sid))!;
  for (const s of d.exercises[0].sets) {
    await env.training.updateSet(s.id, { load_kg: load, reps, rir });
    await env.training.completeSet(s.id, at + 60_000);
  }
  await env.training.finishSession(sid, at + 600_000);
}

describe('coach insights (pure)', () => {
  const base: InsightInput = {
    today: TODAY, trackers: { water: true, sleep: true }, targets: { waterMl: 2500, sleepMin: 450 }, hasActivePlan: true, sessionsLast14: 4,
    missed: [], plannedDates: [], nextDates: ['2026-11-19', '2026-11-20', '2026-11-21'], progression: [],
    waterByDay: new Map(), sleepByDay: new Map([['2026-11-17', 470], ['2026-11-18', 460], ['2026-11-19', 455]]), avgWakeMin: 7 * 60, reminderKinds: [], soreness: null, dismissed: [],
  };
  test('evidence-backed actions, priorities and dismissals', () => {
    const out = computeInsights({
      ...base,
      missed: [{ scheduledId: 'sw1', title: 'Home B', date: '2026-11-18' }], plannedDates: ['2026-11-19'],
      progression: [{ exerciseId: 'db_goblet_squat', name: 'Goblet Squat', currentKg: 14, suggestedKg: 16.5, sessions: 2 }],
      waterByDay: new Map([['2026-11-17', 1000], ['2026-11-18', 1200], ['2026-11-19', 900]]),
      sleepByDay: new Map([['2026-11-17', 360], ['2026-11-18', 380], ['2026-11-19', 370]]),
    });
    expect(out.map((i) => i.kind)).toEqual(['missed_workout', 'progression_ready', 'hydration_low', 'sleep_short']);
    expect(out[0].action).toMatchObject({ tool: 'propose_reschedule_workout', args: { scheduled_id: 'sw1', new_date: '2026-11-20' } });
    expect(out[1].action).toMatchObject({ tool: 'propose_set_next_load', args: { load_kg: 16.5 } });
    expect(out[2].action).toMatchObject({ tool: 'propose_create_reminder', args: { kind: 'water' } });
    // Wake 07:00, goal 7.5 h, 30 min wind-down → 23:00.
    expect(out[3].action).toMatchObject({ tool: 'propose_create_reminder', args: { kind: 'bedtime', time: '23:00' } });
    expect(computeInsights({ ...base, dismissed: [out[0].id], missed: [{ scheduledId: 'sw1', title: 'Home B', date: '2026-11-18' }] }).some((i) => i.kind === 'missed_workout')).toBe(false);
  });
  test('no action when evidence is thin or a reminder exists; high soreness comes first with no action', () => {
    expect(computeInsights({ ...base, waterByDay: new Map([['2026-11-19', 500]]) }).some((i) => i.kind === 'hydration_low')).toBe(false); // 1 logged day
    const withReminder = computeInsights({ ...base, reminderKinds: ['water'], waterByDay: new Map([['a', 500], ['b', 500], ['c', 500]]) });
    expect(withReminder.find((i) => i.kind === 'hydration_low')?.action).toBeNull();
    const sore = computeInsights({ ...base, soreness: 5 });
    expect(sore[0]).toMatchObject({ kind: 'recovery_soreness', action: null });
    expect(computeInsights({ ...base, sleepByDay: new Map() }).some((i) => i.kind === 'sleep_unlogged')).toBe(true);
    expect(computeInsights({ ...base, hasActivePlan: false, sessionsLast14: 0 }).some((i) => i.kind === 'no_plan')).toBe(true);
  });
});

describe('coach on-device tools', () => {
  test('read tools return summaries and respect hidden trackers and hidden nutrition numbers', async () => {
    const env = await makeEnv();
    const prog = await withHomePlan(env);
    await env.recovery.addWater(500, TODAY, NOW, TZ);
    await env.nutrition.log(TODAY, 'Lunch', { name: 'Rice', sourceKind: 'quick', sourceId: null, qty: 1, unit: 'serving', snapshot: { basis: 'per_serving', servingG: null, servingMl: null, servingLabel: 'bowl', kcal: 400, proteinG: null, carbsG: 80, fatG: 2, source: 'q' } }, NOW, TZ);
    const plan = (await env.coach.runRead('get_active_plan', {}, ctx)) as { plan: { program_id: string; days: { exercises: { slot_id: string }[] }[] }; schedule: { scheduled_id: string; missed: boolean }[] };
    expect(plan.plan.program_id).toBe(prog.id);
    expect(plan.plan.days[0].exercises[0].slot_id).toBe(prog.doc.days[0].exercises[0].slotId);
    expect(plan.schedule.filter((s) => s.missed)).toHaveLength(2); // Mon and Wed this week were not done
    expect(await env.coach.runRead('get_hydration_summary', { days: 7 }, ctx)).toMatchObject({ average_ml_over_logged_days: 500, logged_days: 1, range_days: 7 });
    const nut = (await env.coach.runRead('get_nutrition_summary', { days: 1 }, ctx)) as { days: { kcal: number; partial: string[] }[] };
    expect(nut.days[0]).toMatchObject({ kcal: 400, partial: ['proteinG'] });
    await savePrefs(env.store, { hideNutritionNumbers: true, trackers: { nutrition: true, water: false, sleep: true, body: false } });
    expect(await env.coach.runRead('get_nutrition_summary', { days: 1 }, ctx)).toEqual({ numbers_hidden_by_user: true, days: [{ date: TODAY, entries: 1 }] });
    expect(await env.coach.runRead('get_hydration_summary', { days: 7 }, ctx)).toEqual({ hidden: true });
    expect(await env.coach.runRead('get_body_metrics', { days: 30 }, ctx)).toEqual({ hidden: true });
    expect(await env.coach.runRead('get_profile', {}, ctx)).toMatchObject({ targets: { kcal: 'hidden', water_ml: 'hidden' } });
    expect(await env.coach.runRead('get_hydration_summary', { days: 99 }, ctx)).toEqual({ error: 'input.days must be at most 30' });
    expect(await env.coach.runRead('propose_log_water', { amount_ml: 250, date: null, reason: 'x x x' }, ctx)).toEqual({ error: 'propose_log_water is not a read tool' });
    expect(await env.coach.runRead('search_exercises', { query: 'goblet' }, ctx)).toEqual({ exercises: [{ id: 'db_goblet_squat', name: 'Goblet Squat', equipment: 'dumbbell', input: 'weight_reps' }] });
  });

  test('proposals change nothing until applied; apply is idempotent; undo restores', async () => {
    const env = await makeEnv();
    const prog = await withHomePlan(env);
    const slot = prog.doc.days[0].exercises[0];
    const p = await env.coach.propose('chat', null, { name: 'propose_update_plan_exercise', input: { program_id: prog.id, slot_id: slot.slotId, sets: 4, rep_min: null, rep_max: null, rest_sec: 120, duration_sec: null, reason: 'Add volume gradually.' } }, ctx);
    if (!p.ok) throw new Error(p.error);
    expect(p.value.preview.changes).toEqual([{ field: 'sets', from: 3, to: 4, unit: 'count' }, { field: 'rest', from: 90, to: 120, unit: 'sec' }]);
    expect((await env.training.getProgram(prog.id))!.doc.days[0].exercises[0].sets).toBe(3); // nothing changed yet
    const applied = await env.coach.apply(p.value.id, ctx);
    expect(applied).toMatchObject({ ok: true, value: { status: 'applied' } });
    expect(await env.coach.apply(p.value.id, ctx)).toMatchObject({ ok: true }); // second tap: no second change
    const after = (await env.training.getProgram(prog.id))!;
    expect(after.doc.days[0].exercises[0]).toMatchObject({ sets: 4, restSec: 120 });
    expect(after.revision).toBe(prog.revision + 1);
    expect(await env.coach.undo(p.value.id, ctx)).toMatchObject({ ok: true, value: { status: 'undone' } });
    expect((await env.training.getProgram(prog.id))!.doc.days[0].exercises[0]).toMatchObject({ sets: 3, restSec: 90 });
    // Undo refuses to clobber a plan edited after the change.
    const p2 = await env.coach.propose('chat', null, { name: 'propose_swap_plan_exercise', input: { program_id: prog.id, slot_id: slot.slotId, exercise_id: 'bw_squat', reason: 'No dumbbells today.' } }, ctx);
    if (!p2.ok) throw new Error(p2.error);
    await env.coach.apply(p2.value.id, ctx);
    await env.training.saveProgram(prog.id, { name: 'Edited by hand' });
    expect(await env.coach.undo(p2.value.id, ctx)).toEqual({ ok: false, error: 'changed_since' });
    // Declined proposals stay unapplied.
    const p3 = await env.coach.propose('chat', null, { name: 'propose_log_water', input: { amount_ml: 300, date: null, reason: 'Log the glass you mentioned.' } }, ctx);
    if (!p3.ok) throw new Error(p3.error);
    await env.coach.decline(p3.value.id, NOW);
    expect(await env.coach.apply(p3.value.id, ctx)).toEqual({ ok: false, error: 'already_declined' });
    expect(await env.recovery.waterTotal(TODAY)).toBe(0);
  });

  test('device checks: unknown ids, past dates, load step limit, stale proposals', async () => {
    const env = await makeEnv();
    const prog = await withHomePlan(env);
    const bad = (name: string, input: unknown) => env.coach.propose('chat', null, { name, input }, ctx).then((r) => (r.ok ? 'ok' : r.error));
    expect(await bad('propose_swap_plan_exercise', { program_id: prog.id, slot_id: 'nope', exercise_id: 'bw_squat', reason: 'xxx' })).toMatch(/Unknown program_id or slot_id/);
    const sched = await env.training.listScheduled('2026-11-16', '2026-11-22');
    expect(await bad('propose_reschedule_workout', { scheduled_id: sched[0].id, new_date: '2026-11-17', reason: 'xxx' })).toBe('new_date must be today or later.');
    expect(await bad('propose_log_water', { amount_ml: 250, date: '2026-11-25', reason: 'xxx' })).toBe('date must be today or earlier.');
    // +10% limit over the last working load.
    await finishSquat(env, prog.id, prog.doc.days[0].id, NOW - 3 * DAY, 20, 12, 3);
    expect(await bad('propose_set_next_load', { exercise_id: 'db_goblet_squat', load_kg: 25, reason: 'xxx' })).toMatch(/more than \+10%/);
    expect(await bad('propose_set_next_load', { exercise_id: 'db_goblet_squat', load_kg: 22, reason: 'xxx' })).toBe('ok');
    expect(await bad('propose_set_targets', { water_ml: null, sleep_min: null, kcal: 900, protein_g: null, reason: 'xxx' })).toBe('input.kcal must be at least 1200');
    // A proposal that went stale (workout completed meanwhile) fails on apply instead of acting on old data.
    const p = await env.coach.propose('chat', null, { name: 'propose_skip_workout', input: { scheduled_id: sched[2].id, reason: 'Rest day.' } }, ctx);
    if (!p.ok) throw new Error(p.error);
    await env.store.patch('scheduled_workouts', sched[2].id, { status: 'completed' });
    expect(await env.coach.apply(p.value.id, ctx)).toEqual({ ok: false, error: 'That workout is completed and cannot be changed.' });
    expect((await env.coach.getAction(p.value.id))!.status).toBe('failed');
  });

  test('every proposal kind applies and undoes through the normal repositories', async () => {
    const env = await makeEnv();
    const prog = await withHomePlan(env);
    const sched = await env.training.listScheduled('2026-11-16', '2026-11-22');
    const run = async (name: string, input: Record<string, unknown>) => {
      const p = await env.coach.propose('insight', null, { name, input: { reason: 'Because of your logs.', ...input } }, ctx);
      if (!p.ok) throw new Error(`${name}: ${p.error}`);
      const a = await env.coach.apply(p.value.id, ctx);
      if (!a.ok) throw new Error(`${name}: ${a.error}`);
      return p.value.id;
    };
    const resched = await run('propose_reschedule_workout', { scheduled_id: sched[1].id, new_date: '2026-11-21' });
    expect((await env.training.getScheduled(sched[1].id))!).toMatchObject({ local_date: '2026-11-21', moved_from: '2026-11-18' });
    await env.coach.undo(resched, ctx);
    expect((await env.training.getScheduled(sched[1].id))!).toMatchObject({ local_date: '2026-11-18', moved_from: null, status: 'planned' });
    const targets = await run('propose_set_targets', { water_ml: 2500, sleep_min: null, kcal: null, protein_g: 120 });
    expect((await loadPrefs(env.store)).targets).toMatchObject({ waterMl: 2500, proteinG: 120, sleepMin: null });
    await env.coach.undo(targets, ctx);
    expect((await loadPrefs(env.store)).targets).toMatchObject({ waterMl: null, proteinG: null });
    const water = await run('propose_log_water', { amount_ml: 330, date: null });
    expect(await env.recovery.waterTotal(TODAY)).toBe(330);
    const del = await run('propose_delete_entry', { kind: 'water', entry_id: (await env.recovery.listWater(TODAY))[0].id });
    expect(await env.recovery.waterTotal(TODAY)).toBe(0);
    await env.coach.undo(del, ctx);
    expect(await env.recovery.waterTotal(TODAY)).toBe(330); // restored as a new entry
    expect((await env.coach.getAction(water))!.status).toBe('applied');
    const rem = await run('propose_create_reminder', { kind: 'bedtime', time: '22:30', weekdays: [0, 1, 2, 3, 4] });
    expect(await env.recovery.listReminders()).toMatchObject([{ kind: 'bedtime', time: '22:30' }]);
    await env.coach.undo(rem, ctx);
    expect(await env.recovery.listReminders()).toEqual([]);
    const add = await run('propose_add_plan_exercise', { program_id: prog.id, day_id: prog.doc.days[0].id, exercise_id: 'plank', sets: 2, rep_min: null, rep_max: null, duration_sec: 45, rest_sec: 45 });
    expect((await env.training.getProgram(prog.id))!.doc.days[0].exercises.at(-1)).toMatchObject({ exerciseId: 'plank', durationSec: 45 });
    await env.coach.undo(add, ctx);
    expect((await env.training.getProgram(prog.id))!.doc.days[0].exercises).toHaveLength(5);
    await finishSquat(env, prog.id, prog.doc.days[0].id, NOW - DAY, 14, 12, 2);
    const load = await run('propose_set_next_load', { exercise_id: 'db_goblet_squat', load_kg: 15 });
    const next = await env.training.startSession({ programId: prog.id, dayId: prog.doc.days[0].id }, NOW, TZ);
    expect((await env.training.getSession(next))!.exercises[0].sets[0]).toMatchObject({ load_kg: 15, prefill_source: 'suggestion' });
    await env.training.discardSession(next);
    await env.coach.undo(load, ctx);
    const again = await env.training.startSession({ programId: prog.id, dayId: prog.doc.days[0].id }, NOW, TZ);
    expect((await env.training.getSession(again))!.exercises[0].sets[0]).toMatchObject({ load_kg: 14, prefill_source: 'previous' });
  });

  test('chat history is local, replayed in order, exported, and erased with the history', async () => {
    const env = await makeEnv({ sync: true });
    const th = await env.coach.createThread('anthropic', NOW);
    await env.coach.appendMessages(th, [{ role: 'user', displayText: 'Hi coach', native: { role: 'user', content: 'Hi coach' } }, { role: 'assistant', displayText: 'Hello', native: { role: 'assistant', content: [{ type: 'text', text: 'Hello' }] } }], NOW);
    await env.coach.appendMessages(th, [{ role: 'event', displayText: 'Applied: water' }], NOW + 1);
    expect(await env.coach.history(th)).toEqual([{ role: 'user', content: 'Hi coach' }, { role: 'assistant', content: [{ type: 'text', text: 'Hello' }] }]);
    expect((await env.coach.listMessages(th)).map((m) => m.seq)).toEqual([0, 1, 2]);
    expect(await env.coach.latestThread()).toMatchObject({ id: th, provider: 'anthropic' });
    expect(await env.db.all(`SELECT * FROM outbox WHERE tbl LIKE 'coach%'`)).toEqual([]); // never synced
    const b = await buildExport(env.db, NOW);
    expect(b.tables.coach_messages).toHaveLength(3);
    await env.coach.deleteHistory();
    expect(await env.coach.listMessages(th)).toEqual([]);
  });

  test('insights from real data include a ready-to-propose action', async () => {
    const env = await makeEnv();
    await withHomePlan(env);
    const ins = await env.coach.insights(ctx);
    const missed = ins.find((i) => i.kind === 'missed_workout')!;
    expect(missed.action).toMatchObject({ tool: 'propose_reschedule_workout', args: { new_date: '2026-11-19' } });
    const p = await env.coach.propose('insight', null, { name: missed.action!.tool, input: missed.action!.args }, ctx);
    expect(p.ok).toBe(true);
    await env.coach.dismissInsight(missed.id);
    expect((await env.coach.insights(ctx)).some((i) => i.id === missed.id)).toBe(false);
  });
});
