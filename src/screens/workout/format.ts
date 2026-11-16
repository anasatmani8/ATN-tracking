import { formatDuration } from '@/domain/time';
import { t } from '@/i18n';

export function targetLabel(sets: number | null, repMin: number | null, repMax: number | null, durationSec: number | null): string {
  const s = sets ? t('workout.sets', { count: sets }) : '';
  const r = durationSec ? formatDuration(durationSec) : repMin != null && repMax != null ? (repMin === repMax ? t('workout.reps', { count: repMax }) : t('workout.repRange', { min: repMin, max: repMax })) : '';
  return [s, r].filter(Boolean).join(' × ');
}
