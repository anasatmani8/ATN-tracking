import { openNodeDb } from './db.node';
import { migrate } from './schema';
import { Store } from './store';
import { Training } from './training';
import { Nutrition } from './nutrition';
import { Recovery } from './recovery';
import { Coach } from './coach';

export async function makeEnv(opts: { sync?: boolean; path?: string } = {}) {
  const db = openNodeDb(opts.path);
  await migrate(db);
  const store = new Store(db, opts.sync ?? false);
  const training = new Training(store);
  const nutrition = new Nutrition(store);
  const recovery = new Recovery(store);
  return { db, store, training, nutrition, recovery, coach: new Coach(store, training, nutrition, recovery) };
}
export type Env = Awaited<ReturnType<typeof makeEnv>>;
