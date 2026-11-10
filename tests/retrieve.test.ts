import { describe, expect, it } from 'vitest';
import { chunkEntries, packContext, queryTerms, retrieve, sameThing, splitText, textHash } from '@/lib/retrieve';
import type { Entry, MnemoItem } from '@/types/mnemo';

const DAY = 86_400_000;
const thread = (id: string, title: string, o: Partial<MnemoItem> = {}) =>
  ({ id, title, content: '', tags: [], status: 'active', category: 'general', links: [], type: 'note', createdAt: 1, updatedAt: 1, ...o }) as MnemoItem;
const entry = (id: string, threadId: string, text: string, day = 0, o: Partial<Entry> = {}): Entry => ({
  id,
  threadId,
  createdAt: new Date(2026, 0, 1, 10).getTime() + day * DAY,
  updatedAt: 1,
  source: 'text',
  blocks: [{ kind: 'text', markdown: text }],
  filing: { by: 'user' },
  ...o,
});
const found = (hits: { chunk: { entryId: string } }[]) => hits.map((h) => h.chunk.entryId);

const items = [thread('reminders', 'Location reminders'), thread('trip', 'Sylhet trip'), thread('flat', 'Flat hunting')];
const entries = [
  entry('r1', 'reminders', 'Idea: remind me when I arrive at a place. Geofence around saved places.', 0),
  entry('r2', 'reminders', 'Decided the minimum radius is 150 metres, smaller circles miss arrivals.', 3),
  entry('r3', 'reminders', 'Problem: the geofence does not fire when battery saver is on.', 9),
  entry('s1', 'trip', 'Hotel booked for two nights. Ratargul আর Jaflong দুইটাই যাবো।', 1),
  entry('s2', 'trip', 'সিলেটে বৃষ্টি হবে, রেইনকোট নিতে হবে।', 2),
  entry('f1', 'flat', 'The Mohammadpur flat has low water pressure in the morning.', 4),
];
const chunks = chunkEntries(items, entries);

describe('finding what was said', () => {
  it('cuts long notes at paragraphs and sentences, and leaves short ones whole', () => {
    expect(splitText('One short thought.')).toEqual(['One short thought.']);
    const long = `${'First paragraph sentence. '.repeat(20).trim()}\n\n${'Second paragraph sentence. '.repeat(20).trim()}`;
    const parts = splitText(long, 300);
    expect(parts.length).toBeGreaterThan(2);
    expect(parts.every((p) => p.length <= 300)).toBe(true);
    expect(parts.join(' ').replace(/\s+/g, ' ')).toBe(long.replace(/\s+/g, ' '));
    expect(splitText('x'.repeat(1000), 300).every((p) => p.length <= 300)).toBe(true);
  });

  it('keys a passage by its words, however they were spaced or cased', () => {
    expect(textHash('Call  Rahim\ntomorrow')).toBe(textHash('call rahim tomorrow'));
    expect(textHash('call rahim tomorrow')).not.toBe(textHash('call karim tomorrow'));
  });

  it('reads the words asked about, not the words of asking', () => {
    expect(queryTerms('What did I say about the geofence battery?')).toEqual(['geofence', 'battery']);
    expect(queryTerms('what did I do')).not.toEqual([]);
  });

  it('finds the entry that answers, not just the thread', () => {
    expect(found(retrieve('what radius did I decide on?', chunks))[0]).toBe('r2');
    expect(found(retrieve('battery saver problem', chunks))[0]).toBe('r3');
  });

  it("a thread's title counts for each of its entries, and another form of a word still matches", () => {
    expect(found(retrieve('flat water', chunks))).toEqual(['f1']);
    expect(found(retrieve('deciding the radius', chunks))[0]).toBe('r2');
  });

  it('finds Bangla across word endings, and mixed notes by either script', () => {
    expect(found(retrieve('সিলেটের বৃষ্টি', chunks))[0]).toBe('s2');
    expect(found(retrieve('Jaflong যাবো?', chunks))[0]).toBe('s1');
  });

  it('leaves out archived threads and notes still waiting to be read', () => {
    const some = chunkEntries(
      [thread('a', 'Kept'), thread('b', 'Gone', { status: 'archived' })],
      [entry('a1', 'a', 'kettle'), entry('a2', 'a', 'kettle again', 0, { pending: true }), entry('b1', 'b', 'kettle')],
    );
    expect(some.map((c) => c.entryId)).toEqual(['a1']);
  });

  it('meaning finds what shares no word, and adds to words when both are there', () => {
    // Each passage points its own way, and towards the question by `x`.
    const v = (x: number, own = 0) => {
      const out = new Float32Array(chunks.length + 1);
      out[0] = x;
      out[own + 1] = Math.sqrt(1 - x * x);
      return out;
    };
    const chunkVectors = new Map(chunks.map((c, i) => [c.hash, v(c.entryId === 'r2' ? 0.95 : c.entryId === 'f1' ? 0.7 : 0.2, i)]));
    const options = { queryVector: v(1), chunkVectors };
    expect(found(retrieve('how wide is it', chunks, options))).toEqual(['r2', 'f1']);
    expect(found(retrieve('how wide is it', chunks, { ...options, mode: 'keyword' }))).toEqual([]);
    // "geofence" is in r1 and r3 by word; r2 is closest by meaning, and comes back too.
    expect(found(retrieve('geofence', chunks, options))).toEqual(expect.arrayContaining(['r1', 'r3', 'r2']));
    // Without vectors it is the keyword ranking, never an error.
    expect(found(retrieve('geofence', chunks, { queryVector: v(1) })).sort()).toEqual(['r1', 'r3']);
  });

  it('the same thing said twice shows once', () => {
    const twice = chunkEntries(
      [thread('a', 'Car')],
      [
        entry('a1', 'a', 'The mechanic said the brake pads need changing soon.', 0),
        entry('a2', 'a', 'the mechanic said the brake pads need changing soon', 1),
        entry('a3', 'a', 'Engine oil was changed last month.', 2),
      ],
    );
    expect(sameThing(twice[0], twice[1])).toBe(true);
    expect(found(retrieve('brake pads', twice))).toHaveLength(1);
  });

  it('packs passages by thread, in the order they were said, within a budget', () => {
    const packed = packContext(retrieve('geofence radius battery', chunks));
    expect(packed[0]).toMatchObject({ id: 'reminders', title: 'Location reminders' });
    const at = (word: string) => packed[0].text.indexOf(word);
    expect(at('Idea')).toBeLessThan(at('Decided'));
    expect(at('Decided')).toBeLessThan(at('Problem'));
    expect(packed[0].text).toContain(new Date(2026, 0, 4, 10).toDateString());
    expect(packContext(retrieve('geofence radius battery', chunks), { perNoteChars: 120 })[0].text.length).toBeLessThanOrEqual(120);
  });
});
