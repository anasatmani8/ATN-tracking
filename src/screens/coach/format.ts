import { useMemo } from 'react';
import type { Change } from '@/data/coach';
import type { Insight } from '@/domain/coach-insights';
import { formatHoursMinutes } from '@/domain/time';
import { formatDate, t, weekdayName, type StringKey } from '@/i18n';
import { useFmt } from '@/state/hooks';

/** Turns canonical values in proposals and insights into the user's units and language. */
export function useCoachFormat() {
  const fmt = useFmt();
  return useMemo(() => {
    const value = (v: Change['from'], unit: Change['unit']): string => {
      if (v == null || v === '') return '—';
      if (Array.isArray(v)) return v.length === 7 ? t('reminders.everyDay') : v.map((d) => weekdayName(d)).join(', ');
      switch (unit) {
        case 'kg': return fmt.weight(Number(v));
        case 'ml': return fmt.volume(Number(v));
        case 'min': return formatHoursMinutes(Number(v));
        case 'sec': return t('coach.unit.sec', { n: v });
        case 'kcal': return `${fmt.num(Number(v))} kcal`;
        case 'g': return `${fmt.num(Number(v))} g`;
        case 'date': return formatDate(String(v));
        case 'text': return t(`coach.value.${v}` as StringKey) === `coach.value.${v}` ? String(v) : t(`coach.value.${v}` as StringKey);
        default: return String(v);
      }
    };
    const field = (f: string) => {
      const key = `coach.field.${f}` as StringKey;
      return t(key) === key ? f : t(key);
    };
    const insightParams = (i: Insight): Record<string, string | number> => {
      const p = { ...i.params };
      for (const k of ['date', 'newDate']) if (typeof p[k] === 'string' && p[k]) p[k] = formatDate(p[k] as string);
      for (const k of ['currentKg', 'suggestedKg']) if (typeof p[k] === 'number') p[k] = fmt.weight(p[k] as number);
      for (const k of ['avgMl', 'goalMl']) if (typeof p[k] === 'number') p[k] = fmt.volume(p[k] as number);
      for (const k of ['avgMin', 'goalMin']) if (typeof p[k] === 'number') p[k] = formatHoursMinutes(p[k] as number);
      return p;
    };
    return { value, field, insightParams };
  }, [fmt]);
}
