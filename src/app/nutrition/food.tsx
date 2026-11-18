import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';

import { useFeedback } from '@/components/feedback';
import { Btn, Field, Row, Screen, Segmented, Txt } from '@/components/ui';
import type { NutrientBasis } from '@/domain/nutrition';
import { isValidBarcode } from '@/domain/nutrition';
import { parseDecimal } from '@/domain/units';
import { t } from '@/i18n';
import { useApp } from '@/state/app';
import { errorText } from '@/state/hooks';
import { spacing } from '@/theme';

/** Create or edit your own food. Leaving a nutrient blank records it as unknown. Edits affect future logs only. */
export default function FoodForm() {
  const p = useLocalSearchParams<{ id?: string; barcode?: string }>();
  const app = useApp();
  const router = useRouter();
  const { toast, confirm } = useFeedback();
  const [v, setV] = useState({ name: '', brand: '', barcode: p.barcode ?? '', basis: 'per_100g' as NutrientBasis, servingLabel: '', servingAmt: '', kcal: '', protein: '', carbs: '', fat: '' });
  useEffect(() => {
    if (!p.id) return;
    app.nutrition.getFood(p.id).then((f) => {
      if (!f || f.builtin) return;
      const s = f.snapshot;
      const str = (x: number | null) => (x == null ? '' : String(x));
      setV({ name: f.name, brand: f.brand ?? '', barcode: f.barcode ?? '', basis: s.basis, servingLabel: s.servingLabel ?? '', servingAmt: str(s.servingG ?? s.servingMl), kcal: str(s.kcal), protein: str(s.proteinG), carbs: str(s.carbsG), fat: str(s.fatG) });
    });
  }, [p.id, app.nutrition]);
  const set = (k: keyof typeof v) => (x: string) => setV({ ...v, [k]: x });
  const save = async () => {
    const n = (s: string) => (s.trim() === '' ? null : parseDecimal(s));
    const nums = [v.kcal, v.protein, v.carbs, v.fat, v.servingAmt];
    if (nums.some((s) => s.trim() !== '' && n(s) == null)) return toast({ message: t('err.invalid_value'), tone: 'error' });
    if (v.barcode.trim() && !isValidBarcode(v.barcode.trim())) return toast({ message: t('scan.invalid'), tone: 'error' });
    if (v.basis === 'per_serving' && !v.servingLabel.trim()) return toast({ message: t('food.servingRequired'), tone: 'error' });
    const amt = n(v.servingAmt);
    try {
      await app.nutrition.saveFood({
        id: p.id, name: v.name, brand: v.brand.trim() || null, barcode: v.barcode.trim() || null,
        snapshot: {
          basis: v.basis, servingLabel: v.servingLabel.trim() || null,
          servingG: v.basis === 'per_100ml' ? null : amt, servingMl: v.basis === 'per_100ml' ? amt : null,
          kcal: n(v.kcal), proteinG: n(v.protein), carbsG: n(v.carbs), fatG: n(v.fat), source: t('food.sourceUser'),
        },
      });
      toast({ message: t('common.saved') });
      router.back();
    } catch (e) {
      toast({ message: errorText(e), tone: 'error' });
    }
  };
  const basisUnit = v.basis === 'per_100ml' ? 'mL' : 'g';
  return (
    <Screen testID="food-form" title={p.id ? t('food.edit') : t('food.create')} back footer={<Btn testID="food-save" title={t('common.save')} onPress={() => void save()} />}>
      <Row style={{ flexDirection: 'column', alignItems: 'stretch', gap: spacing.md }}>
        <Field testID="food-name" label={t('food.name')} value={v.name} onChangeText={set('name')} maxLength={80} />
        <Field label={t('food.brand')} value={v.brand} onChangeText={set('brand')} maxLength={60} />
        <Field label={t('food.barcode')} value={v.barcode} onChangeText={set('barcode')} keyboardType="number-pad" maxLength={14} hint={t('food.barcodeHint')} />
        <Txt variant="label" tone="textMuted">{t('food.basis')}</Txt>
        <Segmented<NutrientBasis> label={t('food.basis')} value={v.basis} onChange={(basis) => setV({ ...v, basis })} options={[{ value: 'per_100g', label: t('food.per100g') }, { value: 'per_100ml', label: t('food.per100ml') }, { value: 'per_serving', label: t('food.perServingShort') }]} />
        <Row>
          <Field style={{ flex: 1 }} label={t('food.servingLabel')} placeholder={t('food.servingLabelPh')} value={v.servingLabel} onChangeText={set('servingLabel')} maxLength={40} />
          <Field style={{ flex: 1 }} label={t('food.servingAmount')} suffix={basisUnit} value={v.servingAmt} onChangeText={set('servingAmt')} keyboardType="decimal-pad" hint={t('food.servingAmountHint')} />
        </Row>
        <Txt variant="caption" tone="textMuted">{t('food.blankUnknown')}</Txt>
        <Row>
          <Field testID="food-kcal" style={{ flex: 1 }} label={t('macro.kcal')} suffix="kcal" value={v.kcal} onChangeText={set('kcal')} keyboardType="decimal-pad" />
          <Field style={{ flex: 1 }} label={t('macro.proteinG')} suffix="g" value={v.protein} onChangeText={set('protein')} keyboardType="decimal-pad" />
        </Row>
        <Row>
          <Field style={{ flex: 1 }} label={t('macro.carbsG')} suffix="g" value={v.carbs} onChangeText={set('carbs')} keyboardType="decimal-pad" />
          <Field style={{ flex: 1 }} label={t('macro.fatG')} suffix="g" value={v.fat} onChangeText={set('fat')} keyboardType="decimal-pad" />
        </Row>
        {p.id ? <Btn variant="danger" title={t('common.delete')} onPress={async () => { if (await confirm({ title: t('food.delete'), message: t('food.deleteBody'), destructive: true, confirmLabel: t('common.delete') })) { await app.nutrition.deleteFood(p.id!); router.back(); } }} /> : null}
      </Row>
    </Screen>
  );
}
