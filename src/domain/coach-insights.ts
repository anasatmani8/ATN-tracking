import { averageOverLoggedDays } from './recovery';
import type { LocalDate } from './time';

/**
 * Deterministic coaching insights: each one is computed from the user's own logs,
 * states its evidence, and (where a change would help) carries one concrete proposal
 * in the same shape the AI coach uses. No network, no AI.
 */

export type InsightKind = 'missed_workout' | 'progression_ready' | 'hydration_low' | 'sleep_short' | 'recovery_soreness' | 'no_plan' | 'sleep_unlogged';

export interface InsightAction {
  tool: string;
  args: Record<string, unknown>;
}

export interface Insight {
  /** Stable for the same evidence, so a dismissal sticks until the data changes. */
  id: string;
  kind: InsightKind;
  /** Lower comes first. */
  priority: number;
  /** Values for the localized title/body/evidence strings. */
  params: Record<string, string | number>;
  action: InsightAction | null;
}

export interface InsightInput {
  today: LocalDate;
  trackers: { water: boolean; sleep: boolean };
  targets: { waterMl: number | null; sleepMin: number | null };
  hasActivePlan: boolean;
  sessionsLast14: number;
  /** Planned workouts before today in the current week that were not done. */
  missed: { scheduledId: string; title: string; date: LocalDate }[];
  /** Dates (today onwards, next 7 days) that already have a planned workout. */
  plannedDates: LocalDate[];
  /** Next 7 dates starting today, in order. */
  nextDates: LocalDate[];
  progression: { exerciseId: string; name: string; currentKg: number; suggestedKg: number; sessions: number }[];
  /** Water totals per logged day within the last 7 days. */
  waterByDay: Map<LocalDate, number>;
  /** Sleep minutes (nights only) per wake date within the last 7 days. */
  sleepByDay: Map<LocalDate, number>;
  /** Average wake time in minutes after midnight over the same nights, if known. */
  avgWakeMin: number | null;
  reminderKinds: string[];
  soreness: number | null;
  /** Insight ids the user dismissed. */
  dismissed: string[];
}

const hhmm = (min: number) => {
  const m = ((Math.round(min / 15) * 15) % 1440 + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

export function computeInsights(i: InsightInput): Insight[] {
  const out: Insight[] = [];
  const reason = (s: string) => s.slice(0, 300);

  if (i.soreness != null && i.soreness >= 4) {
    out.push({ id: `soreness:${i.today}`, kind: 'recovery_soreness', priority: 0, params: { soreness: i.soreness }, action: null });
  }

  if (i.missed.length > 0) {
    const m = i.missed[i.missed.length - 1];
    const free = i.nextDates.find((d) => !i.plannedDates.includes(d)) ?? null;
    out.push({
      id: `missed:${m.scheduledId}`,
      kind: 'missed_workout',
      priority: 1,
      params: { title: m.title, date: m.date, count: i.missed.length, newDate: free ?? '' },
      action: free ? { tool: 'propose_reschedule_workout', args: { scheduled_id: m.scheduledId, new_date: free, reason: reason(`${m.title} from ${m.date} was not done; ${free} has no other workout planned.`) } } : null,
    });
  }

  for (const p of i.progression.slice(0, 2)) {
    out.push({
      id: `progression:${p.exerciseId}:${p.currentKg}`,
      kind: 'progression_ready',
      priority: 2,
      params: { name: p.name, currentKg: p.currentKg, suggestedKg: p.suggestedKg, sessions: p.sessions },
      action: { tool: 'propose_set_next_load', args: { exercise_id: p.exerciseId, load_kg: p.suggestedKg, reason: reason(`Your last ${p.sessions} sessions of ${p.name} hit the top of the rep range on every working set with reps in reserve.`) } },
    });
  }

  if (i.trackers.water && i.targets.waterMl) {
    const avg = averageOverLoggedDays(i.waterByDay, 7);
    if (avg.average != null && avg.loggedDays >= 3 && avg.average < i.targets.waterMl * 0.8) {
      const hasReminder = i.reminderKinds.includes('water');
      out.push({
        id: `water:${i.today}`,
        kind: 'hydration_low',
        priority: 3,
        params: { avgMl: Math.round(avg.average), goalMl: i.targets.waterMl, logged: avg.loggedDays },
        action: hasReminder ? null : { tool: 'propose_create_reminder', args: { kind: 'water', time: '11:00', weekdays: [0, 1, 2, 3, 4, 5, 6], reason: reason(`Your water averaged ${Math.round(avg.average)} mL on ${avg.loggedDays} logged days, below your ${i.targets.waterMl} mL goal.`) } },
      });
    }
  }

  if (i.trackers.sleep) {
    const avg = averageOverLoggedDays(i.sleepByDay, 7);
    if (i.targets.sleepMin && avg.average != null && avg.loggedDays >= 3 && avg.average < i.targets.sleepMin - 30) {
      const hasReminder = i.reminderKinds.includes('bedtime');
      // Wind down 30 minutes before the bedtime that would give the target, given the usual wake time.
      const bedtime = i.avgWakeMin != null ? hhmm(i.avgWakeMin - i.targets.sleepMin - 30) : '22:30';
      out.push({
        id: `sleep:${i.today}`,
        kind: 'sleep_short',
        priority: 4,
        params: { avgMin: Math.round(avg.average), goalMin: i.targets.sleepMin, logged: avg.loggedDays, bedtime },
        action: hasReminder ? null : { tool: 'propose_create_reminder', args: { kind: 'bedtime', time: bedtime, weekdays: [0, 1, 2, 3, 4, 5, 6], reason: reason(`You slept about ${Math.round(avg.average / 6) / 10} h on ${avg.loggedDays} logged nights; a reminder at ${bedtime} leaves time to reach your goal.`) } },
      });
    } else if (avg.loggedDays < 3) {
      out.push({ id: `sleep-unlogged:${i.today}`, kind: 'sleep_unlogged', priority: 6, params: { logged: avg.loggedDays }, action: null });
    }
  }

  if (!i.hasActivePlan && i.sessionsLast14 < 2) {
    out.push({ id: 'no-plan', kind: 'no_plan', priority: 5, params: { sessions: i.sessionsLast14 }, action: null });
  }

  return out.filter((x) => !i.dismissed.includes(x.id)).sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
}
