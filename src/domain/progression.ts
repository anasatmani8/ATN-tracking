import type { SetLike } from './types';

export interface ProgressionSession {
  sessionId: string;
  startedAt: number;
  /** The exercise actually performed (after any swap). */
  exerciseId: string;
  repMin: number | null;
  repMax: number | null;
  /** User flagged pain or discomfort on this exercise. */
  discomfort: boolean;
  sets: SetLike[];
}

export interface ProgressionConfig {
  enabled: boolean;
  /** Smallest configured load increment in kg. */
  incrementKg: number;
  /** Minimum reps in reserve required on every qualifying set. */
  minRir: number;
}

export type ProgressionReason =
  | 'disabled'
  | 'not_enough_history'
  | 'changed_movement'
  | 'discomfort'
  | 'rep_range_changed'
  | 'no_rep_target'
  | 'no_load'
  | 'load_varied'
  | 'missing_effort'
  | 'below_target'
  | 'effort_high'
  | 'ready';

export interface ProgressionSuggestion {
  action: 'increase' | 'hold' | 'none';
  reason: ProgressionReason;
  currentLoadKg: number | null;
  suggestedLoadKg: number | null;
  /** The sets the decision was based on, newest session first. */
  supporting: { sessionId: string; startedAt: number; sets: SetLike[] }[];
}

const none = (reason: ProgressionReason, supporting: ProgressionSuggestion['supporting'] = []): ProgressionSuggestion => ({
  action: 'none',
  reason,
  currentLoadKg: null,
  suggestedLoadKg: null,
  supporting,
});

/**
 * Default double-progression rule. `sessions` are the completed sessions that
 * included this plan slot, newest first. Never applied automatically: the UI
 * shows the reason and supporting sets and the user accepts, adjusts or dismisses.
 */
export function suggestProgression(exerciseId: string, sessions: ProgressionSession[], cfg: ProgressionConfig): ProgressionSuggestion {
  if (!cfg.enabled) return none('disabled');
  const last2 = sessions.slice(0, 2);
  const supporting = last2.map((s) => ({
    sessionId: s.sessionId,
    startedAt: s.startedAt,
    sets: s.sets.filter((x) => x.kind === 'working' && x.completedAt != null),
  }));
  if (last2.length < 2 || supporting.some((s) => s.sets.length === 0)) return none('not_enough_history', supporting);
  if (last2.some((s) => s.exerciseId !== exerciseId)) return none('changed_movement', supporting);
  if (last2.some((s) => s.discomfort)) return none('discomfort', supporting);
  const [a, b] = last2;
  if (a.repMax == null || b.repMax == null) return none('no_rep_target', supporting);
  if (a.repMin !== b.repMin || a.repMax !== b.repMax) return none('rep_range_changed', supporting);
  const all = supporting.flatMap((s) => s.sets);
  if (all.some((s) => s.loadKg == null || s.loadKg <= 0 || s.loadMode === 'bodyweight' || s.loadMode === 'assisted')) return none('no_load', supporting);
  const load = all[0].loadKg as number;
  if (all.some((s) => s.loadKg !== load || s.loadMode !== all[0].loadMode)) return none('load_varied', supporting);
  const hold = (reason: ProgressionReason): ProgressionSuggestion => ({
    action: 'hold',
    reason,
    currentLoadKg: load,
    suggestedLoadKg: load,
    supporting,
  });
  if (all.some((s) => (s.reps ?? 0) < (a.repMax as number))) return hold('below_target');
  if (all.some((s) => s.rir == null)) return { ...none('missing_effort', supporting), currentLoadKg: load };
  if (all.some((s) => (s.rir as number) < cfg.minRir)) return hold('effort_high');
  return {
    action: 'increase',
    reason: 'ready',
    currentLoadKg: load,
    suggestedLoadKg: Math.round((load + cfg.incrementKg) * 1000) / 1000,
    supporting,
  };
}

/** Stable key for the evidence behind a suggestion, so a dismissal sticks until new data arrives. */
export function suggestionBasisKey(exerciseId: string, s: ProgressionSuggestion): string {
  return `${exerciseId}:${s.supporting.map((x) => x.sessionId).join('+')}:${s.reason}`;
}
