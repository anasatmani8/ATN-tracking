import { Ionicons } from '@expo/vector-icons';
import { Redirect, useRouter } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/components/theme-context';
import type { IconName } from '@/components/ui';
import { formatDuration } from '@/domain/time';
import { elapsedMs } from '@/domain/workout';
import { t, type StringKey } from '@/i18n';
import { useApp, useLive } from '@/state/app';
import { useNow } from '@/state/hooks';
import { radius, shadows, spacing, type } from '@/theme';

const TABS: { name: string; label: StringKey; icon: IconName; iconOn: IconName }[] = [
  { name: 'index', label: 'tab.today', icon: 'today-outline', iconOn: 'today' },
  { name: 'train', label: 'tab.train', icon: 'barbell-outline', iconOn: 'barbell' },
  { name: 'nutrition', label: 'tab.nutrition', icon: 'restaurant-outline', iconOn: 'restaurant' },
  { name: 'recovery', label: 'tab.recovery', icon: 'moon-outline', iconOn: 'moon' },
  { name: 'progress', label: 'tab.progress', icon: 'stats-chart-outline', iconOn: 'stats-chart' },
];

/** Persistent while a session is active, on every tab. */
function ResumeBar() {
  const { c } = useTheme();
  const router = useRouter();
  const { data: active } = useLive((a) => a.training.getActiveSession(), ['sessions']);
  const now = useNow(1000, !!active);
  if (!active) return null;
  const elapsed = formatDuration(elapsedMs({ startedAt: active.started_at, endedAt: null, pausedMs: active.paused_ms, pausedAt: active.paused_at }, now) / 1000);
  return (
    <Pressable
      testID="resume-workout"
      accessibilityRole="button"
      accessibilityLabel={t('resume.a11y', { title: active.title, elapsed })}
      onPress={() => router.push('/workout/active')}
      style={({ pressed }) => [styles.resume, { backgroundColor: c.violet, boxShadow: shadows.raised, opacity: pressed ? 0.85 : 1 }]}>
      <Ionicons name={active.paused_at ? 'pause' : 'play'} size={18} color={c.onViolet} />
      <View style={{ flex: 1 }}>
        <Text style={[type.bodyStrong, { color: c.onViolet }]} numberOfLines={1}>{t('resume.title')}</Text>
        <Text style={[type.caption, { color: c.onViolet }]} numberOfLines={1}>{active.title}{active.paused_at ? ` · ${t('workout.paused')}` : ''}</Text>
      </View>
      <Text style={[type.timer, { color: c.onViolet }]}>{elapsed}</Text>
    </Pressable>
  );
}

export default function TabsLayout() {
  const { prefs } = useApp();
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  if (!prefs.onboarded) return <Redirect href="/onboarding" />;
  return (
    <Tabs
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: c.bg } }}
      tabBar={({ state, navigateToTab }) => (
        <View style={{ backgroundColor: c.surface, borderTopColor: c.border, borderTopWidth: StyleSheet.hairlineWidth }}>
          <ResumeBar />
          <View accessibilityRole="tablist" style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 6) }]}>
            {state.routes.map((route, i) => {
              const tab = TABS.find((x) => x.name === route.name);
              if (!tab) return null;
              const on = state.index === i;
              return (
                <Pressable
                  key={route.key}
                  testID={`tab-${tab.name}`}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={t(tab.label)}
                  onPress={() => {
                    if (!on) navigateToTab(route.key);
                  }}
                  style={styles.tab}>
                  <Ionicons name={on ? tab.iconOn : tab.icon} size={22} color={on ? c.primary : c.textMuted} />
                  <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={[type.caption, { fontFamily: on ? type.bodyStrong.fontFamily : type.caption.fontFamily, color: on ? c.primary : c.textMuted }]}>{t(tab.label)}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}>
      {TABS.map((tab) => <Tabs.Screen key={tab.name} name={tab.name} />)}
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', paddingTop: 6, maxWidth: 640, width: '100%', alignSelf: 'center' },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 52, gap: 2 },
  resume: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginHorizontal: spacing.md, marginTop: spacing.sm, paddingHorizontal: spacing.lg, minHeight: 56, borderRadius: radius.lg, maxWidth: 616, alignSelf: 'center', width: '94%' },
});
