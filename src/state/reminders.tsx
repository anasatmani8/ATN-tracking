import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import type { Reminder } from '@/data/recovery';
import { inQuietHours } from '@/domain/recovery';
import { t, type StringKey } from '@/i18n';
import { useApp, useLive } from './app';

const native = Platform.OS === 'ios' || Platform.OS === 'android';
const REST_ID = 'rest-timer';

/** Where each reminder opens. Screens show a fallback if the target no longer exists. */
export const REMINDER_ROUTES: Record<Reminder['kind'], string> = {
  workout: '/',
  water: '/recovery',
  bedtime: '/recovery/sleep',
  checkin: '/progress/review',
};

if (native) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
}

export type PermissionState = 'granted' | 'denied' | 'undetermined' | 'unsupported';

export async function notificationPermission(): Promise<PermissionState> {
  if (!native) return 'unsupported';
  const p = await Notifications.getPermissionsAsync();
  return p.granted ? 'granted' : p.canAskAgain ? 'undetermined' : 'denied';
}

/** Asked only from the reminder screen, at the moment the user turns a reminder on. */
export async function requestNotificationPermission(): Promise<PermissionState> {
  if (!native) return 'unsupported';
  const p = await Notifications.requestPermissionsAsync();
  return p.granted ? 'granted' : 'denied';
}

export async function scheduleRestAlert(seconds: number): Promise<void> {
  if (!native || seconds < 5) return;
  try {
    if ((await notificationPermission()) !== 'granted') return;
    await Notifications.cancelScheduledNotificationAsync(REST_ID).catch(() => undefined);
    await Notifications.scheduleNotificationAsync({
      identifier: REST_ID,
      content: { title: t('notif.rest.title'), body: t('notif.rest.body'), data: { url: '/workout/active' } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: Math.round(seconds), channelId: 'reminders' },
    });
  } catch {
    // Timer alerts are best-effort; the in-app timer is the source of truth.
  }
}

export async function cancelRestAlert(): Promise<void> {
  if (native) await Notifications.cancelScheduledNotificationAsync(REST_ID).catch(() => undefined);
}

async function reschedule(reminders: Reminder[], quietStart: string | null, quietEnd: string | null) {
  if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('reminders', { name: t('notif.channel'), importance: AndroidImportance.DEFAULT });
  for (const n of await Notifications.getAllScheduledNotificationsAsync()) {
    if (n.identifier.startsWith('rem:')) await Notifications.cancelScheduledNotificationAsync(n.identifier);
  }
  if ((await notificationPermission()) !== 'granted') return;
  for (const r of reminders) {
    if (!r.enabled || inQuietHours(r.time, quietStart, quietEnd)) continue;
    const [hour, minute] = r.time.split(':').map(Number);
    let days: number[] = [];
    try {
      days = JSON.parse(r.weekdays) as number[];
    } catch {
      days = [];
    }
    for (const d of days) {
      await Notifications.scheduleNotificationAsync({
        identifier: `rem:${r.id}:${d}`,
        content: { title: t(`notif.${r.kind}.title` as StringKey), body: t(`notif.${r.kind}.body` as StringKey), data: { url: REMINDER_ROUTES[r.kind] } },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.WEEKLY, weekday: d + 1, hour, minute, channelId: 'reminders' },
      });
    }
  }
}

/** Keeps OS-scheduled reminders in line with stored reminders and quiet hours, and routes notification taps. */
export function ReminderSync() {
  const { prefs } = useApp();
  const router = useRouter();
  const { data } = useLive((a) => a.recovery.listReminders(), ['reminders']);
  useEffect(() => {
    if (!native || !data) return;
    reschedule(data, prefs.quietStart, prefs.quietEnd).catch(() => undefined);
  }, [data, prefs.quietStart, prefs.quietEnd]);
  useEffect(() => {
    if (!native) return;
    const sub = Notifications.addNotificationResponseReceivedListener((res) => {
      const url = res.notification.request.content.data?.url;
      if (typeof url === 'string' && url.startsWith('/')) router.push(url as never);
    });
    return () => sub.remove();
  }, [router]);
  return null;
}
