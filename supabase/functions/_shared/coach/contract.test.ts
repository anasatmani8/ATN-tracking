import { contextLine, GUARDRAILS, safetyNote, screenMessage, SYSTEM_PROMPT, TOOL_BY_NAME, TOOLS, validate, validateToolCall } from './contract.ts';

describe('coach contract', () => {
  test('tool names are unique, schemas are closed objects with every property required', () => {
    expect(new Set(TOOLS.map((t) => t.name)).size).toBe(TOOLS.length);
    for (const t of TOOLS) {
      expect(t.input_schema).toMatchObject({ type: 'object', additionalProperties: false });
      expect(t.input_schema.required.sort()).toEqual(Object.keys(t.input_schema.properties).sort());
      expect(t.name.startsWith('propose_')).toBe(t.kind === 'propose');
      if (t.kind === 'propose') expect(t.input_schema.properties.reason).toBeDefined();
    }
  });

  test('validator: types, nullables, ranges, enums, patterns, unknown keys', () => {
    const spec = TOOL_BY_NAME.propose_update_plan_exercise;
    const ok = { program_id: 'p', slot_id: 's', sets: 4, rep_min: null, rep_max: null, rest_sec: null, duration_sec: null, reason: 'More volume.' };
    expect(validateToolCall(spec.name, ok)).toEqual([]);
    expect(validateToolCall(spec.name, { ...ok, sets: 11 })).toEqual(['input.sets must be at most 10']);
    expect(validateToolCall(spec.name, { ...ok, sets: 2.5 })[0]).toMatch(/must be integer or null/);
    expect(validateToolCall(spec.name, { ...ok, extra: 1 })).toEqual(['input.extra is not allowed']);
    const { reason: _r, ...noReason } = ok;
    expect(validateToolCall(spec.name, noReason)).toContain('input.reason is required');
    expect(validateToolCall(spec.name, { ...ok, sets: null })).toEqual(['Change at least one of sets, rep_min, rep_max, rest_sec, duration_sec']);
    expect(validateToolCall(spec.name, { ...ok, rep_min: 12, rep_max: 8 })).toEqual(['rep_min must not exceed rep_max']);
    expect(validateToolCall('drop_tables', {})).toEqual(['Unknown tool drop_tables']);
    expect(validate({ type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, '2026-1-1')).toEqual(['input has the wrong format']);
    expect(validate({ type: 'string', enum: ['a'] }, 'b')).toEqual(['input must be one of a']);
    expect(validate({ type: 'number' }, Number.NaN)).toEqual(['input must be a finite number']);
  });

  test('guardrails: unsafe energy targets and other out-of-range proposals are rejected', () => {
    const base = { water_ml: null, sleep_min: null, kcal: null, protein_g: null, reason: 'Based on your logs.' };
    expect(validateToolCall('propose_set_targets', { ...base, kcal: GUARDRAILS.kcalTarget.min - 1 })).toEqual([`input.kcal must be at least ${GUARDRAILS.kcalTarget.min}`]);
    expect(validateToolCall('propose_set_targets', { ...base, kcal: 1800 })).toEqual([]);
    expect(validateToolCall('propose_set_targets', base)).toEqual(['Set at least one target']);
    expect(validateToolCall('propose_set_targets', { ...base, water_ml: 9000 })[0]).toMatch(/at most 5000/);
    expect(validateToolCall('propose_log_water', { amount_ml: 5000, date: null, reason: 'x x x' })[0]).toMatch(/at most 2000/);
    expect(validateToolCall('propose_create_reminder', { kind: 'water', time: '25:00', weekdays: [1], reason: 'x x x' })).toEqual(['input.time has the wrong format']);
    expect(validateToolCall('propose_create_reminder', { kind: 'water', time: '10:00', weekdays: [1, 1], reason: 'x x x' })).toEqual(['weekdays must not repeat']);
    expect(validateToolCall('propose_add_plan_exercise', { program_id: 'p', day_id: 'd', exercise_id: 'e', sets: 3, rep_min: null, rep_max: null, duration_sec: null, rest_sec: 60, reason: 'x x x' }))
      .toEqual(['Give a rep range, or a duration for timed exercises']);
  });

  test('safety screen flags warning signs and produces guidance; ordinary messages pass', () => {
    expect(screenMessage('I get chest pain when I run')).toEqual(['cardiac']);
    expect(screenMessage('I passed out after squats')).toContain('fainting');
    expect(screenMessage('I want to eat 800 calories a day')).toContain('eating');
    expect(screenMessage('I sprained my ankle')).toContain('injury');
    expect(screenMessage('sometimes I want to end my life')).toContain('selfHarm');
    expect(screenMessage("I'm pregnant, can I keep lifting?")).toContain('medical');
    expect(screenMessage('How should I progress my bench press?')).toEqual([]);
    expect(screenMessage('Can I do more sets for legs?')).toEqual([]);
    expect(safetyNote([])).toBeNull();
    expect(safetyNote(['cardiac'])).toMatch(/urgent medical care/);
  });

  test('system prompt states the confirmation rule and medical boundaries; context stays out of it', () => {
    expect(SYSTEM_PROMPT).toMatch(/nothing changes until they confirm/);
    expect(SYSTEM_PROMPT).toMatch(/not a medical professional/);
    expect(SYSTEM_PROMPT).not.toMatch(/\d{4}-\d{2}-\d{2}/); // no dates: keeps the prefix cacheable
    expect(contextLine({ today: '2026-11-21', weekday: 'Saturday', timeZone: 'Europe/Paris', units: 'kg, mL, km' })).toBe('App context: today is Saturday 2026-11-21 (Europe/Paris); display units: kg, mL, km.');
  });
});
