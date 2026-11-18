/**
 * Time rules. Instants are UTC milliseconds. A LocalDate is a calendar day
 * ("YYYY-MM-DD") in some IANA zone and is stored separately from instants so
 * that travelling or changing the device zone never moves a historical entry.
 */
export type LocalDate = string;
export type Disambiguation = 'earlier' | 'later';

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export interface ZonedParts {
  y: number;
  m: number;
  d: number;
  hh: number;
  mm: number;
  ss: number;
}

export function partsInTz(ms: number, tz: string): ZonedParts {
  const out: Record<string, number> = {};
  for (const p of fmt(tz).formatToParts(new Date(ms))) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return { y: out.year, m: out.month, d: out.day, hh: out.hour % 24, mm: out.minute, ss: out.second };
}

/** Offset of the zone from UTC at an instant, in ms (east positive). */
export function offsetMs(ms: number, tz: string): number {
  const p = partsInTz(ms, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function makeDate(y: number, m: number, d: number): LocalDate {
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
}

export function parseDate(date: LocalDate): { y: number; m: number; d: number } {
  const [y, m, d] = date.split('-').map(Number);
  return { y, m, d };
}

export function isValidDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const { y, m, d } = parseDate(date);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

export function localDateOf(ms: number, tz: string): LocalDate {
  const p = partsInTz(ms, tz);
  return makeDate(p.y, p.m, p.d);
}

export function localTimeOf(ms: number, tz: string): string {
  const p = partsInTz(ms, tz);
  return `${pad(p.hh)}:${pad(p.mm)}`;
}

export function addDays(date: LocalDate, n: number): LocalDate {
  const { y, m, d } = parseDate(date);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return makeDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export function daysBetween(a: LocalDate, b: LocalDate): number {
  const pa = parseDate(a);
  const pb = parseDate(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86400000);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(date: LocalDate): number {
  const { y, m, d } = parseDate(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function weekStartOf(date: LocalDate, startOfWeek: number): LocalDate {
  const diff = (weekdayOf(date) - startOfWeek + 7) % 7;
  return addDays(date, -diff);
}

export function dateRange(from: LocalDate, to: LocalDate): LocalDate[] {
  const out: LocalDate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function isValidTime(t: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
}

export interface ZonedResolution {
  ms: number;
  /** 'gap' = the wall time does not exist (spring forward); 'ambiguous' = it occurs twice. */
  kind: 'exact' | 'gap' | 'ambiguous';
}

/**
 * Resolve a wall-clock time in a zone to an instant.
 * - Nonexistent times (spring-forward gap) shift forward by the gap length.
 * - Repeated times (fall-back) pick the earlier occurrence unless `later` is requested.
 */
export function zonedToInstant(
  date: LocalDate,
  time: string,
  tz: string,
  disambiguation: Disambiguation = 'earlier',
): ZonedResolution {
  const { y, m, d } = parseDate(date);
  const [hh, mm] = time.split(':').map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  const before = offsetMs(wall - 86400000, tz);
  const after = offsetMs(wall + 86400000, tz);
  const valid: number[] = [];
  for (const off of before === after ? [before] : [before, after]) {
    const t = wall - off;
    if (offsetMs(t, tz) === off) valid.push(t);
  }
  if (valid.length === 1) return { ms: valid[0], kind: 'exact' };
  if (valid.length === 2) {
    valid.sort((a, b) => a - b);
    return { ms: disambiguation === 'earlier' ? valid[0] : valid[1], kind: 'ambiguous' };
  }
  return { ms: wall - before, kind: 'gap' };
}

export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function formatDuration(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

export function formatHoursMinutes(totalMin: number): string {
  const min = Math.max(0, Math.round(totalMin));
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
