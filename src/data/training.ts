import { addDays, localDateOf, weekdayOf, type LocalDate } from '@/domain/time';
import type { HistorySet, InputType, LoadConvention, LoadMode, SetKind, SetLike } from '@/domain/types';
import { analyzeRecords, workoutTotals, type PersonalRecord, type WorkoutTotals } from '@/domain/workout';
import { suggestProgression, suggestionBasisKey, type ProgressionConfig, type ProgressionSession, type ProgressionSuggestion } from '@/domain/progression';
import { BUILTIN_EXERCISES, builtinExercise, type Exercise } from './catalog/exercises';
import { estimateMinutes, templateById, type PlanDay, type PlanExercise, type ProgramDoc } from './catalog/programs';
import { json, newId, type Row, type Store } from './store';

export class AppError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export interface Program {
  id: string;
  name: string;
  description: string;
  doc: ProgramDoc;
  templateId: string | null;
  active: boolean;
  weekdays: number[];
  revision: number;
}

export interface Scheduled {
  id: string;
  local_date: LocalDate;
  program_id: string | null;
  day_id: string | null;
  title: string;
  status: 'planned' | 'completed' | 'skipped' | 'cancelled';
  session_id: string | null;
  moved_from: LocalDate | null;
}

export interface SessionRow {
  id: string; title: string; status: 'active' | 'completed'; started_at: number; ended_at: number | null; tz: string; local_date: LocalDate;
  paused_ms: number; paused_at: number | null; scheduled_id: string | null; program_id: string | null; day_id: string | null; notes: string;
  active_exercise_id: string | null; rest_started_at: number | null; rest_sec: number | null; rest_exercise_id: string | null;
}

export interface SessionExerciseRow {
  id: string; session_id: string; position: number; exercise_id: string; name: string; input_type: InputType; load_convention: LoadConvention;
  implement_count: number; equipment: string; target_sets: number | null; rep_min: number | null; rep_max: number | null;
  target_duration_sec: number | null; rest_sec: number | null; status: 'pending' | 'done' | 'skipped'; replaced_exercise_id: string | null;
  plan_slot_id: string | null; discomfort: number; notes: string;
}

export interface SetRow {
  id: string; session_id: string; session_exercise_id: string; exercise_id: string; position: number; kind: SetKind; reps: number | null;
  load_kg: number | null; load_mode: LoadMode; duration_sec: number | null; distance_m: number | null; rir: number | null;
  completed_at: number | null; prefill_source: 'previous' | 'plan' | 'suggestion' | null;
}

export interface SessionDetail {
  session: SessionRow;
  exercises: (SessionExerciseRow & { sets: SetRow[] })[];
}

export const toSetLike = (s: SetRow): SetLike => ({
  id: s.id, kind: s.kind, reps: s.reps, loadKg: s.load_kg, loadMode: s.load_mode, durationSec: s.duration_sec, distanceM: s.distance_m, rir: s.rir, completedAt: s.completed_at,
});

const mapProgram = (r: Row): Program => ({
  id: r.id as string, name: r.name as string, description: r.description as string, doc: json<ProgramDoc>(r.doc, { days: [] }),
  templateId: r.template_id as string | null, active: r.active === 1, weekdays: json<number[]>(r.weekdays, []), revision: r.revision as number,
});

const mapExercise = (r: Row): Exercise => ({
  id: r.id as string, name: r.name as string, equipment: r.equipment as Exercise['equipment'], pattern: r.pattern as Exercise['pattern'],
  inputType: r.input_type as InputType, loadConvention: r.load_convention as LoadConvention, implementCount: r.implement_count as number,
  cues: r.cues as string, builtin: false,
});

export class Training {
  constructor(private store: Store) {}
  private get db() {
    return this.store.db;
  }

  // ───────── exercises ─────────
  async listExercises(): Promise<Exercise[]> {
    const custom = (await this.db.all<Row>('SELECT * FROM exercises WHERE deleted_at IS NULL ORDER BY name')).map(mapExercise);
    return [...custom, ...BUILTIN_EXERCISES].sort((a, b) => a.name.localeCompare(b.name));
  }

  async getExercise(id: string): Promise<Exercise | null> {
    const b = builtinExercise(id);
    if (b) return b;
    const r = await this.db.first<Row>('SELECT * FROM exercises WHERE id = ?', [id]);
    return r ? mapExercise(r) : null;
  }

  async saveCustomExercise(e: Omit<Exercise, 'builtin' | 'id'> & { id?: string }): Promise<string> {
    if (!e.name.trim()) throw new AppError('name_required');
    const id = e.id ?? newId();
    await this.store.put('exercises', {
      id, name: e.name.trim(), equipment: e.equipment, pattern: e.pattern, input_type: e.inputType, load_convention: e.loadConvention,
      implement_count: e.implementCount, cues: e.cues,
    });
    return id;
  }

  // ───────── programs ─────────
  async listPrograms(): Promise<Program[]> {
    return (await this.db.all<Row>('SELECT * FROM programs WHERE deleted_at IS NULL ORDER BY active DESC, name')).map(mapProgram);
  }

  async getProgram(id: string): Promise<Program | null> {
    const r = await this.db.first<Row>('SELECT * FROM programs WHERE id = ? AND deleted_at IS NULL', [id]);
    return r ? mapProgram(r) : null;
  }

  private async writeProgram(p: Program) {
    await this.store.put('programs', {
      id: p.id, name: p.name, description: p.description, doc: JSON.stringify(p.doc), template_id: p.templateId, active: p.active ? 1 : 0,
      weekdays: JSON.stringify(p.weekdays), revision: p.revision,
    });
  }

  /** Copies a starter template into the user's own, fully editable data. */
  async createFromTemplate(templateId: string): Promise<string> {
    const t = templateById(templateId);
    if (!t) throw new AppError('template_missing');
    const id = newId();
    await this.writeProgram({ id, name: t.name, description: t.description, doc: reId(t.doc), templateId, active: false, weekdays: [], revision: 1 });
    return id;
  }

  async createBlankProgram(name: string): Promise<string> {
    const id = newId();
    await this.writeProgram({ id, name: name.trim() || 'My routine', description: '', doc: { days: [{ id: newId(), name: 'Day 1', estMinutes: 5, exercises: [] }] }, templateId: null, active: false, weekdays: [], revision: 1 });
    return id;
  }

  async duplicateProgram(id: string): Promise<string> {
    const p = await this.getProgram(id);
    if (!p) throw new AppError('program_missing');
    const copy = newId();
    await this.writeProgram({ ...p, id: copy, name: `${p.name} (copy)`, doc: reId(p.doc), active: false, weekdays: [], revision: 1 });
    return copy;
  }

  /** Saving bumps the revision. Past sessions hold their own snapshot, so history is never rewritten. */
  async saveProgram(id: string, patch: { name?: string; description?: string; doc?: ProgramDoc }): Promise<void> {
    const p = await this.getProgram(id);
    if (!p) throw new AppError('program_missing');
    const doc = patch.doc ? { days: patch.doc.days.map((d) => ({ ...d, estMinutes: estimateMinutes(d.exercises) })) } : p.doc;
    await this.writeProgram({ ...p, ...patch, doc, revision: p.revision + 1 });
  }

  async deleteProgram(id: string, today: LocalDate): Promise<void> {
    await this.store.tx(async () => {
      await this.clearFuturePlanned(id, today);
      await this.store.remove('programs', id);
    });
  }

  private async clearFuturePlanned(programId: string | null, today: LocalDate) {
    const rows = await this.db.all<{ id: string }>(
      `SELECT id FROM scheduled_workouts WHERE deleted_at IS NULL AND status = 'planned' AND local_date >= ? AND moved_from IS NULL AND ${programId ? 'program_id = ?' : 'program_id IS NOT NULL'}`,
      programId ? [today, programId] : [today],
    );
    for (const r of rows) await this.store.patch('scheduled_workouts', r.id, { status: 'cancelled' });
  }

  /** Make one program the active plan on the given weekdays and (re)build the upcoming schedule. */
  async activateProgram(id: string, weekdays: number[], today: LocalDate): Promise<void> {
    await this.store.tx(async () => {
      for (const p of await this.listPrograms()) {
        if (p.active && p.id !== id) await this.store.patch('programs', p.id, { active: 0 });
      }
      await this.clearFuturePlanned(null, today);
      await this.store.patch('programs', id, { active: 1, weekdays: JSON.stringify([...new Set(weekdays)].sort()) });
      await this.ensureSchedule(today, 28, true);
    });
  }

  async deactivatePrograms(today: LocalDate): Promise<void> {
    await this.store.tx(async () => {
      for (const p of await this.listPrograms()) if (p.active) await this.store.patch('programs', p.id, { active: 0 });
      await this.clearFuturePlanned(null, today);
    });
  }

  // ───────── schedule ─────────
  /** Materialise planned occurrences for the active program. Deterministic ids keep two devices from duplicating a day. */
  async ensureSchedule(today: LocalDate, horizonDays = 28, revive = false): Promise<void> {
    const r = await this.db.first<Row>('SELECT * FROM programs WHERE active = 1 AND deleted_at IS NULL');
    if (!r) return;
    const p = mapProgram(r);
    if (p.weekdays.length === 0 || p.doc.days.length === 0) return;
    await this.store.tx(async () => {
      const last = await this.db.first<{ day_id: string; id: string }>(
        `SELECT id, day_id FROM scheduled_workouts WHERE program_id = ? AND deleted_at IS NULL ${revive ? "AND status != 'cancelled'" : ''} ORDER BY substr(id, -10) DESC LIMIT 1`, [p.id]);
      let idx = last ? (p.doc.days.findIndex((d) => d.id === last.day_id) + 1) % p.doc.days.length : 0;
      const lastSlot = last ? last.id.slice(-10) : null;
      for (let i = 0; i < horizonDays; i++) {
        const date = addDays(today, i);
        if (lastSlot && date <= lastSlot) continue;
        if (!p.weekdays.includes(weekdayOf(date))) continue;
        const id = `sw_${p.id}_${date}`;
        const exists = await this.db.first<{ status: string; deleted_at: number | null }>('SELECT status, deleted_at FROM scheduled_workouts WHERE id = ?', [id]);
        if (exists && (exists.deleted_at != null || !revive)) continue;
        const d = p.doc.days[idx];
        if (exists) await this.store.patch('scheduled_workouts', id, { status: 'planned', day_id: d.id, title: d.name, local_date: date });
        else await this.store.put('scheduled_workouts', { id, local_date: date, program_id: p.id, day_id: d.id, title: d.name, status: 'planned', session_id: null, moved_from: null });
        idx = (idx + 1) % p.doc.days.length;
      }
    });
  }

  listScheduled(from: LocalDate, to: LocalDate): Promise<Scheduled[]> {
    return this.db.all<Scheduled>('SELECT * FROM scheduled_workouts WHERE deleted_at IS NULL AND local_date BETWEEN ? AND ? ORDER BY local_date', [from, to]);
  }

  getScheduled(id: string): Promise<Scheduled | null> {
    return this.db.first<Scheduled>('SELECT * FROM scheduled_workouts WHERE id = ? AND deleted_at IS NULL', [id]);
  }

  /** Moves the workout: it now counts on (and in the week of) its new date. */
  async reschedule(id: string, newDate: LocalDate): Promise<void> {
    const s = await this.getScheduled(id);
    if (!s || s.status === 'completed') return;
    await this.store.patch('scheduled_workouts', id, { local_date: newDate, moved_from: s.moved_from ?? s.local_date, status: 'planned' });
  }

  async setScheduledStatus(id: string, status: 'planned' | 'skipped' | 'cancelled'): Promise<void> {
    const s = await this.getScheduled(id);
    if (!s || s.status === 'completed') return;
    await this.store.patch('scheduled_workouts', id, { status });
  }

  async planDay(programId: string | null, dayId: string | null): Promise<{ program: Program; day: PlanDay } | null> {
    if (!programId || !dayId) return null;
    const program = await this.getProgram(programId);
    const day = program?.doc.days.find((d) => d.id === dayId);
    return program && day ? { program, day } : null;
  }

  // ───────── active session ─────────
  getActiveSession(): Promise<SessionRow | null> {
    return this.db.first<SessionRow>(`SELECT * FROM sessions WHERE status = 'active' AND deleted_at IS NULL ORDER BY started_at DESC LIMIT 1`);
  }

  async getSession(id: string): Promise<SessionDetail | null> {
    const session = await this.db.first<SessionRow>('SELECT * FROM sessions WHERE id = ? AND deleted_at IS NULL', [id]);
    if (!session) return null;
    const exs = await this.db.all<SessionExerciseRow>('SELECT * FROM session_exercises WHERE session_id = ? AND deleted_at IS NULL ORDER BY position', [id]);
    const sets = await this.db.all<SetRow>('SELECT * FROM session_sets WHERE session_id = ? AND deleted_at IS NULL ORDER BY position', [id]);
    return { session, exercises: exs.map((e) => ({ ...e, sets: sets.filter((s) => s.session_exercise_id === e.id) })) };
  }

  /** Completed working sets from the most recent finished session that included this exercise. */
  async previousSets(exerciseId: string, beforeSessionId?: string): Promise<{ sessionId: string; startedAt: number; sets: SetRow[] } | null> {
    const prev = await this.db.first<{ id: string; started_at: number; sx: string }>(
      `SELECT s.id, s.started_at, x.id AS sx FROM session_exercises x JOIN sessions s ON s.id = x.session_id
       WHERE x.exercise_id = ? AND s.status = 'completed' AND s.deleted_at IS NULL AND x.deleted_at IS NULL AND s.id != ?
         AND EXISTS (SELECT 1 FROM session_sets t WHERE t.session_exercise_id = x.id AND t.completed_at IS NOT NULL AND t.kind = 'working' AND t.deleted_at IS NULL)
       ORDER BY s.started_at DESC LIMIT 1`, [exerciseId, beforeSessionId ?? '']);
    if (!prev) return null;
    const sets = await this.db.all<SetRow>(
      `SELECT * FROM session_sets WHERE session_exercise_id = ? AND completed_at IS NOT NULL AND kind = 'working' AND deleted_at IS NULL ORDER BY position`, [prev.sx]);
    return { sessionId: prev.id, startedAt: prev.started_at, sets };
  }

  private async buildExercise(sessionId: string, position: number, ex: Exercise, plan: Partial<PlanExercise> | null, replaced: string | null) {
    const sxId = newId();
    const sx: Row & { id: string } = {
      id: sxId, session_id: sessionId, position, exercise_id: ex.id, name: ex.name, input_type: ex.inputType, load_convention: ex.loadConvention,
      implement_count: ex.implementCount, equipment: ex.equipment, target_sets: plan?.sets ?? null, rep_min: plan?.repMin ?? null, rep_max: plan?.repMax ?? null,
      target_duration_sec: plan?.durationSec ?? null, rest_sec: plan?.restSec ?? 90, status: 'pending', replaced_exercise_id: replaced,
      plan_slot_id: plan?.slotId ?? null, discomfort: 0, notes: '',
    };
    await this.store.put('session_exercises', sx, { sync: false });
    const prev = await this.previousSets(ex.id, sessionId);
    const accepted = await this.db.first<{ load_kg: number; decided_at: number }>(
      `SELECT load_kg, decided_at FROM progression_decisions WHERE exercise_id = ? AND decision IN ('accepted','adjusted') AND deleted_at IS NULL ORDER BY decided_at DESC LIMIT 1`, [ex.id]);
    const useAccepted = accepted && accepted.load_kg != null && (!prev || accepted.decided_at > prev.startedAt);
    const count = Math.max(1, plan?.sets ?? prev?.sets.length ?? 3);
    for (let i = 0; i < count; i++) {
      const p = prev ? prev.sets[Math.min(i, prev.sets.length - 1)] : null;
      await this.store.put('session_sets', {
        id: newId(), session_id: sessionId, session_exercise_id: sxId, exercise_id: ex.id, position: i, kind: 'working',
        reps: p?.reps ?? (ex.inputType === 'weight_reps' || ex.inputType === 'bodyweight_reps' ? (plan?.repMin ?? null) : null),
        load_kg: useAccepted ? accepted.load_kg : (p?.load_kg ?? null),
        load_mode: p?.load_mode ?? (ex.inputType === 'bodyweight_reps' ? 'bodyweight' : 'external'),
        duration_sec: p?.duration_sec ?? (ex.inputType === 'duration' ? (plan?.durationSec ?? null) : null),
        distance_m: p?.distance_m ?? null, rir: null, completed_at: null,
        prefill_source: useAccepted ? 'suggestion' : p ? 'previous' : plan ? 'plan' : null,
      }, { sync: false });
    }
    return sxId;
  }

  /** Start from a scheduled workout, a plan day, or empty. Safe to call twice: an active session is reused. */
  async startSession(input: { scheduledId?: string; programId?: string; dayId?: string; title?: string }, now: number, tz: string): Promise<string> {
    return this.store.tx(async () => {
      const active = await this.getActiveSession();
      if (active) return active.id;
      const sched = input.scheduledId ? await this.getScheduled(input.scheduledId) : null;
      const plan = await this.planDay(sched?.program_id ?? input.programId ?? null, sched?.day_id ?? input.dayId ?? null);
      const id = newId();
      await this.store.put('sessions', {
        id, title: sched?.title ?? plan?.day.name ?? input.title ?? 'Workout', status: 'active', started_at: now, ended_at: null, tz, local_date: localDateOf(now, tz),
        paused_ms: 0, paused_at: null, scheduled_id: sched?.id ?? null, program_id: plan?.program.id ?? null, day_id: plan?.day.id ?? null, notes: '',
        active_exercise_id: null, rest_started_at: null, rest_sec: null, rest_exercise_id: null,
      }, { sync: false });
      let first: string | null = null;
      for (const [i, px] of (plan?.day.exercises ?? []).entries()) {
        const ex = await this.getExercise(px.exerciseId);
        if (!ex) continue;
        const sx = await this.buildExercise(id, i, ex, px, null);
        first ??= sx;
      }
      if (first) await this.store.patch('sessions', id, { active_exercise_id: first }, { sync: false });
      return id;
    });
  }

  private async syncFlag(sessionId: string): Promise<{ sync: boolean }> {
    const s = await this.db.first<{ status: string }>('SELECT status FROM sessions WHERE id = ?', [sessionId]);
    return { sync: s?.status === 'completed' };
  }

  async setActiveExercise(sessionId: string, sxId: string): Promise<void> {
    await this.store.patch('sessions', sessionId, { active_exercise_id: sxId }, { sync: false });
  }

  async addExercise(sessionId: string, exerciseId: string): Promise<string> {
    return this.store.tx(async () => {
      const ex = await this.getExercise(exerciseId);
      if (!ex) throw new AppError('exercise_missing');
      const max = await this.db.first<{ m: number | null }>('SELECT MAX(position) AS m FROM session_exercises WHERE session_id = ? AND deleted_at IS NULL', [sessionId]);
      const sx = await this.buildExercise(sessionId, (max?.m ?? -1) + 1, ex, null, null);
      const o = await this.syncFlag(sessionId);
      if (o.sync) await this.resyncExercise(sx);
      else await this.store.patch('sessions', sessionId, { active_exercise_id: sx }, { sync: false });
      return sx;
    });
  }

  private async resyncExercise(sxId: string) {
    await this.store.patch('session_exercises', sxId, {});
    for (const s of await this.db.all<{ id: string }>('SELECT id FROM session_sets WHERE session_exercise_id = ? AND deleted_at IS NULL', [sxId])) await this.store.patch('session_sets', s.id, {});
  }

  /**
   * Swap the movement for this session only. Completed sets stay with the
   * original entry (marked done); the replacement gets fresh rows. Pass
   * updatePlan to also change the program for future sessions.
   */
  async replaceExercise(sxId: string, newExerciseId: string, updatePlan: boolean): Promise<string> {
    return this.store.tx(async () => {
      const sx = await this.db.first<SessionExerciseRow>('SELECT * FROM session_exercises WHERE id = ? AND deleted_at IS NULL', [sxId]);
      const ex = await this.getExercise(newExerciseId);
      if (!sx || !ex) throw new AppError('exercise_missing');
      const done = await this.db.first<{ n: number }>('SELECT COUNT(*) AS n FROM session_sets WHERE session_exercise_id = ? AND completed_at IS NOT NULL AND deleted_at IS NULL', [sxId]);
      const plan = { slotId: sx.plan_slot_id ?? undefined, sets: sx.target_sets ?? undefined, repMin: sx.rep_min, repMax: sx.rep_max, durationSec: sx.target_duration_sec, restSec: sx.rest_sec ?? 90 };
      let position = sx.position;
      if (done && done.n > 0) {
        await this.db.run('DELETE FROM session_sets WHERE session_exercise_id = ? AND completed_at IS NULL', [sxId]);
        await this.store.patch('session_exercises', sxId, { status: 'done' }, { sync: false });
        await this.db.run('UPDATE session_exercises SET position = position + 1 WHERE session_id = ? AND position > ?', [sx.session_id, sx.position]);
        position = sx.position + 1;
      } else {
        await this.db.run('DELETE FROM session_sets WHERE session_exercise_id = ?', [sxId]);
        await this.db.run('DELETE FROM session_exercises WHERE id = ?', [sxId]);
      }
      const id = await this.buildExercise(sx.session_id, position, ex, plan, sx.replaced_exercise_id ?? sx.exercise_id);
      await this.store.patch('sessions', sx.session_id, { active_exercise_id: id }, { sync: false });
      this.store.touch('session_sets', 'session_exercises');
      if (updatePlan && sx.plan_slot_id) {
        const s = await this.db.first<{ program_id: string | null }>('SELECT program_id FROM sessions WHERE id = ?', [sx.session_id]);
        const p = s?.program_id ? await this.getProgram(s.program_id) : null;
        if (p) {
          const doc = { days: p.doc.days.map((d) => ({ ...d, exercises: d.exercises.map((x) => (x.slotId === sx.plan_slot_id ? { ...x, exerciseId: newExerciseId } : x)) })) };
          await this.saveProgram(p.id, { doc });
        }
      }
      return id;
    });
  }

  /** Swap candidates: the plan slot's listed alternatives first, then other movements with the same pattern. */
  async alternativesFor(sxId: string): Promise<string[]> {
    const sx = await this.db.first<SessionExerciseRow & { program_id: string | null }>(
      'SELECT x.*, s.program_id FROM session_exercises x JOIN sessions s ON s.id = x.session_id WHERE x.id = ?', [sxId]);
    if (!sx) return [];
    const out: string[] = [];
    if (sx.plan_slot_id && sx.program_id) {
      const p = await this.getProgram(sx.program_id);
      const slot = p?.doc.days.flatMap((d) => d.exercises).find((x) => x.slotId === sx.plan_slot_id);
      if (slot) out.push(...[slot.exerciseId, ...slot.alternatives].filter((id) => id !== sx.exercise_id));
    }
    const pattern = (await this.getExercise(sx.exercise_id))?.pattern;
    if (pattern) for (const e of BUILTIN_EXERCISES) if (e.pattern === pattern && e.id !== sx.exercise_id && !out.includes(e.id)) out.push(e.id);
    return out.slice(0, 6);
  }

  async setExerciseFields(sxId: string, fields: { status?: 'pending' | 'done' | 'skipped'; notes?: string; discomfort?: number; rest_sec?: number }): Promise<void> {
    const sx = await this.db.first<{ session_id: string }>('SELECT session_id FROM session_exercises WHERE id = ?', [sxId]);
    if (!sx) return;
    await this.store.patch('session_exercises', sxId, fields as Row, await this.syncFlag(sx.session_id));
  }

  async addSet(sxId: string, kind: SetKind = 'working'): Promise<string> {
    return this.store.tx(async () => {
      const sx = await this.db.first<SessionExerciseRow>('SELECT * FROM session_exercises WHERE id = ? AND deleted_at IS NULL', [sxId]);
      if (!sx) throw new AppError('exercise_missing');
      const sets = await this.db.all<SetRow>('SELECT * FROM session_sets WHERE session_exercise_id = ? AND deleted_at IS NULL ORDER BY position', [sxId]);
      const last = [...sets].reverse().find((s) => s.kind === kind) ?? null;
      const id = newId();
      let position = sets.length;
      if (kind === 'warmup') {
        // Warm-ups sit before the first working set.
        position = sets.filter((s) => s.kind === 'warmup').length;
        await this.db.run('UPDATE session_sets SET position = position + 1 WHERE session_exercise_id = ? AND position >= ?', [sxId, position]);
      }
      await this.store.put('session_sets', {
        id, session_id: sx.session_id, session_exercise_id: sxId, exercise_id: sx.exercise_id, position, kind,
        reps: last?.reps ?? null, load_kg: kind === 'warmup' ? null : (last?.load_kg ?? null), load_mode: last?.load_mode ?? (sx.input_type === 'bodyweight_reps' ? 'bodyweight' : 'external'),
        duration_sec: last?.duration_sec ?? null, distance_m: last?.distance_m ?? null, rir: null, completed_at: null, prefill_source: null,
      }, await this.syncFlag(sx.session_id));
      return id;
    });
  }

  /** Draft edits are written straight to disk so nothing is lost on force-close. */
  async updateSet(setId: string, fields: Partial<Pick<SetRow, 'reps' | 'load_kg' | 'load_mode' | 'duration_sec' | 'distance_m' | 'rir' | 'kind'>>): Promise<void> {
    const s = await this.db.first<SetRow>('SELECT * FROM session_sets WHERE id = ? AND deleted_at IS NULL', [setId]);
    if (!s) return;
    for (const k of ['reps', 'load_kg', 'duration_sec', 'distance_m', 'rir'] as const) {
      const v = fields[k];
      if (v != null && (!Number.isFinite(v) || v < 0)) throw new AppError('invalid_value');
    }
    if (fields.reps != null && fields.reps > 1000) throw new AppError('invalid_value');
    if (fields.load_kg != null && fields.load_kg > 2000) throw new AppError('invalid_value');
    await this.store.patch('session_sets', setId, { ...fields, prefill_source: s.completed_at ? s.prefill_source : null } as Row, await this.syncFlag(s.session_id));
  }

  async removeSet(setId: string): Promise<void> {
    const s = await this.db.first<SetRow>('SELECT * FROM session_sets WHERE id = ? AND deleted_at IS NULL', [setId]);
    if (!s) return;
    await this.store.remove('session_sets', setId, await this.syncFlag(s.session_id));
  }

  /**
   * Mark a set complete. Durable and idempotent: the first call writes
   * completed_at and starts that exercise's rest timer; repeat taps do nothing.
   */
  async completeSet(setId: string, now: number): Promise<boolean> {
    return this.store.tx(async () => {
      const s = await this.db.first<SetRow>('SELECT * FROM session_sets WHERE id = ? AND deleted_at IS NULL', [setId]);
      if (!s) throw new AppError('set_missing');
      if (s.completed_at != null) return false;
      const sx = await this.db.first<SessionExerciseRow>('SELECT * FROM session_exercises WHERE id = ?', [s.session_exercise_id]);
      if (!sx) throw new AppError('exercise_missing');
      const ok = sx.input_type === 'duration' ? (s.duration_sec ?? 0) > 0
        : sx.input_type === 'distance_duration' ? (s.distance_m ?? 0) > 0 || (s.duration_sec ?? 0) > 0
        : (s.reps ?? 0) > 0;
      if (!ok) throw new AppError('missing_value');
      if (s.load_mode !== 'bodyweight' && sx.input_type === 'bodyweight_reps' && !(s.load_kg && s.load_kg > 0)) throw new AppError('missing_load');
      const o = await this.syncFlag(s.session_id);
      await this.store.patch('session_sets', setId, { completed_at: now }, o);
      if (!o.sync) await this.store.patch('sessions', s.session_id, { rest_started_at: now, rest_sec: sx.rest_sec, rest_exercise_id: sx.id }, { sync: false });
      return true;
    });
  }

  /** Undo for a recent completion: the row returns to draft and its rest timer is cleared. */
  async uncompleteSet(setId: string): Promise<void> {
    await this.store.tx(async () => {
      const s = await this.db.first<SetRow>('SELECT * FROM session_sets WHERE id = ? AND deleted_at IS NULL', [setId]);
      if (!s || s.completed_at == null) return;
      const o = await this.syncFlag(s.session_id);
      await this.store.patch('session_sets', setId, { completed_at: null }, o);
      if (!o.sync) await this.db.run('UPDATE sessions SET rest_started_at = NULL, rest_sec = NULL, rest_exercise_id = NULL WHERE id = ? AND rest_started_at = ?', [s.session_id, s.completed_at]);
      this.store.touch('sessions');
    });
  }

  async skipRest(sessionId: string): Promise<void> {
    await this.store.patch('sessions', sessionId, { rest_started_at: null, rest_sec: null, rest_exercise_id: null }, { sync: false });
  }

  async pause(sessionId: string, now: number): Promise<void> {
    const s = await this.db.first<SessionRow>('SELECT * FROM sessions WHERE id = ?', [sessionId]);
    if (!s || s.status !== 'active' || s.paused_at != null) return;
    await this.store.patch('sessions', sessionId, { paused_at: now }, { sync: false });
  }

  async resume(sessionId: string, now: number): Promise<void> {
    const s = await this.db.first<SessionRow>('SELECT * FROM sessions WHERE id = ?', [sessionId]);
    if (!s || s.status !== 'active' || s.paused_at == null) return;
    const pausedFor = Math.max(0, now - s.paused_at);
    // The rest timer is frozen while paused: shift its start by the paused span.
    await this.store.patch('sessions', sessionId, { paused_at: null, paused_ms: s.paused_ms + pausedFor, rest_started_at: s.rest_started_at == null ? null : s.rest_started_at + pausedFor }, { sync: false });
  }

  async setSessionNotes(sessionId: string, notes: string): Promise<void> {
    await this.store.patch('sessions', sessionId, { notes }, await this.syncFlag(sessionId));
  }

  /**
   * Finish atomically. Unfinished draft rows are dropped, the scheduled
   * occurrence is linked, and one idempotent `session_complete` operation is
   * queued for sync. Repeated taps return the same completed session.
   */
  async finishSession(sessionId: string, now: number): Promise<'finished' | 'already'> {
    return this.store.tx(async () => {
      const s = await this.db.first<SessionRow>('SELECT * FROM sessions WHERE id = ? AND deleted_at IS NULL', [sessionId]);
      if (!s) throw new AppError('session_missing');
      if (s.status === 'completed') return 'already';
      const done = await this.db.first<{ n: number }>('SELECT COUNT(*) AS n FROM session_sets WHERE session_id = ? AND completed_at IS NOT NULL AND deleted_at IS NULL', [sessionId]);
      if (!done || done.n === 0) throw new AppError('no_completed_sets');
      await this.db.run('DELETE FROM session_sets WHERE session_id = ? AND completed_at IS NULL', [sessionId]);
      await this.db.run(`UPDATE session_exercises SET status = CASE WHEN EXISTS (SELECT 1 FROM session_sets t WHERE t.session_exercise_id = session_exercises.id) THEN 'done' ELSE 'skipped' END WHERE session_id = ?`, [sessionId]);
      const pausedMs = s.paused_ms + (s.paused_at != null ? Math.max(0, now - s.paused_at) : 0);
      await this.store.patch('sessions', sessionId, { status: 'completed', ended_at: now, paused_at: null, paused_ms: pausedMs, rest_started_at: null, rest_sec: null, rest_exercise_id: null, active_exercise_id: null }, { sync: false });
      const payload = {
        sessions: await this.db.all('SELECT * FROM sessions WHERE id = ?', [sessionId]),
        session_exercises: await this.db.all('SELECT * FROM session_exercises WHERE session_id = ?', [sessionId]),
        session_sets: await this.db.all('SELECT * FROM session_sets WHERE session_id = ?', [sessionId]),
      };
      await this.store.enqueue('sessions', sessionId, 'session_complete', 0, payload);
      if (s.scheduled_id) await this.store.patch('scheduled_workouts', s.scheduled_id, { status: 'completed', session_id: sessionId });
      this.store.touch('sessions', 'session_exercises', 'session_sets');
      return 'finished';
    });
  }

  /** Throw away an in-progress session. Nothing was synced, so rows are removed outright. */
  async discardSession(sessionId: string): Promise<void> {
    await this.store.tx(async () => {
      const s = await this.db.first<SessionRow>('SELECT * FROM sessions WHERE id = ?', [sessionId]);
      if (!s || s.status !== 'active') return;
      await this.db.run('DELETE FROM session_sets WHERE session_id = ?', [sessionId]);
      await this.db.run('DELETE FROM session_exercises WHERE session_id = ?', [sessionId]);
      await this.db.run('DELETE FROM sessions WHERE id = ?', [sessionId]);
      this.store.touch('sessions', 'session_exercises', 'session_sets');
    });
  }

  /** Delete a finished workout. Its scheduled occurrence becomes open again; records are re-derived by readers. */
  async deleteSession(sessionId: string): Promise<void> {
    await this.store.tx(async () => {
      const s = await this.db.first<SessionRow>('SELECT * FROM sessions WHERE id = ? AND deleted_at IS NULL', [sessionId]);
      if (!s) return;
      if (s.status === 'active') return this.discardSession(sessionId);
      for (const r of await this.db.all<{ id: string }>('SELECT id FROM session_sets WHERE session_id = ? AND deleted_at IS NULL', [sessionId])) await this.store.remove('session_sets', r.id);
      for (const r of await this.db.all<{ id: string }>('SELECT id FROM session_exercises WHERE session_id = ? AND deleted_at IS NULL', [sessionId])) await this.store.remove('session_exercises', r.id);
      await this.store.remove('sessions', sessionId);
      if (s.scheduled_id) await this.store.patch('scheduled_workouts', s.scheduled_id, { status: 'planned', session_id: null });
    });
  }

  // ───────── history & derived ─────────
  /** Every completed set of finished sessions, optionally for one exercise. Source for totals, PRs and charts. */
  async historySets(exerciseId?: string): Promise<(HistorySet & { name: string; localDate: LocalDate })[]> {
    const rows = await this.db.all<SetRow & { started_at: number; local_date: string; input_type: InputType; load_convention: LoadConvention; implement_count: number; name: string }>(
      `SELECT t.*, s.started_at, s.local_date, x.input_type, x.load_convention, x.implement_count, x.name
       FROM session_sets t JOIN session_exercises x ON x.id = t.session_exercise_id JOIN sessions s ON s.id = t.session_id
       WHERE s.status = 'completed' AND s.deleted_at IS NULL AND x.deleted_at IS NULL AND t.deleted_at IS NULL AND t.completed_at IS NOT NULL
       ${exerciseId ? 'AND t.exercise_id = ?' : ''} ORDER BY t.completed_at`, exerciseId ? [exerciseId] : []);
    return rows.map((r) => ({
      ...toSetLike(r), exerciseId: r.exercise_id, inputType: r.input_type, loadConvention: r.load_convention, implementCount: r.implement_count,
      sessionId: r.session_id, sessionStartedAt: r.started_at, name: r.name, localDate: r.local_date,
    }));
  }

  async listHistory(limit: number, offset = 0): Promise<(SessionRow & { totals: WorkoutTotals })[]> {
    const sessions = await this.db.all<SessionRow>(`SELECT * FROM sessions WHERE status = 'completed' AND deleted_at IS NULL ORDER BY started_at DESC LIMIT ? OFFSET ?`, [limit, offset]);
    const out: (SessionRow & { totals: WorkoutTotals })[] = [];
    for (const s of sessions) out.push({ ...s, totals: await this.sessionTotals(s.id) });
    return out;
  }

  async sessionTotals(sessionId: string): Promise<WorkoutTotals> {
    const rows = await this.db.all<SetRow & { load_convention: LoadConvention; implement_count: number }>(
      `SELECT t.*, x.load_convention, x.implement_count FROM session_sets t JOIN session_exercises x ON x.id = t.session_exercise_id
       WHERE t.session_id = ? AND t.deleted_at IS NULL AND x.deleted_at IS NULL`, [sessionId]);
    return workoutTotals(rows.map((r) => ({ ...toSetLike(r), loadConvention: r.load_convention, implementCount: r.implement_count })));
  }

  /** PRs set during a session, derived from the whole history as it stands now. */
  async sessionRecords(sessionId: string): Promise<(PersonalRecord & { name: string })[]> {
    const all = await this.historySets();
    const names = new Map(all.map((s) => [s.exerciseId, s.name]));
    return analyzeRecords(all).events.filter((e) => e.sessionId === sessionId).map((e) => ({ ...e, name: names.get(e.exerciseId) ?? '' }));
  }

  /** Completed sessions for a plan slot or exercise, newest first, shaped for the progression rule. */
  async progressionSessions(exerciseId: string, planSlotId: string | null, limit = 2): Promise<ProgressionSession[]> {
    const xs = await this.db.all<SessionExerciseRow & { started_at: number }>(
      `SELECT x.*, s.started_at FROM session_exercises x JOIN sessions s ON s.id = x.session_id
       WHERE s.status = 'completed' AND s.deleted_at IS NULL AND x.deleted_at IS NULL AND x.status = 'done' AND ${planSlotId ? 'x.plan_slot_id = ?' : 'x.exercise_id = ?'}
       ORDER BY s.started_at DESC LIMIT ?`, [planSlotId ?? exerciseId, limit]);
    const out: ProgressionSession[] = [];
    for (const x of xs) {
      const sets = await this.db.all<SetRow>('SELECT * FROM session_sets WHERE session_exercise_id = ? AND deleted_at IS NULL ORDER BY position', [x.id]);
      out.push({ sessionId: x.session_id, startedAt: x.started_at, exerciseId: x.exercise_id, repMin: x.rep_min, repMax: x.rep_max, discomfort: x.discomfort === 1, sets: sets.map(toSetLike) });
    }
    return out;
  }

  /** Suggestion plus whether the user already decided on exactly this evidence. */
  async progression(exerciseId: string, planSlotId: string | null, cfg: ProgressionConfig): Promise<{ suggestion: ProgressionSuggestion; basisKey: string; decision: string | null }> {
    const suggestion = suggestProgression(exerciseId, await this.progressionSessions(exerciseId, planSlotId), cfg);
    const basisKey = suggestionBasisKey(exerciseId, suggestion);
    const d = await this.db.first<{ decision: string }>('SELECT decision FROM progression_decisions WHERE basis_key = ? AND deleted_at IS NULL ORDER BY decided_at DESC LIMIT 1', [basisKey]);
    return { suggestion, basisKey, decision: d?.decision ?? null };
  }

  async decideProgression(exerciseId: string, basisKey: string, decision: 'accepted' | 'adjusted' | 'dismissed', loadKg: number | null, now: number): Promise<void> {
    await this.store.put('progression_decisions', { id: newId(), exercise_id: exerciseId, basis_key: basisKey, decision, load_kg: loadKg, decided_at: now });
  }
}

/** Give a copied program its own day and slot ids so edits never touch the source. */
function reId(doc: ProgramDoc): ProgramDoc {
  return { days: doc.days.map((d) => ({ ...d, id: newId(), exercises: d.exercises.map((x) => ({ ...x, slotId: newId(), alternatives: [...x.alternatives] })) })) };
}
