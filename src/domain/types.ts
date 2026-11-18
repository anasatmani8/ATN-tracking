export type InputType = 'weight_reps' | 'bodyweight_reps' | 'duration' | 'distance_duration';
/** How the number typed in the load field maps to total external load. */
export type LoadConvention = 'total' | 'per_implement' | 'bodyweight' | 'none';
export type SetKind = 'warmup' | 'working';
/** external: plates/dumbbells/stack. bodyweight: no load. added: belt/vest on a bodyweight move. assisted: band/machine help. */
export type LoadMode = 'external' | 'bodyweight' | 'added' | 'assisted';
export type Equipment = 'bodyweight' | 'dumbbell' | 'barbell' | 'machine' | 'cable' | 'cardio' | 'band';

export interface ExerciseMeta {
  exerciseId: string;
  inputType: InputType;
  loadConvention: LoadConvention;
  /** Implements used when loadConvention is per_implement (2 for a pair of dumbbells). */
  implementCount: number;
}

export interface SetLike {
  id: string;
  kind: SetKind;
  reps: number | null;
  /** Canonical kg as typed (per implement or total, see convention). */
  loadKg: number | null;
  loadMode: LoadMode;
  durationSec: number | null;
  distanceM: number | null;
  rir: number | null;
  completedAt: number | null;
}

export interface HistorySet extends SetLike, ExerciseMeta {
  sessionId: string;
  sessionStartedAt: number;
}
