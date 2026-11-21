import type { DistanceUnit, LengthUnit, VolumeUnit, WeightUnit } from '@/domain/units';
import { json, type Store } from './store';

export interface Prefs {
  onboarded: boolean;
  goal: 'strength' | 'muscle' | 'general' | 'consistency' | null;
  experience: 'new' | 'some' | 'experienced' | null;
  trainingDays: number | null;
  equipment: 'gym' | 'home_dumbbell' | 'bodyweight' | null;
  weightUnit: WeightUnit;
  volumeUnit: VolumeUnit;
  distanceUnit: DistanceUnit;
  lengthUnit: LengthUnit;
  /** 0 = Sunday, 1 = Monday. */
  startOfWeek: number;
  /** Smallest load step, canonical kg. */
  incrementKg: number;
  trackers: { nutrition: boolean; water: boolean; sleep: boolean; body: boolean };
  /** Meal-only view: hides energy and macro numbers everywhere. */
  hideNutritionNumbers: boolean;
  targets: { kcal: number | null; proteinG: number | null; carbsG: number | null; fatG: number | null; waterMl: number | null; sleepMin: number | null };
  waterPresetsMl: number[];
  mealSlots: string[];
  theme: 'system' | 'light' | 'dark';
  progressionEnabled: boolean;
  minRir: number;
  /** Weekday of the optional weekly check-in, null = off. */
  checkinWeekday: number | null;
  quietStart: string | null;
  quietEnd: string | null;
  favoriteFoods: string[];
  sleepAvgIncludesNaps: boolean;
  restTimerAlerts: boolean;
  /** When the user agreed to send coach chats to the named AI provider; null = not yet. */
  coachConsent: { at: number; provider: string } | null;
  /** Coach insight ids the user dismissed. */
  coachDismissed: string[];
}

export const DEFAULT_PREFS: Prefs = {
  onboarded: false, goal: null, experience: null, trainingDays: null, equipment: null,
  weightUnit: 'kg', volumeUnit: 'ml', distanceUnit: 'km', lengthUnit: 'cm', startOfWeek: 1, incrementKg: 2.5,
  trackers: { nutrition: true, water: true, sleep: true, body: false },
  hideNutritionNumbers: false,
  targets: { kcal: null, proteinG: null, carbsG: null, fatG: null, waterMl: null, sleepMin: null },
  waterPresetsMl: [250, 500], mealSlots: ['Breakfast', 'Lunch', 'Dinner', 'Snacks'], theme: 'system',
  progressionEnabled: true, minRir: 2, checkinWeekday: null, quietStart: '22:00', quietEnd: '07:00',
  favoriteFoods: [], sleepAvgIncludesNaps: false, restTimerAlerts: false, coachConsent: null, coachDismissed: [],
};

/** Locale-derived defaults for a new install (US → imperial, Sunday week start). */
export function localeDefaults(region: string | null, usesMetric: boolean | null): Partial<Prefs> {
  const imperial = usesMetric === false || region === 'US';
  const sundayStart = ['US', 'CA', 'MX', 'JP', 'BR', 'IL', 'AU'].includes(region ?? '');
  return {
    weightUnit: imperial ? 'lb' : 'kg', volumeUnit: imperial ? 'floz' : 'ml', distanceUnit: imperial ? 'mi' : 'km', lengthUnit: imperial ? 'in' : 'cm',
    incrementKg: imperial ? 2.268 : 2.5, startOfWeek: sundayStart ? 0 : 1,
  };
}

export async function loadPrefs(store: Store): Promise<Prefs> {
  const rows = await store.db.all<{ id: string; value: string }>('SELECT id, value FROM prefs WHERE deleted_at IS NULL');
  const out = { ...DEFAULT_PREFS } as Record<string, unknown>;
  for (const r of rows) {
    if (!(r.id in DEFAULT_PREFS)) continue;
    const def = (DEFAULT_PREFS as unknown as Record<string, unknown>)[r.id];
    const v = json<unknown>(r.value, def);
    out[r.id] = def && typeof def === 'object' && !Array.isArray(def) ? { ...(def as object), ...(v as object) } : v;
  }
  return out as unknown as Prefs;
}

/** One row per preference key, so two devices changing different settings merge cleanly. */
export async function savePrefs(store: Store, patch: Partial<Prefs>): Promise<void> {
  await store.tx(async () => {
    for (const [k, v] of Object.entries(patch)) await store.put('prefs', { id: k, value: JSON.stringify(v) });
  });
}
