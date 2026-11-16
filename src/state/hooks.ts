import { useEffect, useMemo, useState } from 'react';
import { currentLocale, t, type StringKey } from '@/i18n';
import { formatDistance, formatNumber, formatVolume, formatWeight, fromKg, fromMeters, fromMl, parseDecimal, round, toKg, toMeters, toMl } from '@/domain/units';
import { AppError } from '@/data/training';
import { useApp } from './app';

/** Ticks while mounted so timers re-derive from persisted timestamps. */
export function useNow(intervalMs = 1000, enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, enabled]);
  return now;
}

/** Display/input conversions bound to the user's unit preferences. Canonical values never change. */
export function useFmt() {
  const { prefs } = useApp();
  return useMemo(() => {
    const loc = currentLocale();
    return {
      wUnit: prefs.weightUnit,
      weight: (kg: number) => formatWeight(kg, prefs.weightUnit, loc),
      /** A record load shown the way it is entered: per dumbbell ×2, or total. */
      recordLoad: (totalKg: number, implementCount = 1) =>
        implementCount > 1 ? `${formatWeight(totalKg / implementCount, prefs.weightUnit, loc)} ×${implementCount}` : formatWeight(totalKg, prefs.weightUnit, loc),
      weightNum: (kg: number | null) => (kg == null ? '' : String(round(fromKg(kg, prefs.weightUnit), 2))),
      parseWeight: (text: string) => { const v = parseDecimal(text); return v == null ? null : toKg(v, prefs.weightUnit); },
      volume: (ml: number) => formatVolume(ml, prefs.volumeUnit, loc),
      volUnit: prefs.volumeUnit === 'ml' ? 'mL' : 'fl oz',
      volNum: (ml: number) => String(round(fromMl(ml, prefs.volumeUnit), prefs.volumeUnit === 'ml' ? 0 : 1)),
      parseVolume: (text: string) => { const v = parseDecimal(text); return v == null ? null : toMl(v, prefs.volumeUnit); },
      distance: (m: number) => formatDistance(m, prefs.distanceUnit, loc),
      distUnit: prefs.distanceUnit,
      distNum: (m: number | null) => (m == null ? '' : String(round(fromMeters(m, prefs.distanceUnit), 2))),
      parseDistance: (text: string) => { const v = parseDecimal(text); return v == null ? null : toMeters(v, prefs.distanceUnit); },
      num: (v: number, dp = 0) => formatNumber(v, dp, loc),
    };
  }, [prefs.weightUnit, prefs.volumeUnit, prefs.distanceUnit]);
}

/** User-facing text for a thrown error. */
export function errorText(e: unknown): string {
  if (e instanceof AppError) {
    const key = `err.${e.code}` as StringKey;
    const s = t(key);
    return s === key ? t('err.generic') : s;
  }
  return t('err.generic');
}
