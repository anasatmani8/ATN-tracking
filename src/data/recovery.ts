import { sleepDuration, validateSleep, validateWaterMl, wakeDateOf, type SleepEntry } from '@/domain/recovery';
import { localDateOf, type LocalDate } from '@/domain/time';
import { AppError } from './training';
import { newId, type Row, type Store } from './store';

export interface WaterLog { id: string; local_date: LocalDate; amount_ml: number; logged_at: number; tz: string }
export interface SleepLog {
  id: string; wake_date: LocalDate; kind: 'night' | 'nap'; start_at: number | null; end_at: number | null; tz: string; manual_duration_min: number | null;
  awake_min: number | null; confirmed_asleep: number; quality: number | null; notes: string; source: string;
}
export interface Measurement { id: string; local_date: LocalDate; kind: string; value: number; measured_at: number; source: string }
export interface Checkin { id: string; week_start: LocalDate; local_date: LocalDate; energy: number | null; soreness: number | null; notes: string }
export interface Reminder { id: string; kind: 'workout' | 'water' | 'bedtime' | 'checkin'; time: string; weekdays: string; enabled: number }

export const toSleepEntry = (s: SleepLog): SleepEntry => ({
  id: s.id, kind: s.kind, startAt: s.start_at, endAt: s.end_at, tz: s.tz, manualDurationMin: s.manual_duration_min, awakeMin: s.awake_min,
  confirmedAsleep: s.confirmed_asleep === 1, wakeDate: s.wake_date,
});

export interface SleepInput {
  id?: string;
  kind: 'night' | 'nap';
  startAt: number | null;
  endAt: number | null;
  tz: string;
  /** Required when only a manual duration is given. */
  wakeDate?: LocalDate;
  manualDurationMin: number | null;
  awakeMin: number | null;
  confirmedAsleep: boolean;
  quality: number | null;
  notes: string;
}

export class Recovery {
  constructor(private store: Store) {}
  private get db() {
    return this.store.db;
  }

  // ───────── water ─────────
  /** One row per drink, so undo removes exactly one entry. */
  async addWater(amountMl: number, date: LocalDate, now: number, tz: string): Promise<string> {
    if (!validateWaterMl(amountMl)) throw new AppError('invalid_amount');
    const id = newId();
    await this.store.put('water_logs', { id, local_date: date, amount_ml: Math.round(amountMl), logged_at: now, tz });
    return id;
  }

  async editWater(id: string, amountMl: number): Promise<void> {
    if (!validateWaterMl(amountMl)) throw new AppError('invalid_amount');
    await this.store.patch('water_logs', id, { amount_ml: Math.round(amountMl) });
  }

  removeWater(id: string) {
    return this.store.remove('water_logs', id);
  }

  listWater(from: LocalDate, to: LocalDate = from): Promise<WaterLog[]> {
    return this.db.all<WaterLog>('SELECT * FROM water_logs WHERE deleted_at IS NULL AND local_date BETWEEN ? AND ? ORDER BY logged_at', [from, to]);
  }

  async waterTotal(date: LocalDate): Promise<number> {
    const r = await this.db.first<{ t: number | null }>('SELECT SUM(amount_ml) AS t FROM water_logs WHERE deleted_at IS NULL AND local_date = ?', [date]);
    return r?.t ?? 0;
  }

  // ───────── sleep ─────────
  async saveSleep(i: SleepInput, now: number): Promise<string> {
    const err = validateSleep(i, now);
    if (err) throw new AppError(err);
    if (i.quality != null && (i.quality < 1 || i.quality > 5)) throw new AppError('invalid_value');
    const wake = i.endAt != null ? wakeDateOf(i.endAt, i.tz) : i.wakeDate;
    if (!wake) throw new AppError('need_times_or_duration');
    if (!sleepDuration(i)) throw new AppError('need_times_or_duration');
    const id = i.id ?? newId();
    await this.store.put('sleep_logs', {
      id, wake_date: wake, kind: i.kind, start_at: i.startAt, end_at: i.endAt, tz: i.tz, manual_duration_min: i.manualDurationMin, awake_min: i.awakeMin,
      confirmed_asleep: i.confirmedAsleep ? 1 : 0, quality: i.quality, notes: i.notes, source: 'manual',
    });
    return id;
  }

  removeSleep(id: string) {
    return this.store.remove('sleep_logs', id);
  }

  getSleep(id: string): Promise<SleepLog | null> {
    return this.db.first<SleepLog>('SELECT * FROM sleep_logs WHERE id = ? AND deleted_at IS NULL', [id]);
  }

  listSleep(from: LocalDate, to: LocalDate = from): Promise<SleepLog[]> {
    return this.db.all<SleepLog>('SELECT * FROM sleep_logs WHERE deleted_at IS NULL AND wake_date BETWEEN ? AND ? ORDER BY wake_date, ifnull(end_at, 0)', [from, to]);
  }

  // ───────── body ─────────
  async addMeasurement(kind: string, value: number, date: LocalDate, now: number, id: string = newId()): Promise<string> {
    const max = kind === 'weight' ? 500 : 5;
    if (!(value > 0) || value > max) throw new AppError('invalid_value');
    await this.store.put('measurements', { id, local_date: date, kind, value, measured_at: now, source: 'manual' });
    return id;
  }

  removeMeasurement(id: string) {
    return this.store.remove('measurements', id);
  }

  listMeasurements(kind: string, from: LocalDate, to: LocalDate): Promise<Measurement[]> {
    return this.db.all<Measurement>('SELECT * FROM measurements WHERE deleted_at IS NULL AND kind = ? AND local_date BETWEEN ? AND ? ORDER BY local_date, measured_at', [kind, from, to]);
  }

  // ───────── check-ins ─────────
  /** One check-in per week; saving again edits it. */
  async saveCheckin(weekStart: LocalDate, v: { energy: number | null; soreness: number | null; notes: string }, now: number, tz: string): Promise<string> {
    for (const n of [v.energy, v.soreness]) if (n != null && (n < 1 || n > 5)) throw new AppError('invalid_value');
    const existing = await this.getCheckin(weekStart);
    const id = existing?.id ?? `checkin_${weekStart}`;
    await this.store.put('checkins', { id, week_start: weekStart, local_date: existing?.local_date ?? localDateOf(now, tz), energy: v.energy, soreness: v.soreness, notes: v.notes });
    return id;
  }

  getCheckin(weekStart: LocalDate): Promise<Checkin | null> {
    return this.db.first<Checkin>('SELECT * FROM checkins WHERE deleted_at IS NULL AND week_start = ?', [weekStart]);
  }

  listCheckins(limit = 26): Promise<Checkin[]> {
    return this.db.all<Checkin>('SELECT * FROM checkins WHERE deleted_at IS NULL ORDER BY week_start DESC LIMIT ?', [limit]);
  }

  // ───────── reminders ─────────
  listReminders(): Promise<Reminder[]> {
    return this.db.all<Reminder>('SELECT * FROM reminders WHERE deleted_at IS NULL ORDER BY kind, time');
  }

  async saveReminder(r: { id?: string; kind: Reminder['kind']; time: string; weekdays: number[]; enabled: boolean }): Promise<string> {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(r.time)) throw new AppError('invalid_time');
    const id = r.id ?? newId();
    await this.store.put('reminders', { id, kind: r.kind, time: r.time, weekdays: JSON.stringify(r.weekdays), enabled: r.enabled ? 1 : 0 } as Row & { id: string });
    return id;
  }

  removeReminder(id: string) {
    return this.store.remove('reminders', id);
  }
}
