import { describe, expect, it, vi } from 'vitest';
import { flightsEnabled, framesLookSlow, loadFlightPerformance, recordFlight } from '@/lib/card-flight';

const saved = vi.hoisted(() => new Map<string, string>());
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: async (k: string) => saved.get(k) ?? null, setItem: async (k: string, v: string) => void saved.set(k, v) },
}));

describe('the Resume card flight on a slow phone', () => {
  it('reads 60 fps as fine and under 40 fps as slow, given enough frames', () => {
    expect(framesLookSlow(16.7 * 28, 28)).toBe(false);
    expect(framesLookSlow(33 * 14, 14)).toBe(true);
    expect(framesLookSlow(100, 2)).toBe(false);
  });

  it('turns itself off after two slow flights in a row, not one', async () => {
    expect(await loadFlightPerformance()).toBe(false);
    expect(flightsEnabled()).toBe(true);
    recordFlight(33 * 14, 14);
    expect(flightsEnabled()).toBe(true);
    recordFlight(16.7 * 28, 28); // a smooth one resets the count
    recordFlight(33 * 14, 14);
    expect(flightsEnabled()).toBe(true);
    recordFlight(33 * 14, 14);
    expect(flightsEnabled()).toBe(false);
    expect(saved.get('mnemo.cardFlight.slow')).toBe('1');
  });
});
