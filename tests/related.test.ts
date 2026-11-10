import { describe, expect, it } from 'vitest';
import { linkKey, relatedLocally } from '@/lib/related';
import type { Entry, MnemoItem } from '@/types/mnemo';

let clock = 1;
const thread = (id: string, title: string, content = '', o: Partial<MnemoItem> = {}): MnemoItem => ({
  id,
  title,
  content,
  tags: [],
  status: 'active',
  category: 'general',
  links: [],
  type: 'note',
  createdAt: 1,
  // Each one its own, so nothing read for an earlier test is reused.
  updatedAt: clock++,
  ...o,
});
const DAY = 86_400_000;
const entry = (threadId: string, day: number, o: Partial<Entry> = {}): Entry => ({
  id: `${threadId}-${day}-${clock++}`,
  threadId,
  createdAt: new Date(2026, 0, 1, 10).getTime() + day * DAY,
  updatedAt: 1,
  source: 'text',
  blocks: [],
  filing: { by: 'user' },
  ...o,
});
const ids = (found: { item: MnemoItem }[]) => found.map((f) => f.item.id);

// Unrelated threads, so words have something to be uncommon against.
const filler = () => [
  thread('f1', 'Gym routine', 'Leg day on Sunday, then stretching.'),
  thread('f2', 'Birthday gift', 'Something small for mother, maybe a scarf.'),
  thread('f3', 'Roadmap draft', 'Third quarter priorities and the launch plan.'),
  thread('f4', 'Grocery list', 'Rice, lentils, onions, cooking oil.'),
];

describe('related threads, on the phone', () => {
  it('finds a thread by words in the notes, not only the title', () => {
    const self = thread('a', 'Passport renewal', 'Went to the office. They said talk to Rahman about the visa form.');
    const other = thread('b', 'Embassy appointment', 'Call Rahman before the visa interview on the 12th.');
    const found = relatedLocally(self, [self, other, ...filler()]);
    expect(ids(found)).toEqual(['b']);
    expect(found[0].reason).toBe('Both mention “Rahman” and “visa”');
  });

  it('one shared everyday word is not a connection, a shared name is', () => {
    const self = thread('a', 'Laptop repair', 'The screen flickers. Ask the shop about the warranty.');
    const everyday = thread('b', 'Flat hunting', 'The second flat has a big screen door and a balcony.');
    const named = thread('c', 'Dinner plans', 'Maybe ask Farhan where he ate last week.');
    const self2 = thread('d', 'Cricket tickets', 'Check if Farhan still wants to come along.');
    const all = [self, everyday, named, self2, ...filler()];
    expect(relatedLocally(self, all)).toEqual([]);
    expect(ids(relatedLocally(self2, all))).toEqual(['c']);
  });

  it('a word most threads carry connects none of them', () => {
    const threads = Array.from({ length: 9 }, (_, i) => thread(`t${i}`, `Office errand ${i}`, 'Office paperwork again.'));
    expect(relatedLocally(threads[0], threads)).toEqual([]);
  });

  it('the same link counts whatever was added to it; a common site does not', () => {
    const self = thread('a', 'Desk options', '', { links: ['https://www.example-shop.com/desks/oak?utm_source=fb'] });
    const same = thread('b', 'Home office', '', { links: ['http://example-shop.com/desks/oak/'] });
    const site = thread('c', 'Shelves', '', { links: ['https://example-shop.com/shelves'] });
    const video = thread('d', 'Watch later', '', { links: ['https://youtube.com/watch?v=1'] });
    const self2 = thread('e', 'Guitar lessons', '', { links: ['https://youtube.com/watch?v=2'] });
    const all = [self, same, site, video, self2];
    const found = relatedLocally(self, all);
    expect(ids(found)).toEqual(['b', 'c']);
    expect(found[0].reason).toBe('Saves the same link');
    expect(found[1].reason).toBe('Both link to example-shop.com');
    expect(relatedLocally(self2, all)).toEqual([]);
    expect(linkKey('https://www.a.com/x/?utm_medium=y&id=3#top')?.key).toBe('a.com/x?id=3');
  });

  it('a rare shared tag ranks above a tag on many threads', () => {
    const self = thread('a', 'Sylhet trip', '', { tags: ['travel', 'personal'] });
    const rare = thread('b', 'Hotel booking', '', { tags: ['travel'] });
    const common = thread('c', 'Dentist', '', { tags: ['personal'] });
    const more = ['d', 'e', 'f'].map((id) => thread(id, `Thing ${id}`, '', { tags: ['personal'] }));
    const found = relatedLocally(self, [self, common, rare, ...more], { limit: 2 });
    expect(found[0].item.id).toBe('b');
    expect(found[0].reason).toBe('Also tagged #travel');
  });

  it('reads the same saved place, the same measure, and a suggested note', () => {
    const place = { placeId: 'p1', on: 'arrive' as const, setAt: 1 };
    const self = thread('a', 'Buy fish', '', { place });
    const there = thread('b', 'Return the kettle', '', { place });
    const weighA = thread('c', 'Morning weight');
    const weighB = thread('d', 'Diet plan');
    const loose = thread('e', 'Loose thought');
    const all = [self, there, weighA, weighB, loose];
    const kg = (v: number) => [{ kind: 'measures' as const, items: [{ metric: 'Weight', value: v, unit: 'kg', rollup: 'latest' as const }] }];
    const entries = [
      entry('c', 0, { blocks: kg(71) }),
      entry('d', 9, { blocks: kg(70) }),
      entry('e', 3, { filing: { by: 'suggested', threadId: 'a', confidence: 0.6 } }),
    ];
    const places = [{ id: 'p1', name: 'Market', latitude: 0, longitude: 0, radius: 150, accuracy: 10, savedAt: 1 }];

    const forA = relatedLocally(self, all, { entries, places });
    expect(forA.map((f) => [f.item.id, f.reason])).toEqual([
      ['e', 'Has a note that may belong here'],
      ['b', 'Both for Market'],
    ]);
    expect(relatedLocally(weighA, all, { entries })[0]).toMatchObject({ item: { id: 'd' }, reason: 'Both track weight' });
    expect(relatedLocally(loose, all, { entries })[0].reason).toBe('A note here may belong there');
  });

  it('money spent connects nothing; what it was spent on does', () => {
    const a = thread('a', 'March costs');
    const b = thread('b', 'Office move');
    const c = thread('c', 'Cox trip');
    const spent = (group?: string) => [
      { kind: 'measures' as const, items: [{ metric: 'spent', value: 100, unit: 'BDT', group, rollup: 'sum' as const }] },
    ];
    const entries = [entry('a', 0, { blocks: spent('transport') }), entry('b', 1, { blocks: spent() }), entry('c', 2, { blocks: spent('Transport') })];
    expect(relatedLocally(a, [a, b, c], { entries }).map((f) => [f.item.id, f.reason])).toEqual([['c', 'Both track transport']]);
  });

  it('threads added to on the same days, again and again, are related; one shared sitting is not', () => {
    const a = thread('a', 'Standup notes');
    const b = thread('b', 'Sprint board');
    const c = thread('c', 'Stray idea');
    const daily = thread('d', 'Journal');
    const entries = [
      ...[0, 7, 14, 21].flatMap((d) => [entry('a', d), entry('b', d)]),
      entry('c', 0),
      ...Array.from({ length: 30 }, (_, d) => entry('d', d)),
    ];
    const found = relatedLocally(a, [a, b, c, daily], { entries });
    expect(found.map((f) => [f.item.id, f.reason])).toEqual([['b', 'Often added to on the same days']]);
  });

  it('stored vectors lift a match and stand alone only when very close', () => {
    const v = (x: number) => Float32Array.from([x, Math.sqrt(1 - x * x)]);
    const self = thread('a', 'Sylhet trip', '', { tags: ['travel'] });
    const tagged = thread('b', 'Hotel booking', '', { tags: ['travel'] });
    const tagged2 = thread('c', 'Packing', '', { tags: ['travel'] });
    const close = thread('d', 'Tea garden visit');
    const fair = thread('e', 'Unrelated but fairly similar');
    const vectors = new Map([
      ['a', v(1)],
      ['c', v(0.75)],
      ['d', v(0.9)],
      ['e', v(0.7)],
    ]);
    const found = relatedLocally(self, [self, tagged, tagged2, close, fair], { vectors, limit: 5 });
    expect(ids(found)).toEqual(['c', 'd', 'b']);
    expect(found[1].reason).toBe('Very similar topic');
  });

  it('leaves out archived and unprocessed threads, and Bangla words match across endings', () => {
    const self = thread('a', 'ডাক্তার দেখানো', 'রহমান ডাক্তারের চেম্বার');
    const other = thread('b', 'রিপোর্ট আনা', 'ডাক্তারকে রিপোর্ট দেখাতে হবে');
    const archived = thread('c', 'ডাক্তার', '', { status: 'archived' });
    const pending = thread('d', 'ডাক্তার', '', { pending: true });
    expect(ids(relatedLocally(self, [self, other, archived, pending, ...filler()]))).toEqual(['b']);
  });
});
