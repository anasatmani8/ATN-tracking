/**
 * Canonical storage units: kg, mL, g, m, s, kcal. Conversions happen only at
 * the display / input boundary, so toggling units never rewrites history.
 */
export type WeightUnit = 'kg' | 'lb';
export type VolumeUnit = 'ml' | 'floz';
export type DistanceUnit = 'km' | 'mi';
export type LengthUnit = 'cm' | 'in';

export const KG_PER_LB = 0.45359237;
export const ML_PER_FLOZ = 29.5735295625;
export const M_PER_MI = 1609.344;
export const M_PER_IN = 0.0254;

export const round = (v: number, dp: number) => {
  const f = 10 ** dp;
  return Math.round((v + Number.EPSILON) * f) / f;
};

/** Loads are stored to the gram (3 dp of kg) so 0.25 lb plates round-trip. */
export const toKg = (v: number, unit: WeightUnit) => round(unit === 'kg' ? v : v * KG_PER_LB, 3);
export const fromKg = (kg: number, unit: WeightUnit) => (unit === 'kg' ? kg : kg / KG_PER_LB);
export const toMl = (v: number, unit: VolumeUnit) => round(unit === 'ml' ? v : v * ML_PER_FLOZ, 0);
export const fromMl = (ml: number, unit: VolumeUnit) => (unit === 'ml' ? ml : ml / ML_PER_FLOZ);
export const toMeters = (v: number, unit: DistanceUnit) => round(unit === 'km' ? v * 1000 : v * M_PER_MI, 1);
export const fromMeters = (m: number, unit: DistanceUnit) => (unit === 'km' ? m / 1000 : m / M_PER_MI);
export const lengthToMeters = (v: number, unit: LengthUnit) => round(unit === 'cm' ? v / 100 : v * M_PER_IN, 4);
export const lengthFromMeters = (m: number, unit: LengthUnit) => (unit === 'cm' ? m * 100 : m / M_PER_IN);

/** Locale-aware number without trailing zeros. */
export function formatNumber(v: number, maxDp = 2, locale?: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: maxDp, useGrouping: true }).format(round(v, maxDp));
}

export function formatWeight(kg: number, unit: WeightUnit, locale?: string): string {
  return `${formatNumber(fromKg(kg, unit), unit === 'kg' ? 2 : 1, locale)} ${unit}`;
}

export function weightValue(kg: number, unit: WeightUnit): string {
  return String(round(fromKg(kg, unit), 2));
}

export function formatVolume(ml: number, unit: VolumeUnit, locale?: string): string {
  return unit === 'ml' ? `${formatNumber(ml, 0, locale)} mL` : `${formatNumber(fromMl(ml, unit), 1, locale)} fl oz`;
}

export function formatDistance(m: number, unit: DistanceUnit, locale?: string): string {
  return `${formatNumber(fromMeters(m, unit), 2, locale)} ${unit}`;
}

/** Accepts "12.5" and "12,5". Returns null for empty or invalid text. */
export function parseDecimal(text: string): number | null {
  const t = text.trim().replace(',', '.');
  if (t === '' || !/^\d*\.?\d+$|^\d+\.$/.test(t)) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}
