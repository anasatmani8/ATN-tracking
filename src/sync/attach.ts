import type { Db } from '@/data/db';
import { LOCAL_USER_TABLES, SYNCED_TABLES } from '@/data/schema';
import type { Row, Store } from '@/data/store';

/**
 * Copy guest data into an account partition, only after the user agreed.
 * One local transaction: rows are copied and their sync operations queued
 * together, so a crash leaves either everything or nothing. Rows whose id
 * already exists in the account are skipped, which makes a repeat harmless.
 * An in-progress workout is carried over but stays local until it is finished.
 */
export async function attachGuestData(guest: Db, account: Store): Promise<{ copied: number; skipped: number }> {
  let copied = 0;
  let skipped = 0;
  await account.tx(async () => {
    const activeIds = new Set((await guest.all<{ id: string }>(`SELECT id FROM sessions WHERE status = 'active'`)).map((r) => r.id));
    for (const t of SYNCED_TABLES) {
      const rows = await guest.all<Row>(`SELECT * FROM ${t} WHERE deleted_at IS NULL`);
      for (const r of rows) {
        const id = r.id as string;
        const exists = await account.db.first<{ id: string }>(`SELECT id FROM ${t} WHERE id = ?`, [id]);
        if (exists) {
          skipped += 1;
          continue;
        }
        const row = { ...r, rev: 0 };
        await account.writeRow(t, row);
        const sessionId = t === 'sessions' ? id : ((r.session_id as string | null) ?? null);
        const draft = (t === 'sessions' || t === 'session_exercises' || t === 'session_sets') && sessionId != null && activeIds.has(sessionId);
        if (!draft) await account.enqueue(t, id, 'upsert', 0, row);
        account.touch(t);
        copied += 1;
      }
    }
    await account.db.run(`INSERT OR REPLACE INTO sync_meta (key, value) VALUES ('guest_attached_at', ?)`, [String(account.now())]);
  });
  return { copied, skipped };
}

/** Remove all user data from a partition (local erase, or after a successful guest attach). */
export async function wipeData(db: Db): Promise<void> {
  await db.tx(async () => {
    for (const t of [...SYNCED_TABLES, ...LOCAL_USER_TABLES, 'outbox', 'conflicts', 'sync_meta']) await db.run(`DELETE FROM ${t}`);
  });
}
