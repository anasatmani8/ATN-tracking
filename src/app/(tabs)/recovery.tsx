import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';

import { Chart } from '@/components/chart';
import { useFeedback } from '@/components/feedback';
import { Btn, Card, Chip, Divider, Empty, Field, IconBtn, ListItem, Loading, ProgressBar, Row, Screen, SectionTitle, Txt } from '@/components/ui';
import { toSleepEntry } from '@/data/recovery';
import { averageOverLoggedDays, sleepDuration, sleepMinutesByWakeDate, sumByDay } from '@/domain/recovery';
import { addDays, dateRange, formatHoursMinutes } from '@/domain/time';
import { fromMl } from '@/domain/units';
import { formatDate, formatTime, t } from '@/i18n';
import { useApp, useLive } from '@/state/app';
import { errorText, useFmt } from '@/state/hooks';
import { spacing } from '@/theme';
import { nowMs } from '@/domain/clock';

export default function RecoveryTab() {
  const app = useApp();
  const fmt = useFmt();
  const router = useRouter();
  const { toast } = useFeedback();
  const [custom, setCustom] = useState('');
  const { prefs, today } = app;
  const from = addDays(today, -13);
  const { data } = useLive(async (a) => ({
    water: await a.recovery.listWater(from, today),
    sleep: await a.recovery.listSleep(from, today),
  }), ['water_logs', 'sleep_logs']);

  if (!prefs.trackers.water && !prefs.trackers.sleep) {
    return <Screen title={t('tab.recovery')}><Empty icon="moon-outline" title={t('tracker.hidden.title')} body={t('tracker.hidden.body')} action={<Btn title={t('tracker.enable')} onPress={() => void app.setPrefs({ trackers: { ...prefs.trackers, water: true, sleep: true } })} />} /></Screen>;
  }
  if (!data) return <Screen title={t('tab.recovery')}><Loading /></Screen>;

  const todayWater = data.water.filter((w) => w.local_date === today);
  const total = todayWater.reduce((a, w) => a + w.amount_ml, 0);
  const waterByDay = sumByDay(data.water, (w) => w.amount_ml, (w) => w.local_date);
  const days7 = dateRange(addDays(today, -6), today);
  const waterAvg = averageOverLoggedDays(new Map(days7.filter((d) => waterByDay.has(d)).map((d) => [d, waterByDay.get(d)!])), 7);
  const sleepByDay = sleepMinutesByWakeDate(data.sleep.map(toSleepEntry), prefs.sleepAvgIncludesNaps);
  const sleepAvg = averageOverLoggedDays(new Map(days7.filter((d) => sleepByDay.has(d)).map((d) => [d, sleepByDay.get(d)!])), 7);

  const add = async (ml: number) => {
    try {
      const id = await app.recovery.addWater(ml, today, nowMs(), app.tz);
      toast({ message: t('water.added', { amount: fmt.volume(ml) }), actionLabel: t('common.undo'), onAction: () => void app.recovery.removeWater(id) });
    } catch (e) {
      toast({ message: errorText(e), tone: 'error' });
    }
  };

  return (
    <Screen testID="recovery-screen" title={t('tab.recovery')} right={<Btn size="sm" variant="ghost" icon="notifications-outline" title={t('reminders.title')} onPress={() => router.push('/settings/reminders')} testID="open-reminders" />}>
      {prefs.trackers.water ? (
        <>
          <SectionTitle>{t('water.title')}</SectionTitle>
          <Card testID="water-card" style={{ gap: spacing.md }}>
            <Txt variant="metric" testID="water-total" accessibilityLabel={t('water.totalA11y', { amount: fmt.volume(total) })}>{prefs.targets.waterMl ? t('water.ofGoal', { total: fmt.volNum(total), goal: fmt.volume(prefs.targets.waterMl) }) : fmt.volume(total)}</Txt>
            {prefs.targets.waterMl ? <ProgressBar value={total} max={prefs.targets.waterMl} label={t('water.title')} /> : <Txt variant="caption" tone="textMuted">{t('water.noGoal')}</Txt>}
            <Row wrap>
              {prefs.waterPresetsMl.map((ml) => <Btn key={ml} testID={`rec-water-${ml}`} size="sm" variant="secondary" icon="add" title={fmt.volume(ml)} onPress={() => void add(ml)} />)}
            </Row>
            <Row>
              <Field style={{ flex: 1 }} testID="water-custom" label={t('water.custom')} suffix={fmt.volUnit} value={custom} onChangeText={setCustom} keyboardType="decimal-pad" />
              <Btn testID="water-custom-add" title={t('common.add')} disabled={!custom.trim()} onPress={() => { const ml = fmt.parseVolume(custom); if (ml == null) return toast({ message: t('err.invalid_amount'), tone: 'error' }); setCustom(''); void add(ml); }} style={{ alignSelf: 'flex-end' }} />
            </Row>
            {todayWater.length ? (
              <View>
                <Txt variant="overline" tone="textMuted">{t('water.todayEntries')}</Txt>
                {[...todayWater].reverse().map((w) => (
                  <ListItem key={w.id} title={fmt.volume(w.amount_ml)} subtitle={formatTime(w.logged_at, w.tz)} right={<IconBtn icon="trash-outline" label={t('water.removeA11y', { amount: fmt.volume(w.amount_ml) })} testID={`water-remove-${w.id}`} onPress={async () => {
                    await app.recovery.removeWater(w.id);
                    toast({ message: t('water.removed'), actionLabel: t('common.undo'), onAction: () => void app.recovery.addWater(w.amount_ml, w.local_date, w.logged_at, w.tz) });
                  }} />} />
                ))}
              </View>
            ) : null}
          </Card>
          <Card style={{ marginTop: spacing.md }}>
            <Chart testID="water-chart" title={t('water.last7')} points={days7.map((d) => ({ label: formatDate(d, { weekday: 'short' }), value: waterByDay.has(d) ? fromMl(waterByDay.get(d)!, prefs.volumeUnit) : null }))}
              format={(v) => `${fmt.num(v, prefs.volumeUnit === 'ml' ? 0 : 1)} ${fmt.volUnit}`}
              summary={waterAvg.average == null ? t('chart.noData') : t('water.avgSummary', { avg: fmt.volume(waterAvg.average), logged: waterAvg.loggedDays, days: 7 })} />
          </Card>
        </>
      ) : null}

      {prefs.trackers.sleep ? (
        <>
          <SectionTitle action={<Btn size="sm" variant="ghost" icon="add" title={t('sleep.log')} onPress={() => router.push(`/recovery/sleep?date=${today}`)} testID="sleep-add" />}>{t('sleep.title')}</SectionTitle>
          <Card style={{ gap: spacing.sm }}>
            <Chart testID="sleep-chart" title={t('sleep.last7')} points={days7.map((d) => ({ label: formatDate(d, { weekday: 'short' }), value: sleepByDay.has(d) ? sleepByDay.get(d)! / 60 : null }))}
              format={(v) => formatHoursMinutes(v * 60)}
              summary={sleepAvg.average == null ? t('chart.noData') : t('sleep.avgSummary', { avg: formatHoursMinutes(sleepAvg.average), logged: sleepAvg.loggedDays, days: 7 })} />
            <Txt variant="caption" tone="textMuted">{prefs.sleepAvgIncludesNaps ? t('sleep.avgWithNaps') : t('sleep.avgNoNaps')}</Txt>
            <Chip label={prefs.sleepAvgIncludesNaps ? t('sleep.excludeNaps') : t('sleep.includeNaps')} onPress={() => void app.setPrefs({ sleepAvgIncludesNaps: !prefs.sleepAvgIncludesNaps })} />
          </Card>
          <Card style={{ paddingVertical: spacing.sm, marginTop: spacing.md }}>
            {dateRange(from, today).reverse().map((d, i) => {
              const rows = data.sleep.filter((s) => s.wake_date === d);
              return (
                <View key={d}>
                  {i > 0 ? <Divider /> : null}
                  {rows.length === 0 ? (
                    <ListItem title={formatDate(d)} value={t('sleep.unlogged')} onPress={() => router.push(`/recovery/sleep?date=${d}`)} />
                  ) : rows.map((s) => {
                    const dur = sleepDuration(toSleepEntry(s));
                    return <ListItem key={s.id} testID={`sleep-${d}`} title={`${formatDate(d)}${s.kind === 'nap' ? ` · ${t('sleep.nap')}` : ''}`}
                      subtitle={[s.start_at && s.end_at ? `${formatTime(s.start_at, s.tz)}–${formatTime(s.end_at, s.tz)}` : t('sleep.manualDuration'), s.awake_min ? t('sleep.awakeN', { n: s.awake_min }) : null, s.quality ? t('sleep.qualityN', { n: s.quality }) : null].filter(Boolean).join(' · ')}
                      value={dur ? `${formatHoursMinutes(dur.minutes)}${dur.measure === 'time_in_bed' ? ` ${t('sleep.inBedShort')}` : ''}` : undefined} onPress={() => router.push(`/recovery/sleep?id=${s.id}`)} />;
                  })}
                </View>
              );
            })}
          </Card>
        </>
      ) : null}

      {prefs.trackers.body ? (
        <>
          <SectionTitle>{t('body.title')}</SectionTitle>
          <Card style={{ paddingVertical: spacing.sm }}><ListItem testID="open-body" icon="body-outline" title={t('body.open')} subtitle={t('body.sub')} onPress={() => router.push('/recovery/body')} /></Card>
        </>
      ) : null}
      <Txt variant="caption" tone="textMuted" style={{ marginTop: spacing.xl }}>{t('recovery.disclaimer')}</Txt>
    </Screen>
  );
}
