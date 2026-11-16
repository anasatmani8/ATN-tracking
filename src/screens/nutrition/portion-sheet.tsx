import React, { useState } from 'react';
import { View } from 'react-native';

import { Btn, Chip, Field, Row, Segmented, Sheet, Txt } from '@/components/ui';
import type { LogInput } from '@/data/nutrition';
import { allowedUnits, scaleNutrients, type QtyUnit } from '@/domain/nutrition';
import { parseDecimal } from '@/domain/units';
import { t } from '@/i18n';
import { useApp } from '@/state/app';
import { useFmt } from '@/state/hooks';
import { spacing } from '@/theme';
import { NutrientLine } from './nutrient-line';

export function unitLabel(u: QtyUnit, servingLabel: string | null) {
  return u === 'serving' ? (servingLabel ?? t('unit.serving')) : u === 'g' ? 'g' : 'mL';
}

type FormProps = {
  item: LogInput | null; onConfirm: (qty: number, unit: QtyUnit, slot: string) => void | Promise<void>;
  confirmLabel: string; slot?: string; showSlot?: boolean; extra?: React.ReactNode;
};

/** Confirm the serving and units before anything is saved. */
export function PortionSheet({ visible, onClose, ...props }: FormProps & { visible: boolean; onClose: () => void }) {
  if (!props.item) return null;
  return (
    <Sheet visible={visible} onClose={onClose} title={props.item.name} testID="portion-sheet">
      <PortionForm key={`${props.item.sourceKind}:${props.item.sourceId ?? props.item.name}:${props.item.qty}:${props.item.unit}`} {...props} />
    </Sheet>
  );
}

export function PortionForm({ item, onConfirm, confirmLabel, slot: initialSlot, showSlot = true, extra }: FormProps) {
  const { prefs } = useApp();
  const fmt = useFmt();
  const units0 = item ? allowedUnits(item.snapshot) : [];
  const [qty, setQty] = useState(item ? String(item.qty) : '');
  const [unit, setUnit] = useState<QtyUnit>(item && units0.includes(item.unit) ? item.unit : (units0[0] ?? 'g'));
  const [slot, setSlot] = useState(initialSlot ?? prefs.mealSlots[0]);
  const [busy, setBusy] = useState(false);
  if (!item) return null;
  const s = item.snapshot;
  const units = allowedUnits(s);
  const q = parseDecimal(qty);
  const n = q != null ? scaleNutrients(s, q, unit) : null;
  const basisText = s.basis === 'per_100g' ? t('food.per100g') : s.basis === 'per_100ml' ? t('food.per100ml') : t('food.perServing', { label: s.servingLabel ?? t('unit.serving') });
  return (
    <View style={{ gap: spacing.md }}>
      <Txt variant="caption" tone="textMuted">{basisText}{s.servingLabel && s.basis !== 'per_serving' ? ` · ${t('food.serving', { label: s.servingLabel, amount: s.servingG ? `${fmt.num(s.servingG, 1)} g` : s.servingMl ? `${fmt.num(s.servingMl, 1)} mL` : '?' })}` : ''}</Txt>
      <Txt variant="caption" tone="textMuted">{t('food.source', { source: s.source })}</Txt>
      {units.length > 1 ? <Segmented<QtyUnit> label={t('food.unit')} value={unit} onChange={(u) => { setUnit(u); setQty(u === 'serving' ? '1' : String(u === 'g' ? (s.servingG ?? 100) : (s.servingMl ?? 100))); }} options={units.map((u) => ({ value: u, label: unitLabel(u, s.servingLabel) }))} /> : null}
      <Field testID="portion-qty" label={t('food.amount')} suffix={unitLabel(unit, s.servingLabel)} value={qty} onChangeText={setQty} keyboardType="decimal-pad" error={q == null || q <= 0 ? t('err.invalid_quantity') : null} />
      {s.basis === 'per_serving' && !s.servingG ? <Txt variant="caption" tone="textMuted">{t('food.noGramConversion')}</Txt> : null}
      {showSlot ? (
        <View style={{ gap: spacing.xs }}>
          <Txt variant="label" tone="textMuted">{t('nutrition.meal')}</Txt>
          <Row wrap gap={6}>{prefs.mealSlots.map((m) => <Chip key={m} label={m} selected={slot === m} onPress={() => setSlot(m)} />)}</Row>
        </View>
      ) : null}
      {n ? <NutrientLine n={n} /> : null}
      {extra}
      <Btn testID="portion-confirm" title={confirmLabel} loading={busy} disabled={!n} onPress={async () => { if (q == null || !n) return; setBusy(true); try { await onConfirm(q, unit, slot); } finally { setBusy(false); } }} />
    </View>
  );
}
