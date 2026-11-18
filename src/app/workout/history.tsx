import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';

import { Btn, Card, Divider, Empty, ListItem, Loading, Screen } from '@/components/ui';
import { formatDuration } from '@/domain/time';
import { fromKg } from '@/domain/units';
import { elapsedMs } from '@/domain/workout';
import { formatDate, t } from '@/i18n';
import { useLive } from '@/state/app';
import { useFmt } from '@/state/hooks';
import { spacing } from '@/theme';

const PAGE = 20;

export default function History() {
  const fmt = useFmt();
  const router = useRouter();
  const [pages, setPages] = useState(1);
  const { data } = useLive((a) => a.training.listHistory(PAGE * pages + 1), ['sessions', 'session_sets'], [pages]);
  if (!data) return <Screen title={t('train.history')} back><Loading /></Screen>;
  const more = data.length > PAGE * pages;
  const rows = data.slice(0, PAGE * pages);
  return (
    <Screen testID="history" title={t('train.history')} back>
      {rows.length === 0 ? <Empty icon="time-outline" title={t('train.noHistory.title')} body={t('train.noHistory.body')} /> : (
        <Card style={{ paddingVertical: spacing.sm }}>
          {rows.map((s, i) => (
            <View key={s.id}>
              {i > 0 ? <Divider /> : null}
              <ListItem title={s.title} subtitle={`${formatDate(s.local_date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })} · ${formatDuration(elapsedMs({ startedAt: s.started_at, endedAt: s.ended_at, pausedMs: s.paused_ms, pausedAt: null }, 0) / 1000)}`}
                value={t('train.historyValue', { sets: s.totals.workingSets, volume: fmt.num(fromKg(s.totals.volumeKg, fmt.wUnit)), unit: fmt.wUnit })} onPress={() => router.push(`/workout/summary/${s.id}`)} />
            </View>
          ))}
        </Card>
      )}
      {more ? <Btn style={{ marginTop: spacing.md }} variant="outline" title={t('common.loadMore')} onPress={() => setPages(pages + 1)} /> : null}
    </Screen>
  );
}
