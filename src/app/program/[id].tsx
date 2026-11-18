import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';

import { ExercisePickerSheet } from '@/components/exercise-picker';
import { useFeedback } from '@/components/feedback';
import { Banner, Btn, Card, Chip, Divider, Empty, Field, IconBtn, ListItem, Loading, Row, Screen, SectionTitle, Sheet, Txt } from '@/components/ui';
import { builtinExercise } from '@/data/catalog/exercises';
import { defaultWeekdays, estimateMinutes, type PlanExercise, type ProgramDoc } from '@/data/catalog/programs';
import { newId } from '@/data/store';
import { t, weekdayName } from '@/i18n';
import { useApp, useLive } from '@/state/app';
import type { Program } from '@/data/training';
import { errorText } from '@/state/hooks';
import { spacing } from '@/theme';
import { targetLabel } from '@/screens/workout/format';

const intOrNull = (s: string) => (s.trim() === '' ? null : /^\d+$/.test(s.trim()) ? Number(s.trim()) : NaN);

/** Program editor. Saving creates a new revision; finished workouts keep their own snapshot. Reorder uses buttons, not drag. */
export default function ProgramEditorRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: program } = useLive((a) => a.training.getProgram(id), ['programs'], [id]);
  if (program === undefined) return <Screen title={t('program.title')} back><Loading /></Screen>;
  if (!program) return <Screen title={t('program.title')} back><Empty icon="alert-circle-outline" title={t('fallback.missing.title')} body={t('fallback.missing.body')} /></Screen>;
  // Remount on each saved revision so the editable copy starts from what is stored.
  return <ProgramEditor key={`${program.id}:${program.revision}:${program.active}:${program.weekdays.join()}`} program={program} />;
}

function ProgramEditor({ program }: { program: Program }) {
  const id = program.id;
  const app = useApp();
  const router = useRouter();
  const { toast, confirm } = useFeedback();
  const { data: names } = useLive(async (a) => new Map((await a.training.listExercises()).map((e) => [e.id, e.name])), ['exercises']);
  const [name, setName] = useState(program.name);
  const [doc, setDoc] = useState<ProgramDoc>(program.doc);
  const [dirty, setDirty] = useState(false);
  const [pickDay, setPickDay] = useState<number | null>(null);
  const [editing, setEditing] = useState<{ day: number; idx: number } | null>(null);
  const [daysOpen, setDaysOpen] = useState(false);
  const [weekdays, setWeekdays] = useState<number[]>(program.active ? program.weekdays : defaultWeekdays(program.doc.days.length));

  const nameOf = (eid: string) => names?.get(eid) ?? builtinExercise(eid)?.name ?? eid;
  const edit = (fn: (d: ProgramDoc) => ProgramDoc) => { setDoc(fn(structuredClone(doc))); setDirty(true); };
  const move = (day: number, i: number, dir: -1 | 1) => edit((d) => { const xs = d.days[day].exercises; const j = i + dir; if (j < 0 || j >= xs.length) return d; [xs[i], xs[j]] = [xs[j], xs[i]]; return d; });
  const save = async () => {
    try {
      await app.training.saveProgram(id, { name: name.trim() || program.name, doc });
      setDirty(false);
      toast({ message: t('program.saved') });
    } catch (e) {
      toast({ message: errorText(e), tone: 'error' });
    }
  };
  const ed = editing ? doc.days[editing.day]?.exercises[editing.idx] : null;

  return (
    <Screen testID="program-editor" title={program.name} subtitle={program.active ? t('program.activeOn', { days: program.weekdays.map((d) => weekdayName(d)).join(', ') }) : undefined} back
      footer={dirty ? <Row><Btn variant="outline" title={t('common.discardChanges')} onPress={() => { setDoc(program.doc); setName(program.name); setDirty(false); }} style={{ flex: 1 }} /><Btn testID="program-save" title={t('common.save')} onPress={() => void save()} style={{ flex: 1 }} /></Row> : undefined}>
      <View style={{ gap: spacing.md }}>
        {dirty ? <Banner icon="information-circle-outline" text={t('program.unsaved')} /> : null}
        <Field testID="program-name" label={t('program.name')} value={name} onChangeText={(v) => { setName(v); setDirty(true); }} maxLength={80} />
        <Row wrap>
          {program.active ? <Btn size="sm" variant="secondary" icon="calendar-outline" title={t('program.changeDays')} onPress={() => setDaysOpen(true)} />
            : <Btn testID="program-activate" size="sm" icon="checkmark-circle-outline" title={t('program.makeActive')} disabled={dirty || doc.days.every((d) => d.exercises.length === 0)} onPress={() => setDaysOpen(true)} />}
          {program.active ? <Btn size="sm" variant="outline" title={t('program.stop')} onPress={async () => { if (await confirm({ title: t('program.stop'), message: t('program.stopBody') })) await app.training.deactivatePrograms(app.today); }} /> : null}
          <Btn size="sm" variant="outline" icon="copy-outline" title={t('program.duplicate')} onPress={async () => { const c = await app.training.duplicateProgram(id); router.replace(`/program/${c}`); }} />
        </Row>
      </View>

      {doc.days.map((day, di) => (
        <View key={day.id}>
          <SectionTitle action={<Btn size="sm" variant="ghost" icon="play" title={t('program.startDay')} disabled={dirty || day.exercises.length === 0} onPress={() => router.push(`/workout/preview?programId=${id}&dayId=${day.id}`)} />}>
            {`${day.name} · ${t('program.estMin', { n: estimateMinutes(day.exercises) })}`}
          </SectionTitle>
          <Card style={{ gap: spacing.xs }}>
            <Field label={t('program.dayName')} value={day.name} onChangeText={(v) => edit((d) => { d.days[di].name = v; return d; })} maxLength={60} />
            {day.exercises.length === 0 ? <Txt tone="textMuted">{t('program.dayEmpty')}</Txt> : null}
            {day.exercises.map((x, i) => (
              <View key={x.slotId}>
                <Divider />
                <Row style={{ paddingVertical: spacing.xs }}>
                  <View style={{ flex: 1 }}>
                    <Txt variant="bodyStrong">{nameOf(x.exerciseId)}</Txt>
                    <Txt variant="caption" tone="textMuted">{targetLabel(x.sets, x.repMin, x.repMax, x.durationSec)} · {t('workout.restSec', { n: x.restSec })}</Txt>
                  </View>
                  <IconBtn icon="arrow-up" label={t('program.moveUp', { name: nameOf(x.exerciseId) })} disabled={i === 0} onPress={() => move(di, i, -1)} />
                  <IconBtn icon="arrow-down" label={t('program.moveDown', { name: nameOf(x.exerciseId) })} disabled={i === day.exercises.length - 1} onPress={() => move(di, i, 1)} />
                  <IconBtn testID={`edit-slot-${di}-${i}`} icon="create-outline" label={t('program.editExercise', { name: nameOf(x.exerciseId) })} onPress={() => setEditing({ day: di, idx: i })} />
                </Row>
              </View>
            ))}
            <Row wrap>
              <Btn testID={`add-to-day-${di}`} size="sm" variant="secondary" icon="add" title={t('active.addExercise')} onPress={() => setPickDay(di)} />
              {doc.days.length > 1 ? <Btn size="sm" variant="ghost" title={t('program.removeDay')} onPress={async () => { if (await confirm({ title: t('program.removeDay'), message: day.name, destructive: true, confirmLabel: t('common.delete') })) edit((d) => { d.days.splice(di, 1); return d; }); }} /> : null}
            </Row>
          </Card>
        </View>
      ))}
      <Btn style={{ marginTop: spacing.lg }} variant="outline" icon="add" title={t('program.addDay')} onPress={() => edit((d) => { d.days.push({ id: newId(), name: t('program.dayN', { n: d.days.length + 1 }), estMinutes: 5, exercises: [] }); return d; })} />
      <Btn style={{ marginTop: spacing.xl }} variant="danger" icon="trash-outline" title={t('program.delete')} onPress={async () => {
        if (!(await confirm({ title: t('program.delete'), message: t('program.deleteBody'), destructive: true, confirmLabel: t('common.delete') }))) return;
        await app.training.deleteProgram(id, app.today);
        router.back();
      }} />

      <ExercisePickerSheet visible={pickDay != null} onClose={() => setPickDay(null)} title={t('active.addExercise')} onPick={(e) => {
        const timed = e.inputType === 'duration' || e.inputType === 'distance_duration';
        const x: PlanExercise = { slotId: newId(), exerciseId: e.id, sets: 3, repMin: timed ? null : 8, repMax: timed ? null : 12, durationSec: timed ? 60 : null, restSec: 90, alternatives: [] };
        edit((d) => { d.days[pickDay!].exercises.push(x); return d; });
        setPickDay(null);
      }} />

      <SlotSheet key={ed?.slotId ?? 'none'} slot={ed} name={ed ? nameOf(ed.exerciseId) : ''} onClose={() => setEditing(null)}
        onSave={(x) => { edit((d) => { d.days[editing!.day].exercises[editing!.idx] = x; return d; }); setEditing(null); }}
        onRemove={() => { edit((d) => { d.days[editing!.day].exercises.splice(editing!.idx, 1); return d; }); setEditing(null); }} />

      <Sheet visible={daysOpen} onClose={() => setDaysOpen(false)} title={t('program.chooseDays')}>
        <Txt tone="textMuted">{t('program.chooseDaysBody', { count: doc.days.length })}</Txt>
        <Row wrap gap={6}>
          {[1, 2, 3, 4, 5, 6, 0].map((d) => <Chip key={d} testID={`pd-${d}`} label={weekdayName(d)} selected={weekdays.includes(d)} onPress={() => setWeekdays(weekdays.includes(d) ? weekdays.filter((x) => x !== d) : [...weekdays, d])} />)}
        </Row>
        <Btn testID="activate-confirm" title={program.active ? t('common.save') : t('program.makeActive')} disabled={weekdays.length === 0} onPress={async () => {
          await app.training.activateProgram(id, weekdays, app.today);
          setDaysOpen(false);
          toast({ message: t('program.activated') });
        }} />
      </Sheet>
    </Screen>
  );
}

function SlotSheet({ slot, name, onClose, onSave, onRemove }: { slot: PlanExercise | null; name: string; onClose: () => void; onSave: (x: PlanExercise) => void; onRemove: () => void }) {
  const [v, setV] = useState(() => ({ sets: String(slot?.sets ?? ''), repMin: slot?.repMin?.toString() ?? '', repMax: slot?.repMax?.toString() ?? '', dur: slot?.durationSec?.toString() ?? '', rest: String(slot?.restSec ?? '') }));
  const [err, setErr] = useState<string | null>(null);
  if (!slot) return null;
  const save = () => {
    const sets = intOrNull(v.sets), repMin = intOrNull(v.repMin), repMax = intOrNull(v.repMax), dur = intOrNull(v.dur), rest = intOrNull(v.rest);
    if (!sets || sets < 1 || sets > 20 || [repMin, repMax, dur, rest].some((n) => Number.isNaN(n)) || (repMin != null && repMax != null && repMin > repMax) || (rest ?? 0) > 900) return setErr(t('program.slotInvalid'));
    onSave({ ...slot, sets, repMin: dur ? null : repMin, repMax: dur ? null : (repMax ?? repMin), durationSec: dur, restSec: rest ?? 90 });
  };
  return (
    <Sheet visible={!!slot} onClose={onClose} title={name}>
      <Row><Field label={t('program.sets')} value={v.sets} onChangeText={(x) => setV({ ...v, sets: x })} keyboardType="number-pad" style={{ flex: 1 }} testID="slot-sets" />
        <Field label={t('program.rest')} suffix="s" value={v.rest} onChangeText={(x) => setV({ ...v, rest: x })} keyboardType="number-pad" style={{ flex: 1 }} /></Row>
      {slot.durationSec != null ? (
        <Field label={t('program.duration')} suffix="s" value={v.dur} onChangeText={(x) => setV({ ...v, dur: x })} keyboardType="number-pad" />
      ) : (
        <Row><Field label={t('program.repMin')} value={v.repMin} onChangeText={(x) => setV({ ...v, repMin: x })} keyboardType="number-pad" style={{ flex: 1 }} />
          <Field label={t('program.repMax')} value={v.repMax} onChangeText={(x) => setV({ ...v, repMax: x })} keyboardType="number-pad" style={{ flex: 1 }} /></Row>
      )}
      {err ? <Txt tone="danger">{err}</Txt> : null}
      {slot.alternatives.length ? <ListItem title={t('exercise.alternatives')} subtitle={slot.alternatives.map((a) => builtinExercise(a)?.name ?? a).join(', ')} /> : null}
      <Btn testID="slot-save" title={t('common.save')} onPress={save} />
      <Btn variant="danger" title={t('program.removeExercise')} onPress={onRemove} />
    </Sheet>
  );
}
