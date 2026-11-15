import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import type { MnemoItem, Repeat } from '@/types/mnemo';
import { ruleOf } from '@/lib/repeat';
import { phoneWeekend } from '@/lib/places';
import { hasTime } from '@/lib/when';
import { logError } from '@/lib/errors';

// A thread with a time can also be an event in the phone's calendar
// (`inCalendar`, set per thread or for every appointment in Settings →
// Reminders). Mnemo keeps the event in step: a new time, title or repeat
// moves it, and removing the reminder or the thread removes it. The event
// has no alarms of its own: Mnemo's reminder and heads-ups ring, so nothing
// rings twice. Which event belongs to which thread is kept on this phone
// only; a backup restored elsewhere doesn't touch that phone's calendar.

export const calendarAvailable = Platform.OS === 'android' || Platform.OS === 'ios';

type CalendarItem = Pick<MnemoItem, 'id' | 'title' | 'dueDate' | 'repeat' | 'nextStep' | 'status' | 'inCalendar'>;

const KEY = 'mnemo-calendar-events';
const HOUR = 60 * 60 * 1000;

interface Link {
  eventId: string;
  calendarId: string;
}

// ─── Pure: what the event says ─────────────────────────────────

export interface RecurrenceShape {
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval?: number;
  /** 1 = Sunday … 7 = Saturday, as calendars count; `weekNumber` -1 is the last in the month. */
  daysOfTheWeek?: { dayOfTheWeek: number; weekNumber?: number }[];
}

/** How the calendar repeats the event, from the thread's repeat (lib/repeat.ts). */
export function recurrenceFor(repeat: Repeat | undefined, due: number, weekend: number[] = phoneWeekend()): RecurrenceShape | undefined {
  const rule = ruleOf(repeat);
  if (!rule) return undefined;
  const day = new Date(due).getDay();
  if (rule.unit === 'weekday') {
    return { frequency: 'weekly', daysOfTheWeek: [0, 1, 2, 3, 4, 5, 6].filter((d) => !weekend.includes(d)).map((d) => ({ dayOfTheWeek: d + 1 })) };
  }
  if (rule.nth !== undefined) return { frequency: 'monthly', daysOfTheWeek: [{ dayOfTheWeek: day + 1, weekNumber: rule.nth }] };
  const frequency = rule.unit === 'day' ? 'daily' : rule.unit === 'week' ? 'weekly' : rule.unit === 'month' ? 'monthly' : 'yearly';
  return rule.every > 1 ? { frequency, interval: rule.every } : { frequency };
}

export interface EventShape {
  title: string;
  startDate: Date;
  endDate: Date;
  allDay: boolean;
  notes: string;
  timeZone: string;
  recurrenceRule: RecurrenceShape | null;
  alarms: [];
}

/** The event for a thread: an hour long from its time, or all day when it has no time (an old date-only reminder). */
export function eventFor(item: CalendarItem & { dueDate: number }, weekend?: number[]): EventShape {
  const allDay = !hasTime(item.dueDate);
  const start = new Date(item.dueDate);
  if (allDay) start.setHours(0, 0, 0, 0);
  const end = allDay ? new Date(start.getTime() + 24 * HOUR) : new Date(start.getTime() + HOUR);
  let timeZone = 'UTC';
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
  } catch {
    // UTC, as the calendar would assume.
  }
  return {
    title: item.title || 'Reminder',
    startDate: start,
    endDate: end,
    allDay,
    notes: item.nextStep ? `Next: ${item.nextStep}\n\nFrom Mnemo` : 'From Mnemo',
    timeZone,
    recurrenceRule: recurrenceFor(item.repeat, item.dueDate, weekend) ?? null,
    alarms: [],
  };
}

/** Whether the thread should have an event now. */
export function wantsEvent(item: CalendarItem): item is CalendarItem & { dueDate: number } {
  return !!item.inCalendar && !!item.dueDate && item.status !== 'archived';
}

// ─── Phone side ─────────────────────────────────────────────────

type CalendarModule = typeof import('expo-calendar/legacy');
let module: CalendarModule | null = null;
function cal(): CalendarModule | null {
  if (!calendarAvailable) return null;
  try {
    module ??= require('expo-calendar/legacy') as CalendarModule;
    return module;
  } catch {
    // A build without the calendar module (Expo Go, an old development build).
    return null;
  }
}

async function readLinks(): Promise<Record<string, Link>> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Record<string, Link>) : {};
  } catch {
    return {};
  }
}

async function writeLinks(links: Record<string, Link>): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(links)).catch(() => {});
}

export async function hasCalendarPermission(): Promise<boolean> {
  const c = cal();
  if (!c) return false;
  try {
    return (await c.getCalendarPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

/** Asks once; true when Mnemo may add events. */
export async function requestCalendarPermission(): Promise<boolean> {
  const c = cal();
  if (!c) return false;
  try {
    return (await c.requestCalendarPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

/** The calendar new events go into: the phone's default one, else the person's own main calendar. */
async function targetCalendar(c: CalendarModule): Promise<string | undefined> {
  if (Platform.OS === 'ios') {
    try {
      return (await c.getDefaultCalendarAsync()).id;
    } catch {
      // Falls through to the list.
    }
  }
  const all = await c.getCalendarsAsync(c.EntityTypes.EVENT);
  const writable = all.filter((k) => k.allowsModifications);
  const own = (k: (typeof all)[number]) => k.accessLevel === c.CalendarAccessLevel.OWNER;
  const pick =
    writable.find((k) => k.isPrimary && own(k)) ??
    writable.find((k) => own(k) && k.source?.type === 'com.google') ??
    writable.find((k) => own(k) && !k.source?.isLocalAccount) ??
    writable.find(own) ??
    writable[0];
  return pick?.id;
}

// One change at a time per thread, so two quick edits never make two events.
const queues = new Map<string, Promise<void>>();
function serial(id: string, work: () => Promise<void>): Promise<void> {
  const next = (queues.get(id) ?? Promise.resolve()).then(work).catch((e) => logError('calendar', e));
  queues.set(id, next);
  next.finally(() => queues.get(id) === next && queues.delete(id));
  return next;
}

/**
 * Puts the thread's event in step with it: made, moved, or removed. Never
 * asks for permission (Settings and the thread's chip do); without it,
 * nothing happens.
 */
export function syncCalendarForItem(item: CalendarItem): Promise<void> {
  return serial(item.id, async () => {
    const c = cal();
    if (!c) return;
    const links = await readLinks();
    const link = links[item.id];
    if (!wantsEvent(item)) {
      if (!link) return;
      await c.deleteEventAsync(link.eventId).catch(() => {});
      delete links[item.id];
      await writeLinks(links);
      return;
    }
    if (!(await hasCalendarPermission())) return;
    const details = eventFor(item) as unknown as Parameters<CalendarModule['createEventAsync']>[1];
    if (link) {
      // Deleted in the calendar app meanwhile: made again below, in the same calendar if it's still there.
      const exists = await c.getEventAsync(link.eventId).then(() => true, () => false);
      if (exists) {
        await c.updateEventAsync(link.eventId, details, { futureEvents: true });
        return;
      }
    }
    const calendars = link ? await c.getCalendarsAsync(c.EntityTypes.EVENT).catch(() => []) : [];
    const calendarId = calendars.some((k) => k.id === link?.calendarId && k.allowsModifications) ? link!.calendarId : await targetCalendar(c);
    if (!calendarId) return;
    const eventId = await c.createEventAsync(calendarId, details);
    links[item.id] = { eventId, calendarId };
    await writeLinks(links);
  });
}

/** The thread is gone: so is its event. */
export function removeCalendarEvent(id: string): Promise<void> {
  return syncCalendarForItem({ id, title: '', status: 'archived' });
}

/** "Clear all data": every event Mnemo made goes with the threads. */
export async function removeAllCalendarEvents(): Promise<void> {
  const links = await readLinks();
  await Promise.all(Object.keys(links).map((id) => removeCalendarEvent(id)));
}
