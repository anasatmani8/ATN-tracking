// Supabase Edge Function: the AI coach. Deploy with `supabase functions deploy coach`.
// Secrets (supabase secrets set ...): COACH_PROVIDER, ANTHROPIC_API_KEY or OPENAI_API_KEY, COACH_HASH_SALT;
// optional: COACH_MODEL, COACH_EFFORT, COACH_PER_MINUTE, COACH_PER_DAY, COACH_TOKENS_PER_DAY, COACH_TIMEOUT_MS.
// API keys exist only here; the app never receives them.
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import { createCoachHandler, hashUserId } from '../_shared/coach/handler.ts';
import { createAnthropicProvider } from '../_shared/coach/providers/anthropic.ts';
import { createOpenAIProvider } from '../_shared/coach/providers/openai.ts';
import type { CoachProvider } from '../_shared/coach/providers/types.ts';

const env = (k: string) => Deno.env.get(k) ?? '';
const int = (k: string, d: number) => (Number.isFinite(Number(env(k))) && env(k) !== '' ? Number(env(k)) : d);

const timeoutMs = int('COACH_TIMEOUT_MS', 55_000);
const limits = { perMinute: int('COACH_PER_MINUTE', 6), perDay: int('COACH_PER_DAY', 100) };
const tokensPerDay = int('COACH_TOKENS_PER_DAY', 2_000_000);

function makeProvider(): CoachProvider | null {
  const which = env('COACH_PROVIDER') || 'anthropic';
  if (which === 'anthropic' && env('ANTHROPIC_API_KEY')) {
    const effort = env('COACH_EFFORT') as 'low' | 'medium' | 'high' | '';
    return createAnthropicProvider({
      client: new Anthropic({ apiKey: env('ANTHROPIC_API_KEY'), timeout: timeoutMs, maxRetries: 1 }),
      model: env('COACH_MODEL') || undefined,
      effort: effort || undefined,
    });
  }
  if (which === 'openai' && env('OPENAI_API_KEY') && (env('COACH_MODEL') || env('OPENAI_MODEL'))) {
    return createOpenAIProvider({
      client: new OpenAI({ apiKey: env('OPENAI_API_KEY'), timeout: timeoutMs, maxRetries: 1 }),
      model: env('COACH_MODEL') || env('OPENAI_MODEL'),
    });
  }
  return null;
}

const provider = makeProvider();
const salt = env('COACH_HASH_SALT') || env('SUPABASE_URL');

/** A Supabase client acting as the caller, so RLS and auth.uid() apply. */
function asUser(req: Request) {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false },
  });
}

Deno.serve(createCoachHandler({
  provider,
  limits,
  timeoutMs,
  hashUser: (id) => hashUserId(id, salt),
  async authenticate(req) {
    if (!req.headers.get('Authorization')?.startsWith('Bearer ')) return null;
    const { data, error } = await asUser(req).auth.getUser();
    return error || !data.user ? null : { id: data.user.id };
  },
  async consume(req) {
    const { data, error } = await asUser(req).rpc('coach_consume', { per_minute: limits.perMinute, per_day: limits.perDay, tokens_per_day: tokensPerDay });
    if (error) throw new Error(error.code ?? 'consume_failed');
    return { allowed: !!data.allowed, retryAfterSec: Number(data.retry_after_sec ?? 0), remainingToday: data.remaining_today ?? null };
  },
  async recordTokens(req, _user, input, output) {
    await asUser(req).rpc('coach_record_tokens', { input_tokens: input, output_tokens: output });
  },
  log(event, detail) {
    console.log(JSON.stringify({ fn: 'coach', event, ...detail }));
  },
}));
