import { describe, expect, it } from 'vitest';
import { bm25Scored } from '@/lib/bm25';
import { matchEntries, readPeriod, totalsFor } from '@/lib/find';

const now = new Date('2026-10-12T10:00:00').getTime();
const entry = (id: string, threadId: string, at: number, items: object[]) =>
  ({ id, threadId, createdAt: at, updatedAt: at, source: 'text', filing: { by: 'user' }, blocks: [{ kind: 'measures', items }] }) as never;
const spent = (value: number, label: string) => ({ metric: 'spent', value, unit: 'BDT', label, rollup: 'sum' });

describe('finding', () => {
  it('time words in a search', () => {
    expect(readPeriod('cng last week', now)).toMatchObject({ rest: 'cng', period: { label: 'Last week' } });
    expect(new Date(readPeriod('গত মাসে বাজার', now).period!.from).getMonth()).toBe(8);
    expect(new Date(readPeriod('hotel in march', now).period!.from).getMonth()).toBe(2);
    expect(new Date(readPeriod('december trip', now).period!.from).getFullYear()).toBe(2025);
    expect(readPeriod('i may call', now).period).toBeUndefined();
  });

  it('totals across threads, by time, ignoring question words', () => {
    const entries = [entry('1', 'a', now - 864e5, [spent(1500, 'CNG'), spent(200, 'lunch')]), entry('2', 'b', now - 20 * 864e5, [spent(800, 'cng')])];
    expect(totalsFor('cng', entries)[0]).toMatchObject({ total: 2300, count: 2, threads: 2 });
    expect(totalsFor('spent', entries)[0].threadIds.sort()).toEqual(['a', 'b']);
    expect(totalsFor('cng', entries, readPeriod('this week', now).period)[0]).toMatchObject({ total: 1500 });
    expect(totalsFor('how much did I spend on cng', entries)[0]).toMatchObject({ total: 2300 });
    expect(totalsFor('weight', [entry('3', 'c', now, [{ metric: 'weight', value: 70, unit: 'kg', rollup: 'latest' }])])).toEqual([]);
  });

  it('keyword search: Bangla, half words, whole words first', () => {
    const doc = (id: string, title: string, content = '') => ({ id, title, content, tags: [], category: 'general', updatedAt: 1 }) as never;
    const docs = [doc('x', 'Passport renewal'), doc('y', 'Pass the salt'), doc('z', 'ঢাকা বাজার', 'চাল ডাল তেল')];
    expect(bm25Scored('passp', docs).map((r) => r.doc.id)).toEqual(['x']);
    expect(bm25Scored('pass', docs)[0].doc.id).toBe('y');
    expect(bm25Scored('ডাল', docs).map((r) => r.doc.id)).toEqual(['z']);
  });

  it('inside one thread', () => {
    const e = [{ id: 'q' }, { id: 'r' }] as never[];
    const text = (x: { id: string }) => (x.id === 'r' ? 'CNG fare to Sylhet' : 'lunch');
    expect(matchEntries(e, 'cng fa', text).map((x: { id: string }) => x.id)).toEqual(['r']);
  });
});
