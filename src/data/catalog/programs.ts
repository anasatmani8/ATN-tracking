import type { Equipment } from '@/domain/types';

export interface PlanExercise {
  /** Stable slot id so history can be compared per plan slot even after a swap. */
  slotId: string;
  exerciseId: string;
  sets: number;
  repMin: number | null;
  repMax: number | null;
  durationSec: number | null;
  restSec: number;
  /** Equipment-compatible swaps offered in the logger. */
  alternatives: string[];
}

export interface PlanDay {
  id: string;
  name: string;
  estMinutes: number;
  exercises: PlanExercise[];
}

export interface ProgramDoc {
  days: PlanDay[];
}

export interface ProgramTemplate {
  id: string;
  name: string;
  description: string;
  daysPerWeek: number;
  equipment: Equipment[];
  goals: string[];
  doc: ProgramDoc;
}

type X = [exerciseId: string, sets: number, reps: [number, number] | number, restSec: number, alternatives?: string[]];

function day(prefix: string, idx: number, name: string, xs: X[]): PlanDay {
  const exercises = xs.map(([exerciseId, sets, reps, restSec, alternatives = []], i) => ({
    slotId: `${prefix}-d${idx}-s${i}`,
    exerciseId,
    sets,
    repMin: Array.isArray(reps) ? reps[0] : null,
    repMax: Array.isArray(reps) ? reps[1] : null,
    durationSec: Array.isArray(reps) ? null : reps,
    restSec,
    alternatives,
  }));
  return { id: `${prefix}-d${idx}`, name, estMinutes: estimateMinutes(exercises), exercises };
}

/** Rough duration: ~45 s of work per set plus the programmed rest. */
export function estimateMinutes(xs: Pick<PlanExercise, 'sets' | 'restSec' | 'durationSec'>[]): number {
  const sec = xs.reduce((a, x) => a + x.sets * ((x.durationSec ?? 45) + x.restSec), 0);
  return Math.max(5, Math.round(sec / 60 / 5) * 5);
}

/** Original starter programs. All are copied into the user's data on start and are fully editable. */
export const PROGRAM_TEMPLATES: ProgramTemplate[] = [
  {
    id: 'tpl_fb2', name: 'Full Body · 2 days', daysPerWeek: 2, equipment: ['barbell', 'dumbbell', 'machine', 'cable', 'bodyweight'], goals: ['general', 'consistency'],
    description: 'Two full-body sessions a week covering every major movement.',
    doc: { days: [
      day('fb2', 0, 'Full Body A', [['bb_back_squat', 3, [6, 10], 150, ['leg_press', 'db_goblet_squat']], ['bb_bench_press', 3, [6, 10], 120, ['db_bench_press', 'machine_chest_press']], ['seated_cable_row', 3, [8, 12], 90, ['db_row', 'bb_row']], ['db_rdl', 2, [8, 12], 90, ['leg_curl']], ['plank', 3, 40, 60, ['dead_bug']]]),
      day('fb2', 1, 'Full Body B', [['bb_deadlift', 3, [5, 8], 180, ['bb_rdl', 'db_rdl']], ['db_shoulder_press', 3, [8, 12], 90, ['bb_overhead_press']], ['lat_pulldown', 3, [8, 12], 90, ['pull_up', 'assisted_pull_up']], ['db_split_squat', 2, [8, 12], 90, ['leg_press']], ['db_curl', 2, [10, 15], 60, []]]),
    ] },
  },
  {
    id: 'tpl_fb3', name: 'Full Body · 3 days', daysPerWeek: 3, equipment: ['barbell', 'dumbbell', 'machine', 'cable', 'bodyweight'], goals: ['strength', 'general'],
    description: 'Three rotating full-body sessions with one heavier lift each day.',
    doc: { days: [
      day('fb3', 0, 'Full Body A', [['bb_back_squat', 3, [5, 8], 180, ['leg_press']], ['bb_bench_press', 3, [6, 10], 120, ['db_bench_press']], ['bb_row', 3, [8, 12], 90, ['seated_cable_row']], ['db_lateral_raise', 2, [12, 15], 60, []], ['plank', 3, 40, 60, []]]),
      day('fb3', 1, 'Full Body B', [['bb_deadlift', 3, [5, 8], 180, ['bb_rdl']], ['bb_overhead_press', 3, [6, 10], 120, ['db_shoulder_press']], ['lat_pulldown', 3, [8, 12], 90, ['pull_up']], ['leg_press', 2, [10, 15], 90, ['db_goblet_squat']], ['cable_pushdown', 2, [10, 15], 60, ['db_triceps_ext']]]),
      day('fb3', 2, 'Full Body C', [['bb_front_squat', 3, [6, 10], 150, ['db_goblet_squat']], ['db_incline_press', 3, [8, 12], 90, ['bb_incline_bench']], ['seated_cable_row', 3, [8, 12], 90, ['db_row']], ['bb_hip_thrust', 3, [8, 12], 90, ['glute_bridge']], ['db_curl', 2, [10, 15], 60, []]]),
    ] },
  },
  {
    id: 'tpl_ul4', name: 'Upper / Lower · 4 days', daysPerWeek: 4, equipment: ['barbell', 'dumbbell', 'machine', 'cable', 'bodyweight'], goals: ['muscle', 'strength'],
    description: 'Upper and lower body twice a week with a heavier and a lighter day.',
    doc: { days: [
      day('ul4', 0, 'Upper A', [['bb_bench_press', 4, [5, 8], 150, ['db_bench_press']], ['bb_row', 4, [6, 10], 120, ['seated_cable_row']], ['db_shoulder_press', 3, [8, 12], 90, []], ['lat_pulldown', 3, [8, 12], 90, ['pull_up']], ['cable_pushdown', 2, [10, 15], 60, []], ['db_curl', 2, [10, 15], 60, []]]),
      day('ul4', 1, 'Lower A', [['bb_back_squat', 4, [5, 8], 180, ['leg_press']], ['bb_rdl', 3, [8, 10], 120, ['db_rdl']], ['leg_extension', 3, [10, 15], 75, []], ['leg_curl', 3, [10, 15], 75, []], ['machine_calf_raise', 3, [10, 15], 60, ['db_calf_raise']]]),
      day('ul4', 2, 'Upper B', [['bb_overhead_press', 4, [6, 10], 120, ['db_shoulder_press']], ['pull_up', 4, [5, 10], 120, ['lat_pulldown', 'assisted_pull_up']], ['db_incline_press', 3, [8, 12], 90, []], ['seated_cable_row', 3, [8, 12], 90, []], ['db_lateral_raise', 3, [12, 15], 60, []], ['cable_face_pull', 2, [12, 15], 60, []]]),
      day('ul4', 3, 'Lower B', [['bb_deadlift', 3, [4, 6], 180, ['bb_rdl']], ['leg_press', 3, [10, 12], 120, ['db_goblet_squat']], ['db_split_squat', 3, [8, 12], 90, []], ['bb_hip_thrust', 3, [8, 12], 90, ['glute_bridge']], ['hanging_knee_raise', 3, [8, 15], 60, ['dead_bug']]]),
    ] },
  },
  {
    id: 'tpl_ppl3', name: 'Push / Pull / Legs · 3 days', daysPerWeek: 3, equipment: ['barbell', 'dumbbell', 'machine', 'cable', 'bodyweight'], goals: ['muscle'],
    description: 'One pushing, one pulling and one leg session each week.',
    doc: { days: [
      day('ppl3', 0, 'Push', [['bb_bench_press', 4, [6, 10], 150, ['db_bench_press', 'machine_chest_press']], ['db_incline_press', 3, [8, 12], 90, ['bb_incline_bench']], ['db_shoulder_press', 3, [8, 12], 90, []], ['cable_fly', 3, [12, 15], 60, []], ['db_lateral_raise', 3, [12, 15], 60, []], ['cable_pushdown', 3, [10, 15], 60, ['db_triceps_ext']]]),
      day('ppl3', 1, 'Pull', [['db_row', 3, [8, 12], 90, ['bb_row']], ['lat_pulldown', 4, [8, 12], 90, ['pull_up', 'assisted_pull_up']], ['seated_cable_row', 3, [8, 12], 90, []], ['pull_up', 3, [5, 10], 120, ['assisted_pull_up', 'inverted_row']], ['cable_face_pull', 3, [12, 15], 60, []], ['db_curl', 3, [10, 15], 60, []]]),
      day('ppl3', 2, 'Legs', [['bb_back_squat', 4, [6, 10], 180, ['leg_press']], ['bb_rdl', 3, [8, 12], 120, ['db_rdl']], ['leg_press', 3, [10, 15], 120, []], ['leg_curl', 3, [10, 15], 75, []], ['machine_calf_raise', 3, [10, 15], 60, ['db_calf_raise']], ['plank', 3, 45, 60, []]]),
    ] },
  },
  {
    id: 'tpl_home3', name: 'Home Dumbbell · 3 days', daysPerWeek: 3, equipment: ['dumbbell', 'bodyweight'], goals: ['general', 'consistency', 'muscle'],
    description: 'Three sessions that need only a pair of dumbbells and some floor space.',
    doc: { days: [
      day('home3', 0, 'Home A', [['db_goblet_squat', 3, [8, 12], 90, ['bw_squat']], ['db_floor_press', 3, [8, 12], 90, ['push_up']], ['db_row', 3, [8, 12], 75, ['inverted_row']], ['db_rdl', 3, [10, 12], 90, ['glute_bridge']], ['plank', 3, 30, 45, ['dead_bug']]]),
      day('home3', 1, 'Home B', [['db_split_squat', 3, [8, 12], 90, ['reverse_lunge_bw']], ['db_shoulder_press', 3, [8, 12], 90, []], ['push_up', 3, [6, 15], 75, ['incline_push_up']], ['db_curl', 2, [10, 15], 60, []], ['side_plank', 2, 30, 45, []]]),
      day('home3', 2, 'Home C', [['db_rdl', 3, [8, 12], 90, ['glute_bridge']], ['db_floor_press', 3, [8, 12], 90, ['push_up']], ['db_row', 3, [8, 12], 75, []], ['db_lateral_raise', 2, [12, 15], 60, []], ['db_triceps_ext', 2, [10, 15], 60, []], ['db_calf_raise', 2, [12, 15], 45, []]]),
    ] },
  },
];

export const templateById = (id: string) => PROGRAM_TEMPLATES.find((t) => t.id === id) ?? null;

export interface PlanAnswers {
  goal: 'strength' | 'muscle' | 'general' | 'consistency' | null;
  experience: 'new' | 'some' | 'experienced' | null;
  days: number | null;
  equipment: 'gym' | 'home_dumbbell' | 'bodyweight' | null;
}

/** Onboarding suggestion with a reason the user can read. Pure and deterministic. */
export function suggestTemplate(a: PlanAnswers): { templateId: string; reasonKey: string } {
  if (a.equipment === 'home_dumbbell' || a.equipment === 'bodyweight') return { templateId: 'tpl_home3', reasonKey: 'plan.reason.home' };
  const days = a.days ?? 3;
  if (days <= 2) return { templateId: 'tpl_fb2', reasonKey: 'plan.reason.twoDays' };
  if (days >= 4) return { templateId: 'tpl_ul4', reasonKey: 'plan.reason.fourDays' };
  if (a.goal === 'muscle' && a.experience !== 'new') return { templateId: 'tpl_ppl3', reasonKey: 'plan.reason.ppl' };
  return { templateId: 'tpl_fb3', reasonKey: 'plan.reason.threeDays' };
}

/** Default weekdays (0 = Sunday) for n sessions a week, spread with rest days between. */
export function defaultWeekdays(n: number): number[] {
  return ({ 1: [1], 2: [1, 4], 3: [1, 3, 5], 4: [1, 2, 4, 5], 5: [1, 2, 3, 5, 6], 6: [1, 2, 3, 4, 5, 6] } as Record<number, number[]>)[n] ?? [0, 1, 2, 3, 4, 5, 6];
}
