import React from 'react';
import { Row, Txt } from '@/components/ui';
import type { Nutrients } from '@/domain/nutrition';
import { t } from '@/i18n';
import { useApp } from '@/state/app';
import { useFmt } from '@/state/hooks';

/** Energy and macros, or nothing in meal-only view. Unknown values print as "–", never 0. */
export function NutrientLine({ n, partial }: { n: Nutrients; partial?: Partial<Record<keyof Nutrients, boolean>> }) {
  const { prefs } = useApp();
  const fmt = useFmt();
  if (prefs.hideNutritionNumbers) return null;
  const v = (x: number | null, k: keyof Nutrients, unit: string, dp = 0) => (x == null ? `– ${unit}` : `${partial?.[k] ? '≥' : ''}${fmt.num(x, dp)} ${unit}`);
  return (
    <Row wrap gap={12}>
      <Txt variant="num">{v(n.kcal, 'kcal', 'kcal')}</Txt>
      <Txt variant="label" tone="textMuted">{t('macro.p')} {v(n.proteinG, 'proteinG', 'g', 1)}</Txt>
      <Txt variant="label" tone="textMuted">{t('macro.c')} {v(n.carbsG, 'carbsG', 'g', 1)}</Txt>
      <Txt variant="label" tone="textMuted">{t('macro.f')} {v(n.fatG, 'fatG', 'g', 1)}</Txt>
    </Row>
  );
}
