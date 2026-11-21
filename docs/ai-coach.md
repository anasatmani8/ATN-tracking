# AI coach: architecture and implementation plan

## What exists today (inspected)

- **Expo / React Native app**, TypeScript strict, Expo Router (`src/app`), screens use `useLive()` to read from repositories.
- **Local-first data**: every record lives in on-device SQLite (`src/data`), written only through `Store` (transaction + sync outbox). Repositories: `Training`, `Nutrition`, `Recovery`, prefs. Pure rules live in `src/domain` (records, progression, sleep, adherence, next action).
- **Optional cloud**: Supabase Auth + Postgres. Synced rows go to `public.records` through `SECURITY DEFINER` RPCs; RLS is deny-by-default. One Edge Function exists (`delete-account`). The app works with no account.

The coach is built on those pieces rather than beside them.

## The feature: a coach that proposes, not just a chatbot

1. **Coach insights** (works offline, no AI, no account): a deterministic engine (`src/domain/coach-insights.ts`) turns the user's own data into a short, ranked list of recommendations. Each one states its evidence ("you hit 12 reps on all sets at 14 kg twice, with 2+ reps in reserve") and carries **one concrete action** ("set next load to 16.5 kg", "move Wednesday's missed workout to Friday", "add a 21:30 bedtime reminder"). Today shows the top insight; the Coach screen shows all of them.
2. **Coach chat** (needs an account, because API keys stay on the server): a conversation with the AI, which can read summaries of the user's data through tools and **propose** the same kinds of actions. It can also explain or adapt an insight.
3. **Every change is a proposal card**: a plain-language before → after ("Goblet Squat sets: 3 → 4"), with **Apply** or **Not now**. Deletions use a destructive confirmation. Nothing changes until the user taps. Every applied change is logged with an **Undo** where it can be safely reversed.

## Architecture

```
┌──────────────────────── phone ────────────────────────┐         ┌──── Supabase Edge Function `coach` ────┐
│ Coach screen ── CoachEngine (loop, ≤6 rounds)          │  HTTPS  │ 1. verify user JWT (Supabase Auth)     │
│   │                    │                               │ ──────► │ 2. validate body (size, roles, tools)  │
│   │   read tools ──► CoachTools.read()  (local SQLite) │         │ 3. rate limit (Postgres RPC)           │
│   │   propose tools ─► coach_actions (status=proposed) │ ◄────── │ 4. safety screen of the user message   │
│   │                                                    │  JSON   │ 5. provider adapter (Anthropic|OpenAI) │
│   └─ Proposal card ─ Apply ─► CoachTools.apply() ────►│         │ 6. record token usage                  │
│                                repositories (+sync)   │         │ keys: Supabase secrets, never in app   │
└───────────────────────────────────────────────────────┘         └────────────────────────────────────────┘
```

**Why tools run on the phone.** The phone's SQLite is the source of truth (guests and offline edits included), so tool calls are answered there:

- **Up to date**: the coach sees exactly what the app shows, including changes not yet synced.
- **Data minimization**: only what a tool returns (aggregates, no free-text notes) leaves the device, and only during a chat. The server stores no messages.
- **One write path**: confirmed changes go through the same repositories and sync as manual edits.

The server holds what must stay secret or trusted: the API key, the system prompt, the tool list, validation, rate limits and the safety screen. Because the server re-applies its own system prompt and tool set on every request, the client cannot change the coach's instructions or invent tools. A client that sends forged tool results only misleads its own conversation, inside its own rate limit.

**Why not Anthropic Managed Agents?** The tools must run on the device against local data, and the provider must be swappable with OpenAI. A provider-neutral loop over each vendor's chat API fits both.

### Provider abstraction

`supabase/functions/_shared/coach/providers/{anthropic,openai}.ts` implement one interface:

```ts
interface CoachProvider {
  id: 'anthropic' | 'openai';
  model: string;
  turn(req: { history: unknown[]; input: TurnInput; system: string; tools: ToolSpec[] }): Promise<TurnOutput>;
}
// TurnOutput = { append: unknown[]; text: string; toolCalls: {id, name, input}[]; stop: 'done'|'tool'|'refused'|'truncated'; usage }
```

- **History is opaque to the client.** The server returns the provider-native messages to append (`append`), and the phone stores and replays them unchanged. Reasoning blocks are preserved exactly as each provider requires. A thread records its provider; switching provider starts a new thread.
- **Anthropic** (official `@anthropic-ai/sdk`): default model `claude-opus-5-5`; strict tool schemas; prompt caching on the stable system prompt and tools; server-side refusal fallback enabled (`fallbacks: "default"`); `refusal` and `max_tokens` stops handled.
- **OpenAI** (official `openai` SDK, Chat Completions with function tools): the model must be set explicitly with `OPENAI_MODEL`.
- Configuration (Supabase secrets): `COACH_PROVIDER=anthropic|openai`, `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`, optional `COACH_MODEL`, `COACH_EFFORT`, rate-limit numbers.

## Tools (contract shared by server and app: `supabase/functions/_shared/coach/contract.ts`)

Read tools, answered on the device. Each returns a small JSON summary in canonical units plus the user's display units:

| Tool | Returns |
| --- | --- |
| `get_profile` | goal, experience, equipment, units, trackers on/off, targets |
| `get_training_overview` | workouts in the last N days (≤ 90), adherence, sets/volume per session |
| `get_active_plan` | the active plan: days, slots (ids), sets/reps/rest, the next 14 days of schedule with ids |
| `get_exercise_history` | top sets per session, records, current progression rule result |
| `search_exercises` | id + name + equipment for a query |
| `get_nutrition_summary` | per-day energy and macros (partial flags) for N days (≤ 30). **Counts only if the user hid nutrition numbers** |
| `get_hydration_summary` | per-day water, goal, average over logged days |
| `get_sleep_summary` | per-night sleep (sleep vs time in bed), quality, averages over logged nights |
| `get_body_metrics` | weight trend, **only if the body tracker is on** |
| `get_recent_entries` | ids of recent water/food/sleep/measurement entries (needed to propose a deletion) |
| `get_insights` | the deterministic coach insights |

A tracker the user turned off returns `{ hidden: true }`. The coach respects that choice.

Proposal tools: none writes anything. Each one validates its arguments and creates a pending card.

| Tool | Proposed change | Undo |
| --- | --- | --- |
| `propose_update_plan_exercise` | sets / rep range / rest / duration of a plan slot | yes (if the plan wasn't edited since) |
| `propose_swap_plan_exercise` | replace a slot's exercise | yes (same condition) |
| `propose_add_plan_exercise` / `propose_remove_plan_exercise` | add/remove an exercise in a plan day | yes (same condition) |
| `propose_reschedule_workout` / `propose_skip_workout` | move or skip a scheduled workout | yes |
| `propose_set_next_load` | the load to prefill next time for an exercise | — |
| `propose_set_targets` | water / sleep / energy / protein targets | yes |
| `propose_log_water` | add a water entry | yes |
| `propose_create_reminder` | a water / bedtime / workout / check-in reminder | yes |
| `propose_delete_entry` | delete a water, food, sleep or measurement entry | yes (restored as a new entry) |

**Guardrails in the contract**, enforced on both server and phone: sets 1–10, reps 1–50, rest 15–600 s; a load suggestion at most +10 % above the last working load; water target 1,000–5,000 mL per day; sleep target 6–11 h; an energy target below **1,200 kcal is refused**; protein ≤ 300 g. Out-of-range proposals are rejected with a reason the model sees and can explain.

## API endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/functions/v1/coach` | `{ provider, model, limits }` for the consent screen. Requires sign-in |
| `POST` | `/functions/v1/coach` | One model turn. Body: `{ threadProvider, history[], input: {type:'user', text, context, notes[]} \| {type:'tool_results', results[]} }`. Returns `{ provider, model, append[], text, toolCalls[], stop, safetyFlags[], usage, remainingToday }` |

Errors use one shape, `{ error: { code, message } }`, with codes `unauthorized` (401), `invalid_request` (400), `provider_mismatch` (409), `rate_limited` (429, with `retryAfterSec`), `not_configured` (503), `provider_error` (502) and `timeout` (504).

## Database changes

**Server (`supabase/migrations/0002_coach.sql`)**, RLS forced, no client table access:

- `coach_usage(user_id, day, requests, input_tokens, output_tokens)` for per-day limits.
- `coach_minute(user_id, minute, requests)` for burst limits.
- `coach_consume(per_minute, per_day, tokens_per_day)` (`SECURITY DEFINER`, takes the user from `auth.uid()`): atomically checks and increments, returning `{ allowed, retry_after_sec, remaining_today }`.
- `coach_record_tokens(input, output)`.
- No message content is stored on the server.

**Device (SQLite migration v3)**, local only and never synced (chat stays on the phone):

- `coach_threads(id, provider, title, created_at, updated_at)`
- `coach_messages(id, thread_id, seq, role, display_text, native JSON, created_at)`
- `coach_actions(id, thread_id, source 'chat'|'insight', tool, args JSON, summary, status proposed|applied|declined|failed|undone, result JSON, undo JSON, created_at, decided_at)`
- Preference `coachConsent` (timestamp + provider). Export includes the coach tables; erase removes them.

## Safety

- **System prompt**: a fitness coach for healthy adults; no diagnosis, no treatment, no medication or supplement dosing; no extreme diets; never encourage training through pain, dehydration or eating below safe minimums. Every recommendation cites the user's data or says it's general guidance. It must propose rather than claim to change things, and must not ask for personal identifiers.
- **Server safety screen** on each user message, deterministic keyword groups: chest pain, fainting, injury, eating-disorder signals, self-harm. On a match the request carries a safety note, so the model leads with "please talk to a doctor / emergency services" and does not coach through it. The app shows a fixed help banner too.
- **Numeric guardrails** in the contract (above), checked twice.
- Data the model reads (food names, exercise names) is wrapped as data, not instructions. Free-text notes are never sent.

## Privacy

- Keys only in Supabase secrets. The app never sees them.
- A consent screen before first use names the provider and model and explains what is sent: your messages, plus summaries the coach looks up. Consent can be withdrawn in Settings, which also deletes local coach history.
- The server logs no message content, only error codes and token counts. The provider's metadata gets a one-way hash of the user id (for abuse handling), never the email.
- Privacy policy and data-safety answers must be updated before shipping the chat: data is shared with the AI provider as a processor. See `docs/privacy-and-data-safety.md`.

## Implementation phases (each keeps the app working)

| Phase | Content | Verified by |
| --- | --- | --- |
| 1 | Contract (tools, schemas, guardrails, validator), safety screen, system prompt | unit tests |
| 2 | Device: SQLite v3, `CoachTools` (read + apply + undo), deterministic insights | repository tests |
| 3 | Server: rate-limit migration, provider adapters, request handler, Edge Function | unit tests (fake providers), Postgres tests |
| 4 | App: coach engine loop, chat screen, proposal cards, consent, insights on Today, undo history, settings | engine tests with a fake transport, web e2e with a mocked endpoint |
| 5 | Docs: setup, privacy/data-safety updates, START-HERE addendum | — |

All five phases are built (2026-11-21). Status of each check is in `docs/build-status.md`.

## As built: configuration

Server secrets (Supabase → Edge Functions → Secrets; never in the app):

| Secret | Default | Meaning |
| --- | --- | --- |
| `COACH_PROVIDER` | — (coach off) | `anthropic` or `openai` |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | — | Key for the chosen provider |
| `COACH_MODEL` | Anthropic: `claude-opus-5-5`; OpenAI: required (or `OPENAI_MODEL`) | Model id |
| `COACH_EFFORT` | `medium` | Anthropic effort (`low`…`max`) |
| `COACH_PER_MINUTE` / `COACH_PER_DAY` | 6 / 100 | Requests per user (server caps: 60 / 1000) |
| `COACH_TOKENS_PER_DAY` | 2,000,000 | Input + output tokens per user per day |
| `COACH_TIMEOUT_MS` | 55000 | Per-request provider timeout |
| `COACH_HASH_SALT` | — (set one) | Salt for the one-way user hash sent to the provider |

Switching `COACH_PROVIDER` is safe: old conversations get `provider_mismatch` and the app starts a new conversation automatically. The Anthropic adapter enables server-side fallback to another model when the configured one is overloaded.

## As built: where things are

| Piece | Path |
| --- | --- |
| Contract, guardrails, safety screen, system prompt | `supabase/functions/_shared/coach/contract.ts` (re-exported to the app by `src/coach/contract.ts`) |
| Provider adapters | `supabase/functions/_shared/coach/providers/{anthropic,openai}.ts` |
| Request handler (auth, validation, limits, timeout, error mapping) | `supabase/functions/_shared/coach/handler.ts`, wired in `supabase/functions/coach/index.ts` |
| Rate limits | `supabase/migrations/0002_coach.sql` |
| On-device tools, proposals, apply/undo | `src/data/coach.ts` |
| Insights engine | `src/domain/coach-insights.ts` |
| Tool loop and transport | `src/coach/engine.ts`, `src/coach/transport.ts` |
| Screens | `src/app/coach.tsx`, `src/screens/coach/*`, Today card in `src/app/(tabs)/index.tsx`, Settings section |

Insights and the change log work for every user, offline and without an account. Chat needs a configured backend, a signed-in account and consent; demo mode never calls the server.

On the first sign-in on a device, the new account database starts from that device's guest settings (units, targets, trackers), stored locally only; settings already saved in the account replace them when sync runs.
