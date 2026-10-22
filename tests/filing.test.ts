import { describe, expect, it } from 'vitest';
import { decideFiling, keywordMatch } from '@/lib/filing';

const candidate = (id: string, o: object = {}) => ({ id, title: id, category: 'personal', idleDays: 0, ...o });
const thread = (id: string, title: string, content = '') =>
  ({ id, title, content, tags: [], status: 'active', category: 'personal', createdAt: 1, updatedAt: 1, links: [], type: 'note' }) as never;

describe('filing', () => {
  it('a sure match files, a likely one suggests, a stale one only suggests', () => {
    const match = (confidence: number) => ({ match: 'existing' as const, threadId: 'trip', confidence, reason: '' });
    expect(decideFiling({ filedBy: 'new', match: match(0.9), candidates: [candidate('trip')] }).action).toBe('attach');
    expect(decideFiling({ filedBy: 'new', match: match(0.6), candidates: [candidate('trip')] }).action).toBe('suggest');
    expect(decideFiling({ filedBy: 'new', match: match(0.95), candidates: [candidate('trip', { idleDays: 31 })] }).action).toBe('suggest');
  });

  it('a confident answer outside the closest three is only suggested', () => {
    const similarity = new Map([['a', 0.9], ['b', 0.8], ['c', 0.7], ['trip', 0.1]]);
    const match = { match: 'existing' as const, threadId: 'trip', confidence: 0.9, reason: '' };
    expect(decideFiling({ filedBy: 'new', match, candidates: [candidate('trip')], similarity }).action).toBe('suggest');
  });

  it('offline: suggests only when the words clearly point one way', () => {
    const threads = [thread('s', 'Sylhet trip', 'Reached Sylhet. Tea garden tomorrow.'), thread('r', 'Rickshaw 50, hotel 2,500 taka')];
    expect(keywordMatch({ text: 'The tea garden in Sylhet was beautiful', threads })?.threadId).toBe('s');
    expect(keywordMatch({ text: 'sylhet hotel bill 3000 taka', threads })).toBeNull();
  });

  it('offline: a Bangla note finds the thread named by the plain word', () => {
    const threads = [thread('d', 'ডাক্তার দেখানো'), thread('b', 'Office budget')];
    expect(keywordMatch({ text: 'ডাক্তারকে ফোন করতে হবে', threads })?.threadId).toBe('d');
  });
});
