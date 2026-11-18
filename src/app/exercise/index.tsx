import { useRouter } from 'expo-router';
import React, { useState } from 'react';

import { ExerciseSearch, EQUIPMENT, equipmentLabel } from '@/components/exercise-picker';
import { useFeedback } from '@/components/feedback';
import { Btn, Chip, Field, Row, Screen, Segmented, Sheet, Txt } from '@/components/ui';
import type { Pattern } from '@/data/catalog/exercises';
import type { Equipment, InputType, LoadConvention } from '@/domain/types';
import { t } from '@/i18n';
import { useApp } from '@/state/app';
import { errorText } from '@/state/hooks';

export default function ExerciseLibrary() {
  const app = useApp();
  const router = useRouter();
  const { toast } = useFeedback();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<{ name: string; equipment: Equipment; inputType: InputType; loadConvention: LoadConvention; cues: string }>({ name: '', equipment: 'dumbbell', inputType: 'weight_reps', loadConvention: 'total', cues: '' });
  return (
    <Screen testID="exercise-library" title={t('train.exercises')} back right={<Btn size="sm" variant="secondary" icon="add" title={t('exercise.create')} onPress={() => setOpen(true)} testID="exercise-create" />}>
      <ExerciseSearch onPick={(e) => router.push(`/exercise/${e.id}`)} testIDPrefix="lib" />
      <Sheet visible={open} onClose={() => setOpen(false)} title={t('exercise.create')}>
        <Field testID="ex-name" label={t('exercise.name')} value={f.name} onChangeText={(name) => setF({ ...f, name })} maxLength={80} />
        <Txt variant="label" tone="textMuted">{t('exercise.equipment')}</Txt>
        <Row wrap gap={6}>{EQUIPMENT.map((e) => <Chip key={e} label={equipmentLabel(e)} selected={f.equipment === e} onPress={() => setF({ ...f, equipment: e })} />)}</Row>
        <Txt variant="label" tone="textMuted">{t('exercise.input')}</Txt>
        <Segmented<InputType> label={t('exercise.input')} value={f.inputType} onChange={(inputType) => setF({ ...f, inputType, loadConvention: inputType === 'weight_reps' ? 'total' : inputType === 'bodyweight_reps' ? 'bodyweight' : 'none' })}
          options={[{ value: 'weight_reps', label: t('input.weight_reps') }, { value: 'bodyweight_reps', label: t('input.bodyweight_reps') }, { value: 'duration', label: t('input.duration') }, { value: 'distance_duration', label: t('input.distance') }]} />
        {f.inputType === 'weight_reps' ? (
          <>
            <Txt variant="label" tone="textMuted">{t('exercise.loadConvention')}</Txt>
            <Segmented<LoadConvention> label={t('exercise.loadConvention')} value={f.loadConvention} onChange={(loadConvention) => setF({ ...f, loadConvention })}
              options={[{ value: 'total', label: t('exercise.conv.total') }, { value: 'per_implement', label: t('exercise.conv.pair') }]} />
          </>
        ) : null}
        <Field label={t('exercise.cues')} value={f.cues} onChangeText={(cues) => setF({ ...f, cues })} multiline maxLength={600} />
        <Btn testID="ex-save" title={t('common.save')} onPress={async () => {
          try {
            const id = await app.training.saveCustomExercise({ ...f, pattern: 'core' as Pattern, implementCount: f.loadConvention === 'per_implement' ? 2 : 1 });
            setOpen(false);
            router.push(`/exercise/${id}`);
          } catch (e) {
            toast({ message: errorText(e), tone: 'error' });
          }
        }} />
      </Sheet>
    </Screen>
  );
}
