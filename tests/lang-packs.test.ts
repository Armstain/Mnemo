import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { bm25Search, tokenize } from '@/lib/bm25';
import { telling } from '@/lib/filing';
import { chunkEntries, queryTerms, retrieve } from '@/lib/retrieve';
import { cleanSearchTerms } from '@/lib/search-terms';
import { deriveThreadCache } from '@/lib/threads';
import type { Entry, MnemoItem } from '@/types/mnemo';

const OLD_GAP = new RegExp('[^a-z0-9\\u00c0-\\u024f\\u0980-\\u09ff]+', 'g');
const OLD_DANDA = new RegExp('[\\u0964\\u0965]', 'g');
const OLD_BANGLA = new RegExp('[\\u0980-\\u09FF]');
const OLD_ENDINGS = ['গুলোর', 'গুলো', 'গুলি', 'দের', 'েরা', 'ের', 'এর', 'য়ের', 'কে', 'তে', 'টা', 'টি', 'টার', 'য়', 'র', 'ে']
  .map((e) => e.normalize('NFC'))
  .sort((a, b) => b.length - a.length);

function oldStrip(token: string): string {
  for (const ending of OLD_ENDINGS) {
    if (token.length > ending.length + 1 && token.endsWith(ending)) return token.slice(0, -ending.length);
  }
  return token;
}

function oldTokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFC')
    .replace(OLD_GAP, ' ')
    .replace(OLD_DANDA, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2)
    .map((token) => {
      if (OLD_BANGLA.test(token)) return oldStrip(oldStrip(token));
      if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
      return token;
    });
}

const OLD_COMMON = new Set(
  (
    'the and for with this that from have has had was were are will would should could about into over just ' +
    'need today tomorrow yesterday then also some more very really what when where which who why how note ' +
    'taka spent paid got went did done make made take took call called get buy' +
    ' ami amar tumi ache ase gese hobe korte korbo kore kal aj ajke'
  ).split(' '),
);
const OLD_COMMON_BN = new Set('আমি আমার আজ কাল আজকে হবে করতে করবো করে আছে গেছে টাকা এবং আর'.split(' ').map((w) => w.normalize('NFC')));
const oldTelling = (words: string[]) =>
  new Set(words.filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !OLD_COMMON.has(w) && !OLD_COMMON_BN.has(w)));
const OLD_ASKING = new Set(
  (
    'said say says tell told mention mentioned wrote write noted anything something everything thing things ' +
    'bolechi bolechilam bolsi likhechi likhechilam niye somporke ki kobe koto kothay keno'
  ).split(' '),
);
function oldQueryTerms(query: string): string[] {
  const all = [...new Set(oldTokenize(query))];
  const kept = [...oldTelling(all)].filter((t) => !OLD_ASKING.has(t));
  return kept.length > 0 ? kept : all;
}

const here = (file: string) => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');
const notes = JSON.parse(here('eval/retrieval/notes.json')) as { title: string; entries: { text: string }[] }[];
const questions = JSON.parse(here('eval/retrieval/questions.json')) as { q: string }[];
const samples = [
  ...notes.flatMap((t) => [t.title, ...t.entries.map((e) => e.text)]),
  ...questions.map((q) => q.q),
  ...here('tests/corpus/money.txt').split(/\r?\n/),
  'Paid ৳500 for the rickshaw, 2×3 photos, café at 5:30pm!!',
  'Ami kal dhaka jabo, ticket kinte hobe। ডাক্তারকে ফোন করতে হবে॥',
  'আজকে ব্যাংকে গিয়েছিলাম, meeting ছিল ৩টায় and the manager said okay',
  'tickets passes classes 1990s e-mail user@example.com https://example.com/a?b=1',
];

const thread = (id: string, title: string, o: Partial<MnemoItem> = {}) =>
  ({ id, title, content: '', tags: [], status: 'active', category: 'general', links: [], type: 'note', createdAt: 1, updatedAt: 1, ...o }) as MnemoItem;
const entry = (id: string, threadId: string, text: string, o: Partial<Entry> = {}): Entry => ({
  id,
  threadId,
  createdAt: 1,
  updatedAt: 1,
  source: 'text',
  blocks: [{ kind: 'text', markdown: text }],
  filing: { by: 'user' },
  ...o,
});
const found = (hits: { chunk: { entryId: string } }[]) => hits.map((h) => h.chunk.entryId);

describe('English and Bangla read exactly as before', () => {
  it('has samples in both languages', () => {
    expect(samples.length).toBeGreaterThan(100);
    expect(samples.some((s) => OLD_BANGLA.test(s))).toBe(true);
  });

  it('cuts the same words from every sample note and question', () => {
    for (const text of samples) expect(tokenize(text)).toEqual(oldTokenize(text));
  });

  it('keeps the same telling words and the same question words', () => {
    for (const text of samples) {
      expect([...telling(tokenize(text))]).toEqual([...oldTelling(oldTokenize(text))]);
      expect(queryTerms(text)).toEqual(oldQueryTerms(text));
    }
  });
});

describe('other languages', () => {
  it('keeps words in scripts it has no rules for', () => {
    expect(tokenize('पासपोर्ट नवीनीकरण')).toEqual(['पासपोर्ट', 'नवीनीकरण']);
    expect(tokenize('تجديد جواز السفر')).toEqual(['تجديد', 'جواز', 'السفر']);
    expect(tokenize('продлить паспорт')).toEqual(['продлить', 'паспорт']);
    expect(tokenize('love❤️you')).toEqual(['love', 'you']);
  });

  it('finds a note written in another script, and another form of its word', () => {
    const items = [thread('a', 'Документы'), thread('b', 'Groceries')];
    const entries = [entry('a1', 'a', 'Нужно продлить паспорт до июня.'), entry('b1', 'b', 'Milk, eggs and bread.')];
    const chunks = chunkEntries(items, entries);
    expect(found(retrieve('паспорт', chunks))).toEqual(['a1']);
    expect(found(retrieve('паспорта', chunks))).toEqual(['a1']);
    expect(bm25Search('паспорт', [thread('a', 'Документы', { content: 'Нужно продлить паспорт' }), thread('b', 'Groceries')]).map((i) => i.id)).toEqual(['a']);
  });
});

describe('hidden search terms', () => {
  const items = [thread('p', 'পাসপোর্ট'), thread('g', 'Groceries')];
  const entries = [
    entry('p1', 'p', 'পাসপোর্ট রিনিউ করতে হবে, ফি ৫৭৫০ টাকা।', { searchTerms: ['passport renewal', 'travel documents'] }),
    entry('g1', 'g', 'Milk, eggs and bread.'),
  ];

  it('find a note by words it never used, without changing its text', () => {
    const chunks = chunkEntries(items, entries);
    expect(found(retrieve('travel documents', chunks))).toEqual(['p1']);
    expect(found(retrieve('passport', chunks))).toEqual(['p1']);
    expect(chunks.find((c) => c.entryId === 'p1')!.text).not.toMatch(/travel|passport/);
    expect(found(retrieve('travel documents', chunkEntries(items, [entry('p1', 'p', 'পাসপোর্ট রিনিউ করতে হবে।'), entries[1]])))).toEqual([]);
  });

  it('are gathered onto the thread for the search box', () => {
    const cache = deriveThreadCache(entries.filter((e) => e.threadId === 'p'));
    expect(cache.searchTerms).toEqual(['passport renewal', 'travel documents']);
    expect(deriveThreadCache([entries[1]]).searchTerms).toBeUndefined();
    expect(bm25Search('travel documents', items)).toEqual([]);
    expect(bm25Search('travel documents', [{ ...items[0], ...cache, updatedAt: 2 }, items[1]]).map((i) => i.id)).toEqual(['p']);
  });

  it('are cleaned before they are kept', () => {
    expect(cleanSearchTerms([' Passport  Renewal ', 'passport renewal', 7, '', 'x', 'y'.repeat(60)])).toEqual(['passport renewal']);
    expect(cleanSearchTerms(undefined)).toBeUndefined();
    expect(cleanSearchTerms([])).toBeUndefined();
    expect(cleanSearchTerms(Array.from({ length: 30 }, (_, i) => `term ${i}`))).toHaveLength(12);
  });
});
