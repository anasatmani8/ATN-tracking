import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, useFonts } from '@expo-google-fonts/inter';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { FeedbackProvider } from '@/components/feedback';
import { ThemeProvider, useTheme } from '@/components/theme-context';
import { AppProvider, useApp } from '@/state/app';
import { ReminderSync } from '@/state/reminders';
import { palettes } from '@/theme';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

function Boot() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: palettes.light.primary }}>
      <ActivityIndicator color="#fff" accessibilityLabel="Loading" />
    </View>
  );
}

function Themed() {
  const { prefs } = useApp();
  return (
    <ThemeProvider mode={prefs.theme}>
      <FeedbackProvider>
        <Nav />
        <ReminderSync />
      </FeedbackProvider>
    </ThemeProvider>
  );
}

function Nav() {
  const { c, dark } = useTheme();
  return (
    <>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
        <Stack.Screen name="workout/preview" options={{ presentation: 'modal' }} />
        <Stack.Screen name="workout/active" options={{ presentation: 'fullScreenModal', gestureEnabled: false }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold });
  const ready = fontsLoaded || !!fontError;
  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);
  if (!ready) return <Boot />;
  return (
    <AppProvider fallback={<Boot />}>
      <Themed />
    </AppProvider>
  );
}
