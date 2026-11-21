import { GUARDRAILS, TOOL_BY_NAME, validateToolCall, type ToolCall } from '@/coach/contract';
import { computeInsights, type Insight } from '@/domain/coach-insights';
import { allowedUnits, sumNutrients, type NutrientSnapshot } from '@/domain/nutrition';
import { averageOverLoggedDays, sleepDuration, sleepMinutesByWakeDate, sumByDay } from '@/domain/recovery';
import { adherence, smoothedTrend } from '@/domain/review';
import { addDays, dateRange, isValidDate, localTimeOf, weekStartOf, type LocalDate } from '@/domain/time';
import { analyzeRecords, headlineRecords } from '@/domain/workout';
import type { ProgramDoc } from './catalog/programs';
import { logNutrients, type FoodLog, type LogInput, type Nutrition } from './nutrition';
import { loadPrefs, savePrefs, type Prefs } from './prefs';
import { toSleepEntry, type Recovery, type SleepLog } from './recovery';
import { json, newId, type Store } from './store';
import type { Training } from './training';

/**
 * On-device side of the AI coach.
 * - Read tools: answered from local SQLite; summaries only, no free-text notes.
 * - Proposals: validated against the real data and stored as `proposed`. Nothing changes
 *   until the user confirms; applying goes through the normal repositories (so it syncs).
 * - Every applied change keeps what is needed to undo it.
 */

export interface CoachCtx {
  today: LocalDate;
  tz: string;
  now: number;
}

export type ActionStatus = 'proposed' | 'applied' | 'declined' | 'failed' | 'undone';
export type ValueUnit = 'kg' | 'ml' | 'min' | 'sec' | 'kcal' | 'g' | 'date' | 'time' | 'count' | 'text' | 'weekdays';

export interface Change {
  /** i18n key suffix for the field label, e.g. "sets". */
  field: string;
  from: string | number | number[] | null;
  to: string | number | number[] | null;
  unit: ValueUnit;
}

export interface Preview {
  /** Short subject such as the exercise or workout name. */
  subject: string;
  changes: Change[];
  reason: string;
  destructive: boolean;
  undoable: boolean;
}

export interface CoachAction {
  id: string;
  thread_id: string | null;
  source: 'chat' | 'insight';
  tool: string;
  args: Record<string, unknown>;
  preview: Preview;
  status: ActionStatus;
  error: string | null;
  created_at: number;
  decided_at: number | null;
}

export interface CoachMessage {
  id: string;
  thread_id: string;
  seq: number;
  role: 'user' | 'assistant' | 'tool' | 'event';
  display_text: string;
  native: unknown | null;
  safety: string[];
  created_at: number;
}

type Row = Record<string, unknown>;
type Result<T = undefined> = { ok: true; value: T } | { ok: false; error: string };
const ok = <T,>(value: T): Result<T> => ({ ok: true, value });
const fail = (error: string): Result<never> => ({ ok: false, error });

const round = (v: number, dp = 1) => Math.round(v * 10 ** dp) / 10 ** dp;

const mapAction = (r: Row): CoachAction => ({
  id: r.id as string, thread_id: (r.thread_id as string) ?? null, source: r.source as CoachAction['source'], tool: r.tool as string,
  args: json(r.args as string, {}), preview: json(r.preview as string, { subject: '', changes: [], reason: '', destructive: false, undoable: false }),
  status: r.status as ActionStatus, error: (r.error as string) ?? null, created_at: r.created_at as number, decided_at: (r.decided_at as number) ?? null,
});

export class Coach {
  constructor(
    private store: Store,
    private training: Training,
    private nutrition: Nutrition,
    private recovery: Recovery,
  ) {}

  private get db() {
    return this.store.db;
  }

  // ───────────────────────── threads and messages ─────────────────────────

  async latestThread(): Promise<{ id: string; provider: string } | null> {
    return this.db.first<{ id: string; provider: string }>('SELECT id, provider FROM coach_threads ORDER BY updated_at DESC LIMIT 1');
  }

  async threadProvider(id: string): Promise<string | null> {
    return (await this.db.first<{ provider: string }>('SELECT provider FROM coach_threads WHERE id = ?', [id]))?.provider ?? null;
  }

  async createThread(provider: string, now: number): Promise<string> {
    const id = newId();
    await this.store.tx(async () => {
      await this.db.run('INSERT INTO coach_threads (id, provider, title, created_at, updated_at) VALUES (?,?,?,?,?)', [id, provider, '', now, now]);
      this.store.touch('coach_threads');
    });
    return id;
  }

  async listMessages(threadId: string): Promise<CoachMessage[]> {
    const rows = await this.db.all<Row>('SELECT * FROM coach_messages WHERE thread_id = ? ORDER BY seq', [threadId]);
    return rows.map((r) => ({
      id: r.id as string, thread_id: r.thread_id as string, seq: r.seq as number, role: r.role as CoachMessage['role'], display_text: r.display_text as string,
      native: r.native == null ? null : json<unknown>(r.native as string, null), safety: json<string[]>(r.safety as string, []), created_at: r.created_at as number,
    }));
  }

  /** Provider-native history, replayed unchanged on the next request. */
  async history(threadId: string): Promise<unknown[]> {
    const rows = await this.db.all<{ native: string }>('SELECT native FROM coach_messages WHERE thread_id = ? AND native IS NOT NULL ORDER BY seq', [threadId]);
    return rows.map((r) => JSON.parse(r.native));
  }

  /** Append in one transaction so a crash never leaves half a turn in the history. */
  async appendMessages(threadId: string, items: { role: CoachMessage['role']; displayText: string; native?: unknown; safety?: string[] }[], now: number): Promise<void> {
    if (items.length === 0) return;
    await this.store.tx(async () => {
      const max = await this.db.first<{ m: number | null }>('SELECT MAX(seq) AS m FROM coach_messages WHERE thread_id = ?', [threadId]);
      let seq = (max?.m ?? -1) + 1;
      for (const it of items) {
        await this.db.run('INSERT INTO coach_messages (id, thread_id, seq, role, display_text, native, safety, created_at) VALUES (?,?,?,?,?,?,?,?)',
          [newId(), threadId, seq++, it.role, it.displayText, it.native === undefined ? null : JSON.stringify(it.native), JSON.stringify(it.safety ?? []), now]);
      }
      const title = items.find((i) => i.role === 'user')?.displayText.slice(0, 60);
      await this.db.run(`UPDATE coach_threads SET updated_at = ?, title = CASE WHEN title = '' AND ? IS NOT NULL THEN ? ELSE title END WHERE id = ?`, [now, title ?? null, title ?? '', threadId]);
      this.store.touch('coach_messages', 'coach_threads');
    });
  }

  /** Withdrawing consent or "clear history" removes chats; the change log of applied actions goes with them. */
  async deleteHistory(): Promise<void> {
    await this.store.tx(async () => {
      for (const t of ['coach_messages', 'coach_threads', 'coach_actions']) await this.db.run(`DELETE FROM ${t}`);
      this.store.touch('coach_messages', 'coach_threads', 'coach_actions');
    });
  }

  // ───────────────────────── read tools ─────────────────────────

  async runRead(name: string, input: unknown, ctx: CoachCtx): Promise<unknown> {
    const errs = validateToolCall(name, input);
    if (errs.length) return { error: errs.join('; ') };
    if (TOOL_BY_NAME[name].kind !== 'read') return { error: `${name} is not a read tool` };
    const a = input as Record<string, unknown>;
    const prefs = await loadPrefs(this.store);
    const from = (days: unknown) => addDays(ctx.today, -(Number(days) - 1));
    switch (name) {
      case 'get_profile': return this.profile(prefs);
      case 'get_training_overview': return this.trainingOverview(from(a.days), ctx);
      case 'get_active_plan': return this.activePlan(ctx);
      case 'get_exercise_history': return this.exerciseHistory(a.exercise_id as string, from(a.days), prefs);
      case 'search_exercises': return this.searchExercises(a.query as string);
      case 'get_nutrition_summary': return this.nutritionSummary(from(a.days), ctx, prefs);
      case 'get_hydration_summary': return this.hydrationSummary(from(a.days), ctx, prefs, Number(a.days));
      case 'get_sleep_summary': return this.sleepSummary(from(a.days), ctx, prefs, Number(a.days));
      case 'get_body_metrics': return this.bodyMetrics(from(a.days), ctx, prefs);
      case 'get_recent_entries': return this.recentEntries(a.kind as string, from(a.days), ctx, prefs);
      case 'get_insights': return { insights: (await this.insights(ctx)).map(({ id, kind, params, action }) => ({ id, kind, evidence: params, suggested_action: action })) };
      default: return { error: `Unknown tool ${name}` };
    }
  }

  private profile(p: Prefs) {
    const hidden = p.hideNutritionNumbers;
    return {
      goal: p.goal, experience: p.experience, training_days_per_week: p.trainingDays, equipment: p.equipment,
      display_units: { weight: p.weightUnit, liquids: p.volumeUnit === 'ml' ? 'mL' : 'fl oz', distance: p.distanceUnit, body_measurements: p.lengthUnit },
      week_starts_on: p.startOfWeek, smallest_load_step_kg: p.incrementKg,
      trackers_on: p.trackers,
      nutrition_numbers_hidden_by_user: hidden,
      targets: {
        water_ml: p.trackers.water ? p.targets.waterMl : 'hidden', sleep_min: p.trackers.sleep ? p.targets.sleepMin : 'hidden',
        kcal: hidden || !p.trackers.nutrition ? 'hidden' : p.targets.kcal, protein_g: hidden || !p.trackers.nutrition ? 'hidden' : p.targets.proteinG,
      },
      progression_rule: { enabled: p.progressionEnabled, min_reps_in_reserve: p.minRir },
    };
  }

  private async trainingOverview(from: LocalDate, ctx: CoachCtx) {
    const sessions = (await this.training.listHistory(300)).filter((s) => s.local_date >= from);
    const sched = await this.training.listScheduled(from, ctx.today);
    return {
      period: { from, to: ctx.today },
      workouts: sessions.map((s) => ({
        date: s.local_date, title: s.title, working_sets: s.totals.workingSets, total_reps: s.totals.totalReps, external_volume_kg: round(s.totals.volumeKg, 0),
        duration_min: s.ended_at ? Math.round((s.ended_at - s.started_at - s.paused_ms) / 60000) : null,
      })),
      scheduled_adherence: adherence(sched.map((s) => ({ localDate: s.local_date, status: s.status })), from, ctx.today),
    };
  }

  private async activePlan(ctx: CoachCtx) {
    const p = (await this.training.listPrograms()).find((x) => x.active) ?? null;
    if (!p) return { plan: null, note: 'No active plan. The user can pick one in the Train tab.' };
    const names = new Map((await this.training.listExercises()).map((e) => [e.id, e.name]));
    const upcoming = await this.training.listScheduled(addDays(ctx.today, -7), addDays(ctx.today, 13));
    return {
      plan: {
        program_id: p.id, name: p.name, training_weekdays: p.weekdays,
        days: p.doc.days.map((d) => ({
          day_id: d.id, name: d.name,
          exercises: d.exercises.map((x) => ({ slot_id: x.slotId, exercise_id: x.exerciseId, name: names.get(x.exerciseId) ?? x.exerciseId, sets: x.sets, rep_min: x.repMin, rep_max: x.repMax, duration_sec: x.durationSec, rest_sec: x.restSec })),
        })),
      },
      schedule: upcoming.filter((s) => s.status !== 'cancelled').map((s) => ({ scheduled_id: s.id, date: s.local_date, title: s.title, status: s.status, missed: s.status === 'planned' && s.local_date < ctx.today })),
    };
  }

  private async exerciseHistory(exerciseId: string, from: LocalDate, prefs: Prefs) {
    const ex = await this.training.getExercise(exerciseId);
    if (!ex) return { error: 'Unknown exercise id. Use search_exercises.' };
    const all = await this.training.historySets(exerciseId);
    const recs = headlineRecords(analyzeRecords(all).current, exerciseId);
    const bySession = new Map<string, { date: LocalDate; sets: unknown[] }>();
    for (const s of all.filter((x) => x.localDate >= from)) {
      const e = bySession.get(s.sessionId) ?? { date: s.localDate, sets: [] };
      e.sets.push({ kind: s.kind, reps: s.reps, load_kg: s.loadKg, load_mode: s.loadMode, duration_sec: s.durationSec, distance_m: s.distanceM, rir: s.rir });
      bySession.set(s.sessionId, e);
    }
    const slot = (await this.training.listPrograms()).find((p) => p.active)?.doc.days.flatMap((d) => d.exercises).find((x) => x.exerciseId === exerciseId) ?? null;
    const prog = ex.inputType === 'weight_reps'
      ? await this.training.progression(exerciseId, slot?.slotId ?? null, { enabled: prefs.progressionEnabled, incrementKg: prefs.incrementKg, minRir: prefs.minRir })
      : null;
    return {
      exercise: { id: ex.id, name: ex.name, equipment: ex.equipment, input: ex.inputType, load_entered_as: ex.loadConvention === 'per_implement' ? `per implement (x${ex.implementCount})` : ex.loadConvention },
      sessions: [...bySession.values()],
      records: recs.map((r) => ({ type: r.type, value: r.value, at_load_kg: r.atLoadKg ?? null })),
      progression_rule: prog ? { action: prog.suggestion.action, reason: prog.suggestion.reason, current_kg: prog.suggestion.currentLoadKg, suggested_kg: prog.suggestion.suggestedLoadKg, user_decision: prog.decision } : null,
    };
  }

  private async searchExercises(query: string) {
    const q = query.trim().toLowerCase();
    const list = (await this.training.listExercises()).filter((e) => e.name.toLowerCase().includes(q)).slice(0, 15);
    return { exercises: list.map((e) => ({ id: e.id, name: e.name, equipment: e.equipment, input: e.inputType })) };
  }

  private async nutritionSummary(from: LocalDate, ctx: CoachCtx, p: Prefs) {
    if (!p.trackers.nutrition) return { hidden: true };
    const logs = await this.nutrition.listLogs(from, ctx.today);
    const days = dateRange(from, ctx.today).map((d) => {
      const items = logs.filter((l) => l.local_date === d);
      if (p.hideNutritionNumbers) return { date: d, entries: items.length };
      const t = sumNutrients(items.map(logNutrients));
      return { date: d, entries: items.length, kcal: Math.round(t.kcal), protein_g: round(t.proteinG), carbs_g: round(t.carbsG), fat_g: round(t.fatG), partial: Object.entries(t.partial).filter(([, v]) => v).map(([k]) => k) };
    });
    return p.hideNutritionNumbers
      ? { numbers_hidden_by_user: true, days }
      : { days, targets: { kcal: p.targets.kcal, protein_g: p.targets.proteinG, carbs_g: p.targets.carbsG, fat_g: p.targets.fatG }, note: 'Days with 0 entries are unlogged, not zero intake. "partial" lists nutrients some entries lack.' };
  }

  private async hydrationSummary(from: LocalDate, ctx: CoachCtx, p: Prefs, days: number) {
    if (!p.trackers.water) return { hidden: true };
    const rows = await this.recovery.listWater(from, ctx.today);
    const byDay = sumByDay(rows, (w) => w.amount_ml, (w) => w.local_date);
    const avg = averageOverLoggedDays(byDay, days);
    return { goal_ml: p.targets.waterMl, days: [...byDay].map(([date, ml]) => ({ date, ml })), average_ml_over_logged_days: avg.average == null ? null : Math.round(avg.average), logged_days: avg.loggedDays, range_days: days };
  }

  private async sleepSummary(from: LocalDate, ctx: CoachCtx, p: Prefs, days: number) {
    if (!p.trackers.sleep) return { hidden: true };
    const rows = await this.recovery.listSleep(from, ctx.today);
    const nights = sleepMinutesByWakeDate(rows.map(toSleepEntry), false);
    const avg = averageOverLoggedDays(nights, days);
    return {
      goal_min: p.targets.sleepMin,
      entries: rows.map((s) => { const d = sleepDuration(toSleepEntry(s)); return { wake_date: s.wake_date, kind: s.kind, minutes: d ? Math.round(d.minutes) : null, measure: d?.measure ?? null, quality_1_to_5: s.quality }; }),
      average_night_min_over_logged_nights: avg.average == null ? null : Math.round(avg.average), logged_nights: avg.loggedDays, range_days: days,
      note: 'measure "time_in_bed" means the user did not confirm it was all sleep. Naps are excluded from the average.',
    };
  }

  private async bodyMetrics(from: LocalDate, ctx: CoachCtx, p: Prefs) {
    if (!p.trackers.body) return { hidden: true };
    const w = await this.recovery.listMeasurements('weight', from, ctx.today);
    const trend = smoothedTrend(w.map((m) => ({ date: m.local_date, value: m.value })));
    return { weight_kg: w.map((m) => ({ date: m.local_date, value: round(m.value, 2) })), trend_kg_latest: trend.length ? round(trend[trend.length - 1].value, 2) : null, note: 'Daily weight fluctuates; discuss trends, not single days.' };
  }

  private async recentEntries(kind: string, from: LocalDate, ctx: CoachCtx, p: Prefs) {
    if (kind === 'water') {
      if (!p.trackers.water) return { hidden: true };
      return { entries: (await this.recovery.listWater(from, ctx.today)).map((w) => ({ id: w.id, date: w.local_date, time: localTimeOf(w.logged_at, w.tz), amount_ml: w.amount_ml })) };
    }
    if (kind === 'food') {
      if (!p.trackers.nutrition) return { hidden: true };
      return { entries: (await this.nutrition.listLogs(from, ctx.today)).map((l) => ({ id: l.id, date: l.local_date, meal: l.meal_slot, name: l.name, qty: l.qty, unit: l.unit, kcal: p.hideNutritionNumbers || l.kcal == null ? undefined : Math.round(l.kcal) })) };
    }
    if (kind === 'sleep') {
      if (!p.trackers.sleep) return { hidden: true };
      return { entries: (await this.recovery.listSleep(from, ctx.today)).map((s) => ({ id: s.id, wake_date: s.wake_date, kind: s.kind, minutes: Math.round(sleepDuration(toSleepEntry(s))?.minutes ?? 0) })) };
    }
    if (!p.trackers.body) return { hidden: true };
    const out = [];
    for (const k of ['weight', 'waist', 'hips', 'chest']) out.push(...(await this.recovery.listMeasurements(k, from, ctx.today)).map((m) => ({ id: m.id, date: m.local_date, kind: m.kind, value: m.value })));
    return { entries: out };
  }

  // ───────────────────────── insights ─────────────────────────

  async insights(ctx: CoachCtx): Promise<Insight[]> {
    const p = await loadPrefs(this.store);
    const weekStart = weekStartOf(ctx.today, p.startOfWeek);
    const programs = await this.training.listPrograms();
    const active = programs.find((x) => x.active) ?? null;
    const sched = await this.training.listScheduled(weekStart, addDays(ctx.today, 6));
    const nextDates = dateRange(ctx.today, addDays(ctx.today, 6));
    const history = await this.training.listHistory(60);
    const progression: { exerciseId: string; name: string; currentKg: number; suggestedKg: number; sessions: number }[] = [];
    if (active && p.progressionEnabled) {
      const names = new Map((await this.training.listExercises()).map((e) => [e.id, e.name]));
      for (const x of active.doc.days.flatMap((d) => d.exercises)) {
        const r = await this.training.progression(x.exerciseId, x.slotId, { enabled: true, incrementKg: p.incrementKg, minRir: p.minRir });
        // A load the user already chose (here or in the logger) after the latest session settles it.
        const latest = r.suggestion.supporting[0]?.startedAt ?? 0;
        const chosen = await this.db.first<{ n: number }>(`SELECT COUNT(*) AS n FROM progression_decisions WHERE exercise_id = ? AND deleted_at IS NULL AND decided_at > ?`, [x.exerciseId, latest]);
        if (r.suggestion.action === 'increase' && r.decision == null && !chosen?.n && r.suggestion.currentLoadKg != null && r.suggestion.suggestedLoadKg != null) {
          progression.push({ exerciseId: x.exerciseId, name: names.get(x.exerciseId) ?? x.exerciseId, currentKg: r.suggestion.currentLoadKg, suggestedKg: r.suggestion.suggestedLoadKg, sessions: r.suggestion.supporting.length });
        }
      }
    }
    const from7 = addDays(ctx.today, -6);
    const water = p.trackers.water ? await this.recovery.listWater(from7, ctx.today) : [];
    const sleep = p.trackers.sleep ? (await this.recovery.listSleep(from7, ctx.today)).filter((s) => s.kind === 'night') : [];
    const wakes = sleep.filter((s) => s.end_at != null).map((s) => { const [h, m] = localTimeOf(s.end_at!, s.tz).split(':').map(Number); return h * 60 + m; });
    const checkin = await this.recovery.getCheckin(weekStart);
    return computeInsights({
      today: ctx.today,
      trackers: { water: p.trackers.water, sleep: p.trackers.sleep },
      targets: { waterMl: p.targets.waterMl, sleepMin: p.targets.sleepMin },
      hasActivePlan: !!active,
      sessionsLast14: history.filter((s) => s.local_date >= addDays(ctx.today, -13)).length,
      missed: sched.filter((s) => s.status === 'planned' && s.local_date < ctx.today).map((s) => ({ scheduledId: s.id, title: s.title, date: s.local_date })),
      plannedDates: sched.filter((s) => s.status === 'planned' && s.local_date >= ctx.today).map((s) => s.local_date),
      nextDates,
      progression,
      waterByDay: sumByDay(water, (w) => w.amount_ml, (w) => w.local_date),
      sleepByDay: sleepMinutesByWakeDate(sleep.map(toSleepEntry), false),
      avgWakeMin: wakes.length ? wakes.reduce((x, y) => x + y, 0) / wakes.length : null,
      reminderKinds: (await this.recovery.listReminders()).filter((r) => r.enabled === 1).map((r) => r.kind),
      soreness: checkin?.soreness ?? null,
      dismissed: p.coachDismissed,
    });
  }

  async dismissInsight(id: string): Promise<void> {
    const p = await loadPrefs(this.store);
    if (!p.coachDismissed.includes(id)) await savePrefs(this.store, { coachDismissed: [...p.coachDismissed.slice(-99), id] });
  }

  // ───────────────────────── proposals ─────────────────────────

  listActions(limit = 50): Promise<CoachAction[]> {
    return this.db.all<Row>('SELECT * FROM coach_actions ORDER BY created_at DESC LIMIT ?', [limit]).then((r) => r.map(mapAction));
  }

  async getAction(id: string): Promise<CoachAction | null> {
    const r = await this.db.first<Row>('SELECT * FROM coach_actions WHERE id = ?', [id]);
    return r ? mapAction(r) : null;
  }

  /**
   * Validate a proposal from the model (or an insight) and store it as pending.
   * Returns the action, or an error message the model can read and correct.
   */
  async propose(source: 'chat' | 'insight', threadId: string | null, call: Pick<ToolCall, 'name' | 'input'>, ctx: CoachCtx): Promise<Result<CoachAction>> {
    const errs = validateToolCall(call.name, call.input);
    if (errs.length) return fail(errs.join('; '));
    if (TOOL_BY_NAME[call.name].kind !== 'propose') return fail(`${call.name} is not a proposal tool`);
    const args = call.input as Record<string, unknown>;
    const preview = await this.buildPreview(call.name, args, ctx);
    if (!preview.ok) return preview;
    const id = newId();
    await this.store.tx(async () => {
      await this.db.run('INSERT INTO coach_actions (id, thread_id, source, tool, args, preview, status, created_at) VALUES (?,?,?,?,?,?,?,?)',
        [id, threadId, source, call.name, JSON.stringify(args), JSON.stringify(preview.value), 'proposed', ctx.now]);
      this.store.touch('coach_actions');
    });
    return ok((await this.getAction(id))!);
  }

  private async buildPreview(tool: string, a: Record<string, unknown>, ctx: CoachCtx): Promise<Result<Preview>> {
    const reason = String(a.reason ?? '');
    const p: Omit<Preview, 'subject' | 'changes'> = { reason, destructive: false, undoable: true };
    const exName = async (id: string) => (await this.training.getExercise(id))?.name ?? null;
    switch (tool) {
      case 'propose_update_plan_exercise':
      case 'propose_swap_plan_exercise':
      case 'propose_remove_plan_exercise': {
        const prog = await this.training.getProgram(a.program_id as string);
        const slot = prog?.doc.days.flatMap((d) => d.exercises).find((x) => x.slotId === a.slot_id);
        if (!prog || !slot) return fail('Unknown program_id or slot_id. Call get_active_plan for current ids.');
        const name = (await exName(slot.exerciseId)) ?? slot.exerciseId;
        if (tool === 'propose_remove_plan_exercise') {
          return ok({ ...p, subject: `${prog.name}: ${name}`, destructive: true, changes: [{ field: 'exercise_removed', from: name, to: null, unit: 'text' }] });
        }
        if (tool === 'propose_swap_plan_exercise') {
          const to = await exName(a.exercise_id as string);
          if (!to) return fail('Unknown exercise_id. Use search_exercises.');
          if (a.exercise_id === slot.exerciseId) return fail('That is already the exercise in this slot.');
          return ok({ ...p, subject: prog.name, changes: [{ field: 'exercise', from: name, to, unit: 'text' }] });
        }
        const changes: Change[] = [];
        const cmp = (field: string, from: number | null, to: unknown, unit: ValueUnit) => { if (to != null && to !== from) changes.push({ field, from, to: to as number, unit }); };
        cmp('sets', slot.sets, a.sets, 'count');
        cmp('rep_min', slot.repMin, a.rep_min, 'count');
        cmp('rep_max', slot.repMax, a.rep_max, 'count');
        cmp('rest', slot.restSec, a.rest_sec, 'sec');
        cmp('duration', slot.durationSec, a.duration_sec, 'sec');
        const repMin = (a.rep_min as number | null) ?? slot.repMin;
        const repMax = (a.rep_max as number | null) ?? slot.repMax;
        if (repMin != null && repMax != null && repMin > repMax) return fail('The resulting rep range would have rep_min above rep_max.');
        if (changes.length === 0) return fail('Those values are already set; nothing would change.');
        return ok({ ...p, subject: `${prog.name}: ${name}`, changes });
      }
      case 'propose_add_plan_exercise': {
        const prog = await this.training.getProgram(a.program_id as string);
        const day = prog?.doc.days.find((d) => d.id === a.day_id);
        if (!prog || !day) return fail('Unknown program_id or day_id. Call get_active_plan.');
        const name = await exName(a.exercise_id as string);
        if (!name) return fail('Unknown exercise_id. Use search_exercises.');
        return ok({ ...p, subject: `${prog.name}: ${day.name}`, changes: [
          { field: 'exercise_added', from: null, to: name, unit: 'text' }, { field: 'sets', from: null, to: a.sets as number, unit: 'count' },
          ...(a.duration_sec != null ? [{ field: 'duration', from: null, to: a.duration_sec as number, unit: 'sec' as const }] : [{ field: 'rep_range', from: null, to: `${a.rep_min}–${a.rep_max}`, unit: 'text' as const }]),
          { field: 'rest', from: null, to: a.rest_sec as number, unit: 'sec' },
        ] });
      }
      case 'propose_reschedule_workout':
      case 'propose_skip_workout': {
        const s = await this.training.getScheduled(a.scheduled_id as string);
        if (!s) return fail('Unknown scheduled_id. Call get_active_plan.');
        if (s.status === 'completed' || s.status === 'cancelled') return fail(`That workout is ${s.status} and cannot be changed.`);
        if (tool === 'propose_skip_workout') {
          if (s.status === 'skipped') return fail('That workout is already skipped.');
          return ok({ ...p, subject: s.title, changes: [{ field: 'status', from: 'planned', to: 'skipped', unit: 'text' }] });
        }
        const d = a.new_date as string;
        if (!isValidDate(d)) return fail('new_date is not a valid date.');
        if (d < ctx.today) return fail('new_date must be today or later.');
        if (d > addDays(ctx.today, 60)) return fail('new_date must be within 60 days.');
        if (d === s.local_date) return fail('The workout is already on that date.');
        return ok({ ...p, subject: s.title, changes: [{ field: 'date', from: s.local_date, to: d, unit: 'date' }] });
      }
      case 'propose_set_next_load': {
        const ex = await this.training.getExercise(a.exercise_id as string);
        if (!ex) return fail('Unknown exercise_id. Use search_exercises.');
        if (ex.inputType !== 'weight_reps') return fail('Load suggestions only apply to weighted exercises.');
        const last = await this.training.previousSets(ex.id);
        const lastLoad = last?.sets.reduce<number | null>((m, s) => (s.load_kg != null && (m == null || s.load_kg > m) ? s.load_kg : m), null) ?? null;
        const load = a.load_kg as number;
        // Light loads can't move by 10%: one smallest step (e.g. the next dumbbell) is always allowed.
        const step = (await loadPrefs(this.store)).incrementKg;
        const maxLoad = lastLoad == null ? null : lastLoad + Math.max(lastLoad * (GUARDRAILS.maxLoadIncreasePct / 100), step);
        if (maxLoad != null && load > maxLoad + 1e-9) {
          return fail(`That is more than +${GUARDRAILS.maxLoadIncreasePct}% or one ${step} kg step over the last working load (${lastLoad} kg). Suggest a smaller step.`);
        }
        return ok({ ...p, subject: ex.name, undoable: true, changes: [{ field: 'next_load', from: lastLoad, to: load, unit: 'kg' }] });
      }
      case 'propose_set_targets': {
        const prefs = await loadPrefs(this.store);
        const changes: Change[] = [];
        const add = (field: string, from: number | null, to: unknown, unit: ValueUnit) => { if (to != null && to !== from) changes.push({ field, from, to: to as number, unit }); };
        add('target_water', prefs.targets.waterMl, a.water_ml, 'ml');
        add('target_sleep', prefs.targets.sleepMin, a.sleep_min, 'min');
        add('target_kcal', prefs.targets.kcal, a.kcal, 'kcal');
        add('target_protein', prefs.targets.proteinG, a.protein_g, 'g');
        if (changes.length === 0) return fail('Those targets are already set.');
        return ok({ ...p, subject: '', changes });
      }
      case 'propose_log_water': {
        const date = (a.date as string | null) ?? ctx.today;
        if (!isValidDate(date) || date > ctx.today) return fail('date must be today or earlier.');
        if (date < addDays(ctx.today, -30)) return fail('date must be within the last 30 days.');
        return ok({ ...p, subject: date, changes: [{ field: 'water_entry', from: null, to: a.amount_ml as number, unit: 'ml' }] });
      }
      case 'propose_create_reminder': {
        return ok({ ...p, subject: '', changes: [
          { field: `reminder_${a.kind}`, from: null, to: a.time as string, unit: 'time' },
          { field: 'reminder_days', from: null, to: [...(a.weekdays as number[])].sort(), unit: 'weekdays' },
        ] });
      }
      case 'propose_delete_entry': {
        const desc = await this.describeEntry(a.kind as string, a.entry_id as string);
        if (!desc) return fail('Entry not found. Call get_recent_entries for current ids.');
        return ok({ ...p, subject: desc, destructive: true, changes: [{ field: `delete_${a.kind}`, from: desc, to: null, unit: 'text' }] });
      }
      default:
        return fail(`Unsupported proposal ${tool}`);
    }
  }

  private async describeEntry(kind: string, id: string): Promise<string | null> {
    if (kind === 'water') {
      const w = await this.db.first<{ amount_ml: number; local_date: string }>('SELECT amount_ml, local_date FROM water_logs WHERE id = ? AND deleted_at IS NULL', [id]);
      return w ? `${w.amount_ml} mL · ${w.local_date}` : null;
    }
    if (kind === 'food') {
      const l = await this.nutrition.getLog(id);
      return l ? `${l.name} · ${l.local_date}` : null;
    }
    if (kind === 'sleep') {
      const s = await this.recovery.getSleep(id);
      return s ? `${s.kind} · ${s.wake_date}` : null;
    }
    const m = await this.db.first<{ kind: string; local_date: string; value: number }>('SELECT kind, local_date, value FROM measurements WHERE id = ? AND deleted_at IS NULL', [id]);
    return m ? `${m.kind} ${m.value} · ${m.local_date}` : null;
  }

  async decline(id: string, now: number): Promise<void> {
    await this.store.tx(async () => {
      await this.db.run(`UPDATE coach_actions SET status = 'declined', decided_at = ? WHERE id = ? AND status = 'proposed'`, [now, id]);
      this.store.touch('coach_actions');
    });
  }

  /** Apply a confirmed proposal. Idempotent: only a `proposed` action runs, once. */
  async apply(id: string, ctx: CoachCtx): Promise<Result<CoachAction>> {
    const action = await this.getAction(id);
    if (!action) return fail('not_found');
    if (action.status !== 'proposed') return action.status === 'applied' ? ok(action) : fail(`already_${action.status}`);
    // Re-check against current data: it may have changed since the proposal was made.
    const fresh = await this.buildPreview(action.tool, action.args, ctx);
    if (!fresh.ok) {
      await this.setStatus(id, 'failed', ctx.now, null, fresh.error);
      return fresh;
    }
    try {
      let undo: unknown = null;
      await this.store.tx(async () => {
        const claimed = await this.db.first<{ status: string }>('SELECT status FROM coach_actions WHERE id = ?', [id]);
        if (claimed?.status !== 'proposed') return;
        undo = await this.perform(action.tool, action.args, ctx, id);
        await this.db.run(`UPDATE coach_actions SET status = 'applied', decided_at = ?, undo = ? WHERE id = ?`, [ctx.now, JSON.stringify(undo), id]);
        this.store.touch('coach_actions');
      });
      return ok((await this.getAction(id))!);
    } catch (e) {
      await this.setStatus(id, 'failed', ctx.now, null, e instanceof Error ? e.message : 'error');
      return fail('apply_failed');
    }
  }

  private async setStatus(id: string, status: ActionStatus, now: number, undo: unknown, error: string | null) {
    await this.store.tx(async () => {
      await this.db.run('UPDATE coach_actions SET status = ?, decided_at = ?, undo = COALESCE(?, undo), error = ? WHERE id = ?', [status, now, undo == null ? null : JSON.stringify(undo), error, id]);
      this.store.touch('coach_actions');
    });
  }

  private async editPlan(programId: string, edit: (doc: ProgramDoc) => void) {
    const prog = await this.training.getProgram(programId);
    if (!prog) throw new Error('program_missing');
    const before = structuredClone(prog.doc);
    const doc = structuredClone(prog.doc);
    edit(doc);
    await this.training.saveProgram(programId, { doc });
    return { programId, before, revisionAfter: prog.revision + 1 };
  }

  /** Runs inside the apply transaction. Returns what undo needs. */
  private async perform(tool: string, a: Record<string, unknown>, ctx: CoachCtx, actionId: string): Promise<unknown> {
    switch (tool) {
      case 'propose_update_plan_exercise':
        return this.editPlan(a.program_id as string, (doc) => {
          const x = doc.days.flatMap((d) => d.exercises).find((e) => e.slotId === a.slot_id)!;
          if (a.sets != null) x.sets = a.sets as number;
          if (a.rep_min != null) x.repMin = a.rep_min as number;
          if (a.rep_max != null) x.repMax = a.rep_max as number;
          if (a.rest_sec != null) x.restSec = a.rest_sec as number;
          if (a.duration_sec != null) x.durationSec = a.duration_sec as number;
        });
      case 'propose_swap_plan_exercise':
        return this.editPlan(a.program_id as string, (doc) => {
          const x = doc.days.flatMap((d) => d.exercises).find((e) => e.slotId === a.slot_id)!;
          x.alternatives = [x.exerciseId, ...x.alternatives.filter((e) => e !== a.exercise_id)].slice(0, 4);
          x.exerciseId = a.exercise_id as string;
        });
      case 'propose_add_plan_exercise':
        return this.editPlan(a.program_id as string, (doc) => {
          doc.days.find((d) => d.id === a.day_id)!.exercises.push({
            slotId: newId(), exerciseId: a.exercise_id as string, sets: a.sets as number, repMin: (a.rep_min as number) ?? null, repMax: (a.rep_max as number) ?? null,
            durationSec: (a.duration_sec as number) ?? null, restSec: a.rest_sec as number, alternatives: [],
          });
        });
      case 'propose_remove_plan_exercise':
        return this.editPlan(a.program_id as string, (doc) => {
          for (const d of doc.days) d.exercises = d.exercises.filter((e) => e.slotId !== a.slot_id);
        });
      case 'propose_reschedule_workout': {
        const s = (await this.training.getScheduled(a.scheduled_id as string))!;
        await this.training.reschedule(s.id, a.new_date as string);
        return { scheduledId: s.id, localDate: s.local_date, movedFrom: s.moved_from, status: s.status };
      }
      case 'propose_skip_workout': {
        const s = (await this.training.getScheduled(a.scheduled_id as string))!;
        await this.training.setScheduledStatus(s.id, 'skipped');
        return { scheduledId: s.id, localDate: s.local_date, movedFrom: s.moved_from, status: s.status };
      }
      case 'propose_set_next_load': {
        const decisionId = newId();
        await this.store.put('progression_decisions', { id: decisionId, exercise_id: a.exercise_id as string, basis_key: `coach:${actionId}`, decision: 'adjusted', load_kg: a.load_kg as number, decided_at: ctx.now });
        return { decisionId };
      }
      case 'propose_set_targets': {
        const prefs = await loadPrefs(this.store);
        const before = { ...prefs.targets };
        await savePrefs(this.store, { targets: {
          ...prefs.targets,
          waterMl: (a.water_ml as number | null) ?? prefs.targets.waterMl, sleepMin: (a.sleep_min as number | null) ?? prefs.targets.sleepMin,
          kcal: (a.kcal as number | null) ?? prefs.targets.kcal, proteinG: (a.protein_g as number | null) ?? prefs.targets.proteinG,
        } });
        return { before, keys: ['water_ml', 'sleep_min', 'kcal', 'protein_g'].filter((k) => a[k] != null) };
      }
      case 'propose_log_water':
        return { waterId: await this.recovery.addWater(a.amount_ml as number, (a.date as string | null) ?? ctx.today, ctx.now, ctx.tz) };
      case 'propose_create_reminder':
        return { reminderId: await this.recovery.saveReminder({ kind: a.kind as 'water', time: a.time as string, weekdays: a.weekdays as number[], enabled: true }) };
      case 'propose_delete_entry':
        return this.deleteEntry(a.kind as string, a.entry_id as string);
      default:
        throw new Error('unsupported');
    }
  }

  private async deleteEntry(kind: string, id: string): Promise<unknown> {
    if (kind === 'water') {
      const w = (await this.db.first<Row>('SELECT * FROM water_logs WHERE id = ?', [id]))!;
      await this.recovery.removeWater(id);
      return { kind, row: w };
    }
    if (kind === 'food') {
      const l = (await this.nutrition.getLog(id))!;
      await this.nutrition.deleteLog(id);
      return { kind, row: l };
    }
    if (kind === 'sleep') {
      const s = (await this.recovery.getSleep(id))!;
      await this.recovery.removeSleep(id);
      return { kind, row: s };
    }
    const m = (await this.db.first<Row>('SELECT * FROM measurements WHERE id = ?', [id]))!;
    await this.recovery.removeMeasurement(id);
    return { kind, row: m };
  }

  /** Reverse an applied change, when that is still safe. */
  async undo(id: string, ctx: CoachCtx): Promise<Result<CoachAction>> {
    const action = await this.getAction(id);
    if (!action || action.status !== 'applied') return fail('not_applied');
    if (!action.preview.undoable) return fail('not_undoable');
    const row = await this.db.first<{ undo: string | null }>('SELECT undo FROM coach_actions WHERE id = ?', [id]);
    const u = json<Record<string, unknown> | null>(row?.undo ?? null, null);
    if (!u) return fail('not_undoable');
    try {
      await this.store.tx(async () => {
        switch (action.tool) {
          case 'propose_update_plan_exercise':
          case 'propose_swap_plan_exercise':
          case 'propose_add_plan_exercise':
          case 'propose_remove_plan_exercise': {
            const prog = await this.training.getProgram(u.programId as string);
            if (!prog) throw new Error('program_missing');
            if (prog.revision !== u.revisionAfter) throw new Error('changed_since');
            await this.training.saveProgram(prog.id, { doc: u.before as ProgramDoc });
            break;
          }
          case 'propose_reschedule_workout':
          case 'propose_skip_workout':
            await this.store.patch('scheduled_workouts', u.scheduledId as string, { local_date: u.localDate as string, moved_from: (u.movedFrom as string | null) ?? null, status: u.status as string });
            break;
          case 'propose_set_next_load':
            await this.store.remove('progression_decisions', u.decisionId as string);
            break;
          case 'propose_set_targets': {
            const prefs = await loadPrefs(this.store);
            const before = u.before as Prefs['targets'];
            const keys = u.keys as string[];
            await savePrefs(this.store, { targets: {
              ...prefs.targets,
              ...(keys.includes('water_ml') ? { waterMl: before.waterMl } : {}), ...(keys.includes('sleep_min') ? { sleepMin: before.sleepMin } : {}),
              ...(keys.includes('kcal') ? { kcal: before.kcal } : {}), ...(keys.includes('protein_g') ? { proteinG: before.proteinG } : {}),
            } });
            break;
          }
          case 'propose_log_water':
            await this.recovery.removeWater(u.waterId as string);
            break;
          case 'propose_create_reminder':
            await this.recovery.removeReminder(u.reminderId as string);
            break;
          case 'propose_delete_entry':
            await this.restoreEntry(u.kind as string, u.row as Row, ctx);
            break;
          default:
            throw new Error('not_undoable');
        }
        await this.db.run(`UPDATE coach_actions SET status = 'undone', decided_at = ? WHERE id = ?`, [ctx.now, id]);
        this.store.touch('coach_actions');
      });
      return ok((await this.getAction(id))!);
    } catch (e) {
      return fail(e instanceof Error ? e.message : 'undo_failed');
    }
  }

  /** A deleted row is restored as a new entry: a synced deletion is final, so the old id cannot come back. */
  private async restoreEntry(kind: string, r: Row, ctx: CoachCtx) {
    if (kind === 'water') {
      await this.recovery.addWater(r.amount_ml as number, r.local_date as string, r.logged_at as number, r.tz as string);
    } else if (kind === 'food') {
      const l = r as unknown as FoodLog;
      const input: LogInput = { name: l.name, sourceKind: l.source_kind, sourceId: l.source_id, snapshot: json<NutrientSnapshot>(l.snapshot, null as never), qty: l.qty, unit: l.unit };
      if (!allowedUnits(input.snapshot).includes(input.unit)) throw new Error('restore_failed');
      await this.nutrition.log(l.local_date, l.meal_slot, input, l.logged_at, l.tz);
    } else if (kind === 'sleep') {
      const s = r as unknown as SleepLog;
      await this.recovery.saveSleep({ kind: s.kind, startAt: s.start_at, endAt: s.end_at, tz: s.tz, wakeDate: s.wake_date, manualDurationMin: s.manual_duration_min, awakeMin: s.awake_min, confirmedAsleep: s.confirmed_asleep === 1, quality: s.quality, notes: s.notes }, ctx.now);
    } else {
      await this.recovery.addMeasurement(r.kind as string, r.value as number, r.local_date as string, r.measured_at as number);
    }
  }
}
