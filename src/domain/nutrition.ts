export type NutrientBasis = 'per_100g' | 'per_100ml' | 'per_serving';
export type QtyUnit = 'g' | 'ml' | 'serving';

/** Source nutrient values, frozen onto every log entry. null = unknown (never treated as zero). */
export interface NutrientSnapshot {
  basis: NutrientBasis;
  /** Mass of one serving in grams, only when the source states it. */
  servingG: number | null;
  /** Volume of one serving in mL, only when the source states it. */
  servingMl: number | null;
  servingLabel: string | null;
  kcal: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  source: string;
}

export interface Nutrients {
  kcal: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
}

export const NUTRIENT_KEYS = ['kcal', 'proteinG', 'carbsG', 'fatG'] as const;
export type NutrientKey = (typeof NUTRIENT_KEYS)[number];

/** Units the user may log this food in. A household serving without a stated mass is never converted to grams. */
export function allowedUnits(s: NutrientSnapshot): QtyUnit[] {
  const out: QtyUnit[] = [];
  if (s.basis === 'per_100g') {
    out.push('g');
    if (s.servingG) out.push('serving');
  } else if (s.basis === 'per_100ml') {
    out.push('ml');
    if (s.servingMl) out.push('serving');
  } else {
    out.push('serving');
    if (s.servingG) out.push('g');
    if (s.servingMl) out.push('ml');
  }
  return out;
}

/** Multiplier from the snapshot basis to the logged quantity, or null when no defined conversion exists. */
export function scaleFactor(s: NutrientSnapshot, qty: number, unit: QtyUnit): number | null {
  if (!(qty > 0) || !Number.isFinite(qty)) return null;
  if (s.basis === 'per_100g') {
    if (unit === 'g') return qty / 100;
    if (unit === 'serving' && s.servingG) return (qty * s.servingG) / 100;
  } else if (s.basis === 'per_100ml') {
    if (unit === 'ml') return qty / 100;
    if (unit === 'serving' && s.servingMl) return (qty * s.servingMl) / 100;
  } else {
    if (unit === 'serving') return qty;
    if (unit === 'g' && s.servingG) return qty / s.servingG;
    if (unit === 'ml' && s.servingMl) return qty / s.servingMl;
  }
  return null;
}

/** Scaled nutrients at full precision; round only for display. */
export function scaleNutrients(s: NutrientSnapshot, qty: number, unit: QtyUnit): Nutrients | null {
  const f = scaleFactor(s, qty, unit);
  if (f == null) return null;
  const sc = (v: number | null) => (v == null ? null : v * f);
  return { kcal: sc(s.kcal), proteinG: sc(s.proteinG), carbsG: sc(s.carbsG), fatG: sc(s.fatG) };
}

export interface NutrientTotals {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  /** Per nutrient: true when at least one counted entry had no value, so the total is a lower bound. */
  partial: Record<NutrientKey, boolean>;
  entries: number;
}

export function sumNutrients(entries: Nutrients[]): NutrientTotals {
  const t: NutrientTotals = {
    kcal: 0,
    proteinG: 0,
    carbsG: 0,
    fatG: 0,
    partial: { kcal: false, proteinG: false, carbsG: false, fatG: false },
    entries: entries.length,
  };
  for (const e of entries) {
    for (const k of NUTRIENT_KEYS) {
      const v = e[k];
      if (v == null) t.partial[k] = true;
      else t[k] += v;
    }
  }
  return t;
}

export interface RecipeIngredient {
  name: string;
  snapshot: NutrientSnapshot;
  qty: number;
  unit: QtyUnit;
}

/** Recipe → per-serving snapshot. Unknown ingredient values keep the recipe value unknown. */
export function recipeSnapshot(ingredients: RecipeIngredient[], servingsYield: number, name = 'recipe'): NutrientSnapshot | null {
  if (!(servingsYield > 0) || ingredients.length === 0) return null;
  const parts: Nutrients[] = [];
  for (const i of ingredients) {
    const n = scaleNutrients(i.snapshot, i.qty, i.unit);
    if (!n) return null;
    parts.push(n);
  }
  const t = sumNutrients(parts);
  const per = (k: NutrientKey) => (t.partial[k] ? null : t[k] / servingsYield);
  return {
    basis: 'per_serving',
    servingG: null,
    servingMl: null,
    servingLabel: `1 of ${servingsYield} servings`,
    kcal: per('kcal'),
    proteinG: per('proteinG'),
    carbsG: per('carbsG'),
    fatG: per('fatG'),
    source: `recipe:${name}`,
  };
}

/** EAN-8, UPC-A, EAN-13 or GTIN-14 with a valid check digit. */
export function isValidBarcode(code: string): boolean {
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(code)) return false;
  const digits = code.split('').map(Number);
  const check = digits.pop() as number;
  let sum = 0;
  digits.reverse().forEach((d, i) => (sum += d * (i % 2 === 0 ? 3 : 1)));
  return (10 - (sum % 10)) % 10 === check;
}

/** Drops repeat scanner callbacks for the same code inside a window. */
export function createScanDebouncer(windowMs = 2500, now: () => number = Date.now) {
  let lastCode: string | null = null;
  let lastAt = 0;
  let locked = false;
  return {
    /** true = handle this scan; false = duplicate or a lookup is already in flight. */
    accept(code: string): boolean {
      const t = now();
      if (locked) return false;
      if (code === lastCode && t - lastAt < windowMs) return false;
      lastCode = code;
      lastAt = t;
      locked = true;
      return true;
    },
    release() {
      locked = false;
      lastAt = now();
    },
  };
}
