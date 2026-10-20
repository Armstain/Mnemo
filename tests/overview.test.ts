import { describe, expect, it } from 'vitest';
import { canOrganise, cleanOverview, notesSince, notesToOrganise, overviewText, ORGANISE_MIN_NOTES } from '@/lib/overview';
import type { Entry } from '@/types/mnemo';

const note = (text: string, createdAt: number) =>
  ({ id: `e${createdAt}`, createdAt, blocks: [{ kind: 'text', markdown: text }] }) as unknown as Entry;

describe('organising a thread’s notes', () => {
  it('is offered only once there are enough notes, and not over an overview', () => {
    const few = Array.from({ length: ORGANISE_MIN_NOTES - 1 }, (_, i) => note('x', i));
    const enough = Array.from({ length: ORGANISE_MIN_NOTES }, (_, i) => note('x', i));
    expect(canOrganise(few)).toBe(false);
    expect(canOrganise(enough)).toBe(true);
    expect(canOrganise(enough, { at: 0, notes: 4, themes: [], open: [] })).toBe(false);
  });

  it('sends each note’s text oldest first, skipping empty ones', () => {
    const notes = notesToOrganise([note('second', 2), note('  ', 3), note('first', 1)]);
    expect(notes).toEqual([
      { text: 'first', at: 1 },
      { text: 'second', at: 2 },
    ]);
  });

  it('counts the notes added since the overview was made', () => {
    expect(notesSince({ at: 10, notes: 4, themes: [], open: [] }, [note('a', 5), note('b', 11), note('c', 12)])).toBe(2);
  });

  it('keeps only well-formed themes from the AI’s answer', () => {
    const raw = {
      themes: [
        { title: ' Widget ', points: ['Show only the next step', ''], notes: 2 },
        { title: '', points: ['no title'], notes: 1 },
        { title: 'Empty', points: [], notes: 1 },
        { title: 'Over-counted', points: ['x'], notes: 99 },
      ],
      open: ['Weekly email: worth a server?', 3],
    };
    expect(cleanOverview(raw, 7, 100)).toEqual({
      at: 100,
      notes: 7,
      themes: [
        { title: 'Widget', points: ['Show only the next step'], notes: 2 },
        { title: 'Over-counted', points: ['x'], notes: 7 },
      ],
      open: ['Weekly email: worth a server?'],
    });
    expect(cleanOverview({ themes: [] }, 4, 0)).toBeNull();
    expect(cleanOverview(null, 4, 0)).toBeNull();
  });

  it('shares as plain text', () => {
    const text = overviewText('Ideas', {
      at: 0,
      notes: 3,
      themes: [{ title: 'Widget', points: ['Next step only', 'Dark mode'], notes: 2 }],
      open: ['Weekly email?'],
    });
    expect(text).toBe('Ideas\n\nWidget\n• Next step only\n• Dark mode\n\nStill open\n• Weekly email?');
  });
});
