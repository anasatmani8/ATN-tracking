/** Minimal async SQL boundary so repositories run on expo-sqlite (app) and better-sqlite3 (tests). */
export type SqlValue = string | number | null;

export interface Db {
  run(sql: string, params?: SqlValue[]): Promise<void>;
  all<T = Record<string, SqlValue>>(sql: string, params?: SqlValue[]): Promise<T[]>;
  first<T = Record<string, SqlValue>>(sql: string, params?: SqlValue[]): Promise<T | null>;
  exec(sql: string): Promise<void>;
  /** Serialized transaction. Nested calls join the outer transaction. */
  tx<T>(fn: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export interface RawDriver {
  run(sql: string, params: SqlValue[]): Promise<void>;
  all(sql: string, params: SqlValue[]): Promise<unknown[]>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

/** Wraps a driver with a FIFO lock so concurrent UI writes can never interleave inside a transaction. */
export function createDb(driver: RawDriver): Db {
  let tail: Promise<unknown> = Promise.resolve();
  let depth = 0;
  const db: Db = {
    run: (sql, params = []) => driver.run(sql, params),
    all: (sql, params = []) => driver.all(sql, params) as Promise<never[]>,
    first: async (sql, params = []) => ((await driver.all(sql, params))[0] as never) ?? null,
    exec: (sql) => driver.exec(sql),
    close: () => driver.close(),
    tx<T>(fn: () => Promise<T>): Promise<T> {
      if (depth > 0) return fn();
      const run = async () => {
        depth += 1;
        await driver.exec('BEGIN IMMEDIATE');
        try {
          const out = await fn();
          await driver.exec('COMMIT');
          return out;
        } catch (e) {
          await driver.exec('ROLLBACK').catch(() => undefined);
          throw e;
        } finally {
          depth -= 1;
        }
      };
      const next = tail.then(run, run);
      tail = next.catch(() => undefined);
      return next;
    },
  };
  return db;
}
