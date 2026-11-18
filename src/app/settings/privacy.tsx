import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';

import { useFeedback } from '@/components/feedback';
import { Btn, Card, Divider, ListItem, Screen, SectionTitle, Txt } from '@/components/ui';
import { BASELINE_ATTRIBUTION } from '@/data/catalog/foods';
import type { ExportBundle } from '@/data/export';
import { t, type StringKey } from '@/i18n';
import { useApp } from '@/state/app';
import { shareCsv, shareJson } from '@/state/export-share';
import { spacing } from '@/theme';
import { nowMs } from '@/domain/clock';

const CSV_TABLES: (keyof ExportBundle['tables'])[] = ['sessions', 'session_exercises', 'session_sets', 'programs', 'scheduled_workouts', 'food_logs', 'planned_meals', 'foods', 'recipes', 'water_logs', 'sleep_logs', 'measurements', 'checkins', 'reminders', 'prefs'];

/** What is stored and where, export of everything (hidden trackers included), and local erase. */
export default function Privacy() {
  const app = useApp();
  const router = useRouter();
  const { confirm, toast } = useFeedback();
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch {
      toast({ message: t('export.failed'), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen testID="privacy" title={t('privacy.title')} back>
      <Card style={{ gap: spacing.sm }}>
        <Txt variant="headline">{t('privacy.storedTitle')}</Txt>
        <Txt>{app.cloud.enabled && app.cloud.userId ? t('privacy.storedCloud') : t('privacy.storedLocal')}</Txt>
        <Txt variant="caption" tone="textMuted">{t('privacy.noTracking')}</Txt>
        <Txt variant="caption" tone="textMuted">{t('privacy.backups')}</Txt>
      </Card>

      <SectionTitle>{t('export.title')}</SectionTitle>
      <Card style={{ gap: spacing.sm }}>
        <Txt variant="caption" tone="textMuted">{t('export.note')}</Txt>
        <Btn testID="export-json" icon="download-outline" title={t('export.json')} loading={busy} onPress={() => void run(async () => { const b = await shareJson(app.db, nowMs()); toast({ message: t('export.done', { count: Object.values(b.tables).reduce((a, r) => a + r.length, 0) }) }); })} />
        <Txt variant="label" tone="textMuted" style={{ marginTop: spacing.sm }}>{t('export.csv')}</Txt>
        {CSV_TABLES.map((tb, i) => (
          <View key={tb}>
            {i > 0 ? <Divider /> : null}
            <ListItem testID={`export-csv-${tb}`} title={t(`export.table.${tb}` as StringKey)} onPress={() => void run(() => shareCsv(app.db, tb, nowMs()))} />
          </View>
        ))}
      </Card>

      <SectionTitle>{t('privacy.erase')}</SectionTitle>
      <Card style={{ gap: spacing.sm }}>
        <Txt>{app.cloud.userId ? t('privacy.eraseAccountNote') : t('privacy.eraseBody')}</Txt>
        <Btn testID="erase-local" variant="danger" icon="trash-outline" title={t('privacy.eraseCta')} onPress={async () => {
          if (!(await confirm({ title: t('privacy.eraseConfirmTitle'), message: t('privacy.eraseConfirmBody'), destructive: true, confirmLabel: t('privacy.eraseCta') }))) return;
          await app.eraseLocal();
          router.replace('/onboarding');
        }} />
        {app.cloud.userId ? <Btn variant="outline" title={t('account.delete')} onPress={() => router.push('/settings/account')} /> : null}
      </Card>

      <SectionTitle>{t('privacy.sources')}</SectionTitle>
      <Card style={{ gap: spacing.sm }}>
        <Txt variant="caption" tone="textMuted">{BASELINE_ATTRIBUTION}</Txt>
        <Txt variant="caption" tone="textMuted">{t('privacy.exerciseText')}</Txt>
        <Txt variant="caption" tone="textMuted">{t('privacy.fonts')}</Txt>
        <Txt variant="caption" tone="textMuted">{t('settings.disclaimer')}</Txt>
      </Card>
    </Screen>
  );
}
