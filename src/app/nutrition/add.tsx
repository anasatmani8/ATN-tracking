import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';

import { useFeedback } from '@/components/feedback';
import { Btn, Card, Chip, Divider, Field, IconBtn, ListItem, Loading, Row, Screen, Segmented, Sheet, Txt } from '@/components/ui';
import { BASELINE_ATTRIBUTION } from '@/data/catalog/foods';
import type { LogInput } from '@/data/nutrition';
import { newId } from '@/data/store';
import { parseDecimal } from '@/domain/units';
import { formatDate, t } from '@/i18n';
import { useApp, useLive } from '@/state/app';
import { errorText, useFmt } from '@/state/hooks';
import { PortionSheet } from '@/screens/nutrition/portion-sheet';
import { spacing } from '@/theme';
import { nowMs } from '@/domain/clock';

type Tab = 'search' | 'recent' | 'favorites' | 'meals' | 'recipes';

/** One place to find food: local staples, your foods, recent, favorites, saved meals, recipes, quick add and barcode. */
export default function AddFood() {
  const p = useLocalSearchParams<{ date?: string; slot?: string; mode?: 'log' | 'plan'; tab?: string }>();
  const app = useApp();
  const fmt = useFmt();
  const router = useRouter();
  const { toast, confirm } = useFeedback();
  const date = p.date && /^\d{4}-\d{2}-\d{2}$/.test(p.date) ? p.date : app.today;
  const mode = p.mode === 'plan' ? 'plan' : 'log';
  const [tab, setTab] = useState<Tab>((['search', 'recent', 'favorites', 'meals', 'recipes'] as Tab[]).includes(p.tab as Tab) ? (p.tab as Tab) : 'search');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<LogInput | null>(null);
  const [quick, setQuick] = useState(false);
  const [quickV, setQuickV] = useState({ name: '', kcal: '', p: '', c: '', f: '' });
  const [opId, setOpId] = useState(newId());
  const { data } = useLive(async (a) => ({
    results: await a.nutrition.searchFoods(q),
    recent: await a.nutrition.recentItems(20),
    meals: await a.nutrition.listSavedMeals(),
    recipes: await a.nutrition.listRecipes(),
    slotLogs: await a.nutrition.listLogs(date),
  }), ['foods', 'food_logs', 'saved_meals', 'recipes'], [q, date]);
  const { data: favData } = useLive(async (a) => (await Promise.all(a.prefs.favoriteFoods.map((id) => a.nutrition.getFood(id)))).filter((f) => f != null), ['prefs', 'foods']);
  const favs = useMemo(() => favData ?? [], [favData]);
  const isFav = (id: string | null) => !!id && app.prefs.favoriteFoods.includes(id);
  const toggleFav = (id: string) => void app.setPrefs({ favoriteFoods: isFav(id) ? app.prefs.favoriteFoods.filter((x) => x !== id) : [...app.prefs.favoriteFoods, id] });

  const commit = async (item: LogInput, slot: string) => {
    try {
      if (mode === 'plan') await app.nutrition.plan(date, slot, item);
      else await app.nutrition.log(date, slot, item, nowMs(), app.tz, opId);
      setOpId(newId());
      setPicked(null);
      toast({ message: mode === 'plan' ? t('nutrition.planned', { name: item.name, date: formatDate(date) }) : t('nutrition.loggedToast', { name: item.name, slot }) });
    } catch (e) {
      toast({ message: errorText(e), tone: 'error' });
    }
  };

  const fromFood = (f: { id: string; name: string; brand: string | null; snapshot: LogInput['snapshot'] }): LogInput => ({
    name: f.brand ? `${f.name} (${f.brand})` : f.name, sourceKind: 'food', sourceId: f.id, snapshot: f.snapshot,
    qty: f.snapshot.basis === 'per_serving' ? 1 : (f.snapshot.servingG ?? f.snapshot.servingMl ?? 100), unit: f.snapshot.basis === 'per_serving' ? 'serving' : f.snapshot.basis === 'per_100ml' ? 'ml' : 'g',
  });

  const list = useMemo(() => {
    if (!data) return null;
    if (tab === 'search') return data.results.map((f) => ({ key: f.id, title: f.brand ? `${f.name} · ${f.brand}` : f.name, sub: f.builtin ? t('food.staple') : t('food.yours'), item: fromFood(f) }));
    if (tab === 'recent') return data.recent.map((r, i) => ({ key: `r${i}`, title: r.name, sub: t('food.lastPortion', { qty: fmt.num(r.qty, 1), unit: r.unit === 'serving' ? (r.snapshot.servingLabel ?? t('unit.serving')) : r.unit }), item: r }));
    if (tab === 'favorites') return favs.map((f) => ({ key: f!.id, title: f!.name, sub: '', item: fromFood(f!) }));
    if (tab === 'recipes') return data.recipes.map((r) => ({ key: r.id, title: r.name, sub: t('recipe.yield', { n: fmt.num(r.servingsYield, 1) }), item: app.nutrition.recipeAsInput(r, 1) }));
    return null;
  }, [data, tab, favs, fmt, app.nutrition]);

  return (
    <Screen testID="add-food" title={mode === 'plan' ? t('nutrition.planTitle', { date: formatDate(date) }) : t('nutrition.addTitle', { slot: p.slot ?? '' })} subtitle={mode === 'log' ? formatDate(date) : t('nutrition.planSub')} back>
      <Row wrap>
        <Btn testID="scan-barcode" variant="secondary" icon="barcode-outline" title={t('scan.cta')} onPress={() => router.push(`/nutrition/scan?date=${date}&mode=${mode}${p.slot ? `&slot=${encodeURIComponent(p.slot)}` : ''}`)} />
        <Btn testID="quick-add" variant="outline" icon="flash-outline" title={t('quick.cta')} onPress={() => setQuick(true)} />
        <Btn variant="ghost" icon="add" title={t('food.create')} onPress={() => router.push('/nutrition/food')} testID="create-food" />
      </Row>
      <View style={{ marginTop: spacing.md }}>
        <Segmented<Tab> label={t('nutrition.source')} value={tab} onChange={setTab} options={[
          { value: 'search', label: t('nutrition.tab.search') }, { value: 'recent', label: t('nutrition.tab.recent') }, { value: 'favorites', label: t('nutrition.tab.favorites') },
          { value: 'meals', label: t('nutrition.tab.meals') }, { value: 'recipes', label: t('nutrition.tab.recipes') }]} />
      </View>
      {tab === 'search' ? <Field testID="food-search" style={{ marginTop: spacing.md }} label={t('food.search')} placeholder={t('food.searchPlaceholder')} value={q} onChangeText={setQ} autoCorrect={false} returnKeyType="search" /> : null}
      {!data ? <Loading /> : tab === 'meals' ? (
        <View style={{ gap: spacing.md, marginTop: spacing.md }}>
          {data.meals.length === 0 ? <Txt tone="textMuted">{t('meals.empty')}</Txt> : (
            <Card style={{ paddingVertical: spacing.sm }}>
              {data.meals.map((m, i) => (
                <View key={m.id}>
                  {i > 0 ? <Divider /> : null}
                  <ListItem title={m.name} subtitle={m.items.map((x) => x.name).join(', ')} onPress={async () => {
                    const slot = p.slot ?? app.prefs.mealSlots[0];
                    if (!(await confirm({ title: m.name, message: t('meals.confirm', { count: m.items.length, slot }), confirmLabel: mode === 'plan' ? t('nutrition.planAdd') : t('nutrition.logIt') }))) return;
                    for (const it of m.items) await (mode === 'plan' ? app.nutrition.plan(date, slot, it) : app.nutrition.log(date, slot, it, nowMs(), app.tz));
                    toast({ message: t('meals.logged', { count: m.items.length }) });
                  }} right={<IconBtn icon="trash-outline" label={t('common.delete')} onPress={() => void app.nutrition.deleteSavedMeal(m.id)} />} />
                </View>
              ))}
            </Card>
          )}
          <Txt variant="label" tone="textMuted">{t('meals.saveFrom')}</Txt>
          <Row wrap>
            {app.prefs.mealSlots.map((slot) => {
              const items = data.slotLogs.filter((l) => l.meal_slot === slot);
              return <Chip key={slot} label={`${slot} (${items.length})`} onPress={items.length ? async () => {
                await app.nutrition.saveMeal(`${slot} · ${formatDate(date)}`, items.map((l) => ({ name: l.name, sourceKind: l.source_kind, sourceId: l.source_id, snapshot: JSON.parse(l.snapshot), qty: l.qty, unit: l.unit })));
                toast({ message: t('meals.saved') });
              } : undefined} />;
            })}
          </Row>
        </View>
      ) : (
        <Card style={{ paddingVertical: spacing.sm, marginTop: spacing.md }}>
          {list && list.length === 0 ? <Txt tone="textMuted" style={{ paddingVertical: spacing.md }}>{tab === 'search' ? t('food.noResults') : tab === 'favorites' ? t('food.noFavorites') : tab === 'recipes' ? t('recipe.empty') : t('food.noRecent')}</Txt> : null}
          {list?.map((r, i) => (
            <View key={r.key}>
              {i > 0 ? <Divider /> : null}
              <ListItem testID={`food-${i}`} title={r.title} subtitle={r.sub} onPress={() => setPicked(r.item)} />
            </View>
          ))}
        </Card>
      )}
      {tab === 'search' ? <Txt variant="caption" tone="textMuted" style={{ marginTop: spacing.md }}>{BASELINE_ATTRIBUTION}</Txt> : null}

      <PortionSheet item={picked} visible={!!picked} onClose={() => setPicked(null)} slot={p.slot} confirmLabel={mode === 'plan' ? t('nutrition.planAdd') : t('nutrition.logIt')}
        onConfirm={(qty, unit, slot) => commit({ ...picked!, qty, unit }, slot)}
        extra={picked?.sourceKind === 'food' && picked.sourceId ? <Chip icon={isFav(picked.sourceId) ? 'star' : 'star-outline'} label={isFav(picked.sourceId) ? t('food.unfavorite') : t('food.favorite')} selected={isFav(picked.sourceId)} onPress={() => toggleFav(picked.sourceId!)} /> : null} />

      <Sheet visible={quick} onClose={() => setQuick(false)} title={t('quick.title')}>
        <Txt variant="caption" tone="textMuted">{t('quick.hint')}</Txt>
        <Field testID="quick-name" label={t('quick.name')} value={quickV.name} onChangeText={(name) => setQuickV({ ...quickV, name })} maxLength={80} />
        <Row>
          <Field testID="quick-kcal" style={{ flex: 1 }} label={t('macro.kcal')} suffix="kcal" keyboardType="decimal-pad" value={quickV.kcal} onChangeText={(kcal) => setQuickV({ ...quickV, kcal })} />
          <Field style={{ flex: 1 }} label={t('macro.proteinG')} suffix="g" keyboardType="decimal-pad" value={quickV.p} onChangeText={(v) => setQuickV({ ...quickV, p: v })} />
        </Row>
        <Row>
          <Field style={{ flex: 1 }} label={t('macro.carbsG')} suffix="g" keyboardType="decimal-pad" value={quickV.c} onChangeText={(v) => setQuickV({ ...quickV, c: v })} />
          <Field style={{ flex: 1 }} label={t('macro.fatG')} suffix="g" keyboardType="decimal-pad" value={quickV.f} onChangeText={(v) => setQuickV({ ...quickV, f: v })} />
        </Row>
        <Btn testID="quick-save" title={mode === 'plan' ? t('nutrition.planAdd') : t('nutrition.logIt')} onPress={() => {
          const n = (s: string) => (s.trim() === '' ? null : parseDecimal(s));
          const vals = [n(quickV.kcal), n(quickV.p), n(quickV.c), n(quickV.f)];
          if ([quickV.kcal, quickV.p, quickV.c, quickV.f].some((s, i) => s.trim() !== '' && vals[i] == null)) return toast({ message: t('err.invalid_value'), tone: 'error' });
          setQuick(false);
          setQuickV({ name: '', kcal: '', p: '', c: '', f: '' });
          void commit({ name: quickV.name.trim() || t('quick.defaultName'), sourceKind: 'quick', sourceId: null, qty: 1, unit: 'serving',
            snapshot: { basis: 'per_serving', servingG: null, servingMl: null, servingLabel: t('quick.serving'), kcal: vals[0], proteinG: vals[1], carbsG: vals[2], fatG: vals[3], source: t('quick.source') } }, p.slot ?? app.prefs.mealSlots[0]);
        }} />
      </Sheet>
    </Screen>
  );
}
