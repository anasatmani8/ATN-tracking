import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { TransportError, type Transport } from './engine';
import { httpCoachTransport } from '@/coach/transport';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
/** With no backend configured the app is local-only and all account UI is hidden. */
export const cloudEnabled = url.length > 0 && anonKey.length > 0;

/** Auth tokens live in the platform keystore. Values are chunked to stay under the per-item size limit. */
const CHUNK = 1800;
const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    const n = Number((await SecureStore.getItemAsync(`${key}.n`)) ?? 0);
    if (!n) return null;
    const parts: string[] = [];
    for (let i = 0; i < n; i++) parts.push((await SecureStore.getItemAsync(`${key}.${i}`)) ?? '');
    return parts.join('');
  },
  async setItem(key: string, value: string): Promise<void> {
    const n = Math.ceil(value.length / CHUNK);
    for (let i = 0; i < n; i++) await SecureStore.setItemAsync(`${key}.${i}`, value.slice(i * CHUNK, (i + 1) * CHUNK));
    await SecureStore.setItemAsync(`${key}.n`, String(n));
  },
  async removeItem(key: string): Promise<void> {
    const n = Number((await SecureStore.getItemAsync(`${key}.n`)) ?? 0);
    for (let i = 0; i < n; i++) await SecureStore.deleteItemAsync(`${key}.${i}`);
    await SecureStore.deleteItemAsync(`${key}.n`);
  },
};

let client: SupabaseClient | null = null;
export function supabase(): SupabaseClient {
  if (!cloudEnabled) throw new Error('Cloud is not configured');
  client ??= createClient(url, anonKey, {
    auth: {
      storage: Platform.OS === 'web' ? undefined : secureStorage,
      storageKey: 'kinset.auth',
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
  return client;
}

function mapError(e: { message?: string; code?: string; status?: number } | null | undefined): TransportError {
  const msg = e?.message ?? '';
  if (msg.includes('account_erased')) return new TransportError('erased');
  if (msg.includes('not_authenticated') || msg.includes('JWT') || e?.code === 'PGRST301' || e?.status === 401) return new TransportError('auth');
  if (/fetch|network|timeout|Failed to/i.test(msg)) return new TransportError('network', msg);
  return new TransportError('server', msg);
}

/** Calls the same RPCs the server tests exercise. */
export const supabaseTransport: Transport = {
  async push(ops) {
    try {
      const { data, error } = await supabase().rpc('sync_push', { ops });
      if (error) throw mapError(error);
      return data;
    } catch (e) {
      throw e instanceof TransportError ? e : mapError(e as Error);
    }
  },
  async pull(since, limit) {
    try {
      const { data, error } = await supabase().rpc('sync_pull', { since, lim: limit });
      if (error) throw mapError(error);
      return data;
    } catch (e) {
      throw e instanceof TransportError ? e : mapError(e as Error);
    }
  },
};

/** AI coach transport: the user's access token authenticates; provider keys live only in the server function. */
export const coachTransport = httpCoachTransport({
  baseUrl: url,
  anonKey,
  accessToken: async () => (cloudEnabled ? ((await supabase().auth.getSession()).data.session?.access_token ?? null) : null),
});
