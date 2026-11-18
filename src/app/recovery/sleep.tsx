import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import { useFeedback } from '@/components/feedback';
import { Banner, Btn, Card, Chip, Empty, Field, Loading, Row, Screen, Segmented, Toggle, Txt } from '@/components/ui';
import { sleepDuration, validateSleep } from '@/domain/recovery';
import { addDays, formatHoursMinutes, isValidDate, isValidTime, localTimeOf, zonedToInstant, type Disambiguation } from '@/domain/time';
import { formatDate, t, type StringKey } from '@/i18n';
import { useApp } from '@/state/app';
import { errorText } from '@/state/hooks';
import { spacing } from '@/theme';
import { nowMs } from '@/domain/clock';

/**
 * Sleep log. Times are wall-clock in the zone of the night; nonexistent or repeated
 * times around DST changes are resolved explicitly. Overnight sleep belongs to the wake date.
 */
export default function SleepEditor() {
  const p = useLocalSearchParams<{ id?: string; date?: string }>();
  const app = useApp();
  const router = useRouter();
  const { toast, confirm } = useFeedback();
  const [loading, setLoading] = useState(!!p.id);
  const [missing, setMissing] = useState(false);
  const [tz, setTz] = useState(app.tz);
  const [kind, setKind] = useState<'night' | 'nap'>('night');
  const [mode, setMode] = useState<'times' | 'duration'>('times');
  const [wakeDate, setWakeDate] = useState(p.date && isValidDate(p.date) ? p.date : app.today);
  const [bed, setBed] = useState('23:00');
  const [wake, setWake] = useState('07:00');
  const [hours, setHours] = useState('');
  const [awake, setAwake] = useState('');
  const [asleep, setAsleep] = useState(false);
  const [quality, setQuality] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [bedFold, setBedFold] = useState<Disambiguation>('earlier');
  const [wakeFold, setWakeFold] = useState<Disambiguation>('earlier');

  useEffect(() => {
    if (!p.id) return;
    app.recovery.getSleep(p.id).then((s) => {
      setLoading(false);
      if (!s) return setMissing(true);
      setTz(s.tz);
      setKind(s.kind);
      setWakeDate(s.wake_date);
      if (s.start_at != null && s.end_at != null) {
        setMode('times');
        setBed(localTimeOf(s.start_at, s.tz));
        setWake(localTimeOf(s.end_at, s.tz));
      } else {
        setMode('duration');
        setHours(String(Math.round(((s.manual_duration_min ?? 0) / 60) * 100) / 100));
      }
      setAwake(s.awake_min ? String(s.awake_min) : '');
      setAsleep(s.confirmed_asleep === 1);
      setQuality(s.quality);
      setNotes(s.notes);
    });
  }, [p.id, app.recovery]);

  // A night that ends in the morning started the evening before; a nap or late bedtime after midnight is the same day.
  const computed = useMemo(() => {
    if (mode !== 'times' || !isValidTime(bed) || !isValidTime(wake)) return null;
    const startDate = bed > wake ? addDays(wakeDate, -1) : wakeDate;
    const s = zonedToInstant(startDate, bed, tz, bedFold);
    const e = zonedToInstant(wakeDate, wake, tz, wakeFold);
    return { s, e };
  }, [mode, bed, wake, wakeDate, tz, bedFold, wakeFold]);

  const awakeMin = awake.trim() === '' ? null : /^\d+$/.test(awake.trim()) ? Number(awake) : NaN;
  const manualMin = mode === 'duration' && hours.trim() ? Math.round(Number(hours.replace(',', '.')) * 60) : null;
  const input = { startAt: computed?.s.ms ?? null, endAt: computed?.e.ms ?? null, manualDurationMin: mode === 'duration' ? manualMin : null, awakeMin: Number.isNaN(awakeMin) ? -1 : awakeMin, confirmedAsleep: asleep };
  const err = validateSleep(input, nowMs());
  const dur = !err ? sleepDuration(input) : null;

  if (loading) return <Screen title={t('sleep.title')} back><Loading /></Screen>;
  if (missing) return <Screen title={t('sleep.title')} back><Empty icon="alert-circle-outline" title={t('fallback.missing.title')} body={t('fallback.missing.body')} action={<Btn title={t('sleep.logNew')} onPress={() => router.replace(`/recovery/sleep?date=${app.today}`)} />} /></Screen>;

  const save = async () => {
    try {
      await app.recovery.saveSleep({ id: p.id, kind, tz, wakeDate, startAt: mode === 'times' ? input.startAt : null, endAt: mode === 'times' ? input.endAt : null, manualDurationMin: input.manualDurationMin, awakeMin: input.awakeMin, confirmedAsleep: asleep, quality, notes }, nowMs());
      toast({ message: t('common.saved') });
      router.back();
    } catch (e) {
      toast({ message: errorText(e), tone: 'error' });
    }
  };

  return (
    <Screen testID="sleep-editor" title={p.id ? t('sleep.edit') : t('sleep.log')} subtitle={t('sleep.wakeOn', { date: formatDate(wakeDate) })} back footer={<Btn testID="sleep-save" title={t('common.save')} disabled={!!err} onPress={() => void save()} />}>
      <View style={{ gap: spacing.lg }}>
        <Segmented label={t('sleep.kind')} value={kind} onChange={setKind} options={[{ value: 'night', label: t('sleep.night') }, { value: 'nap', label: t('sleep.nap') }]} />
        <View style={{ gap: spacing.xs }}>
          <Txt variant="label" tone="textMuted">{t('sleep.wakeDate')}</Txt>
          <Row>
            <Btn size="sm" variant="outline" icon="chevron-back" title="" accessibilityLabel={t('date.prev')} onPress={() => setWakeDate(addDays(wakeDate, -1))} />
            <Txt variant="bodyStrong" style={{ flex: 1, textAlign: 'center' }}>{formatDate(wakeDate, { weekday: 'long', month: 'short', day: 'numeric' })}</Txt>
            <Btn size="sm" variant="outline" icon="chevron-forward" title="" accessibilityLabel={t('date.next')} disabled={wakeDate >= app.today} onPress={() => setWakeDate(addDays(wakeDate, 1))} />
          </Row>
        </View>
        <Segmented label={t('sleep.entryMode')} value={mode} onChange={setMode} options={[{ value: 'times', label: t('sleep.mode.times') }, { value: 'duration', label: t('sleep.mode.duration') }]} />
        {mode === 'times' ? (
          <>
            <Row>
              <Field testID="sleep-bed" style={{ flex: 1 }} label={kind === 'nap' ? t('sleep.start') : t('sleep.bedtime')} value={bed} onChangeText={setBed} placeholder="23:30" keyboardType="numbers-and-punctuation" maxLength={5} hint="HH:MM" />
              <Field testID="sleep-wake" style={{ flex: 1 }} label={kind === 'nap' ? t('sleep.end') : t('sleep.wakeTime')} value={wake} onChangeText={setWake} placeholder="07:00" keyboardType="numbers-and-punctuation" maxLength={5} hint="HH:MM" />
            </Row>
            {computed?.s.kind === 'gap' || computed?.e.kind === 'gap' ? <Banner tone="warning" icon="time-outline" text={t('sleep.dstGap')} /> : null}
            {computed?.s.kind === 'ambiguous' ? <View style={{ gap: 6 }}><Txt variant="label">{t('sleep.dstRepeatBed')}</Txt><Row><Chip label={t('sleep.dstFirst')} selected={bedFold === 'earlier'} onPress={() => setBedFold('earlier')} /><Chip label={t('sleep.dstSecond')} selected={bedFold === 'later'} onPress={() => setBedFold('later')} /></Row></View> : null}
            {computed?.e.kind === 'ambiguous' ? <View style={{ gap: 6 }}><Txt variant="label">{t('sleep.dstRepeatWake')}</Txt><Row><Chip label={t('sleep.dstFirst')} selected={wakeFold === 'earlier'} onPress={() => setWakeFold('earlier')} /><Chip label={t('sleep.dstSecond')} selected={wakeFold === 'later'} onPress={() => setWakeFold('later')} /></Row></View> : null}
            <Field testID="sleep-awake" label={t('sleep.awake')} suffix="min" value={awake} onChangeText={setAwake} keyboardType="number-pad" hint={t('sleep.awakeHint')} />
            {awake.trim() === '' ? <Toggle testID="sleep-confirm" label={t('sleep.confirmAsleep')} hint={t('sleep.confirmAsleepHint')} value={asleep} onChange={setAsleep} /> : null}
          </>
        ) : (
          <Field testID="sleep-hours" label={t('sleep.hours')} suffix="h" value={hours} onChangeText={setHours} keyboardType="decimal-pad" hint={t('sleep.hoursHint')} />
        )}
        <Card testID="sleep-result" style={{ gap: 4 }}>
          {err ? <Txt tone="danger">{t(`err.${err}` as StringKey)}</Txt> : dur ? (
            <>
              <Txt variant="metric">{formatHoursMinutes(dur.minutes)}</Txt>
              <Txt variant="caption" tone="textMuted">{dur.measure === 'sleep' ? t('sleep.measure.sleepLong') : t('sleep.measure.inBedLong')}</Txt>
            </>
          ) : null}
          <Txt variant="caption" tone="textMuted">{t('sleep.tzNote', { tz })}</Txt>
        </Card>
        <View style={{ gap: spacing.xs }}>
          <Txt variant="label" tone="textMuted">{t('sleep.quality')}</Txt>
          <Row wrap gap={6}>{[1, 2, 3, 4, 5].map((n) => <Chip key={n} label={t(`sleep.q${n}` as StringKey)} selected={quality === n} onPress={() => setQuality(quality === n ? null : n)} />)}</Row>
        </View>
        <Field label={t('sleep.notes')} value={notes} onChangeText={setNotes} multiline maxLength={1000} />
        {p.id ? <Btn variant="danger" title={t('common.delete')} onPress={async () => { if (await confirm({ title: t('sleep.delete'), destructive: true, confirmLabel: t('common.delete') })) { await app.recovery.removeSleep(p.id!); router.back(); } }} /> : null}
        <Txt variant="caption" tone="textMuted">{t('recovery.disclaimer')}</Txt>
      </View>
    </Screen>
  );
}
