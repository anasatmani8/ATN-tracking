import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { addDays, type LocalDate } from '@/domain/time';
import { formatDate, t } from '@/i18n';
import { type, TOUCH } from '@/theme';
import { useTheme } from './theme-context';
import { IconBtn } from './ui';

/** Previous / next day with a tap-to-return-to-today label. Future days are allowed for planning screens only. */
export function DateNav({ date, today, onChange, allowFuture, onBrand }: { date: LocalDate; today: LocalDate; onChange: (d: LocalDate) => void; allowFuture?: boolean; onBrand?: boolean }) {
  const { c } = useTheme();
  const label = date === today ? t('date.today') : date === addDays(today, -1) ? t('date.yesterday') : date === addDays(today, 1) ? t('date.tomorrow') : formatDate(date);
  const tone = onBrand ? 'onPrimary' : 'text';
  const canNext = allowFuture || date < today;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <IconBtn icon="chevron-back" label={t('date.prev')} tone={tone} onPress={() => onChange(addDays(date, -1))} testID="date-prev" />
      <Pressable testID="date-label" accessibilityRole="button" accessibilityLabel={t('date.a11y', { date: formatDate(date, { weekday: 'long', month: 'long', day: 'numeric' }) })} accessibilityHint={date === today ? undefined : t('date.backToToday')} onPress={() => onChange(today)} style={{ flex: 1, minHeight: TOUCH, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={[type.bodyStrong, { color: onBrand ? c.onPrimary : c.text }]}>{label}</Text>
        {date !== today ? <Text style={[type.caption, { color: onBrand ? c.onPrimary : c.textMuted }]}>{formatDate(date)}</Text> : null}
      </Pressable>
      <IconBtn icon="chevron-forward" label={t('date.next')} tone={tone} disabled={!canNext} onPress={() => onChange(addDays(date, 1))} testID="date-next" />
    </View>
  );
}
