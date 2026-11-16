import React, { useEffect, useState } from 'react';
import { Linking, Platform, View } from 'react-native';

import { useFeedback } from '@/components/feedback';
import { Banner, Btn, Card, Chip, Divider, Field, IconBtn, Row, Screen, SectionTitle, Sheet, Toggle, Txt } from '@/components/ui';
import type { Reminder } from '@/data/recovery';
import { inQuietHours } from '@/domain/recovery';
import { isValidTime } from '@/domain/time';
import { t, weekdayName, type StringKey } from '@/i18n';
import { useApp, useLive } from '@/state/app';
import { notificationPermission, requestNotificationPermission, type PermissionState } from '@/state/reminders';
import { spacing } from '@/theme';

const KINDS: Reminder['kind'][] = ['workout', 'water', 'bedtime', 'checkin'];

/** Reminders are optional. Permission is requested only when the user turns one on. */
export default function Reminders() {
  const app = useApp();
  const { toast } = useFeedback();
  const [perm, setPerm] = useState<PermissionState>('undetermined');
  const [edit, setEdit] = useState<{ id?: string; kind: Reminder['kind']; time: string; weekdays: number[]; enabled: boolean } | null>(null);
  const { data } = useLive((a) => a.recovery.listReminders(), ['reminders']);
  useEffect(() => { notificationPermission().then(setPerm); }, []);
  const { prefs } = app;
  const [qs, setQs] = useState(prefs.quietStart ?? '');
  const [qe, setQe] = useState(prefs.quietEnd ?? '');

  const save = async () => {
    if (!edit) return;
    if (!isValidTime(edit.time) || edit.weekdays.length === 0) return toast({ message: t('err.invalid_time'), tone: 'error' });
    let p = perm;
    if (edit.enabled && p === 'undetermined') p = await requestNotificationPermission();
    setPerm(p);
    await app.recovery.saveReminder(edit);
    setEdit(null);
    if (p === 'denied') toast({ message: t('reminders.savedDenied') });
    else if (inQuietHours(edit.time, prefs.quietStart, prefs.quietEnd)) toast({ message: t('reminders.inQuiet') });
    else toast({ message: t('common.saved') });
  };

  return (
    <Screen testID="reminders" title={t('reminders.title')} back right={<Btn size="sm" variant="secondary" icon="add" title={t('common.add')} testID="reminder-add" onPress={() => setEdit({ kind: 'water', time: '10:00', weekdays: [0, 1, 2, 3, 4, 5, 6], enabled: true })} />}>
      {perm === 'unsupported' ? <Banner icon="information-circle-outline" text={t('reminders.unsupported')} /> : null}
      {perm === 'denied' ? <Banner tone="warning" icon="notifications-off-outline" text={t('reminders.denied')} action={Platform.OS !== 'web' ? <Btn size="sm" variant="outline" title={t('common.openSettings')} onPress={() => void Linking.openSettings()} /> : undefined} /> : null}
      <Txt variant="caption" tone="textMuted" style={{ marginTop: spacing.sm }}>{t('reminders.intro')}</Txt>
      <SectionTitle>{t('reminders.list')}</SectionTitle>
      <Card style={{ paddingVertical: spacing.sm }}>
        {data?.length ? data.map((r, i) => {
          const days: number[] = JSON.parse(r.weekdays);
          return (
            <View key={r.id}>
              {i > 0 ? <Divider /> : null}
              <Row style={{ minHeight: 56 }}>
                <View style={{ flex: 1 }}>
                  <Txt variant="bodyStrong">{t(`reminders.kind.${r.kind}` as StringKey)} · {r.time}</Txt>
                  <Txt variant="caption" tone="textMuted">{days.length === 7 ? t('reminders.everyDay') : days.map((d) => weekdayName(d)).join(', ')}{inQuietHours(r.time, prefs.quietStart, prefs.quietEnd) ? ` · ${t('reminders.quietShort')}` : ''}</Txt>
                </View>
                <IconBtn icon="create-outline" label={t('common.edit')} onPress={() => setEdit({ id: r.id, kind: r.kind, time: r.time, weekdays: days, enabled: r.enabled === 1 })} />
                <IconBtn icon="trash-outline" label={t('common.delete')} onPress={() => void app.recovery.removeReminder(r.id)} />
              </Row>
            </View>
          );
        }) : <Txt tone="textMuted" style={{ paddingVertical: spacing.md }}>{t('reminders.none')}</Txt>}
      </Card>
      <SectionTitle>{t('reminders.quiet')}</SectionTitle>
      <Card style={{ gap: spacing.sm }}>
        <Row>
          <Field style={{ flex: 1 }} label={t('reminders.quietFrom')} value={qs} onChangeText={setQs} maxLength={5} placeholder="22:00" onBlur={() => void app.setPrefs({ quietStart: isValidTime(qs) ? qs : null })} />
          <Field style={{ flex: 1 }} label={t('reminders.quietTo')} value={qe} onChangeText={setQe} maxLength={5} placeholder="07:00" onBlur={() => void app.setPrefs({ quietEnd: isValidTime(qe) ? qe : null })} />
        </Row>
        <Txt variant="caption" tone="textMuted">{t('reminders.quietHint')}</Txt>
      </Card>
      <Sheet visible={!!edit} onClose={() => setEdit(null)} title={edit?.id ? t('reminders.edit') : t('reminders.new')}>
        {edit ? (
          <>
            <Row wrap gap={6}>{KINDS.map((k) => <Chip key={k} label={t(`reminders.kind.${k}` as StringKey)} selected={edit.kind === k} onPress={() => setEdit({ ...edit, kind: k })} />)}</Row>
            <Field testID="reminder-time" label={t('reminders.time')} value={edit.time} onChangeText={(time) => setEdit({ ...edit, time })} maxLength={5} hint="HH:MM" />
            <Row wrap gap={6}>{[1, 2, 3, 4, 5, 6, 0].map((d) => <Chip key={d} label={weekdayName(d)} selected={edit.weekdays.includes(d)} onPress={() => setEdit({ ...edit, weekdays: edit.weekdays.includes(d) ? edit.weekdays.filter((x) => x !== d) : [...edit.weekdays, d] })} />)}</Row>
            <Toggle label={t('reminders.enabled')} value={edit.enabled} onChange={(enabled) => setEdit({ ...edit, enabled })} />
            {edit.enabled && perm === 'undetermined' ? <Txt variant="caption" tone="textMuted">{t('reminders.permissionWhy')}</Txt> : null}
            <Btn testID="reminder-save" title={t('common.save')} onPress={() => void save()} />
          </>
        ) : null}
      </Sheet>
    </Screen>
  );
}
