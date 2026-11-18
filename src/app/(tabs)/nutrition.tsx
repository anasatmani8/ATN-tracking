import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';

import { DateNav } from '@/components/date-nav';
import { useFeedback } from '@/components/feedback';
import { Banner, Btn, Card, Divider, Empty, ListItem, Loading, ProgressBar, Row, Screen, SectionTitle, Segmented, Txt } from '@/components/ui';
import { logNutrients } from '@/data/nutrition';
import { NUTRIENT_KEYS, sumNutrients } from '@/domain/nutrition';
import { addDays } from '@/domain/time';
import { formatDate, t, type StringKey } from '@/i18n';
import { useApp, useLive } from '@/state/app';
import { useFmt } from '@/state/hooks';
import { spacing } from '@/theme';
import { nowMs } from '@/domain/clock';

const qtyText = (qty: number, unit: string, label: string | null, num: (v: number, dp?: number) => string) => `${num(qty, 1)} ${unit === 'serving' ? (label ?? 'serving') : unit === 'ml' ? 'mL' : unit}`;

export default function NutritionTab() {
  const app = useApp();
  const fmt = useFmt();
  const router = useRouter();
  const { toast } = useFeedback();
  const [date, setDate] = useState(app.today);
  const [view, setView] = useState<'diary' | 'plan'>('diary');
  const { prefs } = app;
  const { data } = useLive(async (a) => ({
    logs: await a.nutrition.listLogs(date),
    planned: await a.nutrition.listPlanned(date, view === 'plan' ? addDays(date, 6) : date),
  }), ['food_logs', 'planned_meals'], [date, view]);

  if (!prefs.trackers.nutrition) {
    return <Screen title={t('tab.nutrition')}><Empty icon="restaurant-outline" title={t('tracker.hidden.title')} body={t('tracker.hidden.body')} action={<Btn title={t('tracker.enable')} onPress={() => void app.setPrefs({ trackers: { ...prefs.trackers, nutrition: true } })} />} /></Screen>;
  }
  const totals = data ? sumNutrients(data.logs.map(logNutrients)) : null;
  const targets = prefs.targets;

  return (
    <Screen testID="nutrition-screen" title={t('tab.nutrition')} right={<Btn size="sm" variant="ghost" title={t('nutrition.recipes')} onPress={() => router.push('/nutrition/recipes')} testID="open-recipes" />}>
      <Segmented label={t('nutrition.view')} value={view} onChange={setView} options={[{ value: 'diary', label: t('nutrition.diary') }, { value: 'plan', label: t('nutrition.plan') }]} />
      <DateNav date={date} today={app.today} onChange={setDate} allowFuture />
      {!data || !totals ? <Loading /> : view === 'diary' ? (
        <>
          <Card testID="nutrition-totals" style={{ gap: spacing.sm }}>
            <Row><Txt variant="overline" tone="textMuted" style={{ flex: 1 }}>{t('nutrition.logged')}</Txt><Txt variant="caption" tone="textMuted">{t('nutrition.entries', { count: totals.entries })}</Txt></Row>
            {prefs.hideNutritionNumbers ? <Txt tone="textMuted">{t('nutrition.mealOnly')}</Txt> : (
              <>
                {NUTRIENT_KEYS.map((k) => {
                  const target = k === 'kcal' ? targets.kcal : k === 'proteinG' ? targets.proteinG : k === 'carbsG' ? targets.carbsG : targets.fatG;
                  const unit = k === 'kcal' ? 'kcal' : 'g';
                  const val = `${totals.partial[k] ? '≥ ' : ''}${fmt.num(totals[k], k === 'kcal' ? 0 : 1)} ${unit}`;
                  return (
                    <View key={k} style={{ gap: 4 }}>
                      <Row><Txt variant="label" style={{ flex: 1 }}>{t(`macro.${k}` as StringKey)}</Txt><Txt variant="num">{target ? t('nutrition.ofTarget', { value: val, target: `${fmt.num(target)} ${unit}` }) : val}</Txt></Row>
                      {target ? <ProgressBar value={totals[k]} max={target} label={t(`macro.${k}` as StringKey)} /> : null}
                    </View>
                  );
                })}
                {NUTRIENT_KEYS.some((k) => totals.partial[k]) ? <Txt variant="caption" tone="textMuted" testID="partial-note">{t('nutrition.partial')}</Txt> : null}
              </>
            )}
          </Card>
          {data.planned.filter((p) => p.status === 'planned').length ? (
            <>
              <SectionTitle>{t('nutrition.plannedToday')}</SectionTitle>
              <Banner icon="calendar-outline" text={t('nutrition.plannedNote')} />
              <Card style={{ paddingVertical: spacing.sm, marginTop: spacing.sm }}>
                {data.planned.filter((p) => p.status === 'planned').map((p, i) => (
                  <View key={p.id}>
                    {i > 0 ? <Divider /> : null}
                    <ListItem testID={`planned-${i}`} title={p.name} subtitle={`${p.meal_slot} · ${qtyText(p.qty, p.unit, JSON.parse(p.snapshot).servingLabel, fmt.num)}`} right={<Btn size="sm" title={t('nutrition.logIt')} onPress={() => router.push(`/nutrition/entry/planned-${p.id}?date=${date}`)} testID={`log-planned-${i}`} />} />
                  </View>
                ))}
              </Card>
            </>
          ) : null}
          {prefs.mealSlots.map((slot) => {
            const items = data.logs.filter((l) => l.meal_slot === slot);
            const sub = sumNutrients(items.map(logNutrients));
            return (
              <View key={slot}>
                <SectionTitle action={<Btn size="sm" variant="ghost" icon="add" title={t('nutrition.add')} accessibilityLabel={t('nutrition.addTo', { slot })} onPress={() => router.push(`/nutrition/add?date=${date}&slot=${encodeURIComponent(slot)}`)} testID={`add-${slot}`} />}>
                  {prefs.hideNutritionNumbers || items.length === 0 ? slot : `${slot} · ${sub.partial.kcal ? '≥' : ''}${fmt.num(sub.kcal)} kcal`}
                </SectionTitle>
                {items.length === 0 ? <Txt variant="caption" tone="textMuted">{t('nutrition.slotEmpty')}</Txt> : (
                  <Card style={{ paddingVertical: spacing.sm }}>
                    {items.map((l, i) => (
                      <View key={l.id}>
                        {i > 0 ? <Divider /> : null}
                        <ListItem testID={`entry-${slot}-${i}`} title={l.name} subtitle={qtyText(l.qty, l.unit, JSON.parse(l.snapshot).servingLabel, fmt.num)}
                          value={prefs.hideNutritionNumbers ? undefined : l.kcal == null ? '– kcal' : `${fmt.num(l.kcal)} kcal`} onPress={() => router.push(`/nutrition/entry/${l.id}`)} />
                      </View>
                    ))}
                  </Card>
                )}
              </View>
            );
          })}
          <Row wrap style={{ marginTop: spacing.xl }}>
            <Btn testID="copy-yesterday" variant="outline" icon="copy-outline" title={t('nutrition.copyFrom', { date: formatDate(addDays(date, -1)) })} onPress={async () => {
              const n = await app.nutrition.copyDay(addDays(date, -1), date, nowMs(), app.tz);
              toast({ message: n ? t('nutrition.copied', { count: n }) : t('nutrition.nothingToCopy') });
            }} />
          </Row>
        </>
      ) : (
        <>
          <Txt variant="caption" tone="textMuted" style={{ marginBottom: spacing.sm }}>{t('nutrition.planHint')}</Txt>
          {[0, 1, 2, 3, 4, 5, 6].map((i) => {
            const d = addDays(date, i);
            const items = data.planned.filter((p) => p.local_date === d);
            return (
              <View key={d}>
                <SectionTitle action={<Btn size="sm" variant="ghost" icon="add" title={t('nutrition.planAdd')} onPress={() => router.push(`/nutrition/add?date=${d}&mode=plan`)} testID={`plan-add-${i}`} />}>{formatDate(d)}</SectionTitle>
                {items.length === 0 ? <Txt variant="caption" tone="textMuted">{t('nutrition.planEmpty')}</Txt> : (
                  <Card style={{ paddingVertical: spacing.sm }}>
                    {items.map((p, j) => (
                      <View key={p.id}>
                        {j > 0 ? <Divider /> : null}
                        <ListItem title={p.name} subtitle={`${p.meal_slot} · ${qtyText(p.qty, p.unit, JSON.parse(p.snapshot).servingLabel, fmt.num)}`}
                          value={p.status === 'logged' ? t('nutrition.plannedLogged') : t('nutrition.plannedOpen')} onPress={() => (p.status === 'logged' && p.log_id ? router.push(`/nutrition/entry/${p.log_id}`) : router.push(`/nutrition/entry/planned-${p.id}?date=${d}`))} />
                      </View>
                    ))}
                  </Card>
                )}
              </View>
            );
          })}
        </>
      )}
    </Screen>
  );
}
