import type { JsonSchema, ProviderId, StopKind, ToolCall, ToolSpec, TurnInput } from '../contract.ts';

export interface ProviderTurn {
  /** Provider-native history exactly as previously returned. */
  history: unknown[];
  input: TurnInput;
  /** Extra operator text for this turn only (e.g. the safety note). Sent inside the turn, never stored as a system message. */
  appNote: string | null;
  /** Opaque, non-reversible user id for the provider's abuse monitoring. */
  userHash: string;
}

export interface ProviderResult {
  append: unknown[];
  text: string;
  toolCalls: ToolCall[];
  stop: StopKind;
  usage: { inputTokens: number; outputTokens: number };
}

export interface CoachProvider {
  id: ProviderId;
  model: string;
  /** Validates the structure of client-supplied native history; returns a problem or null. */
  checkHistory(history: unknown[]): string | null;
  /** Tool-call ids the last assistant message is waiting on (tool results must answer exactly these). */
  pendingToolCalls(history: unknown[]): { id: string; name: string }[];
  turn(t: ProviderTurn): Promise<ProviderResult>;
}

export type ProviderErrorCode = 'rate_limited' | 'timeout' | 'provider_error' | 'not_configured' | 'invalid_request';

export class ProviderError extends Error {
  constructor(readonly code: ProviderErrorCode, message: string, readonly retryAfterSec?: number) {
    super(message);
  }
}

/** Strict tool schemas may not use numeric/string/array-size constraints; the contract validator enforces those instead. */
export function strictCompatible(schema: JsonSchema): JsonSchema {
  const { minimum: _a, maximum: _b, minLength: _c, maxLength: _d, minItems: _e, maxItems: _f, pattern: _g, ...rest } = schema;
  const out: JsonSchema = { ...rest };
  if (schema.properties) out.properties = Object.fromEntries(Object.entries(schema.properties).map(([k, v]) => [k, strictCompatible(v)]));
  if (schema.items) out.items = strictCompatible(schema.items);
  return out;
}

export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The text the model sees for a user turn: the message, then app context and notes clearly labelled as from the app. */
export function userTurnText(input: Extract<TurnInput, { type: 'user' }>, appNote: string | null): { userText: string; appText: string } {
  const notes = [input.context, ...(input.notes ?? []), ...(appNote ? [appNote] : [])].filter(Boolean);
  return { userText: input.text, appText: notes.length ? `[App information, not written by the user]\n${notes.join('\n')}` : '' };
}

export type { ToolSpec };
