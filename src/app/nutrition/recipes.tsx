import { useRouter } from 'expo-router';
import React from 'react';
import { View } from 'react-native';

import { Btn, Card, Divider, Empty, ListItem, Loading, Screen } from '@/components/ui';
import { recipeSnapshot } from '@/domain/nutrition';
import { t } from '@/i18n';
import { useApp, useLive } from '@/state/app';
import { useFmt } from '@/state/hooks';
import { spacing } from '@/theme';

export default function Recipes() {
  const router = useRouter();
  const fmt = useFmt();
  const { prefs } = useApp();
  const { data } = useLive((a) => a.nutrition.listRecipes(), ['recipes']);
  return (
    <Screen testID="recipes" title={t('nutrition.recipes')} back right={<Btn size="sm" variant="secondary" icon="add" title={t('recipe.new')} onPress={() => router.push('/nutrition/recipe/new')} testID="recipe-new" />}>
      {!data ? <Loading /> : data.length === 0 ? <Empty icon="book-outline" title={t('recipe.emptyTitle')} body={t('recipe.emptyBody')} /> : (
        <Card style={{ paddingVertical: spacing.sm }}>
          {data.map((r, i) => {
            const s = recipeSnapshot(r.ingredients, r.servingsYield, r.name);
            return (
              <View key={r.id}>
                {i > 0 ? <Divider /> : null}
                <ListItem title={r.name} subtitle={t('recipe.summary', { count: r.ingredients.length, n: fmt.num(r.servingsYield, 1) })} value={prefs.hideNutritionNumbers || s?.kcal == null ? undefined : t('recipe.perServingKcal', { kcal: fmt.num(s.kcal) })} onPress={() => router.push(`/nutrition/recipe/${r.id}`)} />
              </View>
            );
          })}
        </Card>
      )}
    </Screen>
  );
}
