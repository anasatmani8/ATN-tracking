import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Linking, View } from 'react-native';

import { useFeedback } from '@/components/feedback';
import { Card, Chip, Divider, Field, ListItem, Row, Screen, SectionTitle, Segmented, Toggle, Txt } from '@/components/ui';
import type { Prefs } from '@/data/prefs';
import { fromKg, fromMl, parseDecimal, round, toKg, toMl } from '@/domain/units';
import { t, weekdayName } from '@/i18n';
import { useApp } from '@/state/app';
import { useFmt } from '@/state/hooks';
import { spacing } from '@/theme';

/** Number field that saves on blur. Blank clears an optional target. */
type NumPrefProps = { label: string; value: number | null; suffix?: string; onSave: (v: number | null) => void; testID?: string; allowBlank?: boolean };
function NumPref(props: NumPrefProps) {
  return <NumPrefField key={String(props.value)} {...props} />;
}
function NumPrefField({ label, value, suffix, onSave, testID, allowBlank = true }: NumPrefProps) {
  const [text, setText] = useState(value == null ? '' : String(value));
  const [err, setErr] = useState<string | null>(null);
  return (
    <Field testID={testID} style={{ flex: 1 }} label={label} suffix={suffix} value={text} onChangeText={setText} keyboardType="decimal-pad" error={err}
      onBlur={() => {
        if (text.trim() === '') { if (allowBlank) { setErr(null); onSave(null); } else setErr(t('err.invalid_value')); return; }
        const v = parseDecimal(text);
        if (v == null || v <= 0) return setErr(t('err.invalid_value'));
        setErr(null);
        onSave(v);
      }} />
  );
}

export default function Settings() {
  const app = useApp();
  const fmt = useFmt();
  const router = useRouter();
  const { confirm } = useFeedback();
  const { prefs, setPrefs } = app;
  const set = (p: Partial<Prefs>) => void setPrefs(p);
  const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string>;

  return (
    <Screen testID="settings" title={t('settings.title')} back>
      {app.cloud.enabled ? (
        <Card style={{ paddingVertical: spacing.sm }}>
          <ListItem testID="settings-account" icon="person-circle-outline" title={app.cloud.email ?? t('account.guest')} subtitle={app.cloud.email ? (app.sync.status ? t('sync.statusLine', { pending: app.sync.status.pending }) : t('sync.idle')) : t('account.signInSub')} onPress={() => router.push('/settings/account')} />
        </Card>
      ) : (
        <Card><Txt variant="bodyStrong">{t('account.localOnly')}</Txt><Txt variant="caption" tone="textMuted">{t('account.localOnlyBody')}</Txt></Card>
      )}

      <SectionTitle>{t('settings.units')}</SectionTitle>
      <Card style={{ gap: spacing.md }}>
        <Txt variant="label" tone="textMuted">{t('settings.weightUnit')}</Txt>
        <Segmented testID="unit-weight" label={t('settings.weightUnit')} value={prefs.weightUnit} onChange={(weightUnit) => set({ weightUnit, incrementKg: weightUnit === 'lb' ? 2.268 : 2.5 })} options={[{ value: 'kg', label: 'kg' }, { value: 'lb', label: 'lb' }]} />
        <Txt variant="label" tone="textMuted">{t('settings.volumeUnit')}</Txt>
        <Segmented label={t('settings.volumeUnit')} value={prefs.volumeUnit} onChange={(volumeUnit) => set({ volumeUnit })} options={[{ value: 'ml', label: 'mL' }, { value: 'floz', label: 'fl oz' }]} />
        <Txt variant="label" tone="textMuted">{t('settings.distanceUnit')}</Txt>
        <Segmented label={t('settings.distanceUnit')} value={prefs.distanceUnit} onChange={(distanceUnit) => set({ distanceUnit })} options={[{ value: 'km', label: 'km' }, { value: 'mi', label: 'mi' }]} />
        <Txt variant="label" tone="textMuted">{t('settings.lengthUnit')}</Txt>
        <Segmented label={t('settings.lengthUnit')} value={prefs.lengthUnit} onChange={(lengthUnit) => set({ lengthUnit })} options={[{ value: 'cm', label: 'cm' }, { value: 'in', label: 'in' }]} />
        <Txt variant="label" tone="textMuted">{t('settings.weekStart')}</Txt>
        <Segmented label={t('settings.weekStart')} value={prefs.startOfWeek} onChange={(startOfWeek) => set({ startOfWeek })} options={[{ value: 1, label: weekdayName(1, 'long') }, { value: 0, label: weekdayName(0, 'long') }, { value: 6, label: weekdayName(6, 'long') }]} />
        <NumPref label={t('settings.increment')} suffix={fmt.wUnit} value={round(fromKg(prefs.incrementKg, fmt.wUnit), 2)} allowBlank={false} onSave={(v) => v && set({ incrementKg: toKg(v, fmt.wUnit) })} />
        <Txt variant="caption" tone="textMuted">{t('settings.unitsNote')}</Txt>
      </Card>

      <SectionTitle>{t('settings.trackers')}</SectionTitle>
      <Card>
        <Toggle testID="set-trk-nutrition" label={t('tracker.nutrition')} value={prefs.trackers.nutrition} onChange={(v) => set({ trackers: { ...prefs.trackers, nutrition: v } })} />
        <Toggle testID="set-trk-water" label={t('tracker.water')} value={prefs.trackers.water} onChange={(v) => set({ trackers: { ...prefs.trackers, water: v } })} />
        <Toggle testID="set-trk-sleep" label={t('tracker.sleep')} value={prefs.trackers.sleep} onChange={(v) => set({ trackers: { ...prefs.trackers, sleep: v } })} />
        <Toggle testID="set-trk-body" label={t('tracker.body')} value={prefs.trackers.body} onChange={(v) => set({ trackers: { ...prefs.trackers, body: v } })} />
        <Divider />
        <Toggle testID="meal-only" label={t('settings.mealOnly')} hint={t('settings.mealOnlyHint')} value={prefs.hideNutritionNumbers} onChange={(v) => set({ hideNutritionNumbers: v })} />
        <Txt variant="caption" tone="textMuted">{t('settings.hiddenNote')}</Txt>
      </Card>

      <SectionTitle>{t('settings.targets')}</SectionTitle>
      <Card style={{ gap: spacing.md }}>
        <Txt variant="caption" tone="textMuted">{t('settings.targetsNote')}</Txt>
        <Row><NumPref testID="target-water" label={t('settings.targetWater')} suffix={fmt.volUnit} value={prefs.targets.waterMl == null ? null : round(fromMl(prefs.targets.waterMl, prefs.volumeUnit), 1)} onSave={(v) => set({ targets: { ...prefs.targets, waterMl: v == null ? null : toMl(v, prefs.volumeUnit) } })} />
          <NumPref testID="target-sleep" label={t('settings.targetSleep')} suffix="h" value={prefs.targets.sleepMin == null ? null : round(prefs.targets.sleepMin / 60, 2)} onSave={(v) => set({ targets: { ...prefs.targets, sleepMin: v == null ? null : Math.round(v * 60) } })} /></Row>
        {!prefs.hideNutritionNumbers ? (
          <>
            <Row><NumPref label={t('macro.kcal')} suffix="kcal" value={prefs.targets.kcal} onSave={(v) => set({ targets: { ...prefs.targets, kcal: v } })} />
              <NumPref label={t('macro.proteinG')} suffix="g" value={prefs.targets.proteinG} onSave={(v) => set({ targets: { ...prefs.targets, proteinG: v } })} /></Row>
            <Row><NumPref label={t('macro.carbsG')} suffix="g" value={prefs.targets.carbsG} onSave={(v) => set({ targets: { ...prefs.targets, carbsG: v } })} />
              <NumPref label={t('macro.fatG')} suffix="g" value={prefs.targets.fatG} onSave={(v) => set({ targets: { ...prefs.targets, fatG: v } })} /></Row>
          </>
        ) : null}
        <ListPrefs key={`${prefs.waterPresetsMl.join()}|${prefs.volumeUnit}|${prefs.mealSlots.join()}`} />
      </Card>

      <SectionTitle>{t('settings.training')}</SectionTitle>
      <Card>
        <Toggle label={t('settings.progression')} hint={t('settings.progressionHint')} value={prefs.progressionEnabled} onChange={(v) => set({ progressionEnabled: v })} />
        <Toggle label={t('settings.restAlerts')} hint={t('settings.restAlertsHint')} value={prefs.restTimerAlerts} onChange={(v) => set({ restTimerAlerts: v })} />
        <Txt variant="label" tone="textMuted" style={{ marginTop: spacing.sm }}>{t('settings.checkinDay')}</Txt>
        <Row wrap gap={6} style={{ marginTop: spacing.xs }}>
          <Chip label={t('common.off')} selected={prefs.checkinWeekday == null} onPress={() => set({ checkinWeekday: null })} />
          {[1, 2, 3, 4, 5, 6, 0].map((d) => <Chip key={d} label={weekdayName(d)} selected={prefs.checkinWeekday === d} onPress={() => set({ checkinWeekday: d })} />)}
        </Row>
      </Card>

      <SectionTitle>{t('settings.appearance')}</SectionTitle>
      <Segmented testID="theme" label={t('settings.theme')} value={prefs.theme} onChange={(theme) => set({ theme })} options={[{ value: 'system', label: t('settings.theme.system') }, { value: 'light', label: t('settings.theme.light') }, { value: 'dark', label: t('settings.theme.dark') }]} />

      <SectionTitle>{t('settings.more')}</SectionTitle>
      <Card style={{ paddingVertical: spacing.sm }}>
        <ListItem testID="settings-reminders" icon="notifications-outline" title={t('reminders.title')} onPress={() => router.push('/settings/reminders')} />
        <Divider />
        <ListItem testID="settings-privacy" icon="shield-checkmark-outline" title={t('privacy.title')} subtitle={t('privacy.sub')} onPress={() => router.push('/settings/privacy')} />
        <Divider />
        {app.isDemo ? <ListItem icon="flask-outline" title={t('demo.exit')} onPress={() => void app.exitDemo()} /> : (
          <ListItem testID="settings-demo" icon="flask-outline" title={t('demo.try')} subtitle={t('demo.sub')} onPress={async () => { if (await confirm({ title: t('demo.try'), message: t('demo.confirm') })) { await app.enterDemo(); router.replace('/'); } }} />
        )}
        <Divider />
        <ListItem icon="refresh-outline" title={t('settings.redoOnboarding')} onPress={() => { set({ onboarded: false }); router.replace('/onboarding'); }} />
      </Card>

      <SectionTitle>{t('settings.about')}</SectionTitle>
      <Card style={{ gap: spacing.xs }}>
        <Txt variant="label">{t('settings.version', { v: Constants.expoConfig?.version ?? '1.0.0', variant: extra.variant ?? '' })}</Txt>
        {extra.supportEmail ? <ListItem title={t('settings.support')} value={extra.supportEmail} onPress={() => void Linking.openURL(`mailto:${extra.supportEmail}`)} /> : null}
        {extra.privacyUrl ? <ListItem title={t('settings.privacyPolicy')} onPress={() => void Linking.openURL(extra.privacyUrl)} /> : null}
        {extra.termsUrl ? <ListItem title={t('settings.terms')} onPress={() => void Linking.openURL(extra.termsUrl)} /> : null}
        <Txt variant="caption" tone="textMuted">{t('settings.disclaimer')}</Txt>
      </Card>
      <View style={{ height: spacing.xl }} />
    </Screen>
  );
}

/** Water preset amounts and meal slot names, edited as comma-separated text and saved on blur. */
function ListPrefs() {
  const { prefs, setPrefs } = useApp();
  const fmt = useFmt();
  const { toast } = useFeedback();
  const [presetText, setPresetText] = useState(prefs.waterPresetsMl.map((m) => fmt.volNum(m)).join(', '));
  const [slotsText, setSlotsText] = useState(prefs.mealSlots.join(', '));
  return (
    <>
      <Field label={t('settings.waterPresets')} suffix={fmt.volUnit} value={presetText} onChangeText={setPresetText} hint={t('settings.waterPresetsHint')}
        onBlur={() => {
          const vals = presetText.split(/[,;]/).map((s) => parseDecimal(s)).filter((v): v is number => v != null && v > 0).map((v) => toMl(v, prefs.volumeUnit)).filter((ml) => ml <= 5000).slice(0, 4);
          if (vals.length) void setPrefs({ waterPresetsMl: vals });
          else toast({ message: t('err.invalid_value'), tone: 'error' });
        }} />
      <Field label={t('settings.mealSlots')} value={slotsText} onChangeText={setSlotsText} hint={t('settings.mealSlotsHint')}
        onBlur={() => {
          const slots = [...new Set(slotsText.split(',').map((s) => s.trim()).filter(Boolean))].slice(0, 8);
          if (slots.length) void setPrefs({ mealSlots: slots });
        }} />
    </>
  );
}
