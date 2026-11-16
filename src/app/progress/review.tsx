import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';

import { useFeedback } from '@/components/feedback';
import { Btn, Card, Chip, Divider, Field, Icon, IconBtn, ListItem, Loading, Row, Screen, SectionTitle, Txt } from '@/components/ui';
import { addDays, weekStartOf } from '@/domain/time';
import { formatDate, t, type StringKey } from '@/i18n';
import { useApp, useLive } from '@/state/app';
import { useFmt } from '@/state/hooks';
import { loadWeeklyReview, type WeeklyReview } from '@/state/progress';
import { spacing } from '@/theme';
import { nowMs } from '@/domain/clock';

/** Weekly review: completed sessions, PRs, logging coverage and one explainable next step, plus the optional check-in. */
export default function Review() {
  const app = useApp();
  const fmt = useFmt();
  const router = useRouter();
  const current = weekStartOf(app.today, app.prefs.startOfWeek);
  const [week, setWeek] = useState(current);
  const { data } = useLive((a) => loadWeeklyReview(a, week), ['sessions', 'session_sets', 'scheduled_workouts', 'water_logs', 'sleep_logs', 'food_logs', 'checkins', 'progression_decisions', 'prefs'], [week]);
  const { prefs } = app;
  return (
    <Screen testID="weekly-review" title={t('review.title')} back>
      <Row>
        <IconBtn icon="chevron-back" label={t('review.prevWeek')} onPress={() => setWeek(addDays(week, -7))} />
        <Txt variant="bodyStrong" style={{ flex: 1, textAlign: 'center' }}>{t('review.range', { from: formatDate(week), to: formatDate(addDays(week, 6)) })}</Txt>
        <IconBtn icon="chevron-forward" label={t('review.nextWeek')} disabled={week >= current} onPress={() => setWeek(addDays(week, 7))} />
      </Row>
      {!data ? <Loading /> : (
        <>
          <Card testID="next-action" style={{ gap: spacing.sm, marginTop: spacing.md }}>
            <Row><Icon name="compass-outline" tone="primary" /><Txt variant="overline" tone="primary">{t('review.next')}</Txt></Row>
            <Txt variant="headline">{t(`next.${data.next.code}` as StringKey, data.next.evidence)}</Txt>
            <Txt variant="caption" tone="textMuted">{t(`next.${data.next.code}.why` as StringKey, data.next.evidence)}</Txt>
          </Card>
          <SectionTitle>{t('review.training')}</SectionTitle>
          <Card style={{ gap: spacing.sm }}>
            <Txt testID="review-adherence" variant="title">{data.adherence.eligible === 0 ? t('review.unscheduled') : t('review.adherence', { done: data.adherence.completed, total: data.adherence.eligible })}</Txt>
            {data.sessions.map((s) => <ListItem key={s.id} title={s.title} subtitle={formatDate(s.localDate)} onPress={() => router.push(`/workout/summary/${s.id}`)} />)}
            {data.sessions.length === 0 ? <Txt tone="textMuted">{t('review.noSessions')}</Txt> : null}
            {data.prs.length ? (
              <>
                <Divider />
                <Txt variant="bodyStrong">{t('summary.prs', { count: data.prs.length })}</Txt>
                {data.prs.map((p) => <Txt key={`${p.setId}${p.type}`} variant="label">{p.name}: {p.type === 'heaviest_load' ? fmt.weight(p.value) : p.type === 'most_reps_at_load' ? t('pr.repsAt', { reps: p.value, load: fmt.weight(p.atLoadKg!) }) : String(p.value)}</Txt>)}
              </>
            ) : null}
          </Card>
          <SectionTitle>{t('review.coverage')}</SectionTitle>
          <Card style={{ gap: 4 }}>
            {prefs.trackers.sleep ? <Txt>{t('review.cov.sleep', { n: data.coverage.sleep, days: data.daysElapsed })}</Txt> : null}
            {prefs.trackers.water ? <Txt>{t('review.cov.water', { n: data.coverage.water, days: data.daysElapsed })}</Txt> : null}
            {prefs.trackers.nutrition ? <Txt>{t('review.cov.nutrition', { n: data.coverage.nutrition, days: data.daysElapsed })}</Txt> : null}
            <Txt variant="caption" tone="textMuted">{t('review.covNote')}</Txt>
          </Card>
          <SectionTitle>{t('review.checkin')}</SectionTitle>
          <CheckinForm key={`${week}:${data.checkin?.energy}:${data.checkin?.soreness}:${data.checkin?.notes}`} week={week} existing={data.checkin} />
          <View style={{ height: spacing.xl }} />
        </>
      )}
    </Screen>
  );
}

function CheckinForm({ week, existing }: { week: string; existing: WeeklyReview['checkin'] }) {
  const app = useApp();
  const { toast } = useFeedback();
  const [energy, setEnergy] = useState<number | null>(existing?.energy ?? null);
  const [soreness, setSoreness] = useState<number | null>(existing?.soreness ?? null);
  const [notes, setNotes] = useState(existing?.notes ?? '');
  return (
    <Card style={{ gap: spacing.md }}>
      <Txt variant="label" tone="textMuted">{t('review.energy')}</Txt>
      <Row wrap gap={6}>{[1, 2, 3, 4, 5].map((n) => <Chip key={n} testID={`energy-${n}`} label={t(`scale.energy.${n}` as StringKey)} selected={energy === n} onPress={() => setEnergy(energy === n ? null : n)} />)}</Row>
      <Txt variant="label" tone="textMuted">{t('review.soreness')}</Txt>
      <Row wrap gap={6}>{[1, 2, 3, 4, 5].map((n) => <Chip key={n} testID={`soreness-${n}`} label={t(`scale.soreness.${n}` as StringKey)} selected={soreness === n} onPress={() => setSoreness(soreness === n ? null : n)} />)}</Row>
      <Field label={t('review.notes')} value={notes} onChangeText={setNotes} multiline maxLength={1000} />
      <Btn testID="checkin-save" title={existing ? t('review.updateCheckin') : t('review.saveCheckin')} onPress={async () => {
        await app.recovery.saveCheckin(week, { energy, soreness, notes }, nowMs(), app.tz);
        toast({ message: t('common.saved') });
      }} />
      <Txt variant="caption" tone="textMuted">{t('review.painNote')}</Txt>
    </Card>
  );
}
