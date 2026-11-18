import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { buildExport, toCsv, type ExportBundle } from '@/data/export';
import type { Db } from '@/data/db';

/** Hand a file to the OS share sheet (download on web). The file is written to the cache directory only. */
async function shareText(name: string, mime: string, text: string): Promise<void> {
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return;
  }
  const f = new File(Paths.cache, name);
  if (f.exists) f.delete();
  f.create();
  await f.write(text);
  if (!(await Sharing.isAvailableAsync())) throw new Error('sharing_unavailable');
  await Sharing.shareAsync(f.uri, { mimeType: mime, dialogTitle: name, UTI: mime === 'application/json' ? 'public.json' : 'public.comma-separated-values-text' });
}

const stamp = (now: number) => new Date(now).toISOString().slice(0, 10);

export async function shareJson(db: Db, now: number): Promise<ExportBundle> {
  const b = await buildExport(db, now);
  await shareText(`kinset-export-${stamp(now)}.json`, 'application/json', JSON.stringify(b, null, 2));
  return b;
}

export async function shareCsv(db: Db, table: keyof ExportBundle['tables'], now: number): Promise<number> {
  const b = await buildExport(db, now);
  const rows = b.tables[table] ?? [];
  await shareText(`kinset-${table}-${stamp(now)}.csv`, 'text/csv', toCsv(rows) || 'no rows\r\n');
  return rows.length;
}
