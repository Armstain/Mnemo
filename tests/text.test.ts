import { describe, expect, it } from 'vitest';
import { sameWords, withoutLead } from '@/utils/text';

describe('saying the same thing twice', () => {
  it('ignores case and punctuation', () => {
    expect(sameWords('Q4 roadmap draft for Priya', 'q4 roadmap draft, for Priya.')).toBe(true);
    expect(sameWords('Book idea', 'Book ideas')).toBe(false);
  });

  it('drops a title repeated at the start of a preview', () => {
    expect(withoutLead('Book idea: a short story about a lighthouse', 'Book idea')).toBe('A short story about a lighthouse');
    expect(withoutLead('Groceries for Sunday — feta, lemons', 'Groceries for Sunday')).toBe('Feta, lemons');
    expect(withoutLead('Q4 roadmap draft for Priya', 'Q4 roadmap draft for Priya')).toBe('');
  });

  it('only drops whole words, and leaves other text alone', () => {
    expect(withoutLead('Bookkeeping for March', 'Book')).toBe('Bookkeeping for March');
    expect(withoutLead('Call the plumber', 'Passport renewal')).toBe('Call the plumber');
  });

  it('works for Bangla', () => {
    expect(withoutLead('বাজার: ডিম, দুধ', 'বাজার')).toBe('ডিম, দুধ');
    expect(sameWords('কাল মিটিং', 'কাল মিটিং।')).toBe(true);
  });
});
