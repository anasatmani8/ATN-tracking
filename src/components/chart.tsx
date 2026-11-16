import React, { useState } from 'react';
import { Pressable, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

import { t } from '@/i18n';
import { spacing, type } from '@/theme';
import { useTheme } from './theme-context';
import { Btn, Divider, Row, Txt } from './ui';

export interface Point {
  /** Category label shown on the x axis and in the table (e.g. a date). */
  label: string;
  /** null = nothing logged: drawn as a gap, never as zero. */
  value: number | null;
}

/**
 * Single-series chart (bar or line). One hue, no legend (the title names the series),
 * a recessive baseline, tap a mark to read its value, a written summary for screen
 * readers, and a table view as the accessible alternative.
 */
export function Chart({ title, points, kind = 'bar', format, summary, testID, height = 160 }: {
  title: string; points: Point[]; kind?: 'bar' | 'line'; format: (v: number) => string; summary: string; testID?: string; height?: number;
}) {
  const { c } = useTheme();
  const [w, setW] = useState(0);
  const [sel, setSel] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const vals = points.map((p) => p.value).filter((v): v is number => v != null);
  const logged = vals.length;
  const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width);

  let body: React.ReactNode = null;
  if (logged === 0) {
    body = <Txt tone="textMuted" style={{ paddingVertical: spacing.lg }}>{t('chart.noData')}</Txt>;
  } else if (table) {
    body = (
      <View accessibilityRole="list" style={{ gap: 2 }}>
        {points.map((p, i) => (
          <Row key={i} style={{ minHeight: 28 }}>
            <Txt variant="label" tone="textMuted" style={{ flex: 1 }}>{p.label}</Txt>
            <Txt variant="num">{p.value == null ? t('chart.notLogged') : format(p.value)}</Txt>
          </Row>
        ))}
      </View>
    );
  } else if (w > 0) {
    const max = Math.max(...vals);
    const min = kind === 'line' ? Math.min(...vals) : 0;
    const pad = kind === 'line' ? Math.max((max - min) * 0.15, max * 0.02, 0.5) : 0;
    const lo = kind === 'line' ? min - pad : 0;
    const hi = max + pad || 1;
    const top = 8;
    const h = height - top;
    const n = points.length;
    const step = w / n;
    const y = (v: number) => top + h - ((v - lo) / (hi - lo || 1)) * h;
    const xMid = (i: number) => step * i + step / 2;
    const barW = Math.max(2, Math.min(18, step * 0.6));
    const segs: string[] = [];
    let cur = '';
    points.forEach((p, i) => {
      if (p.value == null) { if (cur) segs.push(cur); cur = ''; return; }
      cur += `${cur ? 'L' : 'M'}${xMid(i).toFixed(1)},${y(p.value).toFixed(1)}`;
    });
    if (cur) segs.push(cur);
    body = (
      <View>
        <Svg width={w} height={height} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Line x1={0} x2={w} y1={top + h} y2={top + h} stroke={c.grid} strokeWidth={1} />
          {kind === 'bar' ? points.map((p, i) => {
            if (p.value == null || p.value <= 0) return null;
            const bh = Math.max(2, top + h - y(p.value));
            const x = xMid(i) - barW / 2;
            const r = Math.min(4, barW / 2, bh);
            // Rounded data end, square at the baseline.
            const d = `M${x},${top + h} L${x},${top + h - bh + r} Q${x},${top + h - bh} ${x + r},${top + h - bh} L${x + barW - r},${top + h - bh} Q${x + barW},${top + h - bh} ${x + barW},${top + h - bh + r} L${x + barW},${top + h} Z`;
            return <Path key={i} d={d} fill={c.chart} opacity={sel == null || sel === i ? 1 : 0.45} />;
          }) : (
            <>
              {segs.map((d, i) => <Path key={i} d={d} stroke={c.chart} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />)}
              {points.map((p, i) => (p.value == null ? null : <Circle key={i} cx={xMid(i)} cy={y(p.value)} r={sel === i ? 5 : 4} fill={c.chart} stroke={c.surface} strokeWidth={2} />))}
            </>
          )}
          {sel != null ? <Rect x={xMid(sel) - 0.5} y={top} width={1} height={h} fill={c.textFaint} /> : null}
        </Svg>
        {/* Hit targets wider than the marks. */}
        <View style={{ position: 'absolute', left: 0, top: 0, width: w, height, flexDirection: 'row' }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {points.map((p, i) => <Pressable key={i} style={{ flex: 1 }} onPress={() => setSel(sel === i ? null : i)} />)}
        </View>
        <Row style={{ justifyContent: 'space-between', marginTop: 4 }}>
          <Txt variant="caption" tone="textMuted">{points[0]?.label}</Txt>
          <Txt variant="caption" tone="textMuted">{points[n - 1]?.label}</Txt>
        </Row>
      </View>
    );
  }

  const selected = sel != null ? points[sel] : null;
  return (
    <View testID={testID} style={{ gap: spacing.sm }}>
      <Row>
        <Txt variant="headline" style={{ flex: 1 }} accessibilityRole="header">{title}</Txt>
        {logged > 0 ? <Btn size="sm" variant="ghost" title={table ? t('chart.showChart') : t('chart.showTable')} onPress={() => { setTable(!table); setSel(null); }} /> : null}
      </Row>
      <Text style={[type.caption, { color: c.textMuted }]} accessibilityRole="summary">{summary}</Text>
      <View onLayout={onLayout} accessible={!table} accessibilityLabel={`${title}. ${summary}`}>{body}</View>
      {selected && !table ? <Txt variant="label" accessibilityLiveRegion="polite">{selected.label}: {selected.value == null ? t('chart.notLogged') : format(selected.value)}</Txt> : null}
      {logged > 0 && logged < points.length ? <Txt variant="caption" tone="textMuted">{t('chart.sparse', { logged, total: points.length })}</Txt> : null}
      <Divider />
    </View>
  );
}
