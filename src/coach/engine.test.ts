import { makeEnv } from '@/data/testkit';
import { loadPrefs } from '@/data/prefs';
import { zonedToInstant } from '@/domain/time';
import type { TurnRequest, TurnResponse } from './contract';
import { CoachEngine } from './engine';
import { CoachError, type CoachTransport } from './transport';

const TZ = 'UTC';
const ctx = { today: '2026-11-19', tz: TZ, now: zonedToInstant('2026-11-19', '12:00', TZ).ms };

/** A fake model: each step returns tool calls or text; it sees exactly what the engine sends. */
function scripted(steps: ((req: TurnRequest) => Partial<TurnResponse>)[], provider: 'anthropic' | 'openai' = 'anthropic') {
  const requests: TurnRequest[] = [];
  let i = 0;
  const t: CoachTransport = {
    config: async () => ({ provider, model: 'm', limits: { perMinute: 6, perDay: 100 } }),
    turn: async (req) => {
      requests.push(JSON.parse(JSON.stringify(req)));
      const step = steps[i++];
      if (!step) throw new Error('no more steps');
      const out = step(req);
      const sent = req.input.type === 'user' ? { role: 'user', content: req.input.text } : { role: 'user', content: req.input.results.map((r) => ({ type: 'tool_result', tool_use_id: r.id })) };
      const toolCalls = out.toolCalls ?? [];
      const assistant = { role: 'assistant', content: [...(out.text ? [{ type: 'text', text: out.text }] : []), ...toolCalls.map((c) => ({ type: 'tool_use', ...c }))] };
      return { provider, model: 'm', append: [sent, assistant], text: out.text ?? '', toolCalls, stop: toolCalls.length ? 'tool' : 'done', safetyFlags: [], usage: { inputTokens: 1, outputTokens: 1 }, remainingToday: 10, ...out } as TurnResponse;
    },
  };
  return { t, requests };
}

describe('coach engine', () => {
  test('reads local data, turns a proposal into a pending card, and never applies it', async () => {
    const env = await makeEnv();
    await env.recovery.addWater(900, '2026-11-19', ctx.now, TZ);
    const tools: string[] = [];
    const { t, requests } = scripted([
      () => ({ toolCalls: [{ id: 'a', name: 'get_profile', input: {} }, { id: 'b', name: 'get_hydration_summary', input: { days: 7 } }] }),
      () => ({ toolCalls: [{ id: 'c', name: 'propose_set_targets', input: { water_ml: 2500, sleep_min: null, kcal: null, protein_g: null, reason: 'You average 900 mL.' } }] }),
      () => ({ text: 'I suggested a 2.5 L water goal — tap Apply if you want it.' }),
    ]);
    const engine = new CoachEngine(env.coach, t, () => ctx, (e) => e.type === 'tool' && tools.push(e.name));
    const r = await engine.send(null, 'Am I drinking enough?', 'App context: x');
    expect(r).toMatchObject({ stop: 'done', text: expect.stringMatching(/2.5 L/) });
    expect(tools).toEqual(['get_profile', 'get_hydration_summary', 'propose_set_targets']);
    // The model received the device's answers.
    const results = requests[1].input.type === 'tool_results' ? requests[1].input.results : [];
    expect(results.find((x) => x.id === 'b')?.content).toMatchObject({ average_ml_over_logged_days: 900, logged_days: 1 });
    expect(requests[2].input).toMatchObject({ type: 'tool_results', results: [{ id: 'c', content: { status: 'awaiting_user_confirmation' } }] });
    // Pending, not applied.
    const [action] = await env.coach.listActions();
    expect(action).toMatchObject({ id: r.proposals[0], status: 'proposed', source: 'chat', thread_id: r.threadId });
    expect((await loadPrefs(env.store)).targets.waterMl).toBeNull();
    // History: user, assistant, tool results, assistant, tool results, assistant — replayed in order.
    expect((await env.coach.history(r.threadId))).toHaveLength(6);
    expect(requests[2].history).toHaveLength(4);
    // After the user applies it, the next message tells the model.
    await env.coach.apply(action.id, ctx);
    await env.coach.appendMessages(r.threadId, [{ role: 'event', displayText: 'The user applied: daily water target 2500 mL.' }], ctx.now);
    const next = scripted([() => ({ text: 'Great.' })]);
    await new CoachEngine(env.coach, next.t, () => ctx).send(r.threadId, 'Thanks', 'App context: x');
    expect(next.requests[0].input).toMatchObject({ type: 'user', notes: ['The user applied: daily water target 2500 mL.'] });
    expect(next.requests[0].threadProvider).toBe('anthropic');
  });

  test('invalid proposals come back to the model as errors it can correct', async () => {
    const env = await makeEnv();
    const { t, requests } = scripted([
      () => ({ toolCalls: [{ id: 'x', name: 'propose_set_targets', input: { water_ml: null, sleep_min: null, kcal: 800, protein_g: null, reason: 'Lose weight fast.' } }] }),
      () => ({ text: 'I can\'t set a target that low; a registered dietitian can help.' }),
    ]);
    const r = await new CoachEngine(env.coach, t, () => ctx).send(null, 'Set me to 800 kcal', 'c');
    expect(requests[1].input).toMatchObject({ type: 'tool_results', results: [{ id: 'x', isError: true, content: { error: 'input.kcal must be at least 1200' } }] });
    expect(r.proposals).toEqual([]);
    expect(await env.coach.listActions()).toEqual([]);
  });

  test('a provider switch on the server starts a new thread and retries once', async () => {
    const env = await makeEnv();
    const old = await env.coach.createThread('openai', ctx.now);
    const events: string[] = [];
    let first = true;
    const t: CoachTransport = {
      config: async () => ({ provider: 'anthropic', model: 'm', limits: { perMinute: 1, perDay: 1 } }),
      turn: async (req) => {
        if (first) { first = false; throw new CoachError('provider_mismatch', 'start a new conversation'); }
        expect(req.threadProvider).toBe('anthropic');
        return { provider: 'anthropic', model: 'm', append: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }], text: 'hello', toolCalls: [], stop: 'done', safetyFlags: [], usage: { inputTokens: 0, outputTokens: 0 }, remainingToday: 1 };
      },
    };
    const r = await new CoachEngine(env.coach, t, () => ctx, (e) => e.type === 'new_thread' && events.push(e.reason)).send(old, 'hi', 'c');
    expect(r.threadId).not.toBe(old);
    expect(events).toEqual(['provider_changed']);
    expect(await env.coach.threadProvider(r.threadId)).toBe('anthropic');
  });

  test('tool round limit: the model is told to answer, and errors propagate without corrupting history', async () => {
    const env = await makeEnv();
    const loop = Array.from({ length: 6 }, () => () => ({ toolCalls: [{ id: Math.random().toString(36).slice(2), name: 'get_profile', input: {} }] }));
    const { t, requests } = scripted([...loop, () => ({ text: 'Here is what I found.' })]);
    const r = await new CoachEngine(env.coach, t, () => ctx).send(null, 'Analyse everything', 'c');
    expect(r).toMatchObject({ stop: 'done', text: 'Here is what I found.' });
    const last = requests.at(-1)!.input;
    expect(last.type === 'tool_results' && last.results[0]).toMatchObject({ isError: true, content: { error: expect.stringMatching(/budget/) } });
    // A network failure on the first request leaves no half-written turn.
    const failing: CoachTransport = { config: async () => ({ provider: 'anthropic', model: 'm', limits: { perMinute: 1, perDay: 1 } }), turn: async () => { throw new CoachError('network', 'offline'); } };
    const before = (await env.coach.history(r.threadId)).length;
    await expect(new CoachEngine(env.coach, failing, () => ctx).send(r.threadId, 'again', 'c')).rejects.toMatchObject({ code: 'network' });
    expect((await env.coach.history(r.threadId)).length).toBe(before);
    await expect(new CoachEngine(env.coach, failing, () => ctx).send(r.threadId, '   ', 'c')).rejects.toMatchObject({ code: 'invalid_request' });
  });
});
