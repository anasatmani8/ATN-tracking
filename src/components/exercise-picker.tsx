import React, { useMemo, useState } from 'react';
import { View } from 'react-native';

import type { Exercise } from '@/data/catalog/exercises';
import type { Equipment } from '@/domain/types';
import { t, type StringKey } from '@/i18n';
import { useLive } from '@/state/app';
import { spacing } from '@/theme';
import { Chip, Divider, Field, ListItem, Row, Sheet, Txt } from './ui';

export const EQUIPMENT: Equipment[] = ['bodyweight', 'dumbbell', 'barbell', 'machine', 'cable', 'cardio'];

export function equipmentLabel(e: string) {
  return t(`eq.${e}` as StringKey);
}

export function ExerciseSearch({ onPick, suggested, testIDPrefix = 'pick' }: { onPick: (e: Exercise) => void; suggested?: string[]; testIDPrefix?: string }) {
  const [q, setQ] = useState('');
  const [eq, setEq] = useState<Equipment | null>(null);
  const { data } = useLive((a) => a.training.listExercises(), ['exercises']);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (data ?? []).filter((e) => (!eq || e.equipment === eq) && (!s || e.name.toLowerCase().includes(s)));
  }, [data, q, eq]);
  const sugg = (data ?? []).filter((e) => suggested?.includes(e.id));
  return (
    <View style={{ gap: spacing.md }}>
      {sugg.length ? (
        <View style={{ gap: spacing.xs }}>
          <Txt variant="overline" tone="textMuted">{t('exercise.alternatives')}</Txt>
          {sugg.map((e) => <ListItem key={e.id} testID={`${testIDPrefix}-alt-${e.id}`} title={e.name} subtitle={equipmentLabel(e.equipment)} onPress={() => onPick(e)} />)}
          <Divider />
        </View>
      ) : null}
      <Field testID={`${testIDPrefix}-search`} label={t('exercise.search')} value={q} onChangeText={setQ} placeholder={t('exercise.searchPlaceholder')} autoCorrect={false} returnKeyType="search" />
      <Row wrap gap={6}>
        {EQUIPMENT.map((e) => <Chip key={e} label={equipmentLabel(e)} selected={eq === e} onPress={() => setEq(eq === e ? null : e)} />)}
      </Row>
      <Txt variant="caption" tone="textMuted" accessibilityLiveRegion="polite">{t('exercise.count', { count: list.length })}</Txt>
      {list.map((e) => <ListItem key={e.id} testID={`${testIDPrefix}-${e.id}`} title={e.name} subtitle={`${equipmentLabel(e.equipment)}${e.builtin ? '' : ` · ${t('exercise.custom')}`}`} onPress={() => onPick(e)} />)}
    </View>
  );
}

export function ExercisePickerSheet({ visible, onClose, onPick, title, suggested, children }: { visible: boolean; onClose: () => void; onPick: (e: Exercise) => void; title: string; suggested?: string[]; children?: React.ReactNode }) {
  return (
    <Sheet visible={visible} onClose={onClose} title={title} testID="exercise-picker">
      {children}
      <ExerciseSearch onPick={onPick} suggested={suggested} />
    </Sheet>
  );
}
