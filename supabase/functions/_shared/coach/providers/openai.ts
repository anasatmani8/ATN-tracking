import OpenAI from 'openai';
import { SYSTEM_PROMPT, TOOLS } from '../contract.ts';
import { type CoachProvider, isObj, ProviderError, type ProviderResult, type ProviderTurn, userTurnText } from './types.ts';

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

const TOOL_DEFS: OpenAI.Chat.Completions.ChatCompletionTool[] = TOOLS.map((t) => ({
  type: 'function',
  function: { name: t.name, description: t.description, parameters: t.input_schema as unknown as Record<string, unknown> },
}));

/** OpenAI Chat Completions with function tools. The model must be named explicitly (OPENAI_MODEL / COACH_MODEL). */
export function createOpenAIProvider(opts: { client: OpenAI; model: string; maxTokens?: number }): CoachProvider {
  if (!opts.model) throw new ProviderError('not_configured', 'OPENAI_MODEL is not set');
  return {
    id: 'openai',
    model: opts.model,

    checkHistory(history) {
      for (const m of history) {
        if (!isObj(m) || !['user', 'assistant', 'tool'].includes(m.role as string)) return 'history entries must be user, assistant or tool messages';
      }
      return null;
    },

    pendingToolCalls(history) {
      // Tool results already present after the last assistant message count as answered.
      let i = history.length - 1;
      const answered = new Set<string>();
      while (i >= 0 && isObj(history[i]) && (history[i] as { role: string }).role === 'tool') {
        answered.add(String((history[i] as { tool_call_id: string }).tool_call_id));
        i--;
      }
      const last = history[i];
      if (!isObj(last) || last.role !== 'assistant' || !Array.isArray(last.tool_calls)) return [];
      return (last.tool_calls as { id: string; function?: { name: string } }[]).filter((c) => !answered.has(c.id)).map((c) => ({ id: c.id, name: c.function?.name ?? '' }));
    },

    async turn(t: ProviderTurn): Promise<ProviderResult> {
      let newMsgs: Msg[];
      if (t.input.type === 'user') {
        const { userText, appText } = userTurnText(t.input, t.appNote);
        newMsgs = [{ role: 'user', content: appText ? [{ type: 'text', text: userText }, { type: 'text', text: appText }] : userText }];
      } else {
        newMsgs = t.input.results.map((r) => ({ role: 'tool', tool_call_id: r.id, content: JSON.stringify(r.isError ? { error: r.content } : r.content) }));
      }
      let res: OpenAI.Chat.Completions.ChatCompletion;
      try {
        res = await opts.client.chat.completions.create({
          model: opts.model,
          messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...(t.history as Msg[]), ...newMsgs],
          tools: TOOL_DEFS,
          tool_choice: 'auto',
          max_completion_tokens: opts.maxTokens ?? 4096,
          safety_identifier: t.userHash,
        });
      } catch (e) {
        throw mapOpenAIError(e);
      }
      const usage = { inputTokens: res.usage?.prompt_tokens ?? 0, outputTokens: res.usage?.completion_tokens ?? 0 };
      const choice = res.choices[0];
      if (!choice || choice.finish_reason === 'content_filter') return { append: newMsgs, text: '', toolCalls: [], stop: 'refused', usage };
      if (choice.finish_reason === 'length') return { append: newMsgs, text: '', toolCalls: [], stop: 'truncated', usage };
      const m = choice.message;
      const calls = (m.tool_calls ?? []).filter((c): c is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall => c.type === 'function');
      const toolCalls = calls.map((c) => {
        let input: unknown;
        try {
          input = JSON.parse(c.function.arguments || '{}');
        } catch {
          input = { __invalid_json: true };
        }
        return { id: c.id, name: c.function.name, input };
      });
      const assistant: Msg = {
        role: 'assistant',
        content: m.content ?? null,
        ...(calls.length ? { tool_calls: calls.map((c) => ({ id: c.id, type: 'function' as const, function: { name: c.function.name, arguments: c.function.arguments } })) } : {}),
      };
      return { append: [...newMsgs, assistant], text: (m.content ?? '').trim(), toolCalls, stop: toolCalls.length ? 'tool' : 'done', usage };
    },
  };
}

function mapOpenAIError(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e;
  if (e instanceof OpenAI.RateLimitError) {
    const after = Number(e.headers?.get?.('retry-after'));
    return new ProviderError('rate_limited', 'provider rate limit', Number.isFinite(after) ? after : 30);
  }
  if (e instanceof OpenAI.APIConnectionTimeoutError) return new ProviderError('timeout', 'provider timeout');
  if (e instanceof OpenAI.AuthenticationError || e instanceof OpenAI.PermissionDeniedError) return new ProviderError('not_configured', 'provider credentials rejected');
  if (e instanceof OpenAI.BadRequestError) return new ProviderError('invalid_request', 'provider rejected the conversation');
  if (e instanceof OpenAI.APIError) return new ProviderError('provider_error', `provider error ${e.status ?? ''}`.trim());
  return new ProviderError('provider_error', 'provider unavailable');
}
