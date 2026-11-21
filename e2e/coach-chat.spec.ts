import { expect, test, type Page, type Route } from '@playwright/test';
import { id } from './helpers';

/**
 * The real chat UI and on-device tool loop against a mocked backend:
 * Playwright answers Supabase Auth, the sync RPCs and the coach function on 127.0.0.1:8090.
 * The "model" below is scripted; it sees exactly the tool results the phone sends.
 */
const API = 'http://127.0.0.1:8090';
const USER = { id: '6f1a5a1e-4c9b-4b8e-9d55-1d6c2a7b9e01', email: 'tester@example.com', aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };

type CoachReq = { threadProvider: string | null; history: unknown[]; input: { type: string; text?: string; results?: { id: string; name: string; content: Record<string, unknown> }[] } };

async function mockBackend(page: Page, model: (req: CoachReq) => { text?: string; toolCalls?: { id: string; name: string; input: unknown }[]; safetyFlags?: string[]; status?: number; error?: unknown }) {
  const seen: CoachReq[] = [];
  await page.route(`${API}/**`, async (route: Route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const url = new URL(req.url());
    const reply = (body: unknown, status = 200) => route.fulfill({ status, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (url.pathname === '/auth/v1/token') {
      return reply({ access_token: 'test-access-token', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r', user: USER });
    }
    if (url.pathname === '/auth/v1/user') return reply(USER);
    if (url.pathname === '/rest/v1/rpc/sync_pull') return reply({ records: [], cursor: 0, more: false });
    if (url.pathname === '/rest/v1/rpc/sync_push') return reply(JSON.parse(req.postData() ?? '{"ops":[]}').ops.map((o: { op_id: string }) => ({ op_id: o.op_id, status: 'ok', rev: 1 })));
    if (url.pathname === '/functions/v1/coach') {
      expect(req.headers()['authorization']).toBe('Bearer test-access-token');
      if (req.method() === 'GET') return reply({ provider: 'anthropic', model: 'claude-opus-5-5', limits: { perMinute: 6, perDay: 100 } });
      const body = JSON.parse(req.postData() ?? '{}') as CoachReq;
      seen.push(body);
      const out = model(body);
      if (out.status) return reply(out.error, out.status);
      const toolCalls = out.toolCalls ?? [];
      const sent = body.input.type === 'user' ? { role: 'user', content: body.input.text } : { role: 'user', content: (body.input.results ?? []).map((r) => ({ type: 'tool_result', tool_use_id: r.id, content: JSON.stringify(r.content) })) };
      const assistant = { role: 'assistant', content: [...(out.text ? [{ type: 'text', text: out.text }] : []), ...toolCalls.map((c) => ({ type: 'tool_use', ...c }))] };
      return reply({ provider: 'anthropic', model: 'claude-opus-5-5', append: [sent, assistant], text: out.text ?? '', toolCalls, stop: toolCalls.length ? 'tool' : 'done', safetyFlags: out.safetyFlags ?? [], usage: { inputTokens: 1, outputTokens: 1 }, remainingToday: 42 });
    }
    return reply({ message: 'not mocked' }, 404);
  });
  return seen;
}

async function signedIn(page: Page) {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/');
  await expect(id(page, 'onboarding')).toBeVisible({ timeout: 20_000 });
  await id(page, 'onb-next').click();
  await id(page, 'opt-home_dumbbell').click();
  await id(page, 'onb-next').click();
  await id(page, 'onb-next').click();
  await id(page, 'onb-finish').click();
  await expect(id(page, 'today-screen')).toBeVisible();
  await id(page, 'open-coach').click();
  await id(page, 'coach-signin').click();
  await page.getByLabel('Email').fill(USER.email);
  await page.getByLabel('Password').fill('correct horse battery');
  await page.getByRole('button', { name: 'Sign in' }).last().click();
  // Signing in opens the account's own database; it starts from this device's settings, so no second onboarding.
  await expect(id(page, 'today-screen')).toBeVisible({ timeout: 20_000 });
  await expect(id(page, 'onboarding')).toHaveCount(0);
  await id(page, 'open-coach').click();
}

test('chat: consent first, tools run on the phone, a proposal waits for Apply, the model hears the outcome', async ({ page }) => {
  let step = 0;
  const seen = await mockBackend(page, (req) => {
    step++;
    if (req.input.type === 'user' && /water/i.test(req.input.text ?? '')) return { toolCalls: [{ id: 't1', name: 'get_hydration_summary', input: { days: 7 } }] };
    if (req.input.type === 'tool_results' && req.input.results?.[0].name === 'get_hydration_summary') {
      return { toolCalls: [{ id: 't2', name: 'propose_set_targets', input: { water_ml: 2500, sleep_min: null, kcal: null, protein_g: null, reason: 'You have no water goal yet; 2.5 L is a common starting point.' } }] };
    }
    if (req.input.type === 'tool_results') return { text: 'I suggested a 2.5 L daily water goal. Apply it if it suits you.' };
    return { text: 'Noted.' };
  });
  await signedIn(page);
  await expect(id(page, 'coach-screen')).toBeVisible();
  // Consent names the provider and model, and must be given before the input appears.
  await expect(id(page, 'coach-consent')).toContainText('Anthropic (Claude) (claude-opus-5-5)');
  await expect(id(page, 'coach-input')).toHaveCount(0);
  await id(page, 'coach-consent-agree').click();
  await id(page, 'coach-input').fill('Am I drinking enough water?');
  await id(page, 'coach-send').click();
  await expect(page.getByTestId('bubble-coach').last()).toContainText('2.5 L daily water goal');
  // The phone answered the read tool from local data.
  const toolMsg = seen.find((r) => r.input.type === 'tool_results' && r.input.results?.[0].name === 'get_hydration_summary')!;
  expect(toolMsg.input.results![0].content).toMatchObject({ logged_days: 0, range_days: 7, goal_ml: null });
  const card = id(page, 'chat-proposal-propose_set_targets');
  await expect(card).toContainText('Needs your OK');
  await expect(card).toContainText('Water per day');
  await id(page, 'chat-proposal-propose_set_targets-apply').click();
  await expect(card).toContainText('Applied');
  // The next message carries the outcome as an app note.
  await id(page, 'coach-input').fill('Thanks');
  await id(page, 'coach-send').click();
  await expect(page.getByTestId('bubble-coach').last()).toContainText('Noted.');
  const last = seen.at(-1)!;
  expect(JSON.stringify(last.input)).toContain('The user applied: Daily targets');
  expect(last.threadProvider).toBe('anthropic');
  expect(step).toBeGreaterThanOrEqual(4);
  // The target really changed, through the normal settings.
  await id(page, 'back').click();
  await expect(page.getByText('0 / 2,500 mL')).toBeVisible();
});

test('chat: rate limit and safety warning are shown; the typed message is kept', async ({ page }) => {
  let n = 0;
  await mockBackend(page, (req) => {
    n++;
    if (n === 1) return { status: 429, error: { error: { code: 'rate_limited', message: 'coach limit reached', retryAfterSec: 120 } } };
    return { text: 'Please stop and get checked by a doctor first.', safetyFlags: req.input.type === 'user' ? ['cardiac'] : [] };
  });
  await signedIn(page);
  await id(page, 'coach-consent-agree').click();
  await id(page, 'coach-input').fill('I get chest pain when I lift');
  await id(page, 'coach-send').click();
  await expect(page.getByText('You have reached the coach’s limit for now. Try again in about 2 min.')).toBeVisible();
  await expect(id(page, 'coach-input')).toHaveValue('I get chest pain when I lift');
  await id(page, 'coach-send').click();
  await expect(page.getByTestId('bubble-coach').last()).toContainText('get checked by a doctor');
  await expect(page.getByText(/contact a doctor or your local emergency number/)).toBeVisible();
});
