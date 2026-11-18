import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';

import { useFeedback } from '@/components/feedback';
import { Btn, Card, Divider, Field, IconBtn, ListItem, Row, Screen, SectionTitle, Sheet, Txt } from '@/components/ui';
import type { FoodItem } from '@/data/catalog/foods';
import { recipeSnapshot, type RecipeIngredient } from '@/domain/nutrition';
import { parseDecimal } from '@/domain/units';
import { t } from '@/i18n';
import { useApp, useLive } from '@/state/app';
import { errorText, useFmt } from '@/state/hooks';
import { NutrientLine } from '@/screens/nutrition/nutrient-line';
import { PortionForm } from '@/screens/nutrition/portion-sheet';
import { spacing } from '@/theme';

/** Recipe editor. Ingredients keep their own nutrient snapshot; diary entries made from this recipe never change when it is edited. */
export default function RecipeEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const app = useApp();
  const fmt = useFmt();
  const router = useRouter();
  const { toast, confirm } = useFeedback();
  const [name, setName] = useState('');
  const [yieldText, setYieldText] = useState('1');
  const [ings, setIngs] = useState<RecipeIngredient[]>([]);
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState('');
  const [pick, setPick] = useState<FoodItem | null>(null);
  useEffect(() => {
    if (isNew) return;
    app.nutrition.getRecipe(id).then((r) => {
      if (!r) return;
      setName(r.name);
      setYieldText(String(r.servingsYield));
      setIngs(r.ingredients);
    });
  }, [id, isNew, app.nutrition]);
  const { data: results } = useLive((a) => a.nutrition.searchFoods(q, 25), ['foods'], [q]);
  const servings = parseDecimal(yieldText);
  const snap = servings && servings > 0 ? recipeSnapshot(ings, servings, name) : null;

  return (
    <Screen testID="recipe-editor" title={isNew ? t('recipe.new') : name || t('recipe.title')} back footer={<Btn testID="recipe-save" title={t('common.save')} onPress={async () => {
      try {
        const rid = await app.nutrition.saveRecipe({ id: isNew ? undefined : id, name, servingsYield: servings ?? 0, ingredients: ings });
        toast({ message: t('common.saved') });
        if (isNew) router.replace(`/nutrition/recipe/${rid}`);
      } catch (e) {
        toast({ message: errorText(e), tone: 'error' });
      }
    }} />}>
      <View style={{ gap: spacing.md }}>
        <Field testID="recipe-name" label={t('recipe.name')} value={name} onChangeText={setName} maxLength={80} />
        <Field testID="recipe-yield" label={t('recipe.yieldLabel')} value={yieldText} onChangeText={setYieldText} keyboardType="decimal-pad" hint={t('recipe.yieldHint')} />
        {snap ? <Card><Txt variant="overline" tone="textMuted">{t('recipe.perServing')}</Txt><NutrientLine n={snap} /></Card> : null}
        <Txt variant="caption" tone="textMuted">{t('recipe.editNote')}</Txt>
      </View>
      <SectionTitle action={<Btn size="sm" variant="ghost" icon="add" title={t('recipe.addIngredient')} onPress={() => setAdding(true)} testID="recipe-add-ingredient" />}>{t('recipe.ingredients')}</SectionTitle>
      {ings.length === 0 ? <Txt tone="textMuted">{t('recipe.noIngredients')}</Txt> : (
        <Card style={{ paddingVertical: spacing.sm }}>
          {ings.map((g, i) => (
            <View key={i}>
              {i > 0 ? <Divider /> : null}
              <ListItem title={g.name} subtitle={`${fmt.num(g.qty, 1)} ${g.unit === 'serving' ? (g.snapshot.servingLabel ?? t('unit.serving')) : g.unit}`} right={<IconBtn icon="close" label={t('recipe.removeIngredient', { name: g.name })} onPress={() => setIngs(ings.filter((_, j) => j !== i))} />} />
            </View>
          ))}
        </Card>
      )}
      {!isNew ? (
        <Row wrap style={{ marginTop: spacing.xl }}>
          <Btn variant="secondary" title={t('recipe.logServing')} onPress={() => router.push(`/nutrition/add?tab=recipes`)} />
          <Btn variant="danger" title={t('common.delete')} onPress={async () => { if (await confirm({ title: t('recipe.delete'), message: t('recipe.deleteBody'), destructive: true, confirmLabel: t('common.delete') })) { await app.nutrition.deleteRecipe(id); router.back(); } }} />
        </Row>
      ) : null}
      <Sheet visible={adding} onClose={() => { setAdding(false); setPick(null); }} title={pick ? pick.name : t('recipe.addIngredient')}>
        {pick ? (
          <PortionForm item={{ name: pick.name, sourceKind: 'food', sourceId: pick.id, snapshot: pick.snapshot, qty: pick.snapshot.basis === 'per_serving' ? 1 : 100, unit: pick.snapshot.basis === 'per_serving' ? 'serving' : pick.snapshot.basis === 'per_100ml' ? 'ml' : 'g' }}
            showSlot={false} confirmLabel={t('recipe.addIngredient')} onConfirm={(qty, unit) => { setIngs([...ings, { name: pick.name, snapshot: pick.snapshot, qty, unit }]); setPick(null); setAdding(false); }} />
        ) : (
          <>
            <Field testID="ingredient-search" label={t('food.search')} value={q} onChangeText={setQ} autoCorrect={false} />
            {(results ?? []).map((f) => <ListItem key={f.id} title={f.name} subtitle={f.builtin ? t('food.staple') : t('food.yours')} onPress={() => setPick(f)} />)}
          </>
        )}
      </Sheet>
    </Screen>
  );
}
