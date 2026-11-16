import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View,
  type StyleProp, type TextInputProps, type TextProps, type TextStyle, type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { t } from '@/i18n';
import { radius, shadows, spacing, TOUCH, type, type Palette, type TypeVariant } from '@/theme';
import { useTheme } from './theme-context';

export type IconName = React.ComponentProps<typeof Ionicons>['name'];
type Tone = keyof Pick<Palette, 'text' | 'textMuted' | 'textFaint' | 'primary' | 'onPrimary' | 'danger' | 'success' | 'warning' | 'violet' | 'onPrimarySoft' | 'onInk' | 'onViolet'>;

export function Txt({ variant = 'body', tone = 'text', style, ...props }: TextProps & { variant?: TypeVariant; tone?: Tone }) {
  const { c } = useTheme();
  return <Text {...props} style={[type[variant] as TextStyle, { color: c[tone] }, style]} />;
}

export function Icon({ name, size = 22, tone = 'text' }: { name: IconName; size?: number; tone?: Tone }) {
  const { c } = useTheme();
  return <Ionicons name={name} size={size} color={c[tone]} accessibilityElementsHidden importantForAccessibility="no" />;
}

const btnVariants = {
  primary: (c: Palette) => ({ bg: c.primary, fg: c.onPrimary, border: c.primary }),
  ink: (c: Palette) => ({ bg: c.ink, fg: c.onInk, border: c.ink }),
  secondary: (c: Palette) => ({ bg: c.primarySoft, fg: c.onPrimarySoft, border: c.primarySoft }),
  outline: (c: Palette) => ({ bg: 'transparent', fg: c.text, border: c.border }),
  ghost: (c: Palette) => ({ bg: 'transparent', fg: c.primary, border: 'transparent' }),
  danger: (c: Palette) => ({ bg: c.dangerSoft, fg: c.danger, border: c.dangerSoft }),
} as const;

export function Btn({
  title, onPress, variant = 'primary', size = 'md', icon, disabled, loading, style, accessibilityLabel, accessibilityHint, testID,
}: {
  title: string; onPress?: () => void; variant?: keyof typeof btnVariants; size?: 'sm' | 'md' | 'lg'; icon?: IconName; disabled?: boolean; loading?: boolean;
  style?: StyleProp<ViewStyle>; accessibilityLabel?: string; accessibilityHint?: string; testID?: string;
}) {
  const { c } = useTheme();
  const v = btnVariants[variant](c);
  const h = size === 'lg' ? 56 : TOUCH;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityHint={accessibilityHint}
      aria-disabled={!!disabled || !!loading}
      aria-busy={!!loading}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        { minHeight: h, paddingHorizontal: size === 'sm' ? spacing.md : spacing.lg, borderRadius: size === 'lg' ? radius.full : radius.md, borderCurve: 'continuous', backgroundColor: v.bg, borderColor: v.border, borderWidth: 1, opacity: disabled ? 0.45 : pressed ? 0.75 : 1 },
        styles.btn, style,
      ]}>
      {loading ? <ActivityIndicator color={v.fg} /> : (
        <>
          {icon ? <Ionicons name={icon} size={18} color={v.fg} /> : null}
          <Text style={[size === 'sm' ? type.label : type.bodyStrong, { color: v.fg, flexShrink: 1, textAlign: 'center' }]}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

export function IconBtn({ icon, label, onPress, tone = 'text', filled, disabled, testID, size = 22 }: { icon: IconName; label: string; onPress?: () => void; tone?: Tone; filled?: boolean; disabled?: boolean; testID?: string; size?: number }) {
  const { c } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [styles.iconBtn, { backgroundColor: filled ? c.surfaceAlt : 'transparent', opacity: disabled ? 0.4 : pressed ? 0.6 : 1 }]}>
      <Ionicons name={icon} size={size} color={c[tone]} />
    </Pressable>
  );
}

export function Card({ children, style, onPress, accessibilityLabel, testID }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; accessibilityLabel?: string; testID?: string }) {
  const { c } = useTheme();
  const base: StyleProp<ViewStyle> = [styles.card, { backgroundColor: c.surface, borderColor: c.border, boxShadow: shadows.card }, style];
  if (!onPress) return <View testID={testID} style={base}>{children}</View>;
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} style={({ pressed }) => [base, pressed && { opacity: 0.8 }]}>
      {children}
    </Pressable>
  );
}

export const Row = ({ children, style, gap = spacing.sm, wrap }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; gap?: number; wrap?: boolean }) => (
  <View style={[{ flexDirection: 'row', alignItems: 'center', gap, flexWrap: wrap ? 'wrap' : 'nowrap' }, style]}>{children}</View>
);
export const Spacer = () => <View style={{ flex: 1 }} />;

/** Screen frame: safe areas, an optional header with back button, scroll body and an optional sticky footer. */
export function Screen({
  title, subtitle, back, right, children, footer, scroll = true, padded = true, testID,
}: {
  title?: string; subtitle?: string; back?: boolean | (() => void); right?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode;
  scroll?: boolean; padded?: boolean; testID?: string;
}) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const goBack = typeof back === 'function' ? back : () => (router.canGoBack() ? router.back() : router.replace('/'));
  const body = scroll ? (
    <ScrollView contentContainerStyle={[padded && styles.pad, { paddingBottom: spacing.xxl + (footer ? 0 : insets.bottom) }]} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
      <View style={styles.maxWidth}>{children}</View>
    </ScrollView>
  ) : (
    <View style={[{ flex: 1 }, padded && styles.pad]}>{children}</View>
  );
  return (
    <KeyboardAvoidingView testID={testID} style={{ flex: 1, backgroundColor: c.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{ paddingTop: insets.top, backgroundColor: c.bg }}>
        {title != null || back ? (
          <View style={[styles.header, styles.maxWidth]}>
            {back ? <IconBtn icon="chevron-back" label={t('common.back')} onPress={goBack} testID="back" /> : null}
            <View style={{ flex: 1 }}>
              {title ? <Text accessibilityRole="header" style={[back ? type.headline : type.title, { color: c.text }]} numberOfLines={2}>{title}</Text> : null}
              {subtitle ? <Txt variant="caption" tone="textMuted">{subtitle}</Txt> : null}
            </View>
            {right}
          </View>
        ) : null}
      </View>
      {body}
      {footer ? (
        <View style={[styles.footer, { backgroundColor: c.bg, borderTopColor: c.border, paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          <View style={styles.maxWidth}>{footer}</View>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

export function SectionTitle({ children, action }: { children: string; action?: React.ReactNode }) {
  return (
    <Row style={{ marginTop: spacing.xl, marginBottom: spacing.sm, minHeight: 28 }}>
      <Txt variant="overline" tone="textMuted" accessibilityRole="header" style={{ flex: 1 }}>{children}</Txt>
      {action}
    </Row>
  );
}

export function Field({
  label, hint, error, suffix, style, ...props
}: TextInputProps & { label: string; hint?: string; error?: string | null; suffix?: string; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={[{ gap: 6 }, style]}>
      <Txt variant="label" tone="textMuted">{label}</Txt>
      <View style={[styles.input, { borderColor: error ? c.danger : focused ? c.primary : c.border, backgroundColor: c.surface }]}>
        <TextInput
          accessibilityLabel={suffix ? `${label}, ${suffix}` : label}
          accessibilityHint={hint}
          placeholderTextColor={c.textFaint}
          {...props}
          onFocus={(e) => { setFocused(true); props.onFocus?.(e); }}
          onBlur={(e) => { setFocused(false); props.onBlur?.(e); }}
          style={[type.body, { color: c.text, flex: 1, minHeight: TOUCH, paddingVertical: 0 }, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as never) : null]}
        />
        {suffix ? <Txt variant="label" tone="textMuted">{suffix}</Txt> : null}
      </View>
      {error ? <Txt variant="caption" tone="danger" accessibilityLiveRegion="polite">{error}</Txt> : hint ? <Txt variant="caption" tone="textMuted">{hint}</Txt> : null}
    </View>
  );
}

export function Segmented<T extends string | number>({ options, value, onChange, label, testID }: { options: { value: T; label: string }[]; value: T | null; onChange: (v: T) => void; label: string; testID?: string }) {
  const { c } = useTheme();
  return (
    <View testID={testID} role="radiogroup" accessibilityLabel={label} style={[styles.segmented, { backgroundColor: c.surfaceAlt }]}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={String(o.value)} testID={testID ? `${testID}-${o.value}` : undefined} role="radio" aria-checked={on} accessibilityLabel={o.label} onPress={() => onChange(o.value)}
            style={[styles.segment, on && { backgroundColor: c.surface, boxShadow: shadows.card }]}>
            <Text style={[type.label, { color: on ? c.text : c.textMuted, textAlign: 'center' }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Chip({ label, selected, onPress, icon, testID }: { label: string; selected?: boolean; onPress?: () => void; icon?: IconName; testID?: string }) {
  const { c } = useTheme();
  return (
    <Pressable testID={testID} role={!onPress ? undefined : selected === undefined ? 'button' : 'checkbox'} aria-checked={onPress && selected !== undefined ? selected : undefined}
      accessibilityLabel={label} onPress={onPress} disabled={!onPress}
      style={({ pressed }) => [styles.chip, { backgroundColor: selected ? c.primary : c.surface, borderColor: selected ? c.primary : c.border, opacity: pressed ? 0.7 : 1 }]}>
      {icon ? <Ionicons name={icon} size={16} color={selected ? c.onPrimary : c.textMuted} /> : null}
      <Text style={[type.label, { color: selected ? c.onPrimary : c.text }]}>{label}</Text>
    </Pressable>
  );
}

export function Toggle({ label, hint, value, onChange, testID }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void; testID?: string }) {
  const { c } = useTheme();
  return (
    <Row style={{ minHeight: TOUCH, paddingVertical: spacing.xs }} gap={spacing.md}>
      <View style={{ flex: 1 }}>
        <Txt variant="body">{label}</Txt>
        {hint ? <Txt variant="caption" tone="textMuted">{hint}</Txt> : null}
      </View>
      <Switch testID={testID} accessibilityLabel={label} accessibilityHint={hint} value={value} onValueChange={onChange} trackColor={{ true: c.primary, false: c.border }} />
    </Row>
  );
}

export function ListItem({ title, subtitle, value, icon, onPress, right, destructive, testID }: { title: string; subtitle?: string; value?: string; icon?: IconName; onPress?: () => void; right?: React.ReactNode; destructive?: boolean; testID?: string }) {
  const { c } = useTheme();
  const inner = (
    <Row style={{ minHeight: TOUCH + 4, paddingVertical: spacing.sm }} gap={spacing.md}>
      {icon ? <Ionicons name={icon} size={22} color={destructive ? c.danger : c.textMuted} /> : null}
      <View style={{ flex: 1 }}>
        <Txt variant="body" tone={destructive ? 'danger' : 'text'}>{title}</Txt>
        {subtitle ? <Txt variant="caption" tone="textMuted">{subtitle}</Txt> : null}
      </View>
      {value ? <Txt variant="label" tone="textMuted">{value}</Txt> : null}
      {right ?? (onPress ? <Ionicons name="chevron-forward" size={18} color={c.textFaint} /> : null)}
    </Row>
  );
  if (!onPress) return inner;
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={[title, value, subtitle].filter(Boolean).join(', ')} onPress={onPress} style={({ pressed }) => pressed && { opacity: 0.6 }}>
      {inner}
    </Pressable>
  );
}

export const Divider = () => {
  const { c } = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border }} />;
};

export function Empty({ icon, title, body, action }: { icon: IconName; title: string; body?: string; action?: React.ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={{ alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl, paddingHorizontal: spacing.lg }}>
      <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: c.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icon} size={26} color={c.textMuted} />
      </View>
      <Txt variant="headline" style={{ textAlign: 'center' }}>{title}</Txt>
      {body ? <Txt variant="body" tone="textMuted" style={{ textAlign: 'center' }}>{body}</Txt> : null}
      {action ? <View style={{ marginTop: spacing.sm }}>{action}</View> : null}
    </View>
  );
}

export function Banner({ tone = 'info', icon, text, action }: { tone?: 'info' | 'warning' | 'danger' | 'success'; icon?: IconName; text: string; action?: React.ReactNode }) {
  const { c } = useTheme();
  const map = { info: [c.primarySoft, c.onPrimarySoft], warning: [c.warningSoft, c.warning], danger: [c.dangerSoft, c.danger], success: [c.successSoft, c.success] } as const;
  const [bg, fg] = map[tone];
  return (
    <View accessibilityRole="alert" style={{ backgroundColor: bg, borderRadius: radius.md, padding: spacing.md, flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
      {icon ? <Ionicons name={icon} size={20} color={fg} /> : null}
      <Text style={[type.label, { color: fg, flex: 1 }]}>{text}</Text>
      {action}
    </View>
  );
}

export function Stat({ label, value, unit, tone = 'primary', icon }: { label: string; value: string; unit?: string; tone?: 'primary' | 'violet' | 'success' | 'warning'; icon?: IconName }) {
  const { c } = useTheme();
  return (
    <View accessible accessibilityLabel={`${label}: ${value} ${unit ?? ''}`} style={[styles.stat, { backgroundColor: c.surface, borderColor: c.border }]}>
      <Row gap={4}>
        {icon ? <Ionicons name={icon} size={14} color={c[tone]} /> : null}
        <Text style={[type.caption, { color: c[tone], fontFamily: type.label.fontFamily, flexShrink: 1 }]} numberOfLines={2}>{label}</Text>
      </Row>
      <Text style={[type.metric, { color: c.text }]} adjustsFontSizeToFit numberOfLines={1}>{value}</Text>
      {unit ? <Txt variant="caption" tone="textMuted">{unit}</Txt> : null}
    </View>
  );
}

export function ProgressBar({ value, max, label }: { value: number; max: number; label: string }) {
  const { c } = useTheme();
  const pct = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={label} accessibilityValue={{ min: 0, max: Math.round(max), now: Math.round(Math.min(value, max)) }} style={{ height: 8, borderRadius: 4, backgroundColor: c.surfaceAlt, overflow: 'hidden' }}>
      <View style={{ width: `${pct * 100}%`, height: '100%', backgroundColor: c.primary, borderRadius: 4 }} />
    </View>
  );
}

/** Bottom sheet for short, focused tasks. Closes with the button, backdrop tap or system back. */
export function Sheet({ visible, onClose, title, children, testID }: { visible: boolean; onClose: () => void; title: string; children: React.ReactNode; testID?: string }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable accessibilityLabel={t('common.close')} accessibilityRole="button" onPress={onClose} style={[StyleSheet.absoluteFill, { backgroundColor: c.overlay }]} />
        <View testID={testID} accessibilityViewIsModal style={{ backgroundColor: c.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, maxHeight: '90%', paddingBottom: Math.max(insets.bottom, spacing.lg) }}>
          <Row style={{ padding: spacing.lg, paddingBottom: spacing.sm }}>
            <Txt variant="headline" accessibilityRole="header" style={{ flex: 1 }}>{title}</Txt>
            <IconBtn icon="close" label={t('common.close')} onPress={onClose} filled testID="sheet-close" />
          </Row>
          <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingTop: spacing.sm, gap: spacing.md }} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function Loading() {
  const { c } = useTheme();
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={t('common.loading')} style={{ padding: spacing.xl, alignItems: 'center' }}>
      <ActivityIndicator color={c.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  iconBtn: { width: TOUCH, height: TOUCH, borderRadius: TOUCH / 2, alignItems: 'center', justifyContent: 'center' },
  card: { borderRadius: radius.lg, borderCurve: 'continuous', padding: spacing.lg, borderWidth: StyleSheet.hairlineWidth },
  pad: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  maxWidth: { width: '100%', maxWidth: 640, alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, minHeight: 56 },
  footer: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
  input: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md },
  segmented: { flexDirection: 'row', borderRadius: radius.md, padding: 3, gap: 2 },
  segment: { flex: 1, minHeight: TOUCH - 6, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xs },
  chip: { minHeight: TOUCH - 8, paddingHorizontal: spacing.md, borderRadius: radius.full, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  stat: { flex: 1, borderRadius: radius.lg, borderCurve: 'continuous', padding: spacing.md, borderWidth: StyleSheet.hairlineWidth, gap: 2, minWidth: 96 },
});
