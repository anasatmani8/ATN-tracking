import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';

import { useTheme } from '@/components/theme-context';
import { Btn, Card, Chip, Icon, Row, Screen, Segmented, Toggle, Txt } from '@/components/ui';
import { defaultWeekdays, suggestTemplate, templateById, type PlanAnswers } from '@/data/catalog/programs';
import { t, weekdayName, type StringKey } from '@/i18n';
import { useApp } from '@/state/app';
import { cloudEnabled } from '@/sync/cloud';
import { spacing } from '@/theme';

type Choice<T> = { value: T; label: StringKey };
const GOALS: Choice<NonNullable<PlanAnswers['goal']>>[] = [
  { value: 'strength', label: 'onb.goal.strength' }, { value: 'muscle', label: 'onb.goal.muscle' }, { value: 'general', label: 'onb.goal.general' }, { value: 'consistency', label: 'onb.goal.consistency' },
];
const EXPERIENCE: Choice<NonNullable<PlanAnswers['experience']>>[] = [{ value: 'new', label: 'onb.exp.new' }, { value: 'some', label: 'onb.exp.some' }, { value: 'experienced', label: 'onb.exp.experienced' }];
const EQUIPMENT: Choice<NonNullable<PlanAnswers['equipment']>>[] = [{ value: 'gym', label: 'onb.eq.gym' }, { value: 'home_dumbbell', label: 'onb.eq.home' }, { value: 'bodyweight', label: 'onb.eq.bodyweight' }];

function Options<T extends string | number>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T | null; onChange: (v: T | null) => void }) {
  return (
    <Row wrap>
      {options.map((o) => <Chip key={String(o.value)} testID={`opt-${o.value}`} label={o.label} selected={value === o.value} onPress={() => onChange(value === o.value ? null : o.value)} />)}
    </Row>
  );
}

/** First run. Every question can be skipped, nothing here asks for a permission, and no account is needed. */
export default function Onboarding() {
  const app = useApp();
  const { c } = useTheme();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [a, setA] = useState<PlanAnswers>({ goal: null, experience: null, days: null, equipment: null });
  const [units, setUnits] = useState<'metric' | 'imperial'>(app.prefs.weightUnit === 'lb' ? 'imperial' : 'metric');
  const [trackers, setTrackers] = useState(app.prefs.trackers);
  const [plan, setPlan] = useState<'suggested' | 'blank' | 'none'>('suggested');
  const [weekdays, setWeekdays] = useState<number[] | null>(null);
  const [busy, setBusy] = useState(false);
  const suggestion = useMemo(() => suggestTemplate(a), [a]);
  const tpl = templateById(suggestion.templateId)!;
  const days = weekdays ?? defaultWeekdays(tpl.daysPerWeek);
  const STEPS = 4;

  const finish = async () => {
    setBusy(true);
    try {
      const imperial = units === 'imperial';
      await app.setPrefs({
        onboarded: true, goal: a.goal, experience: a.experience, trainingDays: a.days, equipment: a.equipment, trackers,
        weightUnit: imperial ? 'lb' : 'kg', volumeUnit: imperial ? 'floz' : 'ml', distanceUnit: imperial ? 'mi' : 'km', lengthUnit: imperial ? 'in' : 'cm', incrementKg: imperial ? 2.268 : 2.5,
      });
      if (plan === 'suggested') {
        const id = await app.training.createFromTemplate(tpl.id);
        await app.training.activateProgram(id, days, app.today);
      } else if (plan === 'blank') {
        await app.training.createBlankProgram(t('program.myRoutine'));
      }
      router.replace('/');
    } finally {
      setBusy(false);
    }
  };

  const footer = (
    <Row>
      {step > 0 ? <Btn variant="outline" title={t('common.back')} onPress={() => setStep(step - 1)} style={{ flex: 1 }} /> : <Btn testID="onb-skip-all" variant="ghost" title={t('onb.skipAll')} onPress={() => { setPlan('none'); setStep(STEPS - 1); }} style={{ flex: 1 }} />}
      {step < STEPS - 1 ? <Btn testID="onb-next" title={t('common.next')} onPress={() => setStep(step + 1)} style={{ flex: 1 }} /> : <Btn testID="onb-finish" title={t('onb.finish')} loading={busy} onPress={() => void finish()} style={{ flex: 1 }} />}
    </Row>
  );

  return (
    <Screen testID="onboarding" title={t('onb.title')} subtitle={t('onb.step', { n: step + 1, total: STEPS })} footer={footer}>
      <View style={{ gap: spacing.xl }}>
        {step === 0 ? (
          <>
            <Txt tone="textMuted">{t('onb.intro')}</Txt>
            <View style={{ gap: spacing.sm }}><Txt variant="headline">{t('onb.goal.q')}</Txt><Options options={GOALS.map((o) => ({ value: o.value, label: t(o.label) }))} value={a.goal} onChange={(goal) => setA({ ...a, goal })} /></View>
            <View style={{ gap: spacing.sm }}><Txt variant="headline">{t('onb.exp.q')}</Txt><Options options={EXPERIENCE.map((o) => ({ value: o.value, label: t(o.label) }))} value={a.experience} onChange={(experience) => setA({ ...a, experience })} /></View>
            <Txt variant="caption" tone="textMuted">{t('onb.optional')}</Txt>
          </>
        ) : null}
        {step === 1 ? (
          <>
            <View style={{ gap: spacing.sm }}><Txt variant="headline">{t('onb.days.q')}</Txt><Options options={[2, 3, 4].map((n) => ({ value: n, label: t('onb.days.n', { n }) }))} value={a.days} onChange={(d) => { setA({ ...a, days: d }); setWeekdays(null); }} /></View>
            <View style={{ gap: spacing.sm }}><Txt variant="headline">{t('onb.eq.q')}</Txt><Options options={EQUIPMENT.map((o) => ({ value: o.value, label: t(o.label) }))} value={a.equipment} onChange={(equipment) => { setA({ ...a, equipment }); setWeekdays(null); }} /></View>
            <View style={{ gap: spacing.sm }}><Txt variant="headline">{t('onb.units.q')}</Txt>
              <Segmented label={t('onb.units.q')} value={units} onChange={setUnits} options={[{ value: 'metric', label: t('onb.units.metric') }, { value: 'imperial', label: t('onb.units.imperial') }]} /></View>
          </>
        ) : null}
        {step === 2 ? (
          <>
            <Txt variant="headline">{t('onb.plan.q')}</Txt>
            <Card testID="plan-suggested" onPress={() => setPlan('suggested')} accessibilityLabel={`${t('onb.plan.suggested')}: ${tpl.name}`} style={{ borderColor: plan === 'suggested' ? c.primary : c.border, borderWidth: plan === 'suggested' ? 2 : 1, gap: spacing.sm }}>
              <Row><Icon name={plan === 'suggested' ? 'radio-button-on' : 'radio-button-off'} tone="primary" /><Txt variant="overline" tone="primary">{t('onb.plan.suggested')}</Txt></Row>
              <Txt variant="title">{tpl.name}</Txt>
              <Txt tone="textMuted">{tpl.description}</Txt>
              <Txt variant="label">{t('onb.plan.why')} {t(suggestion.reasonKey as StringKey)}</Txt>
              {plan === 'suggested' ? (
                <View style={{ gap: spacing.sm }}>
                  <Txt variant="label" tone="textMuted">{t('onb.plan.days')}</Txt>
                  <Row wrap gap={6}>
                    {[1, 2, 3, 4, 5, 6, 0].map((d) => <Chip key={d} testID={`weekday-${d}`} label={weekdayName(d)} selected={days.includes(d)} onPress={() => setWeekdays(days.includes(d) ? days.filter((x) => x !== d) : [...days, d])} />)}
                  </Row>
                </View>
              ) : null}
            </Card>
            <Card testID="plan-blank" onPress={() => setPlan('blank')} accessibilityLabel={t('onb.plan.blank')} style={{ borderColor: plan === 'blank' ? c.primary : c.border, borderWidth: plan === 'blank' ? 2 : 1 }}>
              <Row><Icon name={plan === 'blank' ? 'radio-button-on' : 'radio-button-off'} tone="primary" /><View style={{ flex: 1 }}><Txt variant="bodyStrong">{t('onb.plan.blank')}</Txt><Txt variant="caption" tone="textMuted">{t('onb.plan.blank.body')}</Txt></View></Row>
            </Card>
            <Card testID="plan-none" onPress={() => setPlan('none')} accessibilityLabel={t('onb.plan.none')} style={{ borderColor: plan === 'none' ? c.primary : c.border, borderWidth: plan === 'none' ? 2 : 1 }}>
              <Row><Icon name={plan === 'none' ? 'radio-button-on' : 'radio-button-off'} tone="primary" /><View style={{ flex: 1 }}><Txt variant="bodyStrong">{t('onb.plan.none')}</Txt><Txt variant="caption" tone="textMuted">{t('onb.plan.none.body')}</Txt></View></Row>
            </Card>
          </>
        ) : null}
        {step === 3 ? (
          <>
            <Txt variant="headline">{t('onb.trackers.q')}</Txt>
            <Txt tone="textMuted">{t('onb.trackers.body')}</Txt>
            <Card>
              <Toggle testID="trk-nutrition" label={t('tracker.nutrition')} hint={t('tracker.nutrition.hint')} value={trackers.nutrition} onChange={(v) => setTrackers({ ...trackers, nutrition: v })} />
              <Toggle testID="trk-water" label={t('tracker.water')} value={trackers.water} onChange={(v) => setTrackers({ ...trackers, water: v })} />
              <Toggle testID="trk-sleep" label={t('tracker.sleep')} value={trackers.sleep} onChange={(v) => setTrackers({ ...trackers, sleep: v })} />
              <Toggle testID="trk-body" label={t('tracker.body')} hint={t('tracker.body.hint')} value={trackers.body} onChange={(v) => setTrackers({ ...trackers, body: v })} />
            </Card>
            <Txt variant="caption" tone="textMuted">{cloudEnabled ? t('onb.privacy.cloud') : t('onb.privacy.local')}</Txt>
            <Btn testID="try-demo" variant="ghost" icon="flask-outline" title={t('demo.try')} onPress={() => void app.enterDemo()} />
          </>
        ) : null}
      </View>
    </Screen>
  );
}
