import { describe, expect, it, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: async () => null, setItem: async () => {} } }));
vi.mock('expo-secure-store', () => ({}));

const { getPreferences, setPreferences } = await import('@/lib/preferences');
const { isNoConnection } = await import('@/lib/api-key');

describe('turning Gemini on', () => {
  it('marks what came before as written offline, once per switch', () => {
    setPreferences({ aiMode: 'offline' });
    expect(getPreferences().earlierNotesBefore).toBeUndefined();

    setPreferences({ aiMode: 'gemini' });
    const since = getPreferences().earlierNotesBefore;
    expect(since).toBeTypeOf('number');
    expect(getPreferences().earlierNotesAsked).toBe(false);

    // Already on: choosing it again (setup re-run) changes nothing.
    setPreferences({ earlierNotesAsked: true });
    setPreferences({ aiMode: 'gemini' });
    expect(getPreferences()).toMatchObject({ earlierNotesBefore: since, earlierNotesAsked: true });
  });
});

describe('retrying a note', () => {
  it('no connection is retried soon; a timeout may have reached Gemini', () => {
    expect(isNoConnection(new TypeError('Network request failed'))).toBe(true);
    expect(isNoConnection(new Error('TypeError: Failed to fetch'))).toBe(true);
    expect(isNoConnection(new Error('Request timed out'))).toBe(false);
    expect(isNoConnection(new Error('[429] RESOURCE_EXHAUSTED'))).toBe(false);
  });
});
