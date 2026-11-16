import React, { useState } from 'react';
import { View } from 'react-native';

import { Chart } from '@/components/chart';
import { useFeedback } from '@/components/feedback';
import { Btn, Card, Chip, Divider, Field, IconBtn, ListItem, Loading, Row, Screen, SectionTitle, Txt } from '@/components/ui';
import { smoothedTrend } from '@/domain/review';
import { addDays, dateRange } from '@/domain/time';
import { fromKg, lengthFromMeters, lengthToMeters, parseDecimal, round, toKg } from '@/domain/units';
import { formatDate, t, type StringKey } from '@/i18n';
import { useApp, useLive } from '@/state/app';
import { errorText, useFmt } from '@/state/hooks';
import { spacing } from '@/theme';
import { nowMs } from '@/domain/clock';

const KINDS = ['weight', 'waist', 'hips', 'chest'] as const;
type Kind = (typeof KINDS)[number];

/** Optional body metrics. Weight is stored in kg and lengths in metres; the trend uses only logged days. */
export default function Body() {
  const app = useApp();
  const fmt = useFmt();
  const { toast } = useFeedback();
  const [kind, setKind] = useState<Kind>('weight');
  const [value, setValue] = useState('');
  const from = addDays(app.today, -89);
  const { data } = useLive((a) => a.recovery.listMeasurements(kind, from, a.today), ['measurements'], [kind]);
  const lu = app.prefs.lengthUnit;
  const show = (v: number) => (kind === 'weight' ? round(fromKg(v, fmt.wUnit), 1) : round(lengthFromMeters(v, lu), 1));
  const unit = kind === 'weight' ? fmt.wUnit : lu;
  const byDay = new Map((data ?? []).map((m) => [m.local_date, m.value]));
  const trend = kind === 'weight' ? new Map(smoothedTrend([...byDay].map(([date, v]) => ({ date, value: v }))).map((p) => [p.date, p.value])) : null;
  const days = dateRange(addDays(app.today, -29), app.today);
  return (
    <Screen testID="body" title={t('body.title')} back>
      <Row wrap gap={6}>{KINDS.map((k) => <Chip key={k} label={t(`body.${k}` as StringKey)} selected={kind === k} onPress={() => setKind(k)} />)}</Row>
      <Card style={{ marginTop: spacing.md, gap: spacing.sm }}>
        <Row>
          <Field testID="body-value" style={{ flex: 1 }} label={t('body.todayValue', { kind: t(`body.${kind}` as StringKey) })} suffix={unit} value={value} onChangeText={setValue} keyboardType="decimal-pad" />
          <Btn testID="body-save" title={t('common.save')} style={{ alignSelf: 'flex-end' }} onPress={async () => {
            const v = parseDecimal(value);
            if (v == null) return toast({ message: t('err.invalid_value'), tone: 'error' });
            try {
              await app.recovery.addMeasurement(kind, kind === 'weight' ? toKg(v, fmt.wUnit) : lengthToMeters(v, lu), app.today, nowMs());
              setValue('');
            } catch (e) {
              toast({ message: errorText(e), tone: 'error' });
            }
          }} />
        </Row>
        <Txt variant="caption" tone="textMuted">{t('body.neutral')}</Txt>
      </Card>
      {!data ? <Loading /> : (
        <>
          <Card style={{ marginTop: spacing.md }}>
            <Chart kind="line" title={kind === 'weight' ? t('body.trendTitle') : t(`body.${kind}` as StringKey)} points={days.map((d) => ({ label: formatDate(d, { month: 'short', day: 'numeric' }), value: trend ? (byDay.has(d) ? show(trend.get(d)!) : null) : byDay.has(d) ? show(byDay.get(d)!) : null }))}
              format={(v) => `${v} ${unit}`} summary={byDay.size ? t('body.summary', { count: days.filter((d) => byDay.has(d)).length, days: days.length }) : t('chart.noData')} />
            {kind === 'weight' ? <Txt variant="caption" tone="textMuted">{t('body.trendNote')}</Txt> : null}
          </Card>
          <SectionTitle>{t('body.entries')}</SectionTitle>
          <Card style={{ paddingVertical: spacing.sm }}>
            {data.length === 0 ? <Txt tone="textMuted">{t('body.none')}</Txt> : [...data].reverse().map((m, i) => (
              <View key={m.id}>
                {i > 0 ? <Divider /> : null}
                <ListItem title={`${show(m.value)} ${unit}`} subtitle={formatDate(m.local_date)} right={<IconBtn icon="trash-outline" label={t('common.delete')} onPress={() => void app.recovery.removeMeasurement(m.id)} />} />
              </View>
            ))}
          </Card>
        </>
      )}
    </Screen>
  );
}
