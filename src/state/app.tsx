import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as Localization from 'expo-localization';
import React, { createContext, useCallback, useContext, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { seedDemo } from '@/data/demo';
import type { Db } from '@/data/db';
import { deleteExpoDb, openExpoDb } from '@/data/db.expo';
import { Nutrition } from '@/data/nutrition';
import { DEFAULT_PREFS, loadPrefs, localeDefaults, savePrefs, type Prefs } from '@/data/prefs';
import { Recovery } from '@/data/recovery';
import { migrate } from '@/data/schema';
import { setIdGenerator, Store } from '@/data/store';
import { Training } from '@/data/training';
import { deviceTimeZone, localDateOf, type LocalDate } from '@/domain/time';
import { setLocale } from '@/i18n';
import { attachGuestData, wipeData } from '@/sync/attach';
import { cloudEnabled, supabase, supabaseTransport } from '@/sync/cloud';
import { SyncEngine, type SyncReport, type SyncStatus } from '@/sync/engine';

setIdGenerator(() => Crypto.randomUUID());

const PARTITION_KEY = 'kinset.partition';
const dbName = (p: string) => `kinset-${p}.db`;
const acct = (uid: string) => `acct-${uid}`;

interface Env {
  partition: string;
  db: Db;
  store: Store;
  training: Training;
  nutrition: Nutrition;
  recovery: Recovery;
  engine: SyncEngine | null;
}

export interface AppCtx extends Env {
  prefs: Prefs;
  setPrefs: (patch: Partial<Prefs>) => Promise<void>;
  tz: string;
  today: LocalDate;
  isDemo: boolean;
  enterDemo: () => Promise<void>;
  exitDemo: () => Promise<void>;
  /** Erase everything stored in the current partition on this device. */
  eraseLocal: () => Promise<void>;
  cloud: {
    enabled: boolean;
    email: string | null;
    userId: string | null;
    /** Guest rows waiting for the user's decision after first sign-in. */
    guestRowsToMerge: number;
    signIn: (email: string, password: string) => Promise<string | null>;
    signUp: (email: string, password: string) => Promise<string | null>;
    signOut: (removeLocalCopy: boolean) => Promise<void>;
    mergeGuest: (merge: boolean) => Promise<void>;
    deleteAccount: (password: string) => Promise<string | null>;
  };
  sync: { status: SyncStatus | null; lastReport: SyncReport | null; run: () => Promise<SyncReport | null> };
}

const Ctx = createContext<AppCtx | null>(null);
export function useApp(): AppCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('AppProvider missing');
  return v;
}

async function openEnv(partition: string): Promise<Env> {
  const db = await openExpoDb(dbName(partition));
  const from = await migrate(db);
  const store = new Store(db, partition.startsWith('acct-'));
  if (from === 0 && partition === 'guest') {
    const loc = Localization.getLocales()[0];
    await savePrefs(store, localeDefaults(loc?.regionCode ?? null, loc?.measurementSystem ? loc.measurementSystem === 'metric' : null));
  }
  return {
    partition, db, store, training: new Training(store), nutrition: new Nutrition(store), recovery: new Recovery(store),
    engine: store.syncEnabled && cloudEnabled ? new SyncEngine(store, supabaseTransport) : null,
  };
}

async function countUserRows(db: Db): Promise<number> {
  let n = 0;
  for (const t of ['sessions', 'food_logs', 'water_logs', 'sleep_logs', 'measurements', 'programs', 'foods', 'recipes', 'checkins']) {
    n += (await db.first<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t} WHERE deleted_at IS NULL`))?.n ?? 0;
  }
  return n;
}

export function AppProvider({ children, fallback }: { children: React.ReactNode; fallback: React.ReactNode }) {
  const [env, setEnv] = useState<Env | null>(null);
  const [prefs, setPrefsState] = useState<Prefs>(DEFAULT_PREFS);
  const [tz, setTz] = useState(deviceTimeZone());
  const [today, setToday] = useState(() => localDateOf(Date.now(), deviceTimeZone()));
  const [user, setUser] = useState<{ id: string; email: string | null } | null>(null);
  const [authReady, setAuthReady] = useState(!cloudEnabled);
  const [guestRows, setGuestRows] = useState(0);
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [lastReport, setLastReport] = useState<SyncReport | null>(null);
  const envRef = useRef<Env | null>(null);
  const switching = useRef<Promise<void>>(Promise.resolve());

  const switchTo = useCallback((partition: string, before?: () => Promise<void>) => {
    const run = async () => {
      const prev = envRef.current;
      if (prev?.partition === partition && !before) return;
      setEnv(null);
      envRef.current = null;
      if (prev) await prev.db.close().catch(() => undefined);
      if (before) await before();
      const next = await openEnv(partition);
      envRef.current = next;
      setPrefsState(await loadPrefs(next.store));
      if (partition !== 'demo') await AsyncStorage.setItem(PARTITION_KEY, partition);
      setEnv(next);
    };
    switching.current = switching.current.then(run, run);
    return switching.current;
  }, []);

  // Clock: local date and zone follow the device, refreshed on foreground and each minute.
  useEffect(() => {
    const tick = () => {
      const z = deviceTimeZone();
      setTz(z);
      setToday(localDateOf(Date.now(), z));
    };
    const id = setInterval(tick, 30_000);
    const sub = AppState.addEventListener('change', (s) => s === 'active' && tick());
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, []);

  // Auth session → partition.
  useEffect(() => {
    setLocale(Localization.getLocales()[0]?.languageTag);
    if (!cloudEnabled) return;
    const { data } = supabase().auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ? { id: session.user.id, email: session.user.email ?? null } : null);
      setAuthReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!authReady) return;
    (async () => {
      const saved = (await AsyncStorage.getItem(PARTITION_KEY)) ?? 'guest';
      if (user) await switchTo(acct(user.id));
      else await switchTo(saved.startsWith('acct-') ? 'guest' : saved);
    })();
  }, [authReady, user, switchTo]);

  // After sign-in, check whether this device holds guest data the user may want to bring along.
  useEffect(() => {
    if (!user) return;
    (async () => {
      const g = await openExpoDb(dbName('guest'));
      try {
        await migrate(g);
        setGuestRows(await countUserRows(g));
      } finally {
        await g.close();
      }
    })().catch(() => setGuestRows(0));
  }, [user]);

  const runSync = useCallback(async (): Promise<SyncReport | null> => {
    const e = envRef.current;
    if (!e?.engine) return null;
    const report = await e.engine.syncOnce();
    if (envRef.current !== e) return report;
    setLastReport(report);
    setStatus(await e.engine.status());
    if (report.stopped === 'erased') {
      // The account was deleted elsewhere: nothing may be uploaded, and the local copy goes too.
      await supabase().auth.signOut({ scope: 'local' }).catch(() => undefined);
      await switchTo('guest', () => deleteExpoDb(dbName(e.partition)));
    }
    return report;
  }, [switchTo]);

  // Live prefs + sync triggers for the open partition.
  useEffect(() => {
    if (!env) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = env.store.subscribe((tables) => {
      if (tables.has('prefs')) loadPrefs(env.store).then(setPrefsState).catch(() => undefined);
      if (env.engine && tables.has('outbox')) {
        env.engine.status().then(setStatus).catch(() => undefined);
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => void runSync(), 1500);
      }
    });
    if (env.engine) void runSync();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && env.engine && void runSync());
    return () => {
      unsub();
      sub.remove();
      if (timer) clearTimeout(timer);
    };
  }, [env, runSync]);

  const value = useMemo<AppCtx | null>(() => {
    if (!env) return null;
    return {
      ...env, prefs, tz, today,
      // Resolve only after in-memory prefs reflect the write, so navigation right after sees the new values.
      setPrefs: async (patch) => {
        await savePrefs(env.store, patch);
        setPrefsState(await loadPrefs(env.store));
      },
      isDemo: env.partition === 'demo',
      enterDemo: () => switchTo('demo', async () => {
        await deleteExpoDb(dbName('demo'));
        const d = await openEnv('demo');
        const z = deviceTimeZone();
        await seedDemo(d, localDateOf(Date.now(), z), z);
        await d.db.close();
      }),
      exitDemo: async () => {
        const saved = (await AsyncStorage.getItem(PARTITION_KEY)) ?? 'guest';
        await switchTo(user ? acct(user.id) : saved, () => deleteExpoDb(dbName('demo')));
      },
      eraseLocal: async () => {
        await wipeData(env.db);
        env.store.touch('prefs', 'sessions', 'session_sets', 'session_exercises', 'programs', 'scheduled_workouts', 'food_logs', 'planned_meals', 'water_logs', 'sleep_logs', 'measurements', 'checkins', 'reminders', 'foods', 'recipes', 'saved_meals', 'outbox');
        await env.store.tx(async () => undefined);
        setPrefsState(await loadPrefs(env.store));
      },
      cloud: {
        enabled: cloudEnabled, email: user?.email ?? null, userId: user?.id ?? null, guestRowsToMerge: user ? guestRows : 0,
        signIn: async (email, password) => {
          const { error } = await supabase().auth.signInWithPassword({ email: email.trim(), password });
          return error ? error.message : null;
        },
        signUp: async (email, password) => {
          const { data, error } = await supabase().auth.signUp({ email: email.trim(), password });
          if (error) return error.message;
          return data.session ? null : 'confirm_email';
        },
        signOut: async (removeLocalCopy) => {
          // Queued changes stay in the account's local database and upload at the next sign-in,
          // unless the user explicitly removes the local copy.
          await runSync().catch(() => undefined);
          const name = dbName(env.partition);
          await supabase().auth.signOut({ scope: 'local' });
          if (removeLocalCopy) await switchTo('guest', () => deleteExpoDb(name));
        },
        mergeGuest: async (merge) => {
          if (merge && env.store.syncEnabled) {
            const g = await openExpoDb(dbName('guest'));
            try {
              await attachGuestData(g, env.store);
              // Clear the guest copy so it cannot be merged twice.
              await wipeData(g);
            } finally {
              await g.close();
            }
            setPrefsState(await loadPrefs(env.store));
          }
          setGuestRows(0);
        },
        deleteAccount: async (password) => {
          if (!user?.email) return 'not_signed_in';
          // Re-authenticate so the server sees a fresh sign-in on the token.
          const re = await supabase().auth.signInWithPassword({ email: user.email, password });
          if (re.error) return re.error.message;
          const { error } = await supabase().functions.invoke('delete-account', { method: 'POST' });
          if (error) return error.message;
          const name = dbName(env.partition);
          await supabase().auth.signOut({ scope: 'local' }).catch(() => undefined);
          await switchTo('guest', () => deleteExpoDb(name));
          return null;
        },
      },
      sync: { status: env.engine ? status : null, lastReport, run: runSync },
    };
  }, [env, prefs, tz, today, user, guestRows, status, lastReport, runSync, switchTo]);

  // The context functions read refs only inside event handlers and async work, never while rendering.
  // eslint-disable-next-line react-hooks/refs
  if (!value) return <>{fallback}</>;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * Derived view over durable state. Re-runs when any of the named tables
 * change, so every screen reads from the same data and stays consistent.
 */
export function useLive<T>(load: (app: AppCtx) => Promise<T>, tables: string[], deps: unknown[] = []): { data: T | undefined; error: unknown } {
  const app = useApp();
  const [state, setState] = useState<{ data: T | undefined; error: unknown }>({ data: undefined, error: null });
  const seq = useRef(0);
  const run = useEffectEvent(() => {
    const n = ++seq.current;
    load(app).then(
      (data) => n === seq.current && setState({ data, error: null }),
      (error) => n === seq.current && setState((s) => ({ data: s.data, error })),
    );
  });
  const key = tables.join(',');
  useEffect(() => {
    run();
    const set = key.split(',');
    return app.store.subscribe((changed) => set.some((t) => changed.has(t)) && run());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.store, app.today, key, ...deps]);
  return state;
}
