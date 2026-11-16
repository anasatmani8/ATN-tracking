import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useFeedback } from '@/components/feedback';
import { useTheme } from '@/components/theme-context';
import { Btn, Card, Divider, Empty, Icon, IconBtn, Loading, Row, Stat, Txt } from '@/components/ui';
import { formatDuration } from '@/domain/time';
import { elapsedMs } from '@/domain/workout';
import { fromKg } from '@/domain/units';
import { formatDate, formatTime, t } from '@/i18n';
import { useLive } from '@/state/app';
import { useFmt } from '@/state/hooks';
import { spacing, type } from '@/theme';

/** Session recap. Totals and records are always derived from the current history, so edits elsewhere are reflected. */
export default function Summary() {
  const { id, fresh } = useLocalSearchParams<{ id: string; fresh?: string }>();
  const { c } = useTheme();
  const fmt = useFmt();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { confirm, toast } = useFeedback();
  const { data } = useLive(async (a) => {
    const d = await a.training.getSession(id);
    if (!d) return { d: null };
    const sched = d.session.scheduled_id ? await a.training.getScheduled(d.session.scheduled_id) : null;
    return { d, totals: await a.training.sessionTotals(id), prs: await a.training.sessionRecords(id), sched, app: a };
  }, ['sessions', 'session_sets', 'session_exercises', 'scheduled_workouts'], [id]);
  const close = () => (fresh ? router.replace('/') : router.canGoBack() ? router.back() : router.replace('/'));

  if (!data) return <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top }}><Loading /></View>;
  if (!data.d) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top, justifyContent: 'center' }}>
        <Empty icon="alert-circle-outline" title={t('fallback.missing.title')} body={t('fallback.missing.body')} action={<Btn title={t('fallback.goToday')} onPress={() => router.replace('/')} />} />
      </View>
    );
  }
  const { d, totals, prs, sched, app } = data;
  const s = d.session;
  const dur = elapsedMs({ startedAt: s.started_at, endedAt: s.ended_at, pausedMs: s.paused_ms, pausedAt: null }, s.ended_at ?? s.started_at) / 1000;
  const doneExercises = d.exercises.filter((e) => e.sets.length > 0);

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }} testID="summary">
      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxxl }}>
        <LinearGradient colors={[c.heroC, c.heroA, c.heroB]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ paddingTop: insets.top + spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.xl }}>
          <Row style={{ maxWidth: 640, width: '100%', alignSelf: 'center' }}>
            <View style={{ flex: 1 }} />
            <IconBtn icon="close" label={t('common.close')} onPress={close} tone="onViolet" filled testID="summary-close" />
          </Row>
          <View style={{ maxWidth: 640, width: '100%', alignSelf: 'center', marginTop: spacing.xl }}>
            {fresh ? <Text style={[type.label, { color: '#fff' }]}>{t('summary.nice')}</Text> : null}
            <Text accessibilityRole="header" style={[type.display, { color: '#fff' }]}>{s.title}</Text>
            <Row gap={6}>
              <Icon name="time-outline" size={16} tone="onViolet" />
              <Text style={[type.label, { color: '#fff' }]} accessibilityLabel={t('summary.whenA11y', { duration: formatDuration(dur), date: formatDate(s.local_date, { weekday: 'long', month: 'long', day: 'numeric' }) })}>
                {formatDuration(dur)} · {formatDate(s.local_date)} · {formatTime(s.started_at, s.tz)}
              </Text>
            </Row>
          </View>
        </LinearGradient>
        <View style={{ padding: spacing.lg, gap: spacing.md, maxWidth: 640, width: '100%', alignSelf: 'center' }}>
          <Row gap={spacing.sm} style={{ alignItems: 'stretch' }}>
            <Stat icon="layers-outline" tone="primary" label={t('summary.sets')} value={fmt.num(totals!.workingSets)} unit={t('summary.setsUnit')} />
            <Stat icon="barbell-outline" tone="warning" label={t('summary.volume')} value={fmt.num(fromKg(totals!.volumeKg, fmt.wUnit))} unit={fmt.wUnit} />
            <Stat icon="repeat-outline" tone="success" label={t('summary.reps')} value={fmt.num(totals!.totalReps)} unit={t('summary.repsUnit')} />
          </Row>
          {totals!.setsExcludedFromVolume > 0 ? <Txt variant="caption" tone="textMuted">{t('summary.volumeNote', { count: totals!.setsExcludedFromVolume })}</Txt> : null}
          {sched ? <Txt variant="caption" tone="textMuted" testID="summary-scheduled">{t('summary.linked', { title: sched.title, date: formatDate(sched.local_date) })}</Txt> : null}

          {prs && prs.length ? (
            <Card testID="summary-prs" style={{ gap: spacing.sm, borderColor: c.violet }}>
              <Row><Icon name="trophy-outline" tone="violet" /><Txt variant="headline">{t('summary.prs', { count: prs.length })}</Txt></Row>
              {prs.map((p) => (
                <Txt key={`${p.setId}-${p.type}`}>
                  {p.name}: {p.type === 'heaviest_load' ? t('pr.heaviest', { load: fmt.weight(p.value) }) : p.type === 'most_reps_at_load' ? t('pr.repsAt', { reps: p.value, load: fmt.weight(p.atLoadKg!) }) : p.type === 'most_reps' ? t('pr.reps', { reps: p.value }) : p.type === 'longest_duration' ? t('pr.duration', { time: formatDuration(p.value) }) : t('pr.distance', { distance: fmt.distance(p.value) })}
                </Txt>
              ))}
            </Card>
          ) : null}

          <Card style={{ gap: spacing.md }}>
            <Row><Txt variant="headline" style={{ flex: 1 }}>{t('summary.activity')}</Txt><Txt variant="label" tone="primary">{t('summary.recorded')}</Txt></Row>
            {doneExercises.length === 0 ? <Txt tone="textMuted">{t('summary.noSets')}</Txt> : null}
            {doneExercises.map((e, i) => (
              <View key={e.id} style={{ gap: spacing.xs }}>
                {i > 0 ? <Divider /> : null}
                <Txt variant="overline" tone="text" style={{ marginTop: i > 0 ? spacing.sm : 0 }}>{e.name}</Txt>
                {e.sets.map((x) => (
                  <Row key={x.id} style={{ justifyContent: 'flex-end' }}>
                    {x.kind === 'warmup' ? <Txt variant="caption" tone="warning" style={{ flex: 1 }}>{t('set.warmup')}</Txt> : null}
                    <Txt variant="num">
                      {[x.reps != null ? t('workout.reps', { count: x.reps }) : null,
                        x.load_mode === 'bodyweight' ? t('load.bodyweight') : x.load_kg != null ? `${x.load_mode === 'assisted' ? '−' : x.load_mode === 'added' ? '+' : ''}${fmt.weight(x.load_kg)}${e.load_convention === 'per_implement' ? ` ×${e.implement_count}` : ''}` : null,
                        x.duration_sec ? formatDuration(x.duration_sec) : null, x.distance_m ? fmt.distance(x.distance_m) : null].filter(Boolean).join(' · ')}
                    </Txt>
                  </Row>
                ))}
              </View>
            ))}
          </Card>
          {s.notes ? <Card><Txt variant="overline" tone="textMuted">{t('active.notes')}</Txt><Txt>{s.notes}</Txt></Card> : null}
          <Row wrap>
            <Btn testID="summary-edit" variant="secondary" icon="create-outline" title={t('common.edit')} onPress={() => router.push(`/workout/edit/${s.id}`)} />
            <Btn testID="summary-delete" variant="danger" icon="trash-outline" title={t('common.delete')} onPress={async () => {
              if (!(await confirm({ title: t('summary.deleteTitle'), message: t('summary.deleteBody'), confirmLabel: t('common.delete'), destructive: true }))) return;
              await app!.training.deleteSession(s.id);
              toast({ message: t('summary.deleted') });
              close();
            }} />
          </Row>
        </View>
      </ScrollView>
    </View>
  );
}
