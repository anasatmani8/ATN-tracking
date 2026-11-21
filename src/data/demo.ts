import { addDays, weekStartOf, zonedToInstant, type LocalDate } from '@/domain/time';
import { baselineFood } from './catalog/foods';
import { savePrefs } from './prefs';
import type { Nutrition } from './nutrition';
import type { Recovery } from './recovery';
import type { Store } from './store';
import type { Training } from './training';

/**
 * Deterministic sample data for demo mode. It is written to its own database
 * file, never to guest or account data, and is rebuilt each time demo mode starts.
 * Values are fixed; only dates are relative to "today".
 */
export async function seedDemo(env: { store: Store; training: Training; nutrition: Nutrition; recovery: Recovery }, today: LocalDate, tz: string): Promise<void> {
  const { store, training, nutrition, recovery } = env;
  const at = (date: LocalDate, time: string) => zonedToInstant(date, time, tz).ms;
  await savePrefs(store, {
    onboarded: true, goal: 'general', experience: 'some', trainingDays: 3, equipment: 'home_dumbbell',
    trackers: { nutrition: true, water: true, sleep: true, body: true },
    targets: { kcal: null, proteinG: 110, carbsG: null, fatG: null, waterMl: 2500, sleepMin: 420 },
    checkinWeekday: 0,
  });
  // Loads rise once, then hold for the recent sessions, so the coach has a "ready to progress" suggestion to show.
  const start = addDays(weekStartOf(today, 1), -21);
  const pid = await training.createFromTemplate('tpl_home3');
  await training.activateProgram(pid, [1, 3, 5], start);
  await training.ensureSchedule(start, 21 + 28);
  const sched = (await training.listScheduled(start, addDays(today, -1))).filter((s) => s.status === 'planned');
  for (const [n, s] of sched.entries()) {
    if (n === 4) {
      await training.setScheduledStatus(s.id, 'skipped');
      continue;
    }
    const t0 = at(s.local_date, '18:00');
    const sid = await training.startSession({ scheduledId: s.id }, t0, tz);
    const d = await training.getSession(sid);
    let k = 0;
    for (const x of d?.exercises ?? []) {
      for (const set of x.sets) {
        if (x.input_type === 'weight_reps') await training.updateSet(set.id, { load_kg: 8 + 2 * Math.min(Math.floor(n / 3), 1) + (x.position % 3) * 2, reps: x.rep_max ?? 10, rir: 2 });
        else if (x.input_type === 'bodyweight_reps') await training.updateSet(set.id, { reps: 8 + Math.floor(n / 2) });
        await training.completeSet(set.id, t0 + (++k) * 150_000);
      }
    }
    await training.finishSession(sid, t0 + (k + 1) * 150_000);
  }
  const meals: [string, string, number][] = [['Breakfast', 'f_oats', 60], ['Breakfast', 'f_banana', 118], ['Lunch', 'f_chicken_breast', 150], ['Lunch', 'f_rice_white', 200], ['Dinner', 'f_salmon', 140], ['Dinner', 'f_broccoli', 120]];
  for (let i = 13; i >= 0; i--) {
    const date = addDays(today, -i);
    if (i % 5 !== 3) {
      const wake = 6 * 60 + 30 + ((i * 17) % 50);
      const time = `${String(Math.floor(wake / 60)).padStart(2, '0')}:${String(wake % 60).padStart(2, '0')}`;
      await recovery.saveSleep({ kind: 'night', startAt: at(addDays(date, -1), '23:15'), endAt: at(date, time), tz, manualDurationMin: null, awakeMin: 20, confirmedAsleep: false, quality: 3 + (i % 3 === 0 ? 1 : 0), notes: '' }, at(date, '12:00'));
    }
    if (i === 0) continue; // today starts empty so the quick actions have something to do
    for (let w = 0; w < 4 + (i % 4); w++) await recovery.addWater(w % 2 ? 500 : 250, date, at(date, '09:00') + w * 5_400_000, tz);
    if (i % 4 !== 2) for (const [slot, id, g] of meals.slice(0, 4 + (i % 3))) {
      const f = baselineFood(id);
      if (f) await nutrition.log(date, slot, { name: f.name, sourceKind: 'food', sourceId: f.id, snapshot: f.snapshot, qty: g, unit: 'g' }, at(date, '13:00'), tz);
    }
    if (i % 3 === 0) await recovery.addMeasurement('weight', 78.4 - (13 - i) * 0.05 + ((i * 7) % 5) * 0.1, date, at(date, '07:30'));
  }
  const oats = baselineFood('f_oats');
  if (oats) await nutrition.plan(addDays(today, 1), 'Breakfast', { name: oats.name, sourceKind: 'food', sourceId: oats.id, snapshot: oats.snapshot, qty: 60, unit: 'g' });
  await recovery.saveCheckin(addDays(weekStartOf(today, 1), -7), { energy: 4, soreness: 2, notes: '' }, at(addDays(today, -7), '20:00'), tz);
}
