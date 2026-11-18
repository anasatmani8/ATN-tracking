import { openFoodFactsProvider } from './barcode';

const ok = (body: unknown, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body } as Response);

describe('barcode provider', () => {
  test('maps a product and keeps unknown nutrients unknown', async () => {
    let now = 0;
    const p = openFoodFactsProvider({ now: () => (now += 5000), fetchImpl: () => ok({ status: 1, product: { product_name: 'Oat drink', brands: 'Acme, Other', serving_quantity: 250, serving_quantity_unit: 'ml', serving_size: '250 ml', nutriments: { 'energy-kj_100g': 200, proteins_100g: '1' } } }) });
    const r = await p.lookup('3017620422003');
    expect(r).toMatchObject({ status: 'found', name: 'Oat drink', brand: 'Acme', snapshot: { basis: 'per_100ml', servingMl: 250, servingG: null, proteinG: 1, carbsG: null, fatG: null } });
    if (r.status === 'found') expect(Math.round(r.snapshot.kcal!)).toBe(48);
  });
  test('invalid code, unknown product, throttling, timeout and network failure', async () => {
    let now = 0;
    const tick = () => (now += 5000);
    expect((await openFoodFactsProvider({ now: tick, fetchImpl: () => ok({}) }).lookup('123')).status).toBe('invalid');
    expect((await openFoodFactsProvider({ now: tick, fetchImpl: () => ok({ status: 0 }) }).lookup('3017620422003')).status).toBe('not_found');
    expect((await openFoodFactsProvider({ now: tick, fetchImpl: () => ok({}, 404) }).lookup('3017620422003')).status).toBe('not_found');
    const throttled = openFoodFactsProvider({ now: tick, fetchImpl: () => ok({}, 429) });
    expect((await throttled.lookup('3017620422003')).status).toBe('throttled');
    expect((await throttled.lookup('3017620422003')).status).toBe('throttled'); // backs off without calling
    const hang = openFoodFactsProvider({ now: tick, timeoutMs: 20, fetchImpl: (_u, init) => new Promise((_, rej) => init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))) });
    expect((await hang.lookup('3017620422003')).status).toBe('timeout');
    expect((await openFoodFactsProvider({ now: tick, fetchImpl: () => Promise.reject(new TypeError('Network request failed')) }).lookup('3017620422003')).status).toBe('network');
    let calls = 0;
    const fixed = openFoodFactsProvider({ now: () => 1, fetchImpl: () => { calls++; return ok({ status: 0 }); } });
    await fixed.lookup('3017620422003');
    expect((await fixed.lookup('3017620422003')).status).toBe('throttled');
    expect(calls).toBe(1);
  });
});
