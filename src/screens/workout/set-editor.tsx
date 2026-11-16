import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { useFeedback } from '@/components/feedback';
import { useTheme } from '@/components/theme-context';
import { Icon, Row, Segmented, Txt } from '@/components/ui';
import type { SessionExerciseRow, SetRow } from '@/data/training';
import type { LoadMode } from '@/domain/types';
import { t, type StringKey } from '@/i18n';
import { useApp, type AppCtx } from '@/state/app';
import { errorText, useFmt } from '@/state/hooks';
import { radius, spacing, TOUCH, type } from '@/theme';

type Fmt = ReturnType<typeof useFmt>;

function loadLabel(sx: SessionExerciseRow, unit: string): string {
  if (sx.load_convention === 'per_implement') return t('load.perImplement', { unit, n: sx.implement_count });
  if (sx.load_convention === 'bodyweight') return t('load.extra', { unit });
  return t('load.total', { unit });
}

/** One editable set row. Text is kept locally and written to disk after a short pause, on blur, and before completing. */
export function SetEditor({ sx, set, index, fmt, onComplete, onUncomplete, onRemove, editCompleted }: {
  sx: SessionExerciseRow; set: SetRow; index: number; fmt: Fmt; editCompleted?: boolean;
  onComplete: (s: SetRow, flush: () => Promise<void>) => void; onUncomplete: (s: SetRow) => void; onRemove: (s: SetRow) => void;
}) {
  const app = useApp();
  const { c } = useTheme();
  const { toast } = useFeedback();
  const done = set.completed_at != null;
  const locked = done && !editCompleted;
  const init = () => ({
    load: fmt.weightNum(set.load_kg), reps: set.reps == null ? '' : String(set.reps), dur: set.duration_sec == null ? '' : String(set.duration_sec),
    dist: fmt.distNum(set.distance_m), rir: set.rir == null ? '' : String(set.rir),
  });
  const [v, setV] = useState(init);
  const dirty = useRef<Partial<Record<keyof ReturnType<typeof init>, string>>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Refresh from disk when the row changes underneath (undo, unit switch), unless the user is typing.
  useEffect(() => {
    if (Object.keys(dirty.current).length === 0) setV(init());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [set.load_kg, set.reps, set.duration_sec, set.distance_m, set.rir, fmt.wUnit, fmt.distUnit]);

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    const d = dirty.current;
    dirty.current = {};
    if (Object.keys(d).length === 0) return;
    const int = (s: string) => (s.trim() === '' ? null : /^\d+$/.test(s.trim()) ? Number(s.trim()) : NaN);
    const patch: Parameters<AppCtx['training']['updateSet']>[1] = {};
    if (d.load != null) patch.load_kg = d.load.trim() === '' ? null : (fmt.parseWeight(d.load) ?? NaN);
    if (d.reps != null) patch.reps = int(d.reps);
    if (d.dur != null) patch.duration_sec = int(d.dur);
    if (d.dist != null) patch.distance_m = d.dist.trim() === '' ? null : (fmt.parseDistance(d.dist) ?? NaN);
    if (d.rir != null) patch.rir = int(d.rir);
    try {
      await app.training.updateSet(set.id, patch);
    } catch (e) {
      toast({ message: errorText(e), tone: 'error' });
      setV(init());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.training, set.id, fmt]);

  const change = (k: keyof ReturnType<typeof init>, text: string) => {
    setV((s) => ({ ...s, [k]: text }));
    dirty.current[k] = text;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 400);
  };
  useEffect(() => () => void flush(), [flush]);

  const input = (k: keyof ReturnType<typeof init>, label: string, decimal: boolean, width = 76) => (
    <View style={{ alignItems: 'center', gap: 2 }}>
      <TextInput
        testID={`set-${index}-${k}`}
        accessibilityLabel={t('set.fieldA11y', { n: index + 1, field: label })}
        value={v[k]}
        editable={!locked}
        onChangeText={(x) => change(k, x)}
        onBlur={() => void flush()}
        keyboardType={decimal ? 'decimal-pad' : 'number-pad'}
        returnKeyType="done"
        selectTextOnFocus
        placeholder="–"
        placeholderTextColor={c.textFaint}
        style={[type.num, { width, minHeight: TOUCH, textAlign: 'center', borderRadius: radius.sm, backgroundColor: locked ? 'transparent' : c.surfaceAlt, color: c.text }]}
      />
      <Text style={[type.caption, { color: c.textMuted }]} numberOfLines={1}>{label}</Text>
    </View>
  );

  const it = sx.input_type;
  const showLoad = it === 'weight_reps' || (it === 'bodyweight_reps' && set.load_mode !== 'bodyweight');
  return (
    <View testID={`set-row-${index}`} style={{ gap: spacing.xs, paddingVertical: spacing.sm, opacity: done ? 0.85 : 1 }}>
      <Row gap={spacing.sm}>
        <Pressable accessibilityRole="button" accessibilityLabel={set.kind === 'warmup' ? t('set.warmupA11y', { n: index + 1 }) : t('set.workingA11y', { n: index + 1 })} accessibilityHint={done ? undefined : t('set.toggleKind')} disabled={locked}
          onPress={() => void app.training.updateSet(set.id, { kind: set.kind === 'warmup' ? 'working' : 'warmup' })}
          style={{ width: 36, minHeight: TOUCH, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={[type.bodyStrong, { color: set.kind === 'warmup' ? c.warning : c.textMuted }]}>{set.kind === 'warmup' ? 'W' : index + 1}</Text>
        </Pressable>
        <Row gap={spacing.sm} style={{ flex: 1, flexWrap: 'wrap' }}>
          {showLoad ? input('load', fmt.wUnit, true) : null}
          {it === 'weight_reps' || it === 'bodyweight_reps' ? input('reps', t('set.reps'), false, 60) : null}
          {it === 'distance_duration' ? input('dist', fmt.distUnit, true) : null}
          {it === 'duration' || it === 'distance_duration' ? input('dur', t('set.sec'), false, 70) : null}
          {it !== 'duration' && it !== 'distance_duration' ? input('rir', t('set.rir'), false, 48) : null}
        </Row>
        <Pressable
          testID={`set-${index}-complete`}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: done }}
          accessibilityLabel={done ? t('set.completedA11y', { n: index + 1 }) : t('set.completeA11y', { n: index + 1 })}
          onPress={() => (done ? onUncomplete(set) : onComplete(set, flush))}
          style={({ pressed }) => ({ width: 56, height: 56, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: done ? c.success : c.primarySoft, borderWidth: done ? 0 : 2, borderColor: c.primary, opacity: pressed ? 0.7 : 1 })}>
          <Icon name="checkmark" size={30} tone={done ? 'onPrimary' : 'primary'} />
        </Pressable>
      </Row>
      <Row gap={spacing.sm} style={{ paddingLeft: 44 }}>
        {set.prefill_source && !done ? <Txt variant="caption" tone="textMuted">{t(`prefill.${set.prefill_source}` as StringKey)}</Txt> : null}
        {done ? <Txt variant="caption" tone="success">{set.kind === 'warmup' ? t('set.warmupDone') : t('set.done')}</Txt> : null}
        <View style={{ flex: 1 }} />
        {!locked ? <Pressable testID={`set-${index}-remove`} accessibilityRole="button" accessibilityLabel={t('set.removeA11y', { n: index + 1 })} onPress={() => onRemove(set)} hitSlop={8} style={{ minHeight: 32, justifyContent: 'center' }}><Txt variant="caption" tone="textMuted">{t('set.remove')}</Txt></Pressable> : null}
      </Row>
      {it === 'bodyweight_reps' && !locked ? (
        <View style={{ paddingLeft: 44 }}>
          <Segmented<LoadMode> label={t('load.mode')} value={set.load_mode} onChange={(m) => void app.training.updateSet(set.id, { load_mode: m, load_kg: m === 'bodyweight' ? null : set.load_kg })}
            options={[{ value: 'bodyweight', label: t('load.bodyweight') }, { value: 'added', label: t('load.added') }, { value: 'assisted', label: t('load.assisted') }]} />
        </View>
      ) : null}
      {showLoad && !locked ? <Txt variant="caption" tone="textMuted" style={{ paddingLeft: 44 }}>{set.load_mode === 'assisted' ? t('load.assistedHint', { unit: fmt.wUnit }) : loadLabel(sx, fmt.wUnit)}</Txt> : null}
    </View>
  );
}

