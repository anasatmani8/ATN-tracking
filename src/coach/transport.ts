import type { CoachConfig, CoachErrorBody, CoachErrorCode, TurnRequest, TurnResponse } from './contract';

/** What the coach engine needs from the network. The real one calls the Supabase function; tests use a fake. */
export interface CoachTransport {
  config(): Promise<CoachConfig>;
  turn(req: TurnRequest): Promise<TurnResponse>;
}

/** network = no connection; the rest mirror the server's error codes. */
export class CoachError extends Error {
  constructor(readonly code: CoachErrorCode | 'network', message: string, readonly retryAfterSec?: number) {
    super(message);
  }
}

/**
 * HTTP transport to `<supabase>/functions/v1/coach`. The access token proves who the user is;
 * the provider API key never leaves the server.
 */
export function httpCoachTransport(opts: { baseUrl: string; anonKey: string; accessToken: () => Promise<string | null>; timeoutMs?: number; fetchImpl?: typeof fetch }): CoachTransport {
  const f = opts.fetchImpl ?? fetch;
  async function call<T>(method: 'GET' | 'POST', body?: unknown): Promise<T> {
    const token = await opts.accessToken();
    if (!token) throw new CoachError('unauthorized', 'not signed in');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 70_000);
    let res: Response;
    try {
      res = await f(`${opts.baseUrl.replace(/\/$/, '')}/functions/v1/coach`, {
        method,
        signal: ctrl.signal,
        headers: { Authorization: `Bearer ${token}`, apikey: opts.anonKey, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new CoachError((e as Error)?.name === 'AbortError' ? 'timeout' : 'network', 'request failed');
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    if (!res.ok) {
      const err = (parsed as CoachErrorBody | null)?.error;
      throw new CoachError(err?.code ?? (res.status === 401 ? 'unauthorized' : 'provider_error'), err?.message ?? `HTTP ${res.status}`, err?.retryAfterSec);
    }
    return parsed as T;
  }
  return { config: () => call<CoachConfig>('GET'), turn: (req) => call<TurnResponse>('POST', req) };
}
