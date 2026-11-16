import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ExercisePickerSheet } from '@/components/exercise-picker';
import { useFeedback } from '@/components/feedback';
import { useTheme } from '@/components/theme-context';
import { Banner, Btn, Card, Chip, Divider, Empty, Field, Icon, IconBtn, ListItem, Loading, Row, Sheet, Toggle, Txt } from '@/components/ui';
import { builtinExercise } from '@/data/catalog/exercises';
import type { SetRow } from '@/data/training';
import { formatDuration } from '@/domain/time';
import { elapsedMs, restRemainingMs } from '@/domain/workout';
import { t } from '@/i18n';
import { useApp, useLive, type AppCtx } from '@/state/app';
import { errorText, useFmt, useNow } from '@/state/hooks';
import { cancelRestAlert, scheduleRestAlert } from '@/state/reminders';
import { radius, spacing, TOUCH, type } from '@/theme';
import { targetLabel } from '@/screens/workout/format';
import { ProgressionCard } from '@/screens/workout/progression-card';
import { SetEditor } from '@/screens/workout/set-editor';
import { nowMs } from '@/domain/clock';

async function loadActive(a: AppCtx) {
  const session = await a.training.getActiveSession();
  if (!session) return { detail: null };
  return { detail: await a.training.getSession(session.id) };
}

function haptic() {
  if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
}

export default function ActiveWorkout() {
  const app = useApp();
  const { c } = useTheme();
  const fmt = useFmt();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { toast, confirm } = useFeedback();
  const { data } = useLive(loadActive, ['sessions', 'session_exercises', 'session_sets']);
  const detail = data?.detail ?? null;
  const s = detail?.session ?? null;
  const now = useNow(1000, !!s);
  const [listOpen, setListOpen] = useState(false);
  const [picker, setPicker] = useState<null | 'add' | 'replace'>(null);
  const [updatePlan, setUpdatePlan] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const restAlerted = useRef<number | null>(null);

  const exercises = detail?.exercises ?? [];
  const idx = Math.max(0, exercises.findIndex((e) => e.id === s?.active_exercise_id));
  const sx = exercises[idx] ?? null;
  const { data: alts } = useLive((a) => (sx ? a.training.alternativesFor(sx.id) : Promise.resolve([])), ['session_exercises'], [sx?.id]);
  const { data: prev } = useLive((a) => (sx ? a.training.previousSets(sx.exercise_id, s?.id) : Promise.resolve(null)), ['sessions'], [sx?.exercise_id, s?.id]);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const elapsed = s ? elapsedMs({ startedAt: s.started_at, endedAt: null, pausedMs: s.paused_ms, pausedAt: s.paused_at }, now) : 0;
  const rest = s ? restRemainingMs(s.rest_started_at, s.rest_sec, now, s.paused_at) : null;

  useEffect(() => {
    if (rest != null && rest <= 0 && s?.rest_started_at && restAlerted.current !== s.rest_started_at) {
      restAlerted.current = s.rest_started_at;
      toast({ message: t('rest.over') });
    }
  }, [rest, s?.rest_started_at, toast]);

  if (!data) return <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top }}><Loading /></View>;
  if (!s || !detail) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top, justifyContent: 'center' }} testID="no-active">
        <Empty icon="barbell-outline" title={t('active.none.title')} body={t('active.none.body')} action={<Btn title={t('fallback.goToday')} onPress={() => router.replace('/')} />} />
      </View>
    );
  }

  const go = (i: number) => exercises[i] && void app.training.setActiveExercise(s.id, exercises[i].id);

  const complete = async (set: SetRow, flush: () => Promise<void>) => {
    try {
      await flush();
      const first = await app.training.completeSet(set.id, nowMs());
      if (!first) return;
      haptic();
      if (app.prefs.restTimerAlerts && sx?.rest_sec) void scheduleRestAlert(sx.rest_sec);
      toast({ message: t('set.savedToast', { n: (sx?.sets.findIndex((x) => x.id === set.id) ?? 0) + 1 }), actionLabel: t('common.undo'), onAction: () => { void app.training.uncompleteSet(set.id); void cancelRestAlert(); } });
    } catch (e) {
      toast({ message: errorText(e), tone: 'error' });
    }
  };

  const remove = async (set: SetRow) => {
    await app.training.removeSet(set.id);
    toast({ message: t('set.removed') });
  };

  const finish = async () => {
    const pending = exercises.flatMap((e) => e.sets).filter((x) => x.completed_at == null).length;
    const ok = await confirm({ title: t('finish.title'), message: pending ? t('finish.pending', { count: pending }) : t('finish.body'), confirmLabel: t('finish.confirm') });
    if (!ok) return;
    setFinishing(true);
    try {
      await app.training.finishSession(s.id, nowMs());
      void cancelRestAlert();
      router.replace(`/workout/summary/${s.id}?fresh=1`);
    } catch (e) {
      toast({ message: errorText(e), tone: 'error' });
    } finally {
      setFinishing(false);
    }
  };

  const discard = async () => {
    setMenuOpen(false);
    const ok = await confirm({ title: t('discard.title'), message: t('discard.body'), confirmLabel: t('discard.confirm'), destructive: true });
    if (!ok) return;
    await app.training.discardSession(s.id);
    void cancelRestAlert();
    router.replace('/');
  };

  const doneSets = sx?.sets.filter((x) => x.completed_at != null).length ?? 0;
  const paused = s.paused_at != null;

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }} testID="active-workout">
      <View style={{ paddingTop: insets.top + spacing.xs, paddingHorizontal: spacing.md, backgroundColor: c.bg }}>
        <Row style={{ maxWidth: 640, width: '100%', alignSelf: 'center' }}>
          <IconBtn icon="chevron-down" label={t('active.minimize')} onPress={close} filled testID="active-minimize" />
          <IconBtn icon="ellipsis-horizontal" label={t('active.more')} onPress={() => setMenuOpen(true)} filled testID="active-more" />
          <View style={{ flex: 1 }} />
          <Pressable testID="pause-toggle" accessibilityRole="button" accessibilityLabel={paused ? t('workout.resumeTimer') : t('workout.pause')} accessibilityValue={{ text: t('workout.elapsedA11y', { time: formatDuration(elapsed / 1000) }) }}
            onPress={() => void (paused ? app.training.resume(s.id, nowMs()) : app.training.pause(s.id, nowMs()))}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: TOUCH, paddingHorizontal: spacing.lg, borderRadius: radius.full, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, opacity: pressed ? 0.7 : 1 })}>
            <Icon name={paused ? 'play' : 'pause'} size={18} />
            <View>
              <Text style={[type.caption, { color: c.textMuted }]}>{paused ? t('workout.paused') : t('workout.elapsed')}</Text>
              <Text testID="elapsed" style={[type.timer, { color: c.text }]}>{formatDuration(elapsed / 1000)}</Text>
            </View>
          </Pressable>
        </Row>
        {rest != null ? (
          <View testID="rest-timer" accessible accessibilityLiveRegion="polite" accessibilityLabel={rest > 0 ? t('rest.a11y', { time: formatDuration(rest / 1000) }) : t('rest.over')}
            style={{ marginTop: spacing.sm, maxWidth: 640, width: '100%', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, backgroundColor: rest > 0 ? c.violetSoft : c.successSoft }}>
            <Icon name="timer-outline" tone={rest > 0 ? 'violet' : 'success'} />
            <View style={{ flex: 1 }}>
              <Txt variant="caption" tone="textMuted">{rest > 0 ? t('rest.label') : t('rest.over')}</Txt>
              <Text style={[type.metric, { color: rest > 0 ? c.violet : c.success }]}>{rest > 0 ? formatDuration(Math.ceil(rest / 1000)) : formatDuration(Math.floor(-rest / 1000))}</Text>
            </View>
            <Btn size="sm" variant="outline" title={t('rest.skip')} onPress={() => { void app.training.skipRest(s.id); void cancelRestAlert(); }} testID="rest-skip" />
          </View>
        ) : null}
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.md, paddingBottom: 140, maxWidth: 640, width: '100%', alignSelf: 'center' }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        {paused ? <Banner tone="warning" icon="pause-circle-outline" text={t('workout.pausedBanner')} /> : null}
        {!sx ? (
          <Card>
            <Empty icon="add-circle-outline" title={t('active.empty.title')} body={t('active.empty.body')} action={<Btn testID="add-first-exercise" icon="add" title={t('active.addExercise')} onPress={() => setPicker('add')} />} />
          </Card>
        ) : (
          <Card testID="exercise-card" style={{ gap: spacing.sm }}>
            <Row>
              <View style={{ flex: 1 }}>
                <Txt variant="caption" tone="textMuted" testID="exercise-position">{t('active.position', { n: idx + 1, total: exercises.length })}</Txt>
                <Txt variant="title" accessibilityRole="header" testID="exercise-name">{sx.name}</Txt>
                {sx.replaced_exercise_id ? <Txt variant="caption" tone="textMuted">{t('active.swappedFrom', { name: builtinExercise(sx.replaced_exercise_id)?.name ?? '' })}</Txt> : null}
              </View>
              <IconBtn icon="swap-horizontal" label={t('active.replace')} onPress={() => { setUpdatePlan(false); setPicker('replace'); }} filled testID="replace-exercise" />
            </Row>
            <Row wrap gap={spacing.sm}>
              <Chip label={targetLabel(sx.target_sets, sx.rep_min, sx.rep_max, sx.target_duration_sec) || t('active.noTarget')} />
              <Chip icon="timer-outline" label={t('workout.restSec', { n: sx.rest_sec ?? 0 })} />
              <Chip label={t('active.setsDone', { done: doneSets, total: sx.sets.length })} />
            </Row>
            <View testID="previous" style={{ backgroundColor: c.surfaceAlt, borderRadius: radius.md, padding: spacing.md, gap: 2 }}>
              <Txt variant="overline" tone="textMuted">{t('active.previous')}</Txt>
              {prev ? prev.sets.map((p, i) => (
                <Txt key={p.id} variant="num" tone="textMuted">
                  {i + 1}. {[p.load_kg != null ? fmt.weight(p.load_kg) : p.load_mode === 'bodyweight' ? t('load.bodyweight') : null, p.reps != null ? t('workout.reps', { count: p.reps }) : null, p.duration_sec ? formatDuration(p.duration_sec) : null, p.distance_m ? fmt.distance(p.distance_m) : null, p.rir != null ? `${t('set.rir')} ${p.rir}` : null].filter(Boolean).join(' · ')}
                </Txt>
              )) : <Txt variant="caption" tone="textMuted">{t('active.noPrevious')}</Txt>}
            </View>
            <ProgressionCard sx={sx} />
            <Divider />
            {sx.sets.map((set, i) => <SetEditor key={set.id} sx={sx} set={set} index={i} fmt={fmt} onComplete={complete} onUncomplete={(x) => { void app.training.uncompleteSet(x.id); void cancelRestAlert(); }} onRemove={remove} />)}
            <Row wrap>
              <Btn testID="add-set" size="sm" variant="secondary" icon="add" title={t('set.add')} onPress={() => void app.training.addSet(sx.id)} />
              <Btn testID="add-warmup" size="sm" variant="outline" icon="add" title={t('set.addWarmup')} onPress={() => void app.training.addSet(sx.id, 'warmup')} />
            </Row>
            <Divider />
            <Toggle label={t('active.discomfort')} hint={t('active.discomfort.hint')} value={sx.discomfort === 1} onChange={(v) => void app.training.setExerciseFields(sx.id, { discomfort: v ? 1 : 0 })} />
            {sx.discomfort === 1 ? <Banner tone="warning" icon="medkit-outline" text={t('active.discomfort.note')} /> : null}
          </Card>
        )}
      </ScrollView>

      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: c.bg, borderTopWidth: 1, borderTopColor: c.border, paddingBottom: Math.max(insets.bottom, spacing.md), paddingTop: spacing.sm, paddingHorizontal: spacing.md }}>
        <Row style={{ maxWidth: 640, width: '100%', alignSelf: 'center' }}>
          <IconBtn icon="chevron-back" label={t('active.prevExercise')} disabled={idx <= 0} onPress={() => go(idx - 1)} filled testID="prev-exercise" />
          <Btn testID="exercise-list" variant="outline" icon="list" title={t('active.list', { n: exercises.length ? idx + 1 : 0, total: exercises.length })} onPress={() => setListOpen(true)} style={{ flex: 1 }} />
          <IconBtn icon="chevron-forward" label={t('active.nextExercise')} disabled={idx >= exercises.length - 1} onPress={() => go(idx + 1)} filled testID="next-exercise" />
          <Btn testID="finish-workout" variant="primary" title={t('finish.cta')} loading={finishing} onPress={() => void finish()} />
        </Row>
      </View>

      <Sheet visible={listOpen} onClose={() => setListOpen(false)} title={t('active.exercises')} testID="exercise-list-sheet">
        {exercises.map((e, i) => {
          const d = e.sets.filter((x) => x.completed_at).length;
          return <ListItem key={e.id} testID={`goto-${i}`} title={`${i + 1}. ${e.name}`} subtitle={t('active.setsDone', { done: d, total: e.sets.length })} right={i === idx ? <Icon name="radio-button-on" tone="primary" /> : d > 0 && d === e.sets.length ? <Icon name="checkmark-circle" tone="success" /> : undefined} onPress={() => { go(i); setListOpen(false); }} />;
        })}
        <Btn icon="add" variant="secondary" title={t('active.addExercise')} onPress={() => { setListOpen(false); setPicker('add'); }} testID="list-add-exercise" />
      </Sheet>

      <ExercisePickerSheet
        visible={picker != null}
        onClose={() => setPicker(null)}
        title={picker === 'replace' ? t('active.replaceTitle', { name: sx?.name ?? '' }) : t('active.addExercise')}
        suggested={picker === 'replace' ? (alts ?? []) : undefined}
        onPick={async (e) => {
          try {
            if (picker === 'replace' && sx) {
              await app.training.replaceExercise(sx.id, e.id, updatePlan);
              toast({ message: updatePlan ? t('active.replacedPlan', { name: e.name }) : t('active.replaced', { name: e.name }) });
            } else await app.training.addExercise(s.id, e.id);
          } catch (err) {
            toast({ message: errorText(err), tone: 'error' });
          }
          setPicker(null);
        }}>
        {picker === 'replace' && sx?.plan_slot_id ? <Toggle testID="replace-update-plan" label={t('active.updatePlan')} hint={t('active.updatePlan.hint')} value={updatePlan} onChange={setUpdatePlan} /> : null}
      </ExercisePickerSheet>

      <Sheet visible={menuOpen} onClose={() => setMenuOpen(false)} title={s.title}>
        <ListItem icon="create-outline" title={t('active.notes')} subtitle={s.notes || undefined} onPress={() => { setMenuOpen(false); setNotesOpen(true); }} />
        {sx ? <ListItem icon="play-skip-forward-outline" title={t('active.skipExercise')} onPress={() => { void app.training.setExerciseFields(sx.id, { status: 'skipped' }); setMenuOpen(false); go(idx + 1); }} /> : null}
        <ListItem icon="add-circle-outline" title={t('active.addExercise')} onPress={() => { setMenuOpen(false); setPicker('add'); }} />
        <ListItem icon="flag-outline" title={t('finish.early')} onPress={() => { setMenuOpen(false); void finish(); }} />
        <ListItem testID="discard-workout" icon="trash-outline" title={t('discard.title')} destructive onPress={() => void discard()} />
      </Sheet>

      <NotesSheet key={`${notesOpen}:${s.notes}`} visible={notesOpen} onClose={() => setNotesOpen(false)} initial={s.notes} onSave={(n) => void app.training.setSessionNotes(s.id, n)} />
    </View>
  );
}

function NotesSheet({ visible, onClose, initial, onSave }: { visible: boolean; onClose: () => void; initial: string; onSave: (n: string) => void }) {
  const [v, setV] = useState(initial);
  return (
    <Sheet visible={visible} onClose={onClose} title={t('active.notes')}>
      <Field label={t('active.notes')} value={v} onChangeText={setV} multiline maxLength={2000} style={{ minHeight: 120 }} />
      <Btn title={t('common.save')} onPress={() => { onSave(v); onClose(); }} />
    </Sheet>
  );
}
