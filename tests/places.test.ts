import { describe, expect, it } from 'vitest';
import {
  MIN_RADIUS,
  caughtLate,
  distance,
  fixText,
  formatMeters,
  nearbyPlaces,
  nearbyText,
  onPlaceEvent,
  readPlaceReminder,
  separation,
  watchedRadius,
} from '@/lib/places';
import type { Place, PlaceReminder } from '@/types/mnemo';

// Dhaka, roughly: 0.001° of latitude is about 111 m.
const at = (id: string, name: string, northM: number, o: Partial<Place> = {}): Place => ({
  id,
  name,
  latitude: 23.78 + northM / 111_195,
  longitude: 90.4,
  radius: 150,
  accuracy: 20,
  savedAt: 0,
  ...o,
});
const home = at('home', 'Home', 0);
const market = at('market', 'Market', 250);
const office = at('office', 'Office', 450);
const gym = at('gym', 'Gym', 3000);

describe('distance and circles', () => {
  it('measures metres', () => {
    expect(Math.round(distance(home, market))).toBe(250);
  });
  it('never watches a circle narrower than the minimum or the fix', () => {
    expect(watchedRadius({ radius: 50, accuracy: 10 })).toBe(MIN_RADIUS);
    expect(watchedRadius({ radius: 150, accuracy: 240 })).toBe(240);
    expect(watchedRadius({ radius: 500, accuracy: 20 })).toBe(500);
  });
  it('formats', () => {
    expect([formatMeters(14), formatMeters(248), formatMeters(1430), formatMeters(12_400)]).toEqual(['15 m', '250 m', '1.4 km', '12 km']);
  });
});

describe('telling places apart', () => {
  it('home and market 250 m apart overlap: they can’t be told apart', () => {
    expect(separation(home, market).verdict).toBe('overlap');
  });
  it('a little further, close: may mix up on a weak signal', () => {
    expect(separation(home, office).verdict).toBe('close');
  });
  it('3 km is apart', () => {
    expect(separation(home, gym).verdict).toBe('apart');
  });
  it('a poor fix widens the circle, and with it the overlap', () => {
    expect(separation(home, at('far', 'Far', 600)).verdict).toBe('apart');
    expect(separation(home, at('far', 'Far', 600, { accuracy: 500 })).verdict).toBe('overlap');
  });
  it('lists the near ones, nearest first, and says it plainly', () => {
    const near = nearbyPlaces(home, [home, market, office, gym]);
    expect(near.map((n) => [n.place.id, n.verdict])).toEqual([
      ['market', 'overlap'],
      ['office', 'close'],
    ]);
    expect(nearbyText('Home', near[0])).toBe(
      "Home and Market are 250 m apart. Your phone can't tell them apart: a reminder for one may go off at the other, or late.",
    );
  });
  it('a poor fix is worth saying', () => {
    expect(fixText(12)).toBeNull();
    expect(fixText(180)).toMatch(/only place you within 180 m/);
  });
});

describe('events', () => {
  const arrive: PlaceReminder = { placeId: 'market', on: 'arrive', setAt: 0, insideAtSet: false };
  const leave: PlaceReminder = { placeId: 'home', on: 'leave', setAt: 0, insideAtSet: true };
  const later = 60 * 60 * 1000;
  it('arriving fires; being there already doesn’t', () => {
    expect(onPlaceEvent(arrive, 'enter', later, 0)).toBe('fire');
    expect(onPlaceEvent({ ...arrive, insideAtSet: true }, 'enter', later, 0)).toBe('inside');
  });
  it('right after the watch list is set, "inside" is where they were, not an arrival', () => {
    expect(onPlaceEvent(arrive, 'enter', later, later - 30_000)).toBe('inside');
  });
  it('leaving fires once inside; an exit while settling doesn’t', () => {
    expect(onPlaceEvent(leave, 'exit', later, 0)).toBe('fire');
    expect(onPlaceEvent(leave, 'exit', later, later - 10_000)).toBe('outside');
    expect(onPlaceEvent({ ...leave, insideAtSet: false }, 'exit', later, 0)).toBe('outside');
  });
  it('fired is done', () => {
    expect(onPlaceEvent({ ...arrive, firedAt: 1 }, 'enter', later, 0)).toBe('ignore');
  });
});

describe('caught late, when the app opens', () => {
  const r: PlaceReminder = { placeId: 'market', on: 'arrive', setAt: 0, insideAtSet: false };
  const there = { latitude: market.latitude, longitude: market.longitude, accuracy: 20 };
  it('plainly there and it never went off', () => {
    expect(caughtLate(r, market, there)).toBe(true);
  });
  it('not when the fix is too rough to be sure', () => {
    expect(caughtLate(r, market, { ...there, accuracy: 200 })).toBe(false);
  });
  it('not when it was set from there, or where that is unknown', () => {
    expect(caughtLate({ ...r, insideAtSet: true }, market, there)).toBe(false);
    expect(caughtLate({ ...r, insideAtSet: undefined }, market, there)).toBe(false);
  });
  it('leaving: plainly gone', () => {
    const l: PlaceReminder = { placeId: 'home', on: 'leave', setAt: 0, insideAtSet: true };
    expect(caughtLate(l, home, { latitude: gym.latitude, longitude: gym.longitude, accuracy: 30 })).toBe(true);
  });
});

describe('reading it from a note', () => {
  const places = [home, market, at('canteen', 'Office canteen', 900), office, at('bazar', 'bazar', 1500), at('basa', 'বাসা', 2000)];
  it('arriving', () => {
    expect(readPlaceReminder('remind me to buy eggs when I get to the market', places)).toEqual({ placeId: 'market', on: 'arrive' });
    expect(readPlaceReminder('remind me at the office to send the invoice', places)).toEqual({ placeId: 'office', on: 'arrive' });
    expect(readPlaceReminder('bazare gele dim kinbo', places)).toEqual({ placeId: 'bazar', on: 'arrive' });
  });
  it('leaving', () => {
    expect(readPlaceReminder('when I leave home take the umbrella', places)).toEqual({ placeId: 'home', on: 'leave' });
    expect(readPlaceReminder('বাসা থেকে বের হলে চাবি নিও', places)).toEqual({ placeId: 'basa', on: 'leave' });
  });
  it('the longer name wins', () => {
    expect(readPlaceReminder('when I get to the office canteen ask about lunch', places)?.placeId).toBe('canteen');
  });
  it('a place mentioned without a when sets nothing', () => {
    expect(readPlaceReminder('bought eggs at the market, 120 taka', places)).toBeUndefined();
    expect(readPlaceReminder('market prices went up', places)).toBeUndefined();
  });
  it('a place that isn’t saved sets nothing', () => {
    expect(readPlaceReminder('when I get to the pharmacy buy napa', places)).toBeUndefined();
  });
});
