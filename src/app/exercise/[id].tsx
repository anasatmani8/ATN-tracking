import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';

import { Chart } from '@/components/chart';
import { equipmentLabel } from '@/components/exercise-picker';
import { Card, Divider, Empty, ListItem, Loading, Row, Screen, SectionTitle, Segmented, Stat, Txt } from '@/components/ui';
import { addDays, formatDuration, type LocalDate } from '@/domain/time';
import { fromKg } from '@/domain/units';
import { analyzeRecords, externalLoadKg, headlineRecords, setVolumeKg } from '@/domain/workout';
import { formatDate, t, type StringKey } from '@/i18n';
import { useApp, useLive } from '@/state/app';
import { useFmt } from '@/state/hooks';
import { spacing } from '@/theme';

/** Exercise history: cues, personal bests, heaviest load and volume per session. */
export default function ExerciseDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const app = useApp();
  const fmt = useFmt();
  const router = useRouter();
  const [range, setRange] = useState<30 | 90 | 365>(90);
  const { data } = useLive(async (a) => ({ ex: await a.training.getExercise(id), sets: await a.training.historySets(id) }), ['sessions', 'session_sets', 'exercises'], [id]);
  if (!data) return <Screen title="" back><Loading /></Screen>;
  if (!data.ex) return <Screen title={t('train.exercises')} back><Empty icon="alert-circle-outline" title={t('fallback.missing.title')} /></Screen>;
  const { ex, sets } = data;
  const recs = headlineRecords(analyzeRecords(sets).current, id);
  const from: LocalDate = addDays(app.today, -range + 1);
  const bySession = new Map<string, { date: LocalDate; top: number | null; volume: number; sessionId: string }>();
  for (const s of sets) {
    const e = bySession.get(s.sessionId) ?? { date: s.localDate, top: null, volume: 0, sessionId: s.sessionId };
    if (s.kind === 'working') {
      const l = externalLoadKg(s, s);
      if (l != null) e.top = Math.max(e.top ?? 0, l);
      e.volume += setVolumeKg(s, s);
    }
    bySession.set(s.sessionId, e);
  }
  const sessions = [...bySession.values()].filter((x) => x.date >= from).sort((a, b) => (a.date < b.date ? -1 : 1));
  const recLabel = (r: (typeof recs)[number]) =>
    r.type === 'heaviest_load' ? fmt.weight(r.value) : r.type === 'most_reps_at_load' ? t('pr.repsAt', { reps: r.value, load: fmt.weight(r.atLoadKg!) }) : r.type === 'most_reps' ? t('workout.reps', { count: r.value }) : r.type === 'longest_duration' ? formatDuration(r.value) : fmt.distance(r.value);

  return (
    <Screen testID="exercise-detail" title={ex.name} subtitle={`${equipmentLabel(ex.equipment)} · ${t(`input.${ex.inputType}` as StringKey)}`} back>
      {ex.cues ? <Card><Txt variant="overline" tone="textMuted">{t('exercise.cues')}</Txt><Txt>{ex.cues}</Txt></Card> : null}
      {ex.loadConvention === 'per_implement' ? <Txt variant="caption" tone="textMuted" style={{ marginTop: spacing.sm }}>{t('exercise.perImplementNote', { n: ex.implementCount })}</Txt> : null}
      <SectionTitle>{t('exercise.records')}</SectionTitle>
      {recs.length === 0 ? <Card><Txt tone="textMuted">{t('exercise.noRecords')}</Txt></Card> : (
        <Row gap={spacing.sm} wrap style={{ alignItems: 'stretch' }}>
          {recs.map((r) => <Stat key={r.type} label={t(`pr.type.${r.type}` as StringKey)} value={recLabel(r)} unit={formatDate(sets.find((s) => s.id === r.setId)?.localDate ?? app.today)} tone="violet" />)}
        </Row>
      )}
      <SectionTitle>{t('progress.range')}</SectionTitle>
      <Segmented label={t('progress.range')} value={range} onChange={setRange} options={[{ value: 30, label: t('range.30') }, { value: 90, label: t('range.90') }, { value: 365, label: t('range.365') }]} />
      <Card style={{ marginTop: spacing.md, gap: spacing.md }}>
        {ex.inputType === 'weight_reps' || ex.inputType === 'bodyweight_reps' ? (
          <>
            <Chart testID="chart-top-load" title={t('exercise.topLoad')} kind="line" points={sessions.map((s) => ({ label: formatDate(s.date, { month: 'short', day: 'numeric' }), value: s.top }))}
              format={(v) => fmt.weight(v)} summary={sessions.length ? t('chart.sessions', { count: sessions.length }) : t('chart.noData')} />
            <Chart testID="chart-volume" title={t('exercise.volume', { unit: fmt.wUnit })} points={sessions.map((s) => ({ label: formatDate(s.date, { month: 'short', day: 'numeric' }), value: s.volume > 0 ? fromKg(s.volume, fmt.wUnit) : null }))}
              format={(v) => `${fmt.num(v)} ${fmt.wUnit}`} summary={t('exercise.volumeSummary')} />
          </>
        ) : <Txt tone="textMuted">{t('exercise.timedHistory')}</Txt>}
      </Card>
      <SectionTitle>{t('train.history')}</SectionTitle>
      {sessions.length === 0 ? <Card><Txt tone="textMuted">{t('exercise.noHistory')}</Txt></Card> : (
        <Card style={{ paddingVertical: spacing.sm }}>
          {[...sessions].reverse().map((s, i) => (
            <View key={s.sessionId}>
              {i > 0 ? <Divider /> : null}
              <ListItem title={formatDate(s.date)} subtitle={sets.filter((x) => x.sessionId === s.sessionId && x.kind === 'working').map((x) => `${x.loadKg != null ? fmt.weightNum(x.loadKg) : 'BW'}×${x.reps ?? (x.durationSec ? formatDuration(x.durationSec) : '–')}`).join(', ')} onPress={() => router.push(`/workout/summary/${s.sessionId}`)} />
            </View>
          ))}
        </Card>
      )}
    </Screen>
  );
}
