import * as SQLite from 'expo-sqlite';
import { createDb, type Db } from './db';

export async function openExpoDb(name: string): Promise<Db> {
  const raw = await SQLite.openDatabaseAsync(name);
  await raw.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  return createDb({
    run: async (sql, params) => void (await raw.runAsync(sql, params)),
    all: (sql, params) => raw.getAllAsync(sql, params),
    exec: (sql) => raw.execAsync(sql),
    close: () => raw.closeAsync(),
  });
}

export async function deleteExpoDb(name: string): Promise<void> {
  try {
    await SQLite.deleteDatabaseAsync(name);
  } catch {
    // already gone
  }
}
