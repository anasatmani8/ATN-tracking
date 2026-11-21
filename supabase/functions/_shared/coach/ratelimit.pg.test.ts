/** Runs against a real Postgres with all migrations applied (scripts/pg-test.sh). */
import { randomUUID } from 'crypto';
import { Client } from 'pg';

let pg: Client;
beforeAll(async () => {
  pg = new Client({ connectionString: process.env.PG_TEST_URL });
  await pg.connect();
});
afterAll(() => pg.end());

async function as<T>(uid: string | null, sql: string, params: unknown[] = []): Promise<T> {
  await pg.query('begin');
  try {
    await pg.query(`select set_config('request.jwt.claims', $1, true)`, [uid ? JSON.stringify({ sub: uid, role: 'authenticated' }) : '']);
    await pg.query(`set local role ${uid ? 'authenticated' : 'anon'}`);
    const r = await pg.query(sql, params);
    await pg.query('commit');
    return r.rows[0]?.r as T;
  } catch (e) {
    await pg.query('rollback');
    throw e;
  }
}

const consume = (uid: string, perMinute = 3, perDay = 5, tokens = 1000) =>
  as<{ allowed: boolean; retry_after_sec: number; remaining_today: number }>(uid, 'select public.coach_consume($1, $2, $3) as r', [perMinute, perDay, tokens]);

async function newUser() {
  const id = randomUUID();
  await pg.query('insert into auth.users (id) values ($1)', [id]);
  return id;
}

describe('coach rate limits', () => {
  test('per-minute burst limit with retry time, per-day limit, token budget', async () => {
    const u = await newUser();
    for (let i = 0; i < 3; i++) expect(await consume(u)).toMatchObject({ allowed: true, remaining_today: 4 - i });
    const blocked = await consume(u);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retry_after_sec).toBeGreaterThan(0);
    expect(blocked.retry_after_sec).toBeLessThanOrEqual(60);
    // Daily cap: pretend the earlier minutes happened before.
    await pg.query(`update public.coach_minute set minute = minute - interval '5 minutes' where user_id = $1`, [u]);
    expect(await consume(u)).toMatchObject({ allowed: true, remaining_today: 1 });
    expect(await consume(u)).toMatchObject({ allowed: true, remaining_today: 0 });
    await pg.query(`update public.coach_minute set minute = minute - interval '5 minutes' where user_id = $1`, [u]);
    const day = await consume(u);
    expect(day).toMatchObject({ allowed: false, remaining_today: 0 });
    expect(day.retry_after_sec).toBeGreaterThan(60);
    // Token budget.
    const v = await newUser();
    expect((await consume(v, 10, 100, 1000)).allowed).toBe(true);
    await as(v, 'select public.coach_record_tokens($1, $2) as r', [900, 200]);
    expect((await consume(v, 10, 100, 1000)).allowed).toBe(false);
  });

  test('users are counted separately; clients cannot read the tables, call as anonymous, or grant themselves more', async () => {
    const [a, b] = [await newUser(), await newUser()];
    for (let i = 0; i < 3; i++) await consume(a);
    expect((await consume(a)).allowed).toBe(false);
    expect((await consume(b)).allowed).toBe(true);
    await expect(as(a, 'select * from public.coach_usage')).rejects.toThrow(/permission denied/);
    await expect(as(a, `insert into public.coach_usage (user_id, day) values ('${a}', current_date)`)).rejects.toThrow(/permission denied/);
    await expect(as(null, 'select public.coach_consume(5, 5, 5)')).rejects.toThrow(/permission denied/);
    // Huge limits passed directly are clamped (at most 60 per minute).
    const c = await newUser();
    let allowed = 0;
    for (let i = 0; i < 65; i++) if ((await consume(c, 100000, 100000, 999999999)).allowed) allowed++;
    expect(allowed).toBe(60);
    // Negative token reports cannot lower usage.
    await as(c, 'select public.coach_record_tokens($1, $2) as r', [-5000000, -5000000]);
    const row = (await pg.query('select input_tokens, output_tokens from public.coach_usage where user_id = $1', [c])).rows[0];
    expect([Number(row.input_tokens), Number(row.output_tokens)]).toEqual([0, 0]);
  });

  test('deleting the account removes coach usage; an erased account cannot use the coach', async () => {
    const u = await newUser();
    await consume(u);
    await pg.query('insert into public.erased_accounts (user_id) values ($1)', [u]);
    await expect(consume(u)).rejects.toThrow(/account_erased/);
    await pg.query('delete from auth.users where id = $1', [u]);
    expect((await pg.query('select count(*)::int as n from public.coach_usage where user_id = $1', [u])).rows[0].n).toBe(0);
  });
});
