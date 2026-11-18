import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';

import { useFeedback } from '@/components/feedback';
import { Btn, Card, Empty, Loading, Screen, Txt } from '@/components/ui';
import type { LogInput } from '@/data/nutrition';
import type { NutrientSnapshot } from '@/domain/nutrition';
import { formatDate, t } from '@/i18n';
import { useApp, useLive } from '@/state/app';
import { errorText } from '@/state/hooks';
import { PortionForm } from '@/screens/nutrition/portion-sheet';
import { NutrientLine } from '@/screens/nutrition/nutrient-line';
import { spacing } from '@/theme';
import { nowMs } from '@/domain/clock';

/** Edit a diary entry, or log a planned meal (optionally with a changed portion). */
export default function Entry() {
  const { id, date } = useLocalSearchParams<{ id: string; date?: string }>();
  const app = useApp();
  const router = useRouter();
  const { toast, confirm } = useFeedback();
  const plannedId = id.startsWith('planned-') ? id.slice(8) : null;
  const { data } = useLive(async (a) => {
    if (plannedId) {
      const p = (await a.nutrition.listPlanned('0000-01-01', '9999-12-31')).find((x) => x.id === plannedId) ?? null;
      return { planned: p, log: null };
    }
    return { planned: null, log: await a.nutrition.getLog(id) };
  }, ['food_logs', 'planned_meals'], [id]);
  const back = () => (router.canGoBack() ? router.back() : router.replace('/nutrition'));
  if (!data) return <Screen title="" back><Loading /></Screen>;
  const row = data.planned ?? data.log;
  if (!row) return <Screen title={t('nutrition.entry')} back><Empty icon="alert-circle-outline" title={t('fallback.missing.title')} body={t('fallback.missing.body')} action={<Btn title={t('common.back')} onPress={back} />} /></Screen>;
  const item: LogInput = { name: row.name, sourceKind: row.source_kind, sourceId: row.source_id, snapshot: JSON.parse(row.snapshot) as NutrientSnapshot, qty: row.qty, unit: row.unit };

  if (data.planned) {
    const pm = data.planned;
    return (
      <Screen testID="planned-entry" title={pm.name} subtitle={`${t('nutrition.plannedFor', { date: formatDate(pm.local_date) })} · ${pm.meal_slot}`} back>
        <Card style={{ gap: spacing.sm }}>
          <Txt>{pm.status === 'logged' ? t('nutrition.plannedLogged') : t('nutrition.plannedNote')}</Txt>
          <Btn variant="danger" title={t('nutrition.removePlan')} onPress={async () => { await app.nutrition.deletePlanned(pm.id); back(); }} />
        </Card>
        {pm.status === 'planned' ? <Card style={{ marginTop: spacing.md }}><PortionForm item={item} slot={pm.meal_slot} showSlot={false} confirmLabel={t('nutrition.logIt')}
          onConfirm={async (qty, unit) => {
            try {
              const logDate = date && date >= pm.local_date ? date : pm.local_date;
              await app.nutrition.logPlanned(pm.id, nowMs(), app.tz, { qty, unit }, logDate);
              toast({ message: t('nutrition.loggedToast', { name: pm.name, slot: pm.meal_slot }) });
              back();
            } catch (e) {
              toast({ message: errorText(e), tone: 'error' });
            }
          }} /></Card> : null}
      </Screen>
    );
  }
  const log = data.log!;
  return (
    <Screen testID="entry-edit" title={log.name} subtitle={`${formatDate(log.local_date)} · ${log.meal_slot}`} back>
      <Card style={{ gap: spacing.sm }}>
        <NutrientLine n={{ kcal: log.kcal, proteinG: log.protein_g, carbsG: log.carbs_g, fatG: log.fat_g }} />
        <Txt variant="caption" tone="textMuted">{t('nutrition.snapshotNote')}</Txt>
        <Btn testID="entry-delete" variant="danger" icon="trash-outline" title={t('common.delete')} onPress={async () => {
          if (!(await confirm({ title: t('nutrition.deleteEntry'), destructive: true, confirmLabel: t('common.delete') }))) return;
          await app.nutrition.deleteLog(log.id);
          back();
        }} />
      </Card>
      <Card style={{ marginTop: spacing.md }}><PortionForm item={item} slot={log.meal_slot} confirmLabel={t('common.save')}
        onConfirm={async (qty, unit, slot) => {
          try {
            await app.nutrition.editLog(log.id, { qty, unit, mealSlot: slot });
            toast({ message: t('common.saved') });
            back();
          } catch (e) {
            toast({ message: errorText(e), tone: 'error' });
          }
        }} /></Card>
    </Screen>
  );
}
