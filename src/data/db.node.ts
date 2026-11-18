import Database from 'better-sqlite3';
import { createDb, type Db } from './db';

/** Test / tooling adapter. */
export function openNodeDb(path = ':memory:'): Db {
  const raw = new Database(path);
  raw.pragma('foreign_keys = ON');
  return createDb({
    run: async (sql, params) => void raw.prepare(sql).run(...params),
    all: async (sql, params) => raw.prepare(sql).all(...params),
    exec: async (sql) => void raw.exec(sql),
    close: async () => void raw.close(),
  });
}
