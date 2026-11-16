import { useRouter } from 'expo-router';
import React from 'react';
import { View } from 'react-native';

import { Btn, Card, Chip, Divider, Empty, Icon, ListItem, Loading, Row, Screen, SectionTitle, Txt } from '@/components/ui';
import { PROGRAM_TEMPLATES } from '@/data/catalog/programs';
import { addDays, formatDuration, weekdayOf, weekStartOf } from '@/domain/time';
import { fromKg } from '@/domain/units';
import { elapsedMs } from '@/domain/workout';
import { formatDate, t, weekdayName, type StringKey } from '@/i18n';
import { useApp, useLive } from '@/state/app';
import { useFmt } from '@/state/hooks';
import { spacing } from '@/theme';

export default function Train() {
  const app = useApp();
  const fmt = useFmt();
  const router = useRouter();
  const { data } = useLive(async (a) => {
    await a.training.ensureSchedule(a.today);
    const from = weekStartOf(a.today, a.prefs.startOfWeek);
    return {
      from,
      week: await a.training.listScheduled(from, addDays(from, 6)),
      programs: await a.training.listPrograms(),
      history: await a.training.listHistory(5),
      active: await a.training.getActiveSession(),
    };
  }, ['programs', 'scheduled_workouts', 'sessions', 'session_sets', 'prefs']);

  if (!data) return <Screen title={t('tab.train')}><Loading /></Screen>;
  const activeProgram = data.programs.find((p) => p.active) ?? null;

  return (
    <Screen testID="train-screen" title={t('tab.train')} right={<Btn size="sm" variant="secondary" icon="add" title={t('workout.startEmpty')} onPress={() => router.push(data.active ? '/workout/active' : '/workout/preview')} testID="train-start-empty" />}>
      <SectionTitle>{t('train.thisWeek')}</SectionTitle>
      <Card style={{ paddingVertical: spacing.sm }} testID="week-schedule">
        {[0, 1, 2, 3, 4, 5, 6].map((i) => {
          const d = addDays(data.from, i);
          const items = data.week.filter((s) => s.local_date === d && s.status !== 'cancelled');
          const isToday = d === app.today;
          return (
            <View key={d}>
              {i > 0 ? <Divider /> : null}
              {items.length === 0 ? (
                <ListItem title={`${weekdayName(weekdayOf(d))} ${formatDate(d, { day: 'numeric' })}${isToday ? ` · ${t('date.today')}` : ''}`} value={t('train.rest')} />
              ) : items.map((s) => (
                <ListItem key={s.id} testID={`week-${d}`}
                  title={`${weekdayName(weekdayOf(d))} ${formatDate(d, { day: 'numeric' })}${isToday ? ` · ${t('date.today')}` : ''}`}
                  subtitle={`${s.title}${s.moved_from ? ` · ${t('train.movedFrom', { date: formatDate(s.moved_from) })}` : ''}`}
                  value={t(`sched.${s.status}` as StringKey)}
                  right={<Icon name={s.status === 'completed' ? 'checkmark-circle' : s.status === 'skipped' ? 'remove-circle-outline' : 'ellipse-outline'} tone={s.status === 'completed' ? 'success' : 'textMuted'} />}
                  onPress={() => (s.status === 'completed' && s.session_id ? router.push(`/workout/summary/${s.session_id}`) : router.push(`/workout/preview?scheduledId=${encodeURIComponent(s.id)}`))} />
              ))}
            </View>
          );
        })}
      </Card>
      {!activeProgram ? <Txt variant="caption" tone="textMuted" style={{ marginTop: spacing.sm }}>{t('train.noActive')}</Txt> : null}

      <SectionTitle action={<Btn size="sm" variant="ghost" icon="add" title={t('program.new')} testID="new-routine" onPress={async () => { const id = await app.training.createBlankProgram(t('program.myRoutine')); router.push(`/program/${id}`); }} />}>{t('train.myPlans')}</SectionTitle>
      {data.programs.length === 0 ? (
        <Card><Empty icon="clipboard-outline" title={t('train.noPlans.title')} body={t('train.noPlans.body')} /></Card>
      ) : (
        <Card style={{ paddingVertical: spacing.sm }}>
          {data.programs.map((p, i) => (
            <View key={p.id}>
              {i > 0 ? <Divider /> : null}
              <ListItem testID={`program-${i}`} title={p.name} subtitle={p.active ? t('program.activeOn', { days: p.weekdays.map((d) => weekdayName(d)).join(', ') }) : t('program.daysCount', { count: p.doc.days.length })}
                right={p.active ? <Chip label={t('program.active')} selected /> : undefined} onPress={() => router.push(`/program/${p.id}`)} />
            </View>
          ))}
        </Card>
      )}

      <SectionTitle>{t('train.starters')}</SectionTitle>
      <Card style={{ paddingVertical: spacing.sm }}>
        {PROGRAM_TEMPLATES.map((tpl, i) => (
          <View key={tpl.id}>
            {i > 0 ? <Divider /> : null}
            <ListItem testID={`template-${tpl.id}`} title={tpl.name} subtitle={tpl.description} onPress={() => router.push(`/program/template/${tpl.id}`)} />
          </View>
        ))}
      </Card>

      <SectionTitle>{t('train.library')}</SectionTitle>
      <Card style={{ paddingVertical: spacing.sm }}>
        <ListItem testID="open-exercises" icon="search-outline" title={t('train.exercises')} subtitle={t('train.exercises.sub')} onPress={() => router.push('/exercise')} />
      </Card>

      <SectionTitle action={data.history.length ? <Btn size="sm" variant="ghost" title={t('common.seeAll')} onPress={() => router.push('/workout/history')} testID="history-all" /> : undefined}>{t('train.history')}</SectionTitle>
      {data.history.length === 0 ? <Card><Empty icon="time-outline" title={t('train.noHistory.title')} body={t('train.noHistory.body')} /></Card> : (
        <Card style={{ paddingVertical: spacing.sm }}>
          {data.history.map((s, i) => (
            <View key={s.id}>
              {i > 0 ? <Divider /> : null}
              <ListItem testID={`history-${i}`} title={s.title} subtitle={`${formatDate(s.local_date)} · ${formatDuration(elapsedMs({ startedAt: s.started_at, endedAt: s.ended_at, pausedMs: s.paused_ms, pausedAt: null }, 0) / 1000)}`}
                value={t('train.historyValue', { sets: s.totals.workingSets, volume: fmt.num(fromKg(s.totals.volumeKg, fmt.wUnit)), unit: fmt.wUnit })} onPress={() => router.push(`/workout/summary/${s.id}`)} />
            </View>
          ))}
        </Card>
      )}
      {data.active ? <Row style={{ marginTop: spacing.md }}><Btn title={t('resume.title')} onPress={() => router.push('/workout/active')} style={{ flex: 1 }} /></Row> : null}
      <View style={{ height: spacing.lg }} />
    </Screen>
  );
}
