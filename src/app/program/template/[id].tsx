import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';

import { useFeedback } from '@/components/feedback';
import { Btn, Card, Chip, Divider, Empty, Row, Screen, SectionTitle, Txt } from '@/components/ui';
import { builtinExercise } from '@/data/catalog/exercises';
import { defaultWeekdays, templateById } from '@/data/catalog/programs';
import { t, weekdayName } from '@/i18n';
import { useApp } from '@/state/app';
import { equipmentLabel } from '@/components/exercise-picker';
import { spacing } from '@/theme';
import { targetLabel } from '@/screens/workout/format';

export default function TemplateView() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const tpl = templateById(id);
  const app = useApp();
  const router = useRouter();
  const { toast } = useFeedback();
  const [days, setDays] = useState<number[]>(tpl ? defaultWeekdays(tpl.daysPerWeek) : []);
  const [busy, setBusy] = useState(false);
  if (!tpl) return <Screen title={t('program.title')} back><Empty icon="alert-circle-outline" title={t('fallback.missing.title')} /></Screen>;
  return (
    <Screen testID="template-view" title={tpl.name} back footer={
      <View style={{ gap: spacing.sm }}>
        <Btn testID="template-use" title={t('template.use')} loading={busy} disabled={days.length === 0} onPress={async () => {
          setBusy(true);
          const pid = await app.training.createFromTemplate(tpl.id);
          await app.training.activateProgram(pid, days, app.today);
          setBusy(false);
          toast({ message: t('program.activated') });
          router.replace(`/program/${pid}`);
        }} />
        <Btn variant="outline" title={t('template.copy')} onPress={async () => { const pid = await app.training.createFromTemplate(tpl.id); router.replace(`/program/${pid}`); }} />
      </View>}>
      <Txt tone="textMuted">{tpl.description}</Txt>
      <Txt variant="caption" tone="textMuted" style={{ marginTop: spacing.sm }}>{t('template.equipment', { list: tpl.equipment.map(equipmentLabel).join(', ') })}</Txt>
      <SectionTitle>{t('template.days')}</SectionTitle>
      <Row wrap gap={6}>{[1, 2, 3, 4, 5, 6, 0].map((d) => <Chip key={d} label={weekdayName(d)} selected={days.includes(d)} onPress={() => setDays(days.includes(d) ? days.filter((x) => x !== d) : [...days, d])} />)}</Row>
      {tpl.doc.days.map((d) => (
        <View key={d.id}>
          <SectionTitle>{`${d.name} · ${t('program.estMin', { n: d.estMinutes })}`}</SectionTitle>
          <Card style={{ gap: spacing.sm }}>
            {d.exercises.map((x, i) => (
              <View key={x.slotId} style={{ gap: 2 }}>
                {i > 0 ? <Divider /> : null}
                <Txt variant="bodyStrong">{builtinExercise(x.exerciseId)?.name}</Txt>
                <Txt variant="caption" tone="textMuted">{targetLabel(x.sets, x.repMin, x.repMax, x.durationSec)} · {t('workout.restSec', { n: x.restSec })}</Txt>
                {x.alternatives.length ? <Txt variant="caption" tone="textMuted">{t('template.alts', { list: x.alternatives.map((a) => builtinExercise(a)?.name).join(', ') })}</Txt> : null}
              </View>
            ))}
          </Card>
        </View>
      ))}
    </Screen>
  );
}
