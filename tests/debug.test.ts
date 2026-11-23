import { describe, expect, it } from 'vitest';
import { tapCounter, timeline, UNLOCK_GAP_MS } from '@/lib/debug';

describe('the hidden unlock', () => {
  it('opens on the seventh quick tap, not before', () => {
    const tap = tapCounter();
    const results = Array.from({ length: 7 }, (_, i) => tap(1000 + i * 200));
    expect(results).toEqual([false, false, false, false, false, false, true]);
  });

  it('a pause starts the count again', () => {
    const tap = tapCounter();
    for (let i = 0; i < 6; i++) tap(1000 + i * 200);
    const late = 1000 + 5 * 200 + UNLOCK_GAP_MS + 1;
    expect(tap(late)).toBe(false);
    for (let i = 1; i < 6; i++) expect(tap(late + i * 200)).toBe(false);
    expect(tap(late + 6 * 200)).toBe(true);
  });
});

describe('the log as one timeline', () => {
  const logs = {
    place: [{ at: 1, text: 'set 1 place' }, { at: 4, text: 'Android: enter' }],
    voice: [{ at: 3, text: 'recorded 12 s' }],
    errors: [{ at: 2, where: 'ai', message: '503' }],
  };

  it('newest first, every source', () => {
    expect(timeline(logs).map((l) => [l.at, l.source])).toEqual([
      [4, 'place'],
      [3, 'voice'],
      [2, 'error'],
      [1, 'place'],
    ]);
    expect(timeline(logs).find((l) => l.source === 'error')?.text).toBe('ai: 503');
  });

  it('one source only', () => {
    expect(timeline(logs, 'voice').map((l) => l.text)).toEqual(['recorded 12 s']);
  });
});
