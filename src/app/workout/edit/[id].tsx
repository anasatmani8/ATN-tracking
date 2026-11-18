import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';

import { ExercisePickerSheet } from '@/components/exercise-picker';
import { useFeedback } from '@/components/feedback';
import { Btn, Card, Empty, Loading, Row, Screen, Txt } from '@/components/ui';
import { t } from '@/i18n';
import { useApp, useLive } from '@/state/app';
import { errorText, useFmt } from '@/state/hooks';
import { SetEditor } from '@/screens/workout/set-editor';
import { spacing } from '@/theme';
import { nowMs } from '@/domain/clock';

/** Edit a finished workout. Changes sync as ordinary row edits; totals and records are re-derived everywhere. */
export default function EditWorkout() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const app = useApp();
  const fmt = useFmt();
  const router = useRouter();
  const { toast, confirm } = useFeedback();
  const [picker, setPicker] = useState(false);
  const { data } = useLive((a) => a.training.getSession(id), ['sessions', 'session_exercises', 'session_sets'], [id]);
  if (data === undefined) return <Screen title={t('edit.title')} back><Loading /></Screen>;
  if (!data) return <Screen title={t('edit.title')} back><Empty icon="alert-circle-outline" title={t('fallback.missing.title')} body={t('fallback.missing.body')} /></Screen>;
  return (
    <Screen testID="edit-workout" title={t('edit.title')} subtitle={data.session.title} back footer={<Btn title={t('common.done')} onPress={() => router.back()} testID="edit-done" />}>
      <View style={{ gap: spacing.md }}>
        <Txt variant="caption" tone="textMuted">{t('edit.hint')}</Txt>
        {data.exercises.map((sx) => (
          <Card key={sx.id} style={{ gap: spacing.xs }}>
            <Txt variant="headline">{sx.name}</Txt>
            {sx.sets.map((set, i) => (
              <SetEditor key={set.id} sx={sx} set={set} index={i} fmt={fmt} editCompleted
                onComplete={async (s, flush) => { try { await flush(); await app.training.completeSet(s.id, data.session.ended_at ?? nowMs()); } catch (e) { toast({ message: errorText(e), tone: 'error' }); } }}
                onUncomplete={async (s) => {
                  if (await confirm({ title: t('edit.removeSet'), confirmLabel: t('common.delete'), destructive: true })) await app.training.removeSet(s.id);
                }}
                onRemove={(s) => void app.training.removeSet(s.id)} />
            ))}
            <Row><Btn size="sm" variant="secondary" icon="add" title={t('set.add')} onPress={() => void app.training.addSet(sx.id)} /></Row>
          </Card>
        ))}
        <Btn variant="outline" icon="add" title={t('active.addExercise')} onPress={() => setPicker(true)} />
      </View>
      <ExercisePickerSheet visible={picker} onClose={() => setPicker(false)} title={t('active.addExercise')} onPick={async (e) => { await app.training.addExercise(id, e.id); setPicker(false); }} />
    </Screen>
  );
}
