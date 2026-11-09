// What Android answered when Mnemo set its geofences (modules/mnemo-reliability,
// GeofenceOutcomes.kt), and how to say it. Pure: the binding is lib/geofence-native.ts.
// See docs/plans/2026-11-root-fixes.md, A.

export type GeofenceState =
  | 'ok'
  | 'refused'
  | 'no-permission'
  | 'no-provider'
  | 'dropped'
  | 'failed'
  | 'unknown'
  | 'off';

export interface GeofenceOutcome {
  state: GeofenceState;
  /** Places it was asked to watch. */
  count?: number;
  /** When Android answered (ms). */
  at?: number;
  /** Set by Android restoring the task (after a restart, an update, or a background start), not by the app. */
  restored?: boolean;
  /** Play Services' GeofenceStatusCodes value, when it refused. */
  code?: number;
  message?: string;
}

/** Play Services' codes (GeofenceStatusCodes). */
export const GEOFENCE_NOT_AVAILABLE = 1000;
const TOO_MANY = [1001, 1002];
const NO_PERMISSION = 1004;

/** Which setting a refusal points at, so the right fix is offered (and a problem already shown isn't said twice). */
export type OutcomeCause = 'accuracy' | 'background' | 'services' | 'other';

export interface OutcomeProblem {
  cause: OutcomeCause;
  text: string;
}

const clock = (at: number) => new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const dayAndClock = (at: number, now: number) => {
  const d = new Date(at);
  const today = new Date(now);
  const same = d.toDateString() === today.toDateString();
  return same ? clock(at) : `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${clock(at)}`;
};

/** Settings → Location's status: "Watching 2 places since 9:02". Null when there's nothing to say. */
export function outcomeLine(o: GeofenceOutcome | null, now = Date.now()): string | null {
  if (!o || o.state !== 'ok' || !o.count) return null;
  const since = o.at ? ` since ${dayAndClock(o.at, now)}` : '';
  return `Android is watching ${o.count} ${o.count === 1 ? 'place' : 'places'}${since}${o.restored ? ', set again after a restart' : ''}.`;
}

/** What went wrong, in a sentence, or null when Android is watching (or there's nothing to watch). */
export function outcomeProblem(o: GeofenceOutcome | null): OutcomeProblem | null {
  if (!o) return null;
  const after = o.restored ? ' after the phone restarted' : '';
  switch (o.state) {
    case 'ok':
    case 'off':
      return null;
    case 'no-permission':
      return { cause: 'background', text: `Android won't let Mnemo watch places${after}: location isn't allowed "All the time".` };
    case 'no-provider':
      return { cause: 'services', text: `Location was off${after}, so Android isn't watching Mnemo's places.` };
    case 'unknown':
      return { cause: 'other', text: "Android didn't answer when Mnemo set its places. They're set again when you next open Mnemo." };
    case 'failed':
      return { cause: 'other', text: `Mnemo couldn't set its places${after}${o.message ? ` (${o.message})` : ''}.` };
    case 'dropped':
    case 'refused': {
      const verb = o.state === 'dropped' ? 'stopped watching' : 'refused to watch';
      if (o.code === GEOFENCE_NOT_AVAILABLE) {
        return { cause: 'accuracy', text: `Android ${verb} Mnemo's places${after}: Google Location Accuracy is off.` };
      }
      if (o.code === NO_PERMISSION) {
        return { cause: 'background', text: `Android ${verb} Mnemo's places${after}: location isn't allowed "All the time".` };
      }
      if (o.code !== undefined && TOO_MANY.includes(o.code)) {
        return { cause: 'other', text: `Android ${verb} Mnemo's places${after}: apps on this phone are watching too many places.` };
      }
      return { cause: 'other', text: `Android ${verb} Mnemo's places${after}${o.message ? ` (${o.message})` : ''}.` };
    }
  }
}

/** One line for the problem report: state, code, count, when, whether restored. No coordinates. */
export function outcomeReport(o: GeofenceOutcome | null, now = Date.now()): string {
  if (!o) return 'Android geofences: no answer recorded';
  const parts = [o.state, o.code !== undefined ? `code ${o.code}` : '', o.count !== undefined ? `${o.count} places` : '', o.at ? dayAndClock(o.at, now) : '', o.restored ? 'restored' : ''];
  return `Android geofences: ${parts.filter(Boolean).join(' · ')}${o.message ? ` (${o.message})` : ''}`;
}

/** What the native side sends, checked: a stored record from an older build may hold anything. */
export function asOutcome(raw: unknown): GeofenceOutcome | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const states: GeofenceState[] = ['ok', 'refused', 'no-permission', 'no-provider', 'dropped', 'failed', 'unknown', 'off'];
  if (!states.includes(r.state as GeofenceState)) return null;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  return {
    state: r.state as GeofenceState,
    count: num(r.count),
    at: num(r.at),
    restored: r.restored === true,
    code: num(r.code),
    message: typeof r.message === 'string' ? r.message : undefined,
  };
}
