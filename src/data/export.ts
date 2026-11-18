import type { Db } from './db';
import { SCHEMA_VERSION, SYNCED_TABLES } from './schema';

export const EXPORT_FORMAT_VERSION = 1;

export interface ExportBundle {
  format: 'kinset-export';
  formatVersion: number;
  schemaVersion: number;
  exportedAt: string;
  units: { load: 'kg'; volume: 'mL'; mass: 'g'; distance: 'm'; duration: 's'; energy: 'kcal'; instants: 'UTC ms' };
  tables: Record<string, Record<string, unknown>[]>;
}

/**
 * Complete export of everything the user owns, in canonical units. It reads
 * the tables directly, so data behind a hidden tracker is always included.
 * Tombstones and device-local sync bookkeeping are left out.
 */
export async function buildExport(db: Db, now: number): Promise<ExportBundle> {
  const tables: ExportBundle['tables'] = {};
  for (const t of SYNCED_TABLES) {
    const rows = await db.all<Record<string, unknown>>(`SELECT * FROM ${t} WHERE deleted_at IS NULL ORDER BY created_at, id`);
    tables[t] = rows.map(({ rev: _rev, deleted_at: _d, ...rest }) => rest);
  }
  return {
    format: 'kinset-export', formatVersion: EXPORT_FORMAT_VERSION, schemaVersion: SCHEMA_VERSION, exportedAt: new Date(now).toISOString(),
    units: { load: 'kg', volume: 'mL', mass: 'g', distance: 'm', duration: 's', energy: 'kcal', instants: 'UTC ms' },
    tables,
  };
}

function csvCell(v: unknown): string {
  if (v == null) return '';
  let s = String(v);
  // Neutralise spreadsheet formula injection from free-text fields.
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const cols = Object.keys(rows[0]);
  return [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\r\n') + '\r\n';
}

/** One CSV per non-empty table, keyed by file name. */
export function exportCsvFiles(bundle: ExportBundle): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [t, rows] of Object.entries(bundle.tables)) if (rows.length) out[`${t}.csv`] = toCsv(rows);
  return out;
}
