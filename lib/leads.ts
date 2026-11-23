import type { Lead } from '@/types/mnemo';

// Heads-ups before an appointment: "the evening before" and "an hour
// before" out of the box, changed in Settings → Reminders, or per thread.
// A heads-up only says it's coming; its button is OK, not Done, because an
// appointment isn't done before it happened. Pure, so it's easy to test.

export type { Lead };

export const LEAD_CHOICES: { lead: Lead; label: string; short: string }[] = [
  { lead: 7 * 24 * 60, label: 'A week before', short: '1 week' },
  { lead: 24 * 60, label: 'A day before', short: '1 day' },
  { lead: 'eve', label: 'The evening before, 6 pm', short: 'Evening before' },
  { lead: 120, label: '2 hours before', short: '2 hours' },
  { lead: 60, label: 'An hour before', short: '1 hour' },
  { lead: 30, label: '30 minutes before', short: '30 min' },
  { lead: 15, label: '15 minutes before', short: '15 min' },
];

export const DEFAULT_LEADS: Lead[] = ['eve', 60];

const MINUTE = 60_000;

/** Only the known choices, in the order they're offered, each once. */
export function cleanLeads(leads: unknown): Lead[] {
  if (!Array.isArray(leads)) return [];
  return LEAD_CHOICES.map((c) => c.lead).filter((l) => leads.includes(l));
}

/** When one heads-up rings for a reminder at `due`. */
export function leadAt(due: number, lead: Lead): number {
  if (lead !== 'eve') return due - lead * MINUTE;
  const d = new Date(due);
  d.setDate(d.getDate() - 1);
  d.setHours(18, 0, 0, 0);
  return d.getTime();
}

/** The heads-ups still to come, soonest first: after `now`, before the reminder, never two in the same minute. */
export function leadTimes(due: number, leads: Lead[] | undefined, now = Date.now()): { at: number; lead: Lead }[] {
  const out: { at: number; lead: Lead }[] = [];
  for (const lead of cleanLeads(leads)) {
    const at = leadAt(due, lead);
    if (at <= now + MINUTE / 2 || at >= due) continue;
    if (out.some((o) => Math.abs(o.at - at) < MINUTE)) continue;
    out.push({ at, lead });
  }
  return out.sort((a, b) => a.at - b.at);
}

/** "The evening before, 1 hour before" for a chip. */
export function leadsSummary(leads: Lead[] | undefined): string {
  const chosen = LEAD_CHOICES.filter((c) => leads?.includes(c.lead));
  if (chosen.length === 0) return 'No heads-up';
  const text = chosen.map((c) => (c.lead === 'eve' ? 'the evening before' : `${c.short} before`)).join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// What makes a note an appointment rather than a to-do: somewhere to be, or
// someone to see, at that time. "Call the bank at 3" is a to-do: its own
// reminder is the one that matters. "Dentist tomorrow at 10" needs warning.
const APPOINTMENT =
  /\b(appointment|appt|meeting|meet ?up|dentist|doctor|dr|gp|clinic|hospital|check-?up|interview|flight|train to|exam|class|lecture|seminar|workshop|conference|webinar|wedding|party|concert|movie|cinema|theatre|theater|haircut|barber|salon|vet|therapy|therapist|physio|ceremony|funeral|reservation|viva|court|hearing|parents'? evening|ptm|(?:dinner|lunch|coffee|breakfast|drinks|date|call) with)\b|ডাক্তার|মিটিং|পরীক্ষা|ক্লাস|দাওয়াত|বিয়ে|ইন্টারভিউ|(?:^|\s)(daktar|doctor|porikkha|biye|dawat|daoat)(?:\s|$)/i;
const GOING = /^(?:i\s+(?:have|got)\s+(?:a|an|the|my)?\s*)?(meet|meeting|attend|visit|see)\b/i;
const IN_MINUTES = /\b(in|after|within)\s+\S+\s+(min|mins|minutes?|hours?|hrs?|h)\b/i;

/** Whether a note with a time reads as an appointment (somewhere to be), so heads-ups before it make sense. */
export function isAppointment(sentence: string): boolean {
  const t = sentence.trim().toLowerCase();
  if (!t || IN_MINUTES.test(t)) return false;
  return APPOINTMENT.test(t) || GOING.test(t.replace(/^(?:remind me (?:to|about)\s+)/, ''));
}
