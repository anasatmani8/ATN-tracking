import {
  type CoachConfig, type CoachErrorBody, type CoachErrorCode, LIMITS, safetyNote, screenMessage, TOOL_BY_NAME, type TurnInput, type TurnRequest, type TurnResponse,
} from './contract.ts';
import { type CoachProvider, isObj, ProviderError } from './providers/types.ts';

export interface AuthedUser {
  id: string;
}

export interface UsageGate {
  allowed: boolean;
  retryAfterSec: number;
  remainingToday: number | null;
}

export interface HandlerDeps {
  /** Verifies the bearer token with Supabase Auth; null when missing or invalid. */
  authenticate(req: Request): Promise<AuthedUser | null>;
  /** Atomically checks and counts one request for the user (per-minute, per-day and token limits). */
  consume(req: Request, user: AuthedUser): Promise<UsageGate>;
  recordTokens(req: Request, user: AuthedUser, input: number, output: number): Promise<void>;
  /** null when the publisher has not configured a provider. */
  provider: CoachProvider | null;
  limits: { perMinute: number; perDay: number };
  hashUser(userId: string): Promise<string>;
  timeoutMs: number;
  /** Error codes only: never message content. */
  log?(event: string, detail: Record<string, string | number>): void;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const STATUS: Record<CoachErrorCode, number> = {
  unauthorized: 401, invalid_request: 400, provider_mismatch: 409, rate_limited: 429, not_configured: 503, provider_error: 502, timeout: 504,
};

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra } });
}

function error(code: CoachErrorCode, message: string, retryAfterSec?: number): Response {
  const body: CoachErrorBody = { error: { code, message, ...(retryAfterSec != null ? { retryAfterSec } : {}) } };
  return json(body, STATUS[code], retryAfterSec != null ? { 'Retry-After': String(retryAfterSec) } : {});
}

const byteLength = (s: string) => new TextEncoder().encode(s).length;

/** Structural checks on the request body. Returns the parsed request or a message. */
export function parseTurnRequest(raw: unknown, provider: CoachProvider): TurnRequest | string {
  if (!isObj(raw)) return 'body must be an object';
  const { threadProvider, history, input } = raw;
  if (threadProvider !== null && threadProvider !== 'anthropic' && threadProvider !== 'openai') return 'threadProvider must be anthropic, openai or null';
  if (!Array.isArray(history)) return 'history must be an array';
  if (history.length > LIMITS.maxHistoryMessages) return 'history_too_long';
  const hp = provider.checkHistory(history);
  if (hp) return hp;
  if (!isObj(input)) return 'input must be an object';
  if (input.type === 'user') {
    if (typeof input.text !== 'string' || input.text.trim().length === 0) return 'input.text is required';
    if (input.text.length > LIMITS.maxUserTextChars) return `input.text is longer than ${LIMITS.maxUserTextChars} characters`;
    if (typeof input.context !== 'string' || input.context.length > LIMITS.maxContextChars) return 'input.context must be a short string';
    const notes = input.notes ?? [];
    if (!Array.isArray(notes) || notes.length > 5 || notes.some((n) => typeof n !== 'string' || n.length > 300)) return 'input.notes must be up to 5 short strings';
    if (provider.pendingToolCalls(history).length > 0) return 'the last assistant message is waiting for tool results';
    return { threadProvider, history, input: { type: 'user', text: input.text, context: input.context, notes: notes as string[] } };
  }
  if (input.type === 'tool_results') {
    const results = input.results;
    if (!Array.isArray(results) || results.length === 0 || results.length > LIMITS.maxToolResultsPerTurn) return 'input.results must be a non-empty array';
    const pending = provider.pendingToolCalls(history);
    const pendingIds = new Set(pending.map((p) => p.id));
    for (const r of results) {
      if (!isObj(r) || typeof r.id !== 'string' || typeof r.name !== 'string') return 'each result needs id and name';
      if (!TOOL_BY_NAME[r.name]) return `unknown tool ${r.name}`;
      if (!pendingIds.has(r.id) || pending.find((p) => p.id === r.id)?.name !== r.name) return 'tool results must answer the pending tool calls';
      if (byteLength(JSON.stringify(r.content ?? null)) > LIMITS.maxToolResultBytes) return `tool result for ${r.name} is too large`;
      if (r.isError != null && typeof r.isError !== 'boolean') return 'isError must be boolean';
    }
    if (new Set(results.map((r) => (r as { id: string }).id)).size !== results.length || results.length !== pending.length) return 'answer every pending tool call exactly once';
    return { threadProvider, history, input: { type: 'tool_results', results: results as Extract<TurnInput, { type: 'tool_results' }>['results'] } };
  }
  return 'input.type must be user or tool_results';
}

export function createCoachHandler(deps: HandlerDeps) {
  return async function handle(req: Request): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'GET' && req.method !== 'POST') return error('invalid_request', 'method not allowed');

    const user = await deps.authenticate(req).catch(() => null);
    if (!user) return error('unauthorized', 'sign in to use the coach');
    const provider = deps.provider;
    if (!provider) return error('not_configured', 'the coach is not set up on this server');

    if (req.method === 'GET') {
      const config: CoachConfig = { provider: provider.id, model: provider.model, limits: deps.limits };
      return json(config);
    }

    const text = await req.text();
    if (byteLength(text) > LIMITS.maxBodyBytes) return error('invalid_request', 'request too large; start a new conversation');
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return error('invalid_request', 'body must be JSON');
    }
    const parsed = parseTurnRequest(raw, provider);
    if (typeof parsed === 'string') return error('invalid_request', parsed);
    if (parsed.threadProvider && parsed.threadProvider !== provider.id) return error('provider_mismatch', 'the coach now uses a different AI provider; start a new conversation');

    const flags = parsed.input.type === 'user' ? screenMessage(parsed.input.text) : [];

    const gate = await deps.consume(req, user).catch(() => null);
    if (!gate) return error('provider_error', 'usage check failed');
    if (!gate.allowed) return error('rate_limited', 'coach limit reached', gate.retryAfterSec);

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new ProviderError('timeout', 'timed out')), deps.timeoutMs); });
      const result = await Promise.race([
        provider.turn({ history: parsed.history, input: parsed.input, appNote: safetyNote(flags), userHash: await deps.hashUser(user.id) }),
        timeout,
      ]);
      await deps.recordTokens(req, user, result.usage.inputTokens, result.usage.outputTokens).catch(() => deps.log?.('record_tokens_failed', {}));
      const body: TurnResponse = { provider: provider.id, model: provider.model, ...result, safetyFlags: flags, remainingToday: gate.remainingToday };
      return json(body);
    } catch (e) {
      if (e instanceof ProviderError) {
        deps.log?.('provider_error', { code: e.code });
        if (e.code === 'rate_limited') return error('rate_limited', 'the AI provider is busy; try again shortly', e.retryAfterSec ?? 30);
        if (e.code === 'timeout') return error('timeout', 'the coach took too long to answer');
        if (e.code === 'not_configured') return error('not_configured', 'the coach is not set up correctly on this server');
        if (e.code === 'invalid_request') return error('invalid_request', 'this conversation can no longer continue; start a new one');
        return error('provider_error', 'the coach is unavailable right now');
      }
      deps.log?.('unexpected_error', {});
      return error('provider_error', 'the coach is unavailable right now');
    } finally {
      clearTimeout(timer);
    }
  };
}

/** One-way, salted hash so the provider can spot abuse without learning who the user is. */
export async function hashUserId(userId: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${userId}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}
