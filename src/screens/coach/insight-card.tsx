import React, { useState } from 'react';
import { View } from 'react-native';

import { useFeedback } from '@/components/feedback';
import { useTheme } from '@/components/theme-context';
import { Btn, Icon, IconBtn, Row, Txt, type IconName } from '@/components/ui';
import type { CoachAction } from '@/data/coach';
import type { Insight, InsightKind } from '@/domain/coach-insights';
import { t, type StringKey } from '@/i18n';
import { useApp } from '@/state/app';
import { radius, spacing } from '@/theme';
import { useCoachFormat } from './format';

const ICON: Record<InsightKind, IconName> = {
  missed_workout: 'calendar-outline', progression_ready: 'trending-up', hydration_low: 'water-outline', sleep_short: 'moon-outline',
  recovery_soreness: 'medkit-outline', no_plan: 'clipboard-outline', sleep_unlogged: 'bed-outline',
};

/** An evidence-backed recommendation. Its action opens a proposal; nothing changes until the user applies it. */
export function InsightCard({ insight, onProposed, compact, testID }: { insight: Insight; onProposed: (a: CoachAction) => void; compact?: boolean; testID?: string }) {
  const app = useApp();
  const { c } = useTheme();
  const { toast } = useFeedback();
  const cf = useCoachFormat();
  const [busy, setBusy] = useState(false);
  const params = cf.insightParams(insight);
  const review = async () => {
    if (!insight.action) return;
    setBusy(true);
    const r = await app.coach.propose('insight', null, { name: insight.action.tool, input: insight.action.args }, app.coachCtx());
    setBusy(false);
    if (r.ok) onProposed(r.value);
    else toast({ message: t('coach.proposeFailed', { reason: r.error }), tone: 'error' });
  };
  return (
    <View testID={testID} style={{ borderRadius: radius.lg, backgroundColor: c.primarySoft, padding: spacing.md, gap: spacing.xs }}>
      <Row>
        <Icon name={ICON[insight.kind]} size={18} tone="onPrimarySoft" />
        <Txt variant="bodyStrong" tone="onPrimarySoft" style={{ flex: 1 }}>{t(`insight.${insight.kind}.title` as StringKey, params)}</Txt>
        {!compact ? <IconBtn icon="close" label={t('coach.dismissInsight')} size={18} onPress={() => void app.coach.dismissInsight(insight.id)} testID={`${testID}-dismiss`} /> : null}
      </Row>
      <Txt variant="caption" tone="onPrimarySoft">{t(`insight.${insight.kind}.body` as StringKey, params)}</Txt>
      {insight.action ? (
        <Btn testID={`${testID}-review`} size="sm" variant="primary" icon="eye-outline" title={t('coach.reviewChange')} loading={busy} onPress={() => void review()} style={{ alignSelf: 'flex-start', marginTop: spacing.xs }} />
      ) : null}
    </View>
  );
}
