import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useFeedback } from '@/components/feedback';
import { useTheme } from '@/components/theme-context';
import { Btn, Card, Empty, IconBtn, Loading, Row, Txt } from '@/components/ui';
import { builtinExercise } from '@/data/catalog/exercises';
import { formatDate, t } from '@/i18n';
import { useApp, useLive } from '@/state/app';
import { errorText, useFmt } from '@/state/hooks';
import { radius, spacing, type } from '@/theme';
import { targetLabel } from '@/screens/workout/format';
import { nowMs } from '@/domain/clock';

/** Ordered exercise list with targets; the Start action stays visible without covering the list. */
export default function WorkoutPreview() {
  const app = useApp();
  const { c } = useTheme();
  const fmt = useFmt();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { toast } = useFeedback();
  const params = useLocalSearchParams<{ scheduledId?: string; programId?: string; dayId?: string }>();
  const [busy, setBusy] = useState(false);
  const { data } = useLive(async (a) => {
    const sched = params.scheduledId ? await a.training.getScheduled(params.scheduledId) : null;
    const plan = await a.training.planDay(sched?.program_id ?? params.programId ?? null, sched?.day_id ?? params.dayId ?? null);
    return { sched, plan, missing: !!params.scheduledId && !sched, active: await a.training.getActiveSession() };
  }, ['scheduled_workouts', 'programs', 'sessions'], [params.scheduledId, params.programId, params.dayId]);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const start = async () => {
    setBusy(true);
    try {
      await app.training.startSession({ scheduledId: data?.sched?.id, programId: params.programId, dayId: params.dayId, title: t('workout.emptyTitle') }, nowMs(), app.tz);
      router.replace('/workout/active');
    } catch (e) {
      toast({ message: errorText(e), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const title = data?.plan?.day.name ?? data?.sched?.title ?? t('workout.emptyTitle');
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }} testID="workout-preview">
      <LinearGradient colors={[c.heroA, c.heroB, c.heroC]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ paddingTop: insets.top + spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, borderBottomLeftRadius: radius.xl, borderBottomRightRadius: radius.xl }}>
        <Row style={{ justifyContent: 'flex-end' }}><IconBtn icon="close" label={t('common.close')} onPress={close} tone="onViolet" filled testID="preview-close" /></Row>
        <Text accessibilityRole="header" style={[type.display, { color: '#fff', marginTop: spacing.xl }]}>{title}</Text>
        <Text style={[type.label, { color: '#fff' }]}>
          {[data?.plan?.program.name, data?.sched ? formatDate(data.sched.local_date) : null, data?.plan ? t('program.estMin', { n: data.plan.day.estMinutes }) : null].filter(Boolean).join(' · ')}
        </Text>
      </LinearGradient>
      {!data ? <Loading /> : data.missing ? (
        <Empty icon="alert-circle-outline" title={t('fallback.missing.title')} body={t('fallback.missing.body')} action={<Btn title={t('fallback.goToday')} onPress={() => router.replace('/')} />} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm, paddingBottom: 120, maxWidth: 640, width: '100%', alignSelf: 'center' }}>
          {data.active ? <Card><Txt>{t('preview.activeExists', { title: data.active.title })}</Txt></Card> : null}
          {data.plan ? data.plan.day.exercises.map((x, i) => {
            const ex = builtinExercise(x.exerciseId);
            return (
              <Card key={x.slotId} style={{ paddingVertical: spacing.md }}>
                <Row gap={spacing.md}>
                  <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: c.violetSoft, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={[type.label, { color: c.violet }]}>{i + 1}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Txt variant="bodyStrong">{ex?.name ?? x.exerciseId}</Txt>
                    <Txt variant="caption" tone="textMuted">{targetLabel(x.sets, x.repMin, x.repMax, x.durationSec)} · {t('workout.restSec', { n: x.restSec })}</Txt>
                  </View>
                </Row>
              </Card>
            );
          }) : <Txt tone="textMuted">{t('preview.empty')}</Txt>}
          {data.plan?.day.exercises.length === 0 ? <Txt tone="textMuted">{t('preview.noExercises')}</Txt> : null}
          <Txt variant="caption" tone="textMuted" style={{ marginTop: spacing.sm }}>{t('preview.units', { unit: fmt.wUnit })}</Txt>
        </ScrollView>
      )}
      {data && !data.missing ? (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.xl, paddingBottom: Math.max(insets.bottom, spacing.lg), paddingTop: spacing.md, backgroundColor: c.bg }}>
          <Btn testID="preview-start" size="lg" variant="ink" icon="play" loading={busy} title={data.active ? t('resume.title') : t('workout.start')} onPress={() => (data.active ? router.replace('/workout/active') : void start())} style={{ maxWidth: 420, alignSelf: 'center', width: '100%' }} />
        </View>
      ) : null}
    </View>
  );
}
