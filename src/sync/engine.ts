import { SYNCED_TABLES } from '@/data/schema';
import { newId, type Row, type Store } from '@/data/store';

export interface PushOp {
  op_id: string;
  tbl: string;
  id: string;
  kind: 'upsert' | 'delete' | 'session_complete';
  base_rev: number;
  data: unknown;
}

export interface PushResult {
  op_id: string;
  status: 'ok' | 'conflict' | 'rejected_deleted' | 'invalid';
  rev?: number;
  data?: Row | null;
  revs?: Record<string, number>;
  error?: string;
}

export interface RemoteRecord {
  tbl: string;
  id: string;
  data: Row | null;
  rev: number;
  deleted: boolean;
}

export interface Transport {
  push(ops: PushOp[]): Promise<PushResult[]>;
  pull(since: number, limit: number): Promise<{ records: RemoteRecord[]; cursor: number; more: boolean }>;
}

/** network: retry later. auth: sign in again. erased: the account no longer exists. server: unexpected. */
export class TransportError extends Error {
  constructor(readonly kind: 'network' | 'auth' | 'erased' | 'server', message?: string) {
    super(message ?? kind);
  }
}

export interface SyncReport {
  pushed: number;
  pulled: number;
  conflicts: number;
  /** null = clean cycle. */
  stopped: null | 'network' | 'auth' | 'erased' | 'server';
}

export interface SyncStatus {
  pending: number;
  conflicts: number;
  failed: number;
  /** Operations that have failed repeatedly and need attention. */
  stuck: number;
  lastSyncAt: number | null;
  lastError: string | null;
}

interface OutboxRow {
  seq: number; op_id: string; tbl: string; row_id: string; kind: PushOp['kind']; base_rev: number; payload: string | null; attempts: number; next_attempt_at: number;
}

export const STUCK_AFTER_ATTEMPTS = 6;
const MAX_BACKOFF_MS = 5 * 60_000;
export const backoffMs = (attempts: number) => Math.min(MAX_BACKOFF_MS, 2000 * 2 ** Math.max(0, attempts - 1));

export class SyncEngine {
  private running: Promise<SyncReport> | null = null;

  constructor(
    private store: Store,
    private transport: Transport,
    private opts: { batchSize?: number; pullSize?: number } = {},
  ) {}

  private get db() {
    return this.store.db;
  }

  /** One push-then-pull cycle. Concurrent callers share the same run. */
  syncOnce(): Promise<SyncReport> {
    if (!this.running) this.running = this.run().finally(() => (this.running = null));
    return this.running;
  }

  private async run(): Promise<SyncReport> {
    const report: SyncReport = { pushed: 0, pulled: 0, conflicts: 0, stopped: null };
    try {
      // Pull first so local edits made against stale rows are detected as conflicts rather than overwriting.
      report.pulled += await this.pullAll();
      await this.pushAll(report);
      report.pulled += await this.pullAll();
      await this.setMeta('last_sync_at', String(this.store.now()));
      await this.setMeta('last_error', '');
    } catch (e) {
      const kind = e instanceof TransportError ? e.kind : 'server';
      report.stopped = kind;
      await this.setMeta('last_error', kind);
      if (kind === 'erased') await this.dropOutbox();
    }
    this.store.touch('outbox');
    await this.store.tx(async () => undefined);
    return report;
  }

  private async pushAll(report: SyncReport): Promise<void> {
    const size = this.opts.batchSize ?? 50;
    for (;;) {
      const now = this.store.now();
      const blocked = await this.db.first<{ n: number }>(`SELECT COUNT(*) AS n FROM outbox WHERE status = 'pending' AND next_attempt_at > ?`, [now]);
      // Preserve order: if the head of the queue is backing off, wait for it.
      if (blocked && blocked.n > 0) throw new TransportError('network', 'backing_off');
      const ops = await this.db.all<OutboxRow>(`SELECT * FROM outbox WHERE status = 'pending' ORDER BY seq LIMIT ?`, [size]);
      if (ops.length === 0) return;
      await this.db.run(`UPDATE outbox SET attempts = attempts + 1 WHERE seq IN (${ops.map(() => '?').join(',')})`, ops.map((o) => o.seq));
      let results: PushResult[];
      try {
        results = await this.transport.push(ops.map((o) => ({ op_id: o.op_id, tbl: o.tbl, id: o.row_id, kind: o.kind, base_rev: o.base_rev, data: o.payload ? JSON.parse(o.payload) : null })));
      } catch (e) {
        const attempts = ops[0].attempts + 1;
        await this.db.run(`UPDATE outbox SET next_attempt_at = ?, last_error = ? WHERE seq IN (${ops.map(() => '?').join(',')})`,
          [now + backoffMs(attempts), e instanceof Error ? e.message : 'error', ...ops.map((o) => o.seq)]);
        throw e;
      }
      const byId = new Map(results.map((r) => [r.op_id, r]));
      await this.store.tx(async () => {
        for (const op of ops) {
          const still = await this.db.first<{ seq: number }>('SELECT seq FROM outbox WHERE seq = ?', [op.seq]);
          if (!still) continue; // removed by an earlier result in this batch
          const r = byId.get(op.op_id);
          if (!r) continue;
          await this.applyResult(op, r, report);
        }
      });
    }
  }

  private async applyResult(op: OutboxRow, r: PushResult, report: SyncReport): Promise<void> {
    if (r.status === 'ok') {
      report.pushed += 1;
      if (op.kind === 'session_complete') {
        for (const [key, rev] of Object.entries(r.revs ?? {})) {
          const [tbl, id] = key.split('/');
          if (isSynced(tbl)) await this.setRev(tbl, id, rev);
        }
      } else if (op.kind === 'delete') {
        await this.db.run(`DELETE FROM ${op.tbl} WHERE id = ? AND deleted_at IS NOT NULL`, [op.row_id]);
      } else if (r.rev != null) {
        await this.setRev(op.tbl, op.row_id, r.rev);
      }
      await this.db.run('DELETE FROM outbox WHERE seq = ?', [op.seq]);
      return;
    }
    if (r.status === 'rejected_deleted') {
      // The record was deleted elsewhere. Deletes win: drop the local copy and any queued edits.
      await this.db.run(`DELETE FROM ${op.tbl} WHERE id = ?`, [op.row_id]);
      await this.db.run('DELETE FROM outbox WHERE tbl = ? AND row_id = ?', [op.tbl, op.row_id]);
      await this.db.run('DELETE FROM conflicts WHERE tbl = ? AND row_id = ?', [op.tbl, op.row_id]);
      this.store.touch(op.tbl);
      return;
    }
    if (r.status === 'conflict') {
      report.conflicts += 1;
      const local = await this.db.first<Row>(`SELECT * FROM ${op.tbl} WHERE id = ?`, [op.row_id]);
      // Collapse every queued edit of this row into one parked operation awaiting the user's choice.
      await this.db.run(`DELETE FROM outbox WHERE tbl = ? AND row_id = ? AND seq != ?`, [op.tbl, op.row_id, op.seq]);
      await this.db.run(`UPDATE outbox SET status = 'conflict', last_error = 'conflict' WHERE seq = ?`, [op.seq]);
      await this.db.run('DELETE FROM conflicts WHERE tbl = ? AND row_id = ?', [op.tbl, op.row_id]);
      await this.db.run('INSERT INTO conflicts (id, tbl, row_id, local_data, remote_data, remote_rev, created_at) VALUES (?,?,?,?,?,?,?)',
        [newId(), op.tbl, op.row_id, JSON.stringify(local ?? JSON.parse(op.payload ?? '{}')), JSON.stringify(r.data ?? {}), r.rev ?? 0, this.store.now()]);
      this.store.touch('conflicts');
      return;
    }
    await this.db.run(`UPDATE outbox SET status = 'failed', last_error = ? WHERE seq = ?`, [r.error ?? 'invalid', op.seq]);
  }

  private async setRev(tbl: string, id: string, rev: number) {
    await this.db.run(`UPDATE ${tbl} SET rev = ? WHERE id = ?`, [rev, id]);
    await this.db.run(`UPDATE outbox SET base_rev = ? WHERE tbl = ? AND row_id = ? AND kind != 'session_complete'`, [rev, tbl, id]);
  }

  private async pullAll(): Promise<number> {
    let total = 0;
    for (;;) {
      const since = Number((await this.getMeta('cursor')) ?? 0);
      const page = await this.transport.pull(since, this.opts.pullSize ?? 200);
      await this.store.tx(async () => {
        for (const rec of page.records) await this.applyRemote(rec);
        await this.setMeta('cursor', String(Math.max(since, page.cursor)));
      });
      total += page.records.length;
      if (!page.more || page.records.length === 0) return total;
    }
  }

  private async applyRemote(rec: RemoteRecord): Promise<void> {
    if (!isSynced(rec.tbl)) return; // a newer client's table: ignore, the cursor still advances
    if (rec.deleted) {
      await this.db.run(`DELETE FROM ${rec.tbl} WHERE id = ?`, [rec.id]);
      await this.db.run('DELETE FROM outbox WHERE tbl = ? AND row_id = ?', [rec.tbl, rec.id]);
      await this.db.run('DELETE FROM conflicts WHERE tbl = ? AND row_id = ?', [rec.tbl, rec.id]);
      this.store.touch(rec.tbl);
      return;
    }
    const local = await this.db.first<{ rev: number }>(`SELECT rev FROM ${rec.tbl} WHERE id = ?`, [rec.id]);
    if (local && local.rev >= rec.rev) return; // our own echo
    const queued = await this.db.first<{ n: number }>('SELECT COUNT(*) AS n FROM outbox WHERE tbl = ? AND row_id = ?', [rec.tbl, rec.id]);
    if (queued && queued.n > 0) return; // local edits pending: the push will surface the conflict
    if (!rec.data) return;
    await this.store.writeRow(rec.tbl, { ...rec.data, id: rec.id, rev: rec.rev, deleted_at: null });
    this.store.touch(rec.tbl);
  }

  /** Recoverable choice for a same-row conflict. */
  async resolveConflict(conflictId: string, keep: 'mine' | 'theirs'): Promise<void> {
    await this.store.tx(async () => {
      const c = await this.db.first<{ tbl: string; row_id: string; remote_data: string; remote_rev: number }>('SELECT * FROM conflicts WHERE id = ?', [conflictId]);
      if (!c) return;
      if (keep === 'theirs') {
        await this.store.writeRow(c.tbl, { ...(JSON.parse(c.remote_data) as Row), id: c.row_id, rev: c.remote_rev, deleted_at: null });
        await this.db.run('DELETE FROM outbox WHERE tbl = ? AND row_id = ?', [c.tbl, c.row_id]);
      } else {
        const local = await this.db.first<Row>(`SELECT * FROM ${c.tbl} WHERE id = ?`, [c.row_id]);
        await this.db.run('DELETE FROM outbox WHERE tbl = ? AND row_id = ?', [c.tbl, c.row_id]);
        if (local) {
          await this.db.run(`UPDATE ${c.tbl} SET rev = ? WHERE id = ?`, [c.remote_rev, c.row_id]);
          // A new op_id: the server has already recorded the old one as a conflict.
          await this.db.run('INSERT INTO outbox (op_id, tbl, row_id, kind, base_rev, payload, created_at) VALUES (?,?,?,?,?,?,?)',
            [newId(), c.tbl, c.row_id, local.deleted_at ? 'delete' : 'upsert', c.remote_rev, JSON.stringify({ ...local, rev: c.remote_rev }), this.store.now()]);
        }
      }
      await this.db.run('DELETE FROM conflicts WHERE id = ?', [conflictId]);
      this.store.touch(c.tbl, 'conflicts', 'outbox');
    });
  }

  /** Give a parked or failed operation another go. */
  async retryFailed(): Promise<void> {
    await this.db.run(`UPDATE outbox SET status = 'pending', attempts = 0, next_attempt_at = 0 WHERE status = 'failed'`);
    await this.db.run(`UPDATE outbox SET next_attempt_at = 0 WHERE status = 'pending'`);
  }

  async dropOutbox(): Promise<void> {
    await this.db.run('DELETE FROM outbox');
    await this.db.run('DELETE FROM conflicts');
  }

  async status(): Promise<SyncStatus> {
    const c = await this.db.first<{ pending: number; conflicts: number; failed: number; stuck: number }>(
      `SELECT SUM(status = 'pending') AS pending, SUM(status = 'conflict') AS conflicts, SUM(status = 'failed') AS failed,
              SUM(status = 'pending' AND attempts >= ${STUCK_AFTER_ATTEMPTS}) AS stuck FROM outbox`);
    const last = await this.getMeta('last_sync_at');
    return { pending: c?.pending ?? 0, conflicts: c?.conflicts ?? 0, failed: c?.failed ?? 0, stuck: c?.stuck ?? 0, lastSyncAt: last ? Number(last) : null, lastError: (await this.getMeta('last_error')) || null };
  }

  private async getMeta(key: string): Promise<string | null> {
    return (await this.db.first<{ value: string }>('SELECT value FROM sync_meta WHERE key = ?', [key]))?.value ?? null;
  }

  private async setMeta(key: string, value: string) {
    await this.db.run('INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)', [key, value]);
  }
}

const isSynced = (t: string) => (SYNCED_TABLES as readonly string[]).includes(t);
