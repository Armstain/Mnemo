import { describe, expect, it } from 'vitest';
import { begin, clearTrace, gist, subscribeTrace, took, trace, traceSnapshot } from '@/lib/trace';

describe('the live trace', () => {
  it('a step in progress is shown until it ends, then logged with how long it took', () => {
    clearTrace();
    const end = begin('gemini', 'gemini-2.5-flash · audio 120 KB');
    expect(traceSnapshot().active.map((a) => a.text)).toEqual(['gemini-2.5-flash · audio 120 KB']);
    end('ok', 'answered');
    end('error', 'twice');
    const { events, active } = traceSnapshot();
    expect(active).toEqual([]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ topic: 'gemini', text: 'gemini-2.5-flash · audio 120 KB → answered', level: 'ok' });
    expect(events[0].ms).toBeGreaterThanOrEqual(0);
  });

  it('tells listeners, and the snapshot only changes when something does', () => {
    clearTrace();
    let calls = 0;
    const off = subscribeTrace(() => calls++);
    const before = traceSnapshot();
    expect(traceSnapshot()).toBe(before);
    trace('voice', 'mic on');
    expect(calls).toBe(1);
    expect(traceSnapshot()).not.toBe(before);
    off();
    trace('voice', 'mic off');
    expect(calls).toBe(1);
  });

  it('keeps the last 300 steps', () => {
    clearTrace();
    for (let i = 0; i < 310; i++) trace('t', `step ${i}`);
    const { events } = traceSnapshot();
    expect(events).toHaveLength(300);
    expect(events[0].text).toBe('step 10');
  });

  it('says things briefly', () => {
    expect(gist('  buy   milk  ')).toBe('“buy milk”');
    expect(gist('a'.repeat(80), 10)).toBe(`“${'a'.repeat(9)}…”`);
    expect([took(850), took(3400), took(42_000)]).toEqual(['850 ms', '3.4 s', '42 s']);
  });
});
