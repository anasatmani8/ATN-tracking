import type { Coach, CoachCtx } from '@/data/coach';
import { isProposalTool, LIMITS, type ProviderId, type SafetyFlag, type ToolCall, type ToolResult, TOOL_BY_NAME } from './contract';
import { CoachError, type CoachTransport } from './transport';

export type EngineEvent =
  | { type: 'tool'; name: string }
  | { type: 'new_thread'; reason: 'provider_changed' | 'too_long' | 'restarted' };

export interface SendResult {
  threadId: string;
  text: string;
  proposals: string[];
  safetyFlags: SafetyFlag[];
  stop: 'done' | 'refused' | 'truncated' | 'round_limit';
  remainingToday: number | null;
}

/**
 * Runs one user message through the model, answering tool calls on the device.
 * Read tools return local summaries; proposal tools create pending cards (never applied here).
 * Every step is written to local history before the next request, so a crash loses at most one round.
 */
export class CoachEngine {
  constructor(
    private coach: Coach,
    private transport: CoachTransport,
    private ctx: () => CoachCtx,
    private onEvent: (e: EngineEvent) => void = () => undefined,
  ) {}

  async send(threadIdIn: string | null, text: string, context: string): Promise<SendResult> {
    const trimmed = text.trim().slice(0, LIMITS.maxUserTextChars);
    if (!trimmed) throw new CoachError('invalid_request', 'empty message');
    let threadId = threadIdIn;
    let provider = threadId ? await this.coach.threadProvider(threadId) : null;
    if (threadId && !provider) threadId = null;
    // Long threads start fresh: the request would grow past the server's limits.
    if (threadId && (await this.coach.history(threadId)).length > LIMITS.maxHistoryMessages - 12) {
      threadId = null;
      this.onEvent({ type: 'new_thread', reason: 'too_long' });
    }
    const notes = threadId ? await this.pendingNotes(threadId) : [];
    let restarted = false;
    for (;;) {
      try {
        if (!threadId) {
          const cfg = await this.transport.config();
          provider = cfg.provider;
          threadId = await this.coach.createThread(cfg.provider, this.ctx().now);
        }
        return await this.run(threadId, provider as ProviderId, trimmed, context, notes);
      } catch (e) {
        // A conversation the server can't continue (provider switched, broken history) restarts once.
        if (!restarted && e instanceof CoachError && (e.code === 'provider_mismatch' || (e.code === 'invalid_request' && /start a new/.test(e.message)))) {
          restarted = true;
          threadId = null;
          this.onEvent({ type: 'new_thread', reason: e.code === 'provider_mismatch' ? 'provider_changed' : 'restarted' });
          continue;
        }
        throw e;
      }
    }
  }

  /** App events (applied/declined proposals) since the user's last message become notes for the model. */
  private async pendingNotes(threadId: string): Promise<string[]> {
    const msgs = await this.coach.listMessages(threadId);
    const lastUser = msgs.map((m) => m.role).lastIndexOf('user');
    return msgs.slice(lastUser + 1).filter((m) => m.role === 'event').map((m) => m.display_text).slice(-5);
  }

  private async run(threadId: string, provider: ProviderId, text: string, context: string, notes: string[]): Promise<SendResult> {
    const proposals: string[] = [];
    let res = await this.transport.turn({ threadProvider: provider, history: await this.coach.history(threadId), input: { type: 'user', text, context, notes } });
    const now = () => this.ctx().now;
    // The user's text and the appended native messages are stored together.
    await this.coach.appendMessages(threadId, [
      { role: 'user', displayText: text, native: res.append[0], safety: res.safetyFlags },
      ...res.append.slice(1).map((n) => ({ role: 'assistant' as const, displayText: res.text, native: n })),
    ], now());
    const safety = res.safetyFlags;
    for (let round = 1; res.stop === 'tool'; round++) {
      const results: ToolResult[] = [];
      const lastRound = round >= LIMITS.maxRoundsPerMessage;
      for (const call of res.toolCalls) results.push(lastRound ? this.budgetUsed(call) : await this.execute(threadId, call, proposals));
      res = await this.transport.turn({ threadProvider: provider, history: await this.coach.history(threadId), input: { type: 'tool_results', results } });
      await this.coach.appendMessages(threadId, res.append.map((n, i) => ({
        role: i === 0 ? ('tool' as const) : ('assistant' as const), displayText: i === 0 ? '' : res.text, native: n,
      })), now());
      if (lastRound && res.stop === 'tool') {
        return { threadId, text: res.text, proposals, safetyFlags: safety, stop: 'round_limit', remainingToday: res.remainingToday };
      }
    }
    return { threadId, text: res.text, proposals, safetyFlags: safety, stop: res.stop, remainingToday: res.remainingToday };
  }

  private budgetUsed(call: ToolCall): ToolResult {
    return { id: call.id, name: call.name, content: { error: 'Tool budget for this message is used up. Answer the user now without calling tools.' }, isError: true };
  }

  private async execute(threadId: string, call: ToolCall, proposals: string[]): Promise<ToolResult> {
    if (!TOOL_BY_NAME[call.name]) return { id: call.id, name: call.name, content: { error: `Unknown tool ${call.name}` }, isError: true };
    this.onEvent({ type: 'tool', name: call.name });
    try {
      if (isProposalTool(call.name)) {
        const r = await this.coach.propose('chat', threadId, call, this.ctx());
        if (!r.ok) return { id: call.id, name: call.name, content: { error: r.error }, isError: true };
        proposals.push(r.value.id);
        return { id: call.id, name: call.name, content: { status: 'awaiting_user_confirmation', proposal_id: r.value.id, note: 'Shown to the user as a card. Do not claim it was applied.' } };
      }
      const content = await this.coach.runRead(call.name, call.input, this.ctx());
      const isError = typeof content === 'object' && content !== null && 'error' in content;
      return { id: call.id, name: call.name, content: shrink(content), isError };
    } catch {
      return { id: call.id, name: call.name, content: { error: 'The app could not read that data.' }, isError: true };
    }
  }
}

/** Keep tool results under the server's size limit by trimming long arrays from the end. */
function shrink(content: unknown): unknown {
  const size = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;
  if (size(content) <= LIMITS.maxToolResultBytes - 200) return content;
  const copy = JSON.parse(JSON.stringify(content)) as Record<string, unknown>;
  for (let i = 0; i < 50 && size(copy) > LIMITS.maxToolResultBytes - 200; i++) {
    const key = Object.keys(copy).find((k) => Array.isArray(copy[k]) && (copy[k] as unknown[]).length > 1);
    if (!key) break;
    const arr = copy[key] as unknown[];
    copy[key] = arr.slice(Math.ceil(arr.length / 2));
    copy.truncated = 'Older items were left out to fit; ask for fewer days for detail.';
  }
  return size(copy) <= LIMITS.maxToolResultBytes - 200 ? copy : { error: 'Result too large; ask for fewer days.' };
}
