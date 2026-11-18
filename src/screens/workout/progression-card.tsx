import React, { useState } from 'react';
import { View } from 'react-native';

import { useFeedback } from '@/components/feedback';
import { useTheme } from '@/components/theme-context';
import { Btn, Field, Icon, Row, Txt } from '@/components/ui';
import type { SessionExerciseRow, SetRow } from '@/data/training';
import { formatDate, t, type StringKey } from '@/i18n';
import { localDateOf } from '@/domain/time';
import { useApp, useLive } from '@/state/app';
import { useFmt } from '@/state/hooks';
import { radius, spacing } from '@/theme';
import { nowMs } from '@/domain/clock';

/** Shows the rule's reason and evidence. The user accepts, adjusts or dismisses; nothing is applied automatically. */
export function ProgressionCard({ sx }: { sx: SessionExerciseRow & { sets: SetRow[] } }) {
  const app = useApp();
  const { c } = useTheme();
  const fmt = useFmt();
  const { toast } = useFeedback();
  const [adjust, setAdjust] = useState<string | null>(null);
  const cfg = { enabled: app.prefs.progressionEnabled, incrementKg: app.prefs.incrementKg, minRir: app.prefs.minRir };
  const { data } = useLive((a) => (sx.input_type === 'weight_reps' ? a.training.progression(sx.exercise_id, sx.plan_slot_id, cfg) : Promise.resolve(null)),
    ['progression_decisions', 'sessions'], [sx.exercise_id, sx.plan_slot_id, cfg.enabled, cfg.incrementKg, cfg.minRir]);
  if (!data || data.suggestion.action === 'none' && ['disabled', 'not_enough_history'].includes(data.suggestion.reason)) return null;
  const { suggestion: sg, basisKey, decision } = data;
  if (decision === 'dismissed') return null;
  const applyToDrafts = async (kg: number) => {
    for (const s of sx.sets) if (s.completed_at == null && s.kind === 'working') await app.training.updateSet(s.id, { load_kg: kg });
  };
  return (
    <View testID="progression-card" style={{ borderRadius: radius.md, borderWidth: 1, borderColor: sg.action === 'increase' ? c.primary : c.border, padding: spacing.md, gap: spacing.sm }}>
      <Row>
        <Icon name={sg.action === 'increase' ? 'trending-up' : 'information-circle-outline'} tone={sg.action === 'increase' ? 'primary' : 'textMuted'} />
        <Txt variant="bodyStrong" style={{ flex: 1 }}>
          {sg.action === 'increase' ? t('prog.increase', { from: fmt.weight(sg.currentLoadKg!), to: fmt.weight(sg.suggestedLoadKg!) }) : sg.action === 'hold' ? t('prog.hold', { load: fmt.weight(sg.currentLoadKg!) }) : t('prog.noChange')}
        </Txt>
      </Row>
      <Txt variant="caption" tone="textMuted">{t(`prog.reason.${sg.reason}` as StringKey)}</Txt>
      {sg.supporting.map((s) => (
        <Txt key={s.sessionId} variant="caption" tone="textMuted">
          {formatDate(localDateOf(s.startedAt, app.tz))}: {s.sets.map((x) => `${x.loadKg != null ? fmt.weightNum(x.loadKg) : '–'}×${x.reps ?? '–'}${x.rir != null ? ` @${x.rir}` : ''}`).join(', ')}
        </Txt>
      ))}
      {decision ? <Txt variant="caption" tone="success">{t(`prog.decided.${decision}` as StringKey)}</Txt> : sg.action === 'increase' ? (
        adjust == null ? (
          <Row wrap>
            <Btn testID="prog-accept" size="sm" title={t('prog.accept')} onPress={async () => { await app.training.decideProgression(sx.exercise_id, basisKey, 'accepted', sg.suggestedLoadKg, nowMs()); await applyToDrafts(sg.suggestedLoadKg!); toast({ message: t('prog.accepted') }); }} />
            <Btn testID="prog-adjust" size="sm" variant="outline" title={t('prog.adjust')} onPress={() => setAdjust(fmt.weightNum(sg.suggestedLoadKg))} />
            <Btn testID="prog-dismiss" size="sm" variant="ghost" title={t('prog.dismiss')} onPress={() => void app.training.decideProgression(sx.exercise_id, basisKey, 'dismissed', null, nowMs())} />
          </Row>
        ) : (
          <Row>
            <Field label={t('prog.adjustLabel')} suffix={fmt.wUnit} value={adjust} onChangeText={setAdjust} keyboardType="decimal-pad" style={{ flex: 1 }} />
            <Btn size="sm" title={t('common.save')} onPress={async () => {
              const kg = fmt.parseWeight(adjust);
              if (kg == null || kg <= 0) return toast({ message: t('err.invalid_value'), tone: 'error' });
              await app.training.decideProgression(sx.exercise_id, basisKey, 'adjusted', kg, nowMs());
              await applyToDrafts(kg);
              setAdjust(null);
            }} />
          </Row>
        )
      ) : (
        <Btn size="sm" variant="ghost" title={t('prog.dismiss')} onPress={() => void app.training.decideProgression(sx.exercise_id, basisKey, 'dismissed', null, nowMs())} />
      )}
    </View>
  );
}
