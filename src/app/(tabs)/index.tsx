import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DateNav } from '@/components/date-nav';
import { useFeedback } from '@/components/feedback';
import { useTheme } from '@/components/theme-context';
import { Banner, Btn, Card, Chip, Icon, Loading, ProgressBar, Row, Sheet, Txt, type IconName } from '@/components/ui';
import { addDays, formatHoursMinutes } from '@/domain/time';
import { formatDate, t } from '@/i18n';
import { useApp, useLive } from '@/state/app';
import { errorText, useFmt } from '@/state/hooks';
import { DAY_TABLES, loadDay } from '@/state/today';
import { radius, spacing, type } from '@/theme';
import { nowMs } from '@/domain/clock';

function HabitRow({ icon, title, value, status, done, children }: { icon: IconName; title: string; value: string; status: string; done: boolean; children: React.ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={{ gap: spacing.sm }}>
      <Row gap={spacing.md}>
        <View style={{ width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: done ? c.primary : c.border, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} size={20} tone={done ? 'primary' : 'textMuted'} />
        </View>
        <View style={{ flex: 1 }} accessible accessibilityLabel={`${title}. ${value}. ${status}`}>
          <Txt variant="bodyStrong">{title}</Txt>
          <Txt variant="num">{value}</Txt>
          <Row gap={4}>
            {done ? <Icon name="checkmark-circle" size={14} tone="success" /> : null}
            <Txt variant="caption" tone={done ? 'success' : 'textMuted'}>{status}</Txt>
          </Row>
        </View>
      </Row>
      <Row wrap gap={spacing.sm} style={{ paddingLeft: 56 }}>{children}</Row>
    </View>
  );
}

export default function Today() {
  const app = useApp();
  const { c } = useTheme();
  const fmt = useFmt();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { toast } = useFeedback();
  const [date, setDate] = useState(app.today);
  const [moveOpen, setMoveOpen] = useState(false);
  const { data: day } = useLive((a) => loadDay(a, date), DAY_TABLES, [date]);
  const { prefs, today } = app;
  const isToday = date === today;
  const appName = (Constants.expoConfig?.name ?? 'Kinset').replace(/ \(.*\)$/, '');

  const addWater = async (ml: number) => {
    try {
      const id = await app.recovery.addWater(ml, date, nowMs(), app.tz);
      toast({ message: t('water.added', { amount: fmt.volume(ml) }), actionLabel: t('common.undo'), onAction: () => void app.recovery.removeWater(id) });
    } catch (e) {
      toast({ message: errorText(e), tone: 'error' });
    }
  };

  const p = day?.progress;
  const sched = day?.scheduled ?? null;

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }} testID="today-screen">
      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl }}>
        <View style={{ backgroundColor: c.primary, paddingTop: insets.top + spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl + spacing.lg }}>
          <View style={{ maxWidth: 640, width: '100%', alignSelf: 'center', gap: spacing.sm }}>
            <Row>
              <Text accessibilityRole="header" style={[type.title, { color: c.onPrimary, flex: 1 }]}>{appName}</Text>
              <Pressable testID="open-settings" accessibilityRole="button" accessibilityLabel={t('settings.entry')} onPress={() => router.push('/settings')}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: spacing.md, borderRadius: radius.full, borderWidth: 1, borderColor: c.onPrimary, opacity: pressed ? 0.7 : 1 })}>
                <Icon name="person-circle-outline" size={20} tone="onPrimary" />
                <Text style={[type.label, { color: c.onPrimary }]}>{t('settings.entry')}</Text>
              </Pressable>
            </Row>
            <DateNav date={date} today={today} onChange={setDate} allowFuture onBrand />
            <View accessible accessibilityLabel={p && p.total > 0 ? t('today.progress.a11y', { done: p.done, total: p.total }) : t('today.progress.none')}>
              {p && p.total > 0 ? (
                <Text testID="daily-progress" style={[type.display, { color: c.onPrimary }]}>{t('today.progress', { done: p.done, total: p.total })}</Text>
              ) : (
                <Text testID="daily-progress" style={[type.headline, { color: c.onPrimary }]}>{day ? t('today.progress.none') : ' '}</Text>
              )}
              <Text style={[type.caption, { color: c.onPrimary }]}>{formatDate(date, { weekday: 'long', month: 'long', day: 'numeric' })}</Text>
            </View>
          </View>
        </View>

        <View style={{ marginTop: -spacing.xxl, paddingHorizontal: spacing.lg, gap: spacing.md, maxWidth: 640, width: '100%', alignSelf: 'center' }}>
          {app.isDemo ? <Banner icon="flask-outline" text={t('demo.banner')} action={<Btn size="sm" variant="outline" title={t('demo.exit')} onPress={() => void app.exitDemo()} testID="exit-demo" />} /> : null}
          {app.sync.status && app.sync.status.conflicts > 0 ? <Banner tone="warning" icon="git-compare-outline" text={t('sync.conflictBanner', { count: app.sync.status.conflicts })} action={<Btn size="sm" variant="outline" title={t('sync.review')} onPress={() => router.push('/settings/account')} />} /> : null}
          {app.sync.status && (app.sync.status.stuck > 0 || app.sync.status.failed > 0) ? <Banner tone="danger" icon="cloud-offline-outline" text={t('sync.stuckBanner')} action={<Btn size="sm" variant="outline" title={t('sync.review')} onPress={() => router.push('/settings/account')} />} /> : null}

          {!day ? <Card><Loading /></Card> : (
            <>
              <Card testID="workout-card" style={{ gap: spacing.md }}>
                <Row>
                  <Icon name="barbell-outline" size={18} tone="violet" />
                  <Txt variant="overline" tone="textMuted">{t('today.workout')}</Txt>
                </Row>
                {day.active ? (
                  <>
                    <Txt variant="title">{day.active.title}</Txt>
                    <Txt tone="textMuted">{t('today.workout.inProgress')}</Txt>
                    <Btn testID="today-resume" size="lg" icon="play" title={t('resume.title')} onPress={() => router.push('/workout/active')} />
                  </>
                ) : sched?.status === 'completed' || (!sched && day.completedSession) ? (
                  <>
                    <Txt variant="title">{day.completedSession?.title ?? sched?.title}</Txt>
                    <Row gap={6}><Icon name="checkmark-circle" size={18} tone="success" /><Txt tone="success">{t('today.workout.done')}</Txt></Row>
                    {day.completedSession ? <Btn variant="secondary" title={t('today.workout.viewSummary')} onPress={() => router.push(`/workout/summary/${day.completedSession!.id}`)} /> : null}
                  </>
                ) : sched?.status === 'skipped' ? (
                  <>
                    <Txt variant="title">{sched.title}</Txt>
                    <Txt tone="textMuted">{t('today.workout.skipped')}</Txt>
                    <Btn variant="outline" title={t('today.workout.unskip')} onPress={() => void app.training.setScheduledStatus(sched.id, 'planned')} />
                  </>
                ) : sched ? (
                  <>
                    <Txt variant="title">{sched.title}</Txt>
                    <Txt tone="textMuted">{date < today ? t('today.workout.missed') : isToday ? t('today.workout.planned') : t('today.workout.upcoming')}</Txt>
                    {isToday ? <Btn testID="today-start" size="lg" icon="play" title={t('workout.start')} onPress={() => router.push(`/workout/preview?scheduledId=${encodeURIComponent(sched.id)}`)} />
                      : <Btn variant="secondary" title={t('workout.preview')} onPress={() => router.push(`/workout/preview?scheduledId=${encodeURIComponent(sched.id)}`)} />}
                    <Btn testID="today-move" variant="ghost" title={t('today.workout.moveOrSkip')} onPress={() => setMoveOpen(true)} />
                  </>
                ) : (
                  <>
                    <Txt variant="title">{t('today.rest.title')}</Txt>
                    <Txt tone="textMuted">{t('today.rest.body')}</Txt>
                    {isToday ? (
                      <Row wrap>
                        <Btn testID="today-start-empty" variant="secondary" icon="add" title={t('workout.startEmpty')} onPress={() => router.push('/workout/preview')} />
                        <Btn variant="ghost" title={t('today.rest.plans')} onPress={() => router.push('/train')} />
                      </Row>
                    ) : null}
                  </>
                )}
              </Card>

              {day.checkinDue ? (
                <Card testID="checkin-card" onPress={() => router.push('/progress/review')} accessibilityLabel={t('today.checkin.a11y', { status: day.checkin ? t('today.checkin.done') : t('today.checkin.open') })}>
                  <Row gap={spacing.md}>
                    <Icon name="clipboard-outline" tone="primary" />
                    <View style={{ flex: 1 }}>
                      <Txt variant="bodyStrong">{t('today.checkin.title')}</Txt>
                      <Txt variant="caption" tone={day.checkin ? 'success' : 'textMuted'}>{day.checkin ? t('today.checkin.done') : t('today.checkin.open')}</Txt>
                    </View>
                    <Icon name={day.checkin ? 'checkmark-circle' : 'add-circle-outline'} tone={day.checkin ? 'success' : 'primary'} />
                  </Row>
                </Card>
              ) : null}

              {prefs.trackers.water || prefs.trackers.sleep || prefs.trackers.nutrition ? (
                <Card style={{ gap: spacing.lg }}>
                  <Row><Icon name="leaf-outline" size={18} tone="primary" /><Txt variant="overline" tone="textMuted">{t('today.daily')}</Txt></Row>
                  {prefs.trackers.water ? (
                    <View style={{ gap: spacing.sm }}>
                      <HabitRow icon="water-outline" title={t('water.title')} done={!!prefs.targets.waterMl && day.waterMl >= prefs.targets.waterMl}
                        value={prefs.targets.waterMl ? t('water.ofGoal', { total: fmt.volNum(day.waterMl), goal: fmt.volume(prefs.targets.waterMl) }) : fmt.volume(day.waterMl)}
                        status={prefs.targets.waterMl ? (day.waterMl >= prefs.targets.waterMl ? t('status.goalMet') : t('water.remaining', { amount: fmt.volume(prefs.targets.waterMl - day.waterMl) })) : day.waterMl > 0 ? t('status.logged') : t('status.notLogged')}>
                        {prefs.waterPresetsMl.slice(0, 3).map((ml) => (
                          <Chip key={ml} testID={`water-add-${ml}`} icon="add" label={fmt.volume(ml)} onPress={() => void addWater(ml)} />
                        ))}
                      </HabitRow>
                      {prefs.targets.waterMl ? <View style={{ paddingLeft: 56 }}><ProgressBar value={day.waterMl} max={prefs.targets.waterMl} label={t('water.title')} /></View> : null}
                    </View>
                  ) : null}
                  {prefs.trackers.sleep ? (
                    <HabitRow icon="bed-outline" title={isToday ? t('sleep.lastNight') : t('sleep.night')} done={!!prefs.targets.sleepMin && (day.night?.duration?.minutes ?? 0) >= prefs.targets.sleepMin}
                      value={day.night?.duration ? `${formatHoursMinutes(day.night.duration.minutes)} · ${day.night.duration.measure === 'sleep' ? t('sleep.measure.sleep') : t('sleep.measure.inBed')}` : t('status.notLogged')}
                      status={day.night?.duration ? (prefs.targets.sleepMin ? (day.night.duration.minutes >= prefs.targets.sleepMin ? t('status.goalMet') : t('sleep.goal', { goal: formatHoursMinutes(prefs.targets.sleepMin) })) : t('status.logged')) : t('sleep.unlogged')}>
                      <Chip testID="sleep-log" icon={day.night ? 'create-outline' : 'add'} label={day.night ? t('common.edit') : t('sleep.log')} onPress={() => router.push(day.night ? `/recovery/sleep?id=${day.night.id}` : `/recovery/sleep?date=${date}`)} />
                    </HabitRow>
                  ) : null}
                  {prefs.trackers.nutrition ? (
                    <HabitRow icon="restaurant-outline" title={t('nutrition.meals')} done={false}
                      value={day.meals.length === 0 ? t('status.notLogged') : prefs.hideNutritionNumbers ? t('nutrition.entries', { count: day.meals.length }) : `${fmt.num(day.nutrition.kcal)} kcal${day.nutrition.partial.kcal ? ` ${t('nutrition.partialShort')}` : ''}`}
                      status={day.plannedMeals > 0 ? t('nutrition.plannedLeft', { count: day.plannedMeals }) : day.meals.length ? t('nutrition.entries', { count: day.meals.length }) : t('nutrition.noneToday')}>
                      <Chip testID="meal-add" icon="add" label={t('nutrition.addFood')} onPress={() => router.push(`/nutrition/add?date=${date}`)} />
                      {day.plannedMeals > 0 ? <Chip label={t('nutrition.viewPlan')} onPress={() => router.push('/nutrition')} /> : null}
                    </HabitRow>
                  ) : null}
                </Card>
              ) : (
                <Card><Txt tone="textMuted">{t('today.noTrackers')}</Txt><Btn variant="ghost" title={t('settings.trackers')} onPress={() => router.push('/settings')} /></Card>
              )}
            </>
          )}
        </View>
      </ScrollView>

      <Sheet visible={moveOpen} onClose={() => setMoveOpen(false)} title={t('today.move.title')} testID="move-sheet">
        <Txt tone="textMuted">{t('today.move.body')}</Txt>
        <Row wrap>
          {[1, 2, 3, 4, 5, 6, 7].map((n) => {
            const d = addDays(date > today ? date : today, n);
            return <Chip key={d} testID={`move-${n}`} label={formatDate(d)} onPress={() => { if (sched) void app.training.reschedule(sched.id, d); setMoveOpen(false); toast({ message: t('today.move.done', { date: formatDate(d) }) }); }} />;
          })}
        </Row>
        {date < today && sched ? <Btn variant="secondary" title={t('today.move.toToday')} onPress={() => { void app.training.reschedule(sched.id, today); setMoveOpen(false); setDate(today); }} /> : null}
        <Btn testID="skip-workout" variant="outline" title={t('today.move.skip')} onPress={() => { if (sched) void app.training.setScheduledStatus(sched.id, 'skipped'); setMoveOpen(false); }} />
        <Btn variant="danger" title={t('today.move.cancel')} onPress={() => { if (sched) void app.training.setScheduledStatus(sched.id, 'cancelled'); setMoveOpen(false); }} />
      </Sheet>
    </View>
  );
}
