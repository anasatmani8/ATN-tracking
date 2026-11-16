import { openNodeDb } from './db.node';
import { migrate } from './schema';
import { Store } from './store';
import { Training } from './training';
import { Nutrition } from './nutrition';
import { Recovery } from './recovery';

export async function makeEnv(opts: { sync?: boolean; path?: string } = {}) {
  const db = openNodeDb(opts.path);
  await migrate(db);
  const store = new Store(db, opts.sync ?? false);
  return { db, store, training: new Training(store), nutrition: new Nutrition(store), recovery: new Recovery(store) };
}
export type Env = Awaited<ReturnType<typeof makeEnv>>;
