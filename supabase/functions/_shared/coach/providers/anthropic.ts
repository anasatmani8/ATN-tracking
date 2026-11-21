import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM_PROMPT, TOOLS } from '../contract.ts';
import { type CoachProvider, isObj, ProviderError, type ProviderResult, type ProviderTurn, strictCompatible, userTurnText } from './types.ts';

export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5-5';
type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** Tool definitions and system prompt never change between requests, so the prefix stays cacheable. */
const TOOL_DEFS: Anthropic.Beta.BetaTool[] = TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  input_schema: strictCompatible(t.input_schema) as Anthropic.Beta.BetaTool.InputSchema,
  strict: true,
}));

export function createAnthropicProvider(opts: { client: Anthropic; model?: string; effort?: Effort; maxTokens?: number }): CoachProvider {
  const model = opts.model || DEFAULT_ANTHROPIC_MODEL;
  return {
    id: 'anthropic',
    model,

    checkHistory(history) {
      for (const m of history) {
        if (!isObj(m) || (m.role !== 'user' && m.role !== 'assistant')) return 'history entries must be user or assistant messages';
        if (typeof m.content !== 'string' && !Array.isArray(m.content)) return 'history content must be text or blocks';
      }
      return null;
    },

    pendingToolCalls(history) {
      const last = history[history.length - 1];
      if (!isObj(last) || last.role !== 'assistant' || !Array.isArray(last.content)) return [];
      return last.content.filter((b): b is { type: 'tool_use'; id: string; name: string } => isObj(b) && b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name }));
    },

    async turn(t: ProviderTurn): Promise<ProviderResult> {
      let newMsg: Anthropic.Beta.BetaMessageParam;
      if (t.input.type === 'user') {
        const { userText, appText } = userTurnText(t.input, t.appNote);
        newMsg = { role: 'user', content: [{ type: 'text', text: userText }, ...(appText ? [{ type: 'text' as const, text: appText }] : [])] };
      } else {
        newMsg = {
          role: 'user',
          content: t.input.results.map((r) => ({ type: 'tool_result' as const, tool_use_id: r.id, content: JSON.stringify(r.content), ...(r.isError ? { is_error: true } : {}) })),
        };
      }
      let res: Anthropic.Beta.BetaMessage;
      try {
        res = await opts.client.beta.messages.create({
          model,
          max_tokens: opts.maxTokens ?? 16000,
          system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
          tools: TOOL_DEFS,
          tool_choice: { type: 'auto' },
          messages: [...(t.history as Anthropic.Beta.BetaMessageParam[]), newMsg],
          output_config: { effort: opts.effort ?? 'medium' },
          // On a safety decline, the API re-runs the request on a fallback model it chooses.
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          metadata: { user_id: t.userHash },
        });
      } catch (e) {
        throw mapAnthropicError(e);
      }
      const usage = {
        inputTokens: (res.usage.input_tokens ?? 0) + (res.usage.cache_creation_input_tokens ?? 0) + (res.usage.cache_read_input_tokens ?? 0),
        outputTokens: res.usage.output_tokens ?? 0,
      };
      // A refused or truncated reply is not kept: the history must stay valid for the next turn.
      if (res.stop_reason === 'refusal') return { append: [newMsg], text: '', toolCalls: [], stop: 'refused', usage };
      if (res.stop_reason === 'max_tokens') return { append: [newMsg], text: '', toolCalls: [], stop: 'truncated', usage };
      const text = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('\n').trim();
      const toolCalls = res.content
        .filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
        .map((b) => ({ id: b.id, name: b.name, input: b.input }));
      // The assistant content goes back unchanged on the next request (thinking blocks included).
      const assistant: Anthropic.Beta.BetaMessageParam = { role: 'assistant', content: res.content as unknown as Anthropic.Beta.BetaContentBlockParam[] };
      return { append: [newMsg, assistant], text, toolCalls, stop: res.stop_reason === 'tool_use' && toolCalls.length ? 'tool' : 'done', usage };
    },
  };
}

function mapAnthropicError(e: unknown): ProviderError {
  if (e instanceof Anthropic.RateLimitError) {
    const after = Number(e.headers?.get?.('retry-after'));
    return new ProviderError('rate_limited', 'provider rate limit', Number.isFinite(after) ? after : 30);
  }
  if (e instanceof Anthropic.APIConnectionTimeoutError) return new ProviderError('timeout', 'provider timeout');
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return new ProviderError('not_configured', 'provider credentials rejected');
  if (e instanceof Anthropic.BadRequestError) return new ProviderError('invalid_request', 'provider rejected the conversation');
  if (e instanceof Anthropic.APIError) return new ProviderError('provider_error', `provider error ${e.status ?? ''}`.trim());
  return new ProviderError('provider_error', 'provider unavailable');
}
