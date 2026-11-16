import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';

import { Chart } from '@/components/chart';
import { Btn, Card, Divider, Empty, ListItem, Loading, Row, Screen, SectionTitle, Segmented, Stat, Txt } from '@/components/ui';
import { fromKg } from '@/domain/units';
import { formatDuration, formatHoursMinutes } from '@/domain/time';
import { formatDate, t } from '@/i18n';
import { useApp, useLive } from '@/state/app';
import { useFmt } from '@/state/hooks';
import { loadProgress } from '@/state/progress';
import { spacing } from '@/theme';

export default function ProgressTab() {
  const app = useApp();
  const fmt = useFmt();
  const router = useRouter();
  const [range, setRange] = useState<7 | 30 | 90>(30);
  const { data } = useLive((a) => loadProgress(a, range), ['sessions', 'session_sets', 'scheduled_workouts', 'water_logs', 'sleep_logs', 'measurements', 'food_logs', 'prefs'], [range]);
  const { prefs } = app;
  return (
    <Screen testID="progress-screen" title={t('tab.progress')}>
      <Card testID="weekly-review-entry" onPress={() => router.push('/progress/review')} accessibilityLabel={t('review.title')}>
        <Row><View style={{ flex: 1 }}><Txt variant="headline">{t('review.title')}</Txt><Txt variant="caption" tone="textMuted">{t('review.entrySub')}</Txt></View><Txt tone="primary">›</Txt></Row>
      </Card>
      <View style={{ marginTop: spacing.lg }}>
        <Segmented label={t('progress.range')} value={range} onChange={setRange} options={[{ value: 7, label: t('range.7') }, { value: 30, label: t('range.30') }, { value: 90, label: t('range.90') }]} />
      </View>
      {!data ? <Loading /> : (
        <>
          <SectionTitle>{t('progress.training')}</SectionTitle>
          <Row gap={spacing.sm} style={{ alignItems: 'stretch' }}>
            <Stat label={t('progress.workouts')} value={fmt.num(data.sessionCount)} unit={t('progress.inDays', { n: range })} />
            <Stat label={t('progress.scheduledDone')} value={data.adherence.eligible ? `${data.adherence.completed}/${data.adherence.eligible}` : '–'} unit={data.adherence.eligible ? t('progress.ofScheduled') : t('progress.noneScheduled')} tone="success" />
          </Row>
          <Card style={{ marginTop: spacing.md, gap: spacing.md }}>
            <Chart testID="chart-frequency" title={t('progress.perWeek')} points={data.perWeek.map((w) => ({ label: formatDate(w.week, { month: 'short', day: 'numeric' }), value: w.sessions }))} format={(v) => t('progress.sessionsN', { count: v })}
              summary={t('progress.freqSummary', { total: data.sessionCount, weeks: data.perWeek.length })} />
            <Chart testID="chart-volume-week" title={t('progress.volumeWeek', { unit: fmt.wUnit })} points={data.perWeek.map((w) => ({ label: formatDate(w.week, { month: 'short', day: 'numeric' }), value: w.volumeKg > 0 ? fromKg(w.volumeKg, fmt.wUnit) : null }))}
              format={(v) => `${fmt.num(v)} ${fmt.wUnit}`} summary={t('progress.volumeSummary')} />
          </Card>
          <SectionTitle>{t('progress.bests')}</SectionTitle>
          {data.records.length === 0 ? <Card><Empty icon="trophy-outline" title={t('progress.noBests')} body={t('progress.noBestsBody')} /></Card> : (
            <Card style={{ paddingVertical: spacing.sm }}>
              {data.records.slice(0, 12).map((r, i) => (
                <View key={`${r.exerciseId}-${r.type}`}>
                  {i > 0 ? <Divider /> : null}
                  <ListItem title={r.name} value={r.type === 'heaviest_load' ? fmt.weight(r.value) : r.type === 'most_reps' ? t('workout.reps', { count: r.value }) : formatDuration(r.value)} onPress={() => router.push(`/exercise/${r.exerciseId}`)} />
                </View>
              ))}
            </Card>
          )}
          {data.recentPrs.length ? <Txt variant="caption" tone="textMuted" style={{ marginTop: spacing.sm }}>{t('progress.recentPrs', { count: data.recentPrs.length, n: range })}</Txt> : null}
          <SectionTitle>{t('progress.lifts')}</SectionTitle>
          {data.lifts.length === 0 ? <Txt tone="textMuted">{t('progress.noLifts')}</Txt> : (
            <Card style={{ paddingVertical: spacing.sm }}>
              {data.lifts.slice(0, 15).map((l, i) => (
                <View key={l.id}>
                  {i > 0 ? <Divider /> : null}
                  <ListItem testID={`lift-${i}`} title={l.name} subtitle={t('progress.sessionsN', { count: l.sessions })} value={l.volumeKg > 0 ? `${fmt.num(fromKg(l.volumeKg, fmt.wUnit))} ${fmt.wUnit}` : undefined} onPress={() => router.push(`/exercise/${l.id}`)} />
                </View>
              ))}
            </Card>
          )}
          {prefs.trackers.water || prefs.trackers.sleep ? <SectionTitle>{t('progress.recovery')}</SectionTitle> : null}
          <Row gap={spacing.sm} style={{ alignItems: 'stretch' }}>
            {prefs.trackers.water ? <Stat label={t('progress.waterAvg')} value={data.water.avg.average == null ? '–' : fmt.volume(data.water.avg.average)} unit={t('progress.loggedDays', { logged: data.water.avg.loggedDays, days: range })} /> : null}
            {prefs.trackers.sleep ? <Stat label={t('progress.sleepAvg')} value={data.sleep.avg.average == null ? '–' : formatHoursMinutes(data.sleep.avg.average)} unit={t('progress.loggedDays', { logged: data.sleep.avg.loggedDays, days: range })} tone="violet" /> : null}
          </Row>
          {prefs.trackers.sleep ? <Txt variant="caption" tone="textMuted" style={{ marginTop: spacing.xs }}>{prefs.sleepAvgIncludesNaps ? t('sleep.avgWithNaps') : t('sleep.avgNoNaps')}</Txt> : null}
          {prefs.trackers.body ? (
            <>
              <SectionTitle action={<Btn size="sm" variant="ghost" title={t('common.open')} onPress={() => router.push('/recovery/body')} />}>{t('body.title')}</SectionTitle>
              <Card>
                {data.weights.length ? <Txt>{t('progress.latestWeight', { value: fmt.weight(data.weights.at(-1)!.value), date: formatDate(data.weights.at(-1)!.local_date), count: data.weights.length })}</Txt> : <Txt tone="textMuted">{t('body.none')}</Txt>}
              </Card>
            </>
          ) : null}
          {prefs.trackers.nutrition ? <Txt variant="caption" tone="textMuted" style={{ marginTop: spacing.lg }}>{t('progress.nutritionDays', { logged: data.nutritionDays, days: range })}</Txt> : null}
        </>
      )}
    </Screen>
  );
}
