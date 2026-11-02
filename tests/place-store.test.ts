import { describe, expect, it, vi } from 'vitest';

// A memory stand-in for the phone's storage.
const disk = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => disk.get(k) ?? null,
    setItem: async (k: string, v: string) => void disk.set(k, v),
  },
}));

const place = (id: string, name: string) => ({ id, name, latitude: 51.5, longitude: -0.1, radius: 150, accuracy: 0, savedAt: 0 });

describe('saved places', () => {
  it('a screen opened after a removal never gets the list from launch', async () => {
    disk.set('mnemo-places', JSON.stringify([place('a', 'Home'), place('b', 'Gym')]));
    const store = await import('@/lib/place-store');
    expect((await store.loadPlaces()).map((p) => p.name)).toEqual(['Home', 'Gym']);
    await store.removePlace('b');
    // What a newly mounted screen (usePlaces) reads:
    expect((await store.loadPlaces()).map((p) => p.name)).toEqual(['Home']);
    expect(JSON.parse(disk.get('mnemo-places')!).map((p: { name: string }) => p.name)).toEqual(['Home']);
    await store.savePlace(place('c', 'Office'));
    expect((await store.loadPlaces()).map((p) => p.name)).toEqual(['Home', 'Office']);
  });
});
