import { en } from './en';

export type StringKey = keyof typeof en;
let table: Record<string, string> = en;
let locale: string | undefined;

/** Swap in another language table at startup. English is the only shipped table. */
export function setLocale(tag: string | undefined, strings?: Record<string, string>) {
  locale = tag;
  table = strings ? { ...en, ...strings } : en;
}
export const currentLocale = () => locale;

/** Look up a string and fill {placeholders}. `count` selects key_one / key_other when present. */
export function t(key: StringKey, params?: Record<string, string | number>): string {
  let s = table[key as string] ?? (key as string);
  if (params && typeof params.count === 'number') {
    const plural = table[`${key}_${params.count === 1 ? 'one' : 'other'}`];
    if (plural) s = plural;
  }
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (_, k: string) => (k in params ? String(params[k]) : `{${k}}`));
}

export function formatDate(date: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, { ...opts, timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function formatTime(ms: number, tz: string): string {
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone: tz }).format(new Date(ms));
}

export function weekdayName(weekday: number, style: 'short' | 'long' | 'narrow' = 'short'): string {
  // 2023-01-01 was a Sunday.
  return new Intl.DateTimeFormat(locale, { weekday: style, timeZone: 'UTC' }).format(new Date(Date.UTC(2023, 0, 1 + weekday)));
}
