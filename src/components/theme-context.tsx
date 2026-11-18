import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { palettes, type Palette } from '@/theme';

interface ThemeValue {
  c: Palette;
  dark: boolean;
}
const ThemeCtx = createContext<ThemeValue>({ c: palettes.light, dark: false });

export function ThemeProvider({ mode, children }: { mode: 'system' | 'light' | 'dark'; children: React.ReactNode }) {
  const system = useColorScheme();
  const dark = mode === 'system' ? system === 'dark' : mode === 'dark';
  const value = useMemo(() => ({ c: dark ? palettes.dark : palettes.light, dark }), [dark]);
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export const useTheme = () => useContext(ThemeCtx);
