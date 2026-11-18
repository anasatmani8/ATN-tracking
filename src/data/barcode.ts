import { isValidBarcode, type NutrientSnapshot } from '@/domain/nutrition';

export type LookupResult =
  | { status: 'found'; name: string; brand: string | null; snapshot: NutrientSnapshot; source: string }
  | { status: 'not_found' | 'invalid' | 'throttled' | 'network' | 'timeout' | 'disabled' };

export interface BarcodeProvider {
  id: string;
  /** Shown wherever provider data is displayed. */
  attribution: string;
  lookup(code: string): Promise<LookupResult>;
}

/**
 * Open Food Facts read API (data under ODbL; attribution required). Shipped
 * disabled: it is enabled only through EXPO_PUBLIC_BARCODE_PROVIDER=openfoodfacts
 * after the publisher has reviewed licence, coverage, rate limits and privacy.
 * Only the barcode is sent; no user identifier.
 */
export function openFoodFactsProvider(opts: { fetchImpl?: typeof fetch; now?: () => number; timeoutMs?: number; userAgent?: string } = {}): BarcodeProvider {
  const f = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;
  const timeoutMs = opts.timeoutMs ?? 8000;
  let blockedUntil = 0;
  let last = Number.NEGATIVE_INFINITY;
  return {
    id: 'openfoodfacts',
    attribution: 'Product data from Open Food Facts (openfoodfacts.org), available under the Open Database License.',
    async lookup(code) {
      if (!isValidBarcode(code)) return { status: 'invalid' };
      const t = now();
      // Stay well under the published product-read limit and honour server back-off.
      if (t < blockedUntil || t - last < 1000) return { status: 'throttled' };
      last = t;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await f(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=product_name,brands,nutriments,serving_size,serving_quantity,serving_quantity_unit`, {
          signal: ctrl.signal,
          headers: { 'User-Agent': opts.userAgent ?? 'KinsetApp/1.0' },
        });
        if (res.status === 429) {
          blockedUntil = now() + 60_000;
          return { status: 'throttled' };
        }
        if (res.status === 404) return { status: 'not_found' };
        if (!res.ok) return { status: 'network' };
        const body = (await res.json()) as { status?: number; product?: Record<string, unknown> };
        const p = body.product;
        if (body.status !== 1 || !p) return { status: 'not_found' };
        const n = (p.nutriments ?? {}) as Record<string, number | string | undefined>;
        const num = (k: string) => {
          const v = n[k];
          const x = typeof v === 'string' ? Number(v) : v;
          return typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : null;
        };
        let kcal = num('energy-kcal_100g');
        if (kcal == null) {
          const kj = num('energy-kj_100g') ?? num('energy_100g');
          kcal = kj == null ? null : kj / 4.184;
        }
        const unit = String(p.serving_quantity_unit ?? 'g').toLowerCase();
        const sq = typeof p.serving_quantity === 'number' ? p.serving_quantity : Number(p.serving_quantity);
        const servingOk = Number.isFinite(sq) && sq > 0;
        const name = String(p.product_name ?? '').trim();
        if (!name) return { status: 'not_found' };
        return {
          status: 'found', name, brand: p.brands ? String(p.brands).split(',')[0].trim() : null, source: 'openfoodfacts',
          snapshot: {
            basis: unit === 'ml' ? 'per_100ml' : 'per_100g',
            servingG: servingOk && unit !== 'ml' ? sq : null, servingMl: servingOk && unit === 'ml' ? sq : null,
            servingLabel: p.serving_size ? String(p.serving_size).slice(0, 40) : null,
            kcal, proteinG: num('proteins_100g'), carbsG: num('carbohydrates_100g'), fatG: num('fat_100g'),
            source: `Open Food Facts ${code} (ODbL)`,
          },
        };
      } catch (e) {
        return { status: (e as Error)?.name === 'AbortError' ? 'timeout' : 'network' };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export const disabledProvider: BarcodeProvider = { id: 'off', attribution: '', lookup: async () => ({ status: 'disabled' }) };

