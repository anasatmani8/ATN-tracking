/**
 * Runs against a real Postgres with the production migration (scripts/pg-test.sh).
 * "Devices" are separate SQLite databases; the transport executes the same RPCs the
 * app calls, as the `authenticated` role with the user's JWT claims.
 */
import { Client } from 'pg';
import { randomUUID } from 'crypto';
import { makeEnv, type Env } from '@/data/testkit';
import { buildExport } from '@/data/export';
import { attachGuestData } from './attach';
import { backoffMs, SyncEngine, TransportError, type PushOp, type Transport } from './engine';

const TZ = 'UTC';
const T0 = Date.UTC(2026, 10, 16, 18);
let pg: Client;

beforeAll(async () => {
  pg = new Client({ connectionString: process.env.PG_TEST_URL });
  await pg.connect();
});
afterAll(() => pg.end());

async function asRole<T>(role: 'authenticated' | 'anon', claims: object | null, fn: () => Promise<T>): Promise<T> {
  await pg.query('begin');
  try {
    await pg.query(`select set_config('request.jwt.claims', $1, true)`, [claims ? JSON.stringify(claims) : '']);
    await pg.query(`set local role ${role}`);
    const out = await fn();
    await pg.query('commit');
    return out;
  } catch (e) {
    await pg.query('rollback');
    throw e;
  }
}

function mapError(e: unknown): never {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes('account_erased')) throw new TransportError('erased');
  if (msg.includes('not_authenticated')) throw new TransportError('auth');
  throw new TransportError('server', msg);
}

function transportFor(uid: string | null, o: { offline?: () => boolean; loseResponse?: () => boolean; sent?: PushOp[][] } = {}): Transport {
  const claims = uid ? { sub: uid, role: 'authenticated' } : null;
  return {
    async push(ops) {
      if (o.offline?.()) throw new TransportError('network');
      o.sent?.push(ops);
      const res = await asRole(uid ? 'authenticated' : 'anon', claims, async () => (await pg.query('select public.sync_push($1::jsonb) as r', [JSON.stringify(ops)])).rows[0].r).catch(mapError);
      if (o.loseResponse?.()) throw new TransportError('network', 'response_lost');
      return res;
    },
    async pull(since, limit) {
      if (o.offline?.()) throw new TransportError('network');
      return asRole(uid ? 'authenticated' : 'anon', claims, async () => (await pg.query('select public.sync_pull($1, $2) as r', [since, limit])).rows[0].r).catch(mapError);
    },
  };
}

async function newUser(): Promise<string> {
  const id = randomUUID();
  await pg.query('insert into auth.users (id) values ($1)', [id]);
  return id;
}

async function device(uid: string, o: Parameters<typeof transportFor>[1] = {}) {
  const env = await makeEnv({ sync: true });
  let t = T0;
  env.store.now = () => (t += 1000);
  return { env, engine: new SyncEngine(env.store, transportFor(uid, o), { batchSize: 3, pullSize: 4 }), advance: (ms: number) => (t += ms) };
}

const water = (env: Env) => env.db.all<{ id: string; amount_ml: number; rev: number }>('SELECT id, amount_ml, rev FROM water_logs WHERE deleted_at IS NULL ORDER BY id');

async function finishWorkout(env: Env, at = T0) {
  const sid = await env.training.startSession({ title: 'Free' }, at, TZ);
  const sx = await env.training.addExercise(sid, 'bb_bench_press');
  const set = (await env.training.getSession(sid))!.exercises.find((e) => e.id === sx)!.sets[0];
  await env.training.updateSet(set.id, { load_kg: 60, reps: 5 });
  await env.training.completeSet(set.id, at + 60000);
  await env.training.finishSession(sid, at + 600000);
  return { sid, setId: set.id };
}

describe('authorization', () => {
  test('anonymous callers cannot read or write', async () => {
    await expect(asRole('anon', null, () => pg.query(`select public.sync_push('[]'::jsonb)`))).rejects.toThrow(/permission denied/);
    await expect(asRole('anon', null, () => pg.query('select public.sync_pull(0, 10)'))).rejects.toThrow(/permission denied/);
    await expect(asRole('anon', null, () => pg.query('select * from public.records'))).rejects.toThrow(/permission denied/);
    await expect(asRole('anon', null, () => pg.query('select public.delete_my_data()'))).rejects.toThrow(/permission denied/);
    // authenticated role without a subject claim
    await expect(asRole('authenticated', {}, () => pg.query(`select public.sync_push('[]'::jsonb)`))).rejects.toThrow(/not_authenticated/);
  });

  test('accounts are isolated: no cross-account read, write, overwrite or delete', async () => {
    const [a, b] = [await newUser(), await newUser()];
    const A = await device(a);
    const id = await A.env.recovery.addWater(250, '2026-11-16', T0, TZ);
    await A.engine.syncOnce();
    // B's sync sees nothing of A.
    const B = await device(b);
    await B.engine.syncOnce();
    expect(await water(B.env)).toEqual([]);
    // Direct table access as B: RLS hides A's rows, and writes are refused outright.
    const asB = { sub: b, role: 'authenticated' };
    expect((await asRole('authenticated', asB, () => pg.query('select * from public.records'))).rows).toEqual([]);
    for (const sql of [
      `insert into public.records (user_id, tbl, id, data, rev) values ('${a}', 'water_logs', 'x', '{}', 1)`,
      `update public.records set data = '{}'`,
      `delete from public.records`,
      `select * from public.applied_ops`,
      `select * from public.erased_accounts`,
      `select nextval('public.record_rev')`,
      `select public.sync_apply_row('${a}', 'water_logs', '${id}', 'delete', 0, null)`,
      `select public.sync_apply_op('${a}', '{}'::jsonb)`,
    ]) await expect(asRole('authenticated', asB, () => pg.query(sql))).rejects.toThrow(/permission denied/);
    // B pushing the same record id creates B's own row and leaves A's untouched.
    await B.env.store.put('water_logs', { id, local_date: '2026-11-16', amount_ml: 999, logged_at: T0, tz: TZ });
    await B.engine.syncOnce();
    await B.env.recovery.removeWater(id);
    await B.engine.syncOnce();
    await A.engine.syncOnce();
    expect(await water(A.env)).toMatchObject([{ id, amount_ml: 250 }]);
    const rows = (await pg.query('select user_id, deleted from public.records where id = $1 order by deleted', [id])).rows;
    expect(rows).toEqual([{ user_id: a, deleted: false }, { user_id: b, deleted: true }]);
  });

  test('server-side validation rejects bad operations', async () => {
    const u = await newUser();
    const t = transportFor(u);
    const res = await t.push([
      { op_id: 'v1', tbl: 'auth_users', id: 'x', kind: 'upsert', base_rev: 0, data: { id: 'x' } },
      { op_id: 'v2', tbl: 'water_logs', id: 'x', kind: 'upsert', base_rev: 0, data: { id: 'y' } },
      { op_id: 'v3', tbl: 'water_logs', id: 'x', kind: 'truncate' as never, base_rev: 0, data: null },
      { op_id: 'v4', tbl: 'water_logs', id: 'big', kind: 'upsert', base_rev: 0, data: { id: 'big', blob: Array.from({ length: 40000 }, () => Math.random().toString(36)).join('') } },
    ]);
    expect(res.map((r) => [r.status, r.error])).toEqual([['invalid', 'unknown_table'], ['invalid', 'bad_data'], ['invalid', 'bad_kind'], ['invalid', 'too_large']]);
    await expect(t.push(Array.from({ length: 201 }, (_, i) => ({ op_id: `n${i}`, tbl: 'water_logs', id: `${i}`, kind: 'delete' as const, base_rev: 0, data: null })))).rejects.toThrow(/invalid_ops/);
  });
});

describe('two-device sync', () => {
  test('guest data is attached once, syncs to a second device, and offline edits merge without duplicates', async () => {
    const uid = await newUser();
    // Guest use, offline.
    const guest = await makeEnv();
    await guest.recovery.addWater(250, '2026-11-16', T0, TZ);
    await guest.recovery.addWater(500, '2026-11-16', T0 + 1, TZ);
    const { sid } = await finishWorkout(guest);
    // Sign in on device A and explicitly attach.
    const A = await device(uid);
    expect(await attachGuestData(guest.db, A.env.store)).toMatchObject({ copied: 5, skipped: 0 });
    expect(await attachGuestData(guest.db, A.env.store)).toMatchObject({ copied: 0, skipped: 5 }); // repeat is harmless
    const r1 = await A.engine.syncOnce();
    expect(r1.stopped).toBeNull();
    expect((await A.engine.status()).pending).toBe(0);
    // Device B restores everything.
    const B = await device(uid);
    await B.engine.syncOnce();
    expect((await water(B.env)).map((w) => w.amount_ml).sort()).toEqual([250, 500]);
    expect((await B.env.training.sessionTotals(sid)).volumeKg).toBe(300);
    expect(await B.env.training.listHistory(5)).toHaveLength(1);
    // Both go offline and edit different rows, then reconnect.
    const [wa, wb] = await water(A.env);
    await A.env.recovery.editWater(wa.id, 300);
    await B.env.recovery.editWater(wb.id, 600);
    await B.env.recovery.addWater(100, '2026-11-17', T0, TZ);
    await A.engine.syncOnce();
    await B.engine.syncOnce();
    await A.engine.syncOnce();
    const final = (await water(A.env)).map((w) => w.amount_ml).sort((x, y) => x - y);
    expect(final).toEqual([100, 300, 600]);
    expect((await water(B.env)).map((w) => w.amount_ml).sort((x, y) => x - y)).toEqual(final);
    expect((await pg.query(`select count(*)::int as n from public.records where user_id = $1 and tbl = 'water_logs'`, [uid])).rows[0].n).toBe(3);
    // Exports from both devices agree.
    const strip = async (e: Env) => (await buildExport(e.db, 0)).tables.water_logs.map((w) => [w.id, w.amount_ml]).sort();
    expect(await strip(A.env)).toEqual(await strip(B.env));
  });

  test('duplicate delivery and an interrupted batch never create duplicates', async () => {
    const uid = await newUser();
    let lose = true;
    const sent: PushOp[][] = [];
    const A = await device(uid, { loseResponse: () => lose, sent });
    for (let i = 0; i < 5; i++) await A.env.recovery.addWater(100 + i, '2026-11-16', T0 + i, TZ);
    const first = await A.engine.syncOnce(); // server applied batch 1, response lost
    expect(first.stopped).toBe('network');
    expect((await A.engine.status()).pending).toBe(5);
    const blocked = await A.engine.syncOnce(); // still backing off
    expect(blocked.stopped).toBe('network');
    expect(sent).toHaveLength(1);
    lose = false;
    A.advance(backoffMs(1) + 1);
    const again = await A.engine.syncOnce();
    expect(again).toMatchObject({ stopped: null, pushed: 5 });
    expect(sent[1].map((o) => o.op_id)).toEqual(sent[0].map((o) => o.op_id)); // same idempotency keys resent
    expect((await pg.query(`select count(*)::int as n from public.records where user_id = $1`, [uid])).rows[0].n).toBe(5);
    expect((await water(A.env)).every((w) => w.rev > 0)).toBe(true);
    // Finishing a workout twice from the client is one server-side completion.
    const { sid } = await finishWorkout(A.env);
    await A.engine.syncOnce();
    const op = sent.flat().find((o) => o.kind === 'session_complete')!;
    const replay = await transportFor(uid).push([op, { ...op, op_id: 'replayed-under-new-id' }]);
    expect(replay.map((r) => r.status)).toEqual(['ok', 'ok']);
    expect((await pg.query(`select count(*)::int as n from public.records where user_id = $1 and tbl like 'session%'`, [uid])).rows[0].n).toBe(3);
    const B = await device(uid);
    await B.engine.syncOnce();
    expect(await B.env.training.listHistory(5)).toMatchObject([{ id: sid }]);
  });

  test('same-row concurrent edits surface a conflict with a recoverable choice', async () => {
    const uid = await newUser();
    const A = await device(uid);
    const B = await device(uid);
    const id = await A.env.recovery.addWater(250, '2026-11-16', T0, TZ);
    await A.engine.syncOnce();
    await B.engine.syncOnce();
    await A.env.recovery.editWater(id, 300);
    await B.env.recovery.editWater(id, 400);
    await A.engine.syncOnce();
    const rep = await B.engine.syncOnce();
    expect(rep.conflicts).toBe(1);
    expect(await B.engine.status()).toMatchObject({ conflicts: 1, pending: 0 });
    const c = (await B.env.db.all<{ id: string; local_data: string; remote_data: string }>('SELECT * FROM conflicts'))[0];
    expect([JSON.parse(c.local_data).amount_ml, JSON.parse(c.remote_data).amount_ml]).toEqual([400, 300]);
    expect((await water(B.env))[0].amount_ml).toBe(400); // local value kept until the user chooses
    await B.engine.resolveConflict(c.id, 'mine');
    await B.engine.syncOnce();
    await A.engine.syncOnce();
    expect((await water(A.env))[0].amount_ml).toBe(400);
    // And the other choice.
    await A.env.recovery.editWater(id, 500);
    await B.env.recovery.editWater(id, 600);
    await A.engine.syncOnce();
    await B.engine.syncOnce();
    const c2 = (await B.env.db.all<{ id: string }>('SELECT id FROM conflicts'))[0];
    await B.engine.resolveConflict(c2.id, 'theirs');
    expect((await water(B.env))[0].amount_ml).toBe(500);
    expect(await B.engine.status()).toMatchObject({ conflicts: 0, pending: 0 });
    await B.engine.syncOnce();
    await A.engine.syncOnce();
    expect((await water(A.env))[0].amount_ml).toBe(500);
  });

  test('a delete while another device is offline is never resurrected by its stale edit', async () => {
    const uid = await newUser();
    const A = await device(uid);
    let offline = false;
    const B = await device(uid, { offline: () => offline });
    const id = await A.env.recovery.addWater(250, '2026-11-16', T0, TZ);
    const keep = await A.env.recovery.addWater(111, '2026-11-16', T0, TZ);
    await A.engine.syncOnce();
    await B.engine.syncOnce();
    offline = true;
    await B.env.recovery.editWater(id, 999); // stale edit queued offline
    expect((await B.engine.syncOnce()).stopped).toBe('network');
    await A.env.recovery.removeWater(id);
    await A.engine.syncOnce();
    offline = false;
    B.advance(10 * 60_000);
    await B.engine.syncOnce();
    expect((await water(B.env)).map((w) => w.id)).toEqual([keep].sort());
    await A.engine.syncOnce();
    expect((await water(A.env)).map((w) => w.id)).toEqual([keep].sort());
    expect((await pg.query('select deleted, data from public.records where user_id = $1 and id = $2', [uid, id])).rows).toEqual([{ deleted: true, data: null }]);
    expect(await B.engine.status()).toMatchObject({ pending: 0, conflicts: 0 });
    // Same outcome when the stale edit reaches the server before the device has pulled the tombstone.
    const t = transportFor(uid);
    const res = await t.push([{ op_id: randomUUID(), tbl: 'water_logs', id, kind: 'upsert', base_rev: 0, data: { id, amount_ml: 5 } }]);
    expect(res[0].status).toBe('rejected_deleted');
  });

  test('expired session stops sync without losing queued changes', async () => {
    const uid = await newUser();
    const env = await makeEnv({ sync: true });
    const expired = new SyncEngine(env.store, transportFor(null));
    await env.recovery.addWater(250, '2026-11-16', T0, TZ);
    const rep = await expired.syncOnce();
    expect(rep.stopped).toBe('server'); // anon role is refused at the grant level
    expect((await expired.status()).pending).toBe(1);
    const ok = new SyncEngine(env.store, transportFor(uid));
    await ok.retryFailed();
    expect((await ok.syncOnce()).pushed).toBe(1);
  });

  test('account deletion: requires recent sign-in, erases data, and an old device cannot upload queued writes', async () => {
    const uid = await newUser();
    const A = await device(uid);
    const old = await device(uid);
    await A.env.recovery.addWater(250, '2026-11-16', T0, TZ);
    await A.engine.syncOnce();
    await old.engine.syncOnce();
    await old.env.recovery.addWater(777, '2026-11-17', T0, TZ); // queued on the old device
    const now = Math.floor(Date.now() / 1000);
    const stale = { sub: uid, role: 'authenticated', amr: [{ method: 'password', timestamp: now - 3600 }] };
    await expect(asRole('authenticated', stale, () => pg.query('select public.delete_my_data()'))).rejects.toThrow(/reauth_required/);
    const fresh = { sub: uid, role: 'authenticated', amr: [{ method: 'password', timestamp: now - 5 }] };
    await asRole('authenticated', fresh, () => pg.query('select public.delete_my_data()'));
    await pg.query('delete from auth.users where id = $1', [uid]); // what the Edge Function does with the service role
    expect((await pg.query('select count(*)::int as n from public.records where user_id = $1', [uid])).rows[0].n).toBe(0);
    const rep = await old.engine.syncOnce();
    expect(rep.stopped).toBe('erased');
    expect((await old.engine.status()).pending).toBe(0); // queue dropped, nothing uploaded
    expect((await pg.query('select count(*)::int as n from public.records where user_id = $1', [uid])).rows[0].n).toBe(0);
  });
});
