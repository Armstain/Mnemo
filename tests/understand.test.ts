import { describe, expect, it } from 'vitest';
import { readWhen, understand } from '@/lib/understand';

const now = new Date('2026-10-12T10:00:00').getTime(); // a Monday
const read = (text: string) => understand(text, { now });
const at = (ts?: number) => (ts ? new Date(ts).toString().slice(0, 21) : undefined);

describe('reading a note on the phone', () => {
  it('Banglish and Bangla amounts', () => {
    expect(read('cng khoroch gese der hajar taka').measures).toEqual([
      { metric: 'spent', value: 1500, unit: 'BDT', label: 'cng', group: 'transport', rollup: 'sum' },
    ]);
    expect(read('সিএনজি খরচ গেছে দেড় হাজার টাকা').measures[0]).toMatchObject({ value: 1500, unit: 'BDT', label: 'সিএনজি' });
  });

  it('several amounts in one note, one currency', () => {
    const m = read('rickshaw 50, lunch 120, hotel 2,500 taka').measures;
    expect(m.map((x) => [x.label, x.value, x.group])).toEqual([
      ['rickshaw', 50, 'transport'],
      ['lunch', 120, 'food'],
      ['hotel', 2500, 'stay'],
    ]);
  });

  it('labels after the amount', () => {
    const m = read('Spent $20 on lunch and 15 dollars on a cab').measures;
    expect(m.map((x) => [x.label, x.value, x.unit])).toEqual([
      ['lunch', 20, 'USD'],
      ['cab', 15, 'USD'],
    ]);
  });

  it('quantities, phone numbers and "in 5 minutes" are not readings', () => {
    expect(read('bought 2 kg rice for 180 taka').measures.map((m) => m.value)).toEqual([180]);
    expect(read('call mom 01712345678. paid 500 taka for fuel').measures.map((m) => m.value)).toEqual([500]);
    expect(read('the shop is 2 km away, will go in 5 minutes').measures).toEqual([]);
  });

  it('activity readings', () => {
    expect(read('ran 5 km, weight 72.4 kg').measures.map((m) => [m.metric, m.value, m.rollup])).toEqual([
      ['ran', 5, 'sum'],
      ['weight', 72.4, 'latest'],
    ]);
    expect(read('slept 6 hours').measures[0]).toMatchObject({ metric: 'sleep', rollup: 'average' });
  });

  it('next step, due time, title without the time', () => {
    const r = read('Need to call the plumber tomorrow at 5pm about the kitchen leak');
    expect(r.nextStep).toBe('Call the plumber about the kitchen leak');
    expect(at(r.due)).toBe('Tue Oct 13 2026 17:00');
    expect(r.title).toBe('Call the plumber about the kitchen leak');
  });

  it('Bangla and Banglish steps and times', () => {
    expect(at(read('কাল বিকাল ৫টায় ডাক্তারের কাছে যেতে হবে').due)).toBe('Tue Oct 13 2026 17:00');
    expect(at(read('kal sokal 10 tay bank e jete hobe').due)).toBe('Tue Oct 13 2026 10:00');
    expect(read('আজকে অফিসে মিটিং ছিল, কাল প্রেজেন্টেশন দিতে হবে').nextStep).toBe('প্রেজেন্টেশন দিতে হবে');
  });

  it('lists, typed or said', () => {
    expect(read('Shopping list:\n- milk\n- eggs\n- [x] bread').checklist.map((c) => [c.text, c.checked])).toEqual([
      ['milk', false],
      ['eggs', false],
      ['bread', true],
    ]);
    expect(read('buy milk, eggs, bread and butter').checklist.map((c) => c.text)).toEqual(['Milk', 'Eggs', 'Bread', 'Butter']);
    const bn = read('ঢাকা ফিরে বাজার করতে হবে: চাল, ডাল, তেল আর পেঁয়াজ');
    expect(bn.checklist).toHaveLength(4);
    expect(bn.nextStep).toBe('ঢাকা ফিরে বাজার করতে হবে');
  });

  it('links, tags, category, left off', () => {
    const r = read('check https://example.com/foo. and www.test.org #trip #ঢাকা');
    expect(r.links).toEqual(['https://example.com/foo', 'https://www.test.org']);
    expect(r.tags).toEqual(['trip', 'ঢাকা']);
    expect(r.title).toBe('example.com');
    const book = read('Read 30 pages of Sapiens, stopped at chapter 4. Finish it by friday');
    expect(book.leftOff).toBe('Read 30 pages of Sapiens, stopped at chapter 4');
    expect(book.nextStep).toBe('Finish it');
    expect(at(book.due)).toBe('Fri Oct 16 2026 09:00');
    expect(read('Meeting with client about the invoice').category).toBe('work');
  });

  it('a heading before a colon is the title', () => {
    expect(read('Lisbon trip: dinner €40, museum 12 euros').title).toBe('Lisbon trip');
  });

  it('dates: day/month order follows the phone', () => {
    expect(at(readWhen('pay rent on 3/11', now))).toBe('Tue Nov 03 2026 09:00');
    expect(at(readWhen('pay rent on 3/11', now, true))).toBe('Thu Mar 11 2027 09:00');
    expect(readWhen('call today', new Date('2026-10-12T20:00:00').getTime())).toBeUndefined();
  });
});

describe('a time with no day', () => {
  const at = (s: string) => new Date(s).getTime();
  const noon = at('2026-10-14T13:09:00');
  it('"at 6 pm" is today at six while it is still ahead', () => {
    expect(readWhen('remind to charge my watch and ear buds at 6 pm', noon)).toBe(at('2026-10-14T18:00:00'));
  });
  it('and tomorrow once it has passed', () => {
    expect(readWhen('call amma at 9 am', noon)).toBe(at('2026-10-15T09:00:00'));
  });
  it('Bangla and Banglish times too', () => {
    expect(readWhen('বিকাল ৫টায় ঔষধ খেতে হবে', noon)).toBe(at('2026-10-14T17:00:00'));
    expect(readWhen('rat 9 tay call dite hobe', noon)).toBe(at('2026-10-14T21:00:00'));
  });
  it('an amount is not a time', () => {
    expect(readWhen('lunch 450 taka, tea 120 taka', noon)).toBeUndefined();
  });
  it('"remind me to" is the next step, and the title drops it', () => {
    const r = understand('remind me to charge my watch and ear buds at 6 pm', { now: noon });
    expect(r.title).toBe('Charge my watch and ear buds');
    expect(r.nextStep).toBe('Charge my watch and ear buds');
    expect(r.due).toBe(at('2026-10-14T18:00:00'));
  });
});

describe('a time counted from now', () => {
  const at = (s: string) => new Date(s).getTime();
  const seven = at('2026-10-14T19:00:00');
  it('"in 20 mins … remind me": a reminder at 7:20, not 20 minutes of exercise', () => {
    const r = understand('I’ll go to the gym in 20 mins remind me', { now: seven });
    expect(r.due).toBe(at('2026-10-14T19:20:00'));
    expect(r.measures).toEqual([]);
    expect(r.nextStep).toBe('Go to the gym');
    expect(r.title).toBe('Go to the gym');
  });
  it('hours, half an hour, words', () => {
    expect(readWhen('call amma in an hour', seven)).toBe(at('2026-10-14T20:00:00'));
    expect(readWhen('need to leave in half an hour', seven)).toBe(at('2026-10-14T19:30:00'));
    expect(readWhen('take the pill in 2 hours', seven)).toBe(at('2026-10-14T21:00:00'));
  });
  it('Bangla and Banglish', () => {
    expect(readWhen('২০ মিনিট পরে ওষুধ খেতে হবে', seven)).toBe(at('2026-10-14T19:20:00'));
    expect(readWhen('1 ghonta pore call dite hobe', seven)).toBe(at('2026-10-14T20:00:00'));
  });
  it('a duration that is a reading stays one', () => {
    const r = understand('Went to the gym for 45 min', { now: seven });
    expect(r.measures.map((m) => [m.metric, m.value, m.unit])).toEqual([['exercise', 45, 'min']]);
    expect(r.due).toBeUndefined();
  });
  it('curly apostrophes read like straight ones', () => {
    expect(understand('I’ll send the quote tomorrow', { now: seven }).nextStep).toBe('Send the quote');
  });
});
