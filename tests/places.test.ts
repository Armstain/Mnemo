import { describe, expect, it } from 'vitest';
import {
  MAX_WATCHED,
  MIN_RADIUS,
  caughtLate,
  onFix,
  circleChanged,
  distance,
  fixText,
  formatMeters,
  isArmed,
  nameProblem,
  onPlaceEvent,
  overlaps,
  overlapText,
  pickWatched,
  readPlaceReminder,
  watchedRadius,
} from '@/lib/places';
import type { Place, PlaceReminder } from '@/types/mnemo';

// Any spot on Earth: 1° of latitude is about 111 km wherever you are.
const at = (id: string, name: string, northM: number, o: Partial<Place> = {}): Place => ({
  id,
  name,
  latitude: 51.5 + northM / 111_195,
  longitude: -0.12,
  radius: 150,
  accuracy: 0,
  savedAt: 0,
  ...o,
});
const a = at('a', 'Home', 0);
const b = at('b', 'Gym', 250);
const c = at('c', 'Office', 4000);

describe('a place is a circle', () => {
  it('measures metres', () => {
    expect(Math.round(distance(a, b))).toBe(250);
  });
  it('never narrower than the minimum, nor than the fix it was saved with', () => {
    expect(watchedRadius({ radius: 50, accuracy: 0 })).toBe(MIN_RADIUS);
    expect(watchedRadius({ radius: 150, accuracy: 240 })).toBe(240);
    expect(watchedRadius({ radius: 500, accuracy: 20 })).toBe(500);
  });
  it('formats', () => {
    expect([formatMeters(14), formatMeters(248), formatMeters(1430), formatMeters(12_400)]).toEqual(['15 m', '250 m', '1.4 km', '12 km']);
  });
  it('only a poor fix is worth a word', () => {
    expect(fixText(0)).toBeNull();
    expect(fixText(60)).toBeNull();
    expect(fixText(180)).toMatch(/within 180 m, so the circle is that wide/);
  });
});

describe('overlaps: the one warning about places', () => {
  it('circles that touch overlap, whatever the places are', () => {
    expect(overlaps(a, [a, b, c]).map((p) => p.id)).toEqual(['b']);
    expect(overlaps(c, [a, b, c])).toEqual([]);
  });
  it('a nested place overlaps the one around it', () => {
    const campus = at('campus', 'Campus', 0, { radius: 500 });
    expect(overlaps(at('lab', 'Lab', 200), [campus]).map((p) => p.id)).toEqual(['campus']);
  });
  it('a bigger circle, or a poor fix, can create an overlap', () => {
    const far = at('far', 'Far', 600);
    expect(overlaps(a, [far])).toEqual([]);
    expect(overlaps({ ...a, radius: 500 }, [far]).length).toBe(1);
    expect(overlaps(a, [{ ...far, accuracy: 500 }]).length).toBe(1);
  });
  it('says it in general terms', () => {
    expect(overlapText([b])).toBe('Its circle overlaps Gym. Being at one can count as being at the other.');
    expect(overlapText([b, c])).toBe('Its circle overlaps Gym and Office. Being at one can count as being at another.');
    expect(overlapText([])).toBeNull();
  });
});

describe('names and changes', () => {
  it('needs a name, and no two the same', () => {
    expect(nameProblem('  ', [a])).toBe('Give it a name.');
    expect(nameProblem('home', [a])).toBe('You already have a place with that name.');
    expect(nameProblem('Home', [a], 'a')).toBeNull();
  });
  it('a moved or resized circle is a change; a rename isn’t', () => {
    expect(circleChanged(a, { ...a, name: 'House' })).toBe(false);
    expect(circleChanged(a, { ...a, latitude: a.latitude + 0.001 })).toBe(true);
    expect(circleChanged(a, { ...a, radius: 300 })).toBe(true);
  });
});

describe('which reminders count, and which places are watched', () => {
  const r = (placeId: string, setAt: number): PlaceReminder => ({ placeId, on: 'arrive', setAt });
  it('done, archived or already fired: not waiting', () => {
    expect(isArmed({ status: 'active', place: r('a', 1) })).toBe(true);
    expect(isArmed({ status: 'completed', place: r('a', 1) })).toBe(false);
    expect(isArmed({ status: 'archived', place: r('a', 1) })).toBe(false);
    expect(isArmed({ status: 'active', place: { ...r('a', 1), firedAt: 2 } })).toBe(false);
  });
  it(`at most ${MAX_WATCHED} places, the most recently set first`, () => {
    const places = Array.from({ length: MAX_WATCHED + 2 }, (_, i) => at(`p${i}`, `P${i}`, i * 1000));
    const items = places.map((p, i) => ({ status: 'active' as const, place: r(p.id, i) }));
    const { watched, overflow } = pickWatched(items, places);
    expect(watched.length).toBe(MAX_WATCHED);
    expect([...overflow]).toEqual(['p1', 'p0']);
  });
  it('a place nobody is waiting for isn’t watched', () => {
    expect(pickWatched([{ status: 'active', place: r('a', 1) }], [a, b, c]).watched.map((p) => p.id)).toEqual(['a']);
  });
});

describe('events', () => {
  const arrive: PlaceReminder = { placeId: 'b', on: 'arrive', setAt: 0, insideAtSet: false };
  const leave: PlaceReminder = { placeId: 'a', on: 'leave', setAt: 0, insideAtSet: true };
  const later = 60 * 60 * 1000;
  it('arriving fires; being there already doesn’t', () => {
    expect(onPlaceEvent(arrive, 'enter', later, 0)).toBe('fire');
    expect(onPlaceEvent({ ...arrive, insideAtSet: true }, 'enter', later, 0)).toBe('inside');
  });
  it('set while inside: it counts only after leaving and coming back', () => {
    const inside = { ...arrive, insideAtSet: true };
    expect(onPlaceEvent(inside, 'exit', later, 0)).toBe('outside');
    expect(onPlaceEvent({ ...inside, insideAtSet: false }, 'enter', later + 1, 0)).toBe('fire');
  });
  it('right after the watch list is set, "inside" isn’t an arrival when where the phone was is unknown', () => {
    expect(onPlaceEvent({ ...arrive, insideAtSet: undefined }, 'enter', later, later - 30_000)).toBe('inside');
  });
  it('known outside, then inside right after the list is set (opening Mnemo on arriving): it fires', () => {
    expect(onPlaceEvent(arrive, 'enter', later, later - 30_000)).toBe('fire');
  });
  it('leaving fires once inside, even right after the list is set; an unknown exit while settling doesn’t', () => {
    expect(onPlaceEvent(leave, 'exit', later, 0)).toBe('fire');
    expect(onPlaceEvent(leave, 'exit', later, later - 10_000)).toBe('fire');
    expect(onPlaceEvent({ ...leave, insideAtSet: undefined }, 'exit', later, later - 10_000)).toBe('outside');
    expect(onPlaceEvent({ ...leave, insideAtSet: false }, 'exit', later, 0)).toBe('outside');
  });
  it('fired is done', () => {
    expect(onPlaceEvent({ ...arrive, firedAt: 1 }, 'enter', later, 0)).toBe('ignore');
  });
});

describe('positions read while the app is open', () => {
  const near = { latitude: b.latitude, longitude: b.longitude, accuracy: 20 };
  const far = { latitude: c.latitude, longitude: c.longitude, accuracy: 20 };
  it('first learns where the phone is', () => {
    expect(onFix({ placeId: 'b', on: 'arrive', setAt: 0 }, b, near)).toBe('inside');
    expect(onFix({ placeId: 'b', on: 'arrive', setAt: 0 }, b, far)).toBe('outside');
  });
  it('arrive: leaving first, then coming back, fires', () => {
    const r: PlaceReminder = { placeId: 'b', on: 'arrive', setAt: 0, insideAtSet: true };
    expect(onFix(r, b, near)).toBeNull();
    expect(onFix(r, b, far)).toBe('outside');
    expect(onFix({ ...r, insideAtSet: false }, b, near)).toBe('fire');
  });
  it('leave: once inside, going fires', () => {
    const r: PlaceReminder = { placeId: 'b', on: 'leave', setAt: 0, insideAtSet: false };
    expect(onFix(r, b, near)).toBe('inside');
    expect(onFix({ ...r, insideAtSet: true }, b, far)).toBe('fire');
  });
  it('a fix too rough to tell says nothing', () => {
    expect(onFix({ placeId: 'b', on: 'arrive', setAt: 0, insideAtSet: false }, b, { ...near, accuracy: 300 })).toBeNull();
  });
});

describe('caught late, when the app opens', () => {
  const r: PlaceReminder = { placeId: 'b', on: 'arrive', setAt: 0, insideAtSet: false };
  const there = { latitude: b.latitude, longitude: b.longitude, accuracy: 20 };
  it('plainly inside and it never went off', () => {
    expect(caughtLate(r, b, there)).toBe(true);
  });
  it('not on a fix too rough to be sure', () => {
    expect(caughtLate(r, b, { ...there, accuracy: 200 })).toBe(false);
  });
  it('not when set from inside, or when where it was set is unknown', () => {
    expect(caughtLate({ ...r, insideAtSet: true }, b, there)).toBe(false);
    expect(caughtLate({ ...r, insideAtSet: undefined }, b, there)).toBe(false);
  });
  it('leaving: plainly gone', () => {
    const l: PlaceReminder = { placeId: 'a', on: 'leave', setAt: 0, insideAtSet: true };
    expect(caughtLate(l, a, { latitude: c.latitude, longitude: c.longitude, accuracy: 30 })).toBe(true);
  });
});

describe('reading it from a note', () => {
  const places = [a, b, c, at('canteen', 'Office canteen', 9000), at('club', 'Book club', 12_000), at('basa', 'বাসা', 20_000), at('dokan', 'dokan', 30_000)];
  it('arriving, with any saved name', () => {
    expect(readPlaceReminder('remind me to call mum when I get to the gym', places)).toEqual({ placeId: 'b', on: 'arrive' });
    expect(readPlaceReminder('remind me at the office to send the invoice', places)).toEqual({ placeId: 'c', on: 'arrive' });
    expect(readPlaceReminder("when I'm at book club ask about next month", places)).toEqual({ placeId: 'club', on: 'arrive' });
  });
  it('Banglish and Bangla "at" endings', () => {
    expect(readPlaceReminder('dokane gele chal kinbo', places)).toEqual({ placeId: 'dokan', on: 'arrive' });
    expect(readPlaceReminder('বাসায় পৌঁছে ফোন দিও', places)).toEqual({ placeId: 'basa', on: 'arrive' });
  });
  it('leaving', () => {
    expect(readPlaceReminder('when I leave home take the umbrella', places)).toEqual({ placeId: 'a', on: 'leave' });
    expect(readPlaceReminder('বাসা থেকে বের হলে চাবি নিও', places)).toEqual({ placeId: 'basa', on: 'leave' });
  });
  it('the longer name is the one meant', () => {
    expect(readPlaceReminder('when I get to the office canteen ask about lunch', places)?.placeId).toBe('canteen');
  });
  it('whole words only', () => {
    expect(readPlaceReminder('when I get to the officers mess say hi', places)).toBeUndefined();
    expect(readPlaceReminder('when I get to the gymnasium bring shoes', places)).toBeUndefined();
  });
  it('two saved places named: no guess', () => {
    expect(readPlaceReminder('when I leave home remind me to stop at the gym', places)).toBeUndefined();
  });
  it('a place named without a when, or a place not saved: nothing', () => {
    expect(readPlaceReminder('had a great session at the gym, 5 km', places)).toBeUndefined();
    expect(readPlaceReminder('when I get to the pharmacy buy paracetamol', places)).toBeUndefined();
  });
});
