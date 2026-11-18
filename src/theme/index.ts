import type { TextStyle } from 'react-native';

/** Brand palette. Light is a warm neutral with white cards; dark is a deliberate deep-navy set, not an inversion. */
export const palettes = {
  light: {
    bg: '#F5F3EF', surface: '#FFFFFF', surfaceAlt: '#EEEBE5', border: '#E2DED6',
    text: '#14161C', textMuted: '#5B6070', textFaint: '#8A8F9C',
    primary: '#1D4ED8', primaryPressed: '#1A43BC', onPrimary: '#FFFFFF', primarySoft: '#E4EBFD', onPrimarySoft: '#16379E',
    violet: '#6D3FD6', violetSoft: '#EEE7FD', onViolet: '#FFFFFF', heroA: '#7C4DEB', heroB: '#3B5BEA', heroC: '#B9A5F7',
    success: '#17703F', successSoft: '#DFF3E7', warning: '#8A5A00', warningSoft: '#FBEFD2', danger: '#B3261E', dangerSoft: '#FBE4E2',
    ink: '#14161C', onInk: '#FFFFFF', overlay: 'rgba(15,18,28,0.45)', chart: '#1D4ED8', grid: '#E2DED6',
  },
  dark: {
    bg: '#0C0F17', surface: '#161A25', surfaceAlt: '#1F2431', border: '#2B3142',
    text: '#F1F3F8', textMuted: '#A7AEC0', textFaint: '#7C8498',
    primary: '#6E93FF', primaryPressed: '#89A6FF', onPrimary: '#08112B', primarySoft: '#1B2850', onPrimarySoft: '#C4D3FF',
    violet: '#A98BFF', violetSoft: '#2A2150', onViolet: '#150B33', heroA: '#4B2BA8', heroB: '#243C9E', heroC: '#6C55C4',
    success: '#5FD08F', successSoft: '#133223', warning: '#F0C060', warningSoft: '#3A2D0E', danger: '#FF8A80', dangerSoft: '#40191A',
    ink: '#F1F3F8', onInk: '#0C0F17', overlay: 'rgba(0,0,0,0.6)', chart: '#5B82F5', grid: '#2B3142',
  },
} as const;

export type Palette = { [K in keyof (typeof palettes)['light']]: string };

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;
export const radius = { sm: 8, md: 12, lg: 16, xl: 24, full: 9999 } as const;
export const shadows = {
  card: '0 1px 2px rgba(20, 22, 28, 0.06)',
  raised: '0 6px 16px rgba(20, 22, 28, 0.12)',
} as const;
export const motion = { fast: 150, base: 250 } as const;
/** Minimum touch target: 44 pt on iOS, 48 dp on Android. 48 satisfies both. */
export const TOUCH = 48;

export const fonts = {
  regular: 'Inter_400Regular', medium: 'Inter_500Medium', semibold: 'Inter_600SemiBold', bold: 'Inter_700Bold',
} as const;

const tabular: TextStyle = { fontVariant: ['tabular-nums'] };

/** Type ramp. Sizes scale with the system text size. */
export const type = {
  display: { fontFamily: fonts.bold, fontSize: 30, lineHeight: 36 },
  title: { fontFamily: fonts.bold, fontSize: 22, lineHeight: 28 },
  headline: { fontFamily: fonts.semibold, fontSize: 17, lineHeight: 22 },
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 22 },
  bodyStrong: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 22 },
  label: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 18 },
  caption: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 17 },
  overline: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16, letterSpacing: 0.6, textTransform: 'uppercase' },
  metric: { fontFamily: fonts.bold, fontSize: 26, lineHeight: 30, ...tabular },
  timer: { fontFamily: fonts.semibold, fontSize: 17, lineHeight: 22, ...tabular },
  num: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 22, ...tabular },
} as const satisfies Record<string, TextStyle>;
export type TypeVariant = keyof typeof type;
