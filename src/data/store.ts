import type { Db, SqlValue } from './db';
import { SYNCED_TABLES, type SyncedTable } from './schema';

export type Row = Record<string, SqlValue>;
type Listener = (tables: Set<string>) => void;

let idGen: () => string = () => {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
};
export const setIdGenerator = (fn: () => string) => (idGen = fn);
export const newId = () => idGen();

export interface WriteOpts {
  /** false keeps the write device-local (used for in-progress workout drafts). */
  sync?: boolean;
}

/**
 * The single write path. Every mutation of a synced table goes through here so
 * the row change and its outbox operation commit in the same transaction, and
 * so derived views are told which tables changed.
 */
export class Store {
  private listeners = new Set<Listener>();
  private pending = new Set<string>();
  private columns = new Map<string, string[]>();
  now: () => number = Date.now;

  constructor(
    readonly db: Db,
    /** Outbox is only written for account partitions. Guest and demo data stay on the device. */
    public syncEnabled: boolean,
  ) {}

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Mark tables dirty; listeners fire once the outermost transaction commits. */
  touch(...tables: string[]) {
    for (const t of tables) this.pending.add(t);
  }

  private flush() {
    if (this.pending.size === 0) return;
    const tables = this.pending;
    this.pending = new Set();
    for (const l of [...this.listeners]) l(tables);
  }

  async tx<T>(fn: () => Promise<T>): Promise<T> {
    try {
      const out = await this.db.tx(fn);
      this.flush();
      return out;
    } catch (e) {
      this.pending = new Set();
      throw e;
    }
  }

  async columnsOf(table: string): Promise<string[]> {
    let cols = this.columns.get(table);
    if (!cols) {
      assertTable(table);
      cols = (await this.db.all<{ name: string }>(`PRAGMA table_info(${table})`)).map((c) => c.name);
      this.columns.set(table, cols);
    }
    return cols;
  }

  async get<T = Row>(table: SyncedTable, id: string): Promise<T | null> {
    assertTable(table);
    return this.db.first<T>(`SELECT * FROM ${table} WHERE id = ? AND deleted_at IS NULL`, [id]);
  }

  /** Insert or fully replace a row. Unknown keys are rejected by SQLite; common columns are managed here. */
  async put(table: SyncedTable, row: Row & { id: string }, opts: WriteOpts = {}): Promise<void> {
    await this.tx(async () => {
      const existing = await this.db.first<Row>(`SELECT * FROM ${table} WHERE id = ?`, [row.id]);
      const now = this.now();
      const full: Row = { ...existing, ...row, created_at: (existing?.created_at as number) ?? now, updated_at: now, deleted_at: null, rev: (existing?.rev as number) ?? 0 };
      await this.writeRow(table, full);
      if (opts.sync !== false) await this.enqueue(table, row.id, 'upsert', full.rev as number, full);
      this.touch(table);
    });
  }

  async patch(table: SyncedTable, id: string, fields: Row, opts: WriteOpts = {}): Promise<void> {
    await this.tx(async () => {
      const existing = await this.db.first<Row>(`SELECT * FROM ${table} WHERE id = ? AND deleted_at IS NULL`, [id]);
      if (!existing) return;
      const full: Row = { ...existing, ...fields, updated_at: this.now() };
      await this.writeRow(table, full);
      if (opts.sync !== false) await this.enqueue(table, id, 'upsert', full.rev as number, full);
      this.touch(table);
    });
  }

  /** Tombstone a row. Synced rows keep the tombstone so a stale device can never resurrect them. */
  async remove(table: SyncedTable, id: string, opts: WriteOpts = {}): Promise<void> {
    await this.tx(async () => {
      const existing = await this.db.first<Row>(`SELECT rev FROM ${table} WHERE id = ? AND deleted_at IS NULL`, [id]);
      if (!existing) return;
      const now = this.now();
      if (opts.sync === false) await this.db.run(`DELETE FROM ${table} WHERE id = ?`, [id]);
      else {
        await this.db.run(`UPDATE ${table} SET deleted_at = ?, updated_at = ? WHERE id = ?`, [now, now, id]);
        await this.enqueue(table, id, 'delete', existing.rev as number, null);
      }
      this.touch(table);
    });
  }

  async writeRow(table: string, row: Row): Promise<void> {
    const cols = (await this.columnsOf(table)).filter((c) => c in row);
    const sql = `INSERT OR REPLACE INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`;
    await this.db.run(sql, cols.map((c) => row[c] ?? null));
  }

  /**
   * Queue a sync operation. An unsent upsert for the same row is replaced in
   * place; an operation that may already have reached the server is never
   * rewritten, because its op_id is the idempotency key.
   */
  async enqueue(table: string, rowId: string, kind: 'upsert' | 'delete' | 'session_complete', baseRev: number, payload: unknown): Promise<void> {
    if (!this.syncEnabled) return;
    const now = this.now();
    if (kind === 'upsert') {
      const unsent = await this.db.first<{ seq: number }>(
        `SELECT seq FROM outbox WHERE tbl = ? AND row_id = ? AND kind = 'upsert' AND attempts = 0 AND status = 'pending' ORDER BY seq DESC LIMIT 1`,
        [table, rowId],
      );
      const later = unsent
        ? await this.db.first<{ seq: number }>(`SELECT seq FROM outbox WHERE tbl = ? AND row_id = ? AND seq > ?`, [table, rowId, unsent.seq])
        : null;
      if (unsent && !later) {
        await this.db.run(`UPDATE outbox SET payload = ? WHERE seq = ?`, [JSON.stringify(payload), unsent.seq]);
        return;
      }
    }
    if (kind === 'delete') {
      // Unsent edits to a row that is being deleted are pointless; drop them.
      await this.db.run(`DELETE FROM outbox WHERE tbl = ? AND row_id = ? AND kind = 'upsert' AND attempts = 0`, [table, rowId]);
    }
    await this.db.run(
      `INSERT INTO outbox (op_id, tbl, row_id, kind, base_rev, payload, created_at) VALUES (?,?,?,?,?,?,?)`,
      [newId(), table, rowId, kind, baseRev, payload == null ? null : JSON.stringify(payload), now],
    );
    this.touch('outbox');
  }
}

function assertTable(table: string) {
  if (!(SYNCED_TABLES as readonly string[]).includes(table)) throw new Error(`Unknown table ${table}`);
}

export const json = <T>(text: SqlValue | undefined, fallback: T): T => {
  if (typeof text !== 'string') return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
};
