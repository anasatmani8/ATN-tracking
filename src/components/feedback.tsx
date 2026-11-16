import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { t } from '@/i18n';
import { radius, shadows, spacing, type } from '@/theme';
import { useReducedMotion } from './reduced-motion';
import { useTheme } from './theme-context';
import { Btn, Txt } from './ui';
import { nowMs } from '@/domain/clock';

interface ConfirmOpts { title: string; message?: string; confirmLabel?: string; cancelLabel?: string; destructive?: boolean }
interface ToastOpts { message: string; actionLabel?: string; onAction?: () => void; tone?: 'default' | 'error'; durationMs?: number }
interface FeedbackValue { confirm: (o: ConfirmOpts) => Promise<boolean>; toast: (o: ToastOpts) => void }

const Ctx = createContext<FeedbackValue>({ confirm: async () => false, toast: () => undefined });
export const useFeedback = () => useContext(Ctx);

/** App-wide confirmation dialogs and an undo-capable snackbar (works the same on iOS, Android and web). */
export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const [dialog, setDialog] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const [toast, setToast] = useState<(ToastOpts & { id: number }) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const confirm = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => setDialog({ ...o, resolve })), []);
  const showToast = useCallback((o: ToastOpts) => {
    if (timer.current) clearTimeout(timer.current);
    const id = nowMs();
    setToast({ ...o, id });
    AccessibilityInfo.announceForAccessibility(o.message);
    timer.current = setTimeout(() => setToast((cur) => (cur?.id === id ? null : cur)), o.durationMs ?? (o.actionLabel ? 6000 : 3000));
  }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const close = (v: boolean) => {
    dialog?.resolve(v);
    setDialog(null);
  };

  return (
    <Ctx.Provider value={{ confirm, toast: showToast }}>
      {children}
      {toast ? (
        <View pointerEvents="box-none" style={[styles.toastWrap, { bottom: insets.bottom + 76 }]}>
          <View testID="toast" accessibilityLiveRegion="polite" style={[styles.toast, { backgroundColor: toast.tone === 'error' ? c.danger : c.ink, boxShadow: shadows.raised }]}>
            <Text style={[type.label, { color: toast.tone === 'error' ? '#fff' : c.onInk, flex: 1 }]}>{toast.message}</Text>
            {toast.actionLabel ? (
              <Pressable testID="toast-action" accessibilityRole="button" accessibilityLabel={toast.actionLabel} hitSlop={12} onPress={() => { toast.onAction?.(); setToast(null); }} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.sm }}>
                <Text style={[type.bodyStrong, { color: c.onInk, textDecorationLine: 'underline' }]}>{toast.actionLabel}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}
      <Modal visible={!!dialog} transparent animationType={reduced ? 'none' : 'fade'} onRequestClose={() => close(false)}>
        <View style={[styles.backdrop, { backgroundColor: c.overlay }]}>
          <View testID="dialog" accessibilityViewIsModal accessibilityRole="alert" style={[styles.dialog, { backgroundColor: c.surface }]}>
            <Txt variant="headline" accessibilityRole="header">{dialog?.title}</Txt>
            {dialog?.message ? <Txt variant="body" tone="textMuted">{dialog.message}</Txt> : null}
            <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
              <Btn testID="dialog-confirm" title={dialog?.confirmLabel ?? t('common.ok')} variant={dialog?.destructive ? 'danger' : 'primary'} onPress={() => close(true)} />
              <Btn testID="dialog-cancel" title={dialog?.cancelLabel ?? t('common.cancel')} variant="outline" onPress={() => close(false)} />
            </View>
          </View>
        </View>
      </Modal>
    </Ctx.Provider>
  );
}

const styles = StyleSheet.create({
  toastWrap: { position: 'absolute', left: spacing.lg, right: spacing.lg, alignItems: 'center' },
  toast: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: radius.md, paddingLeft: spacing.lg, paddingRight: spacing.sm, minHeight: 52, maxWidth: 560, width: '100%' },
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  dialog: { width: '100%', maxWidth: 420, borderRadius: radius.xl, padding: spacing.xl, gap: spacing.sm },
});
