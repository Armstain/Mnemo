import { describe, expect, it } from 'vitest';
import { asOutcome, outcomeLine, outcomeProblem, outcomeReport } from '@/lib/geofence-outcome';

// What Android answered, in words (lib/geofence-outcome.ts).

const at = new Date(2026, 10, 9, 9, 2).getTime();

describe("Android's answer, said plainly", () => {
  it('yes: how many places, since when, and whether it was set again after a restart', () => {
    expect(outcomeLine({ state: 'ok', count: 2, at }, at)).toMatch(/^Android is watching 2 places since .*9.*02/);
    expect(outcomeLine({ state: 'ok', count: 1, at, restored: true }, at)).toContain('1 place since');
    expect(outcomeLine({ state: 'ok', count: 1, at, restored: true }, at)).toContain('set again after a restart');
    expect(outcomeLine({ state: 'refused', code: 1000, count: 2 }, at)).toBeNull();
    expect(outcomeLine(null)).toBeNull();
  });

  it('no: the reason, pointing at the setting that fixes it', () => {
    expect(outcomeProblem({ state: 'refused', code: 1000 })).toMatchObject({ cause: 'accuracy' });
    expect(outcomeProblem({ state: 'dropped', code: 1000 })?.text).toContain('stopped watching');
    expect(outcomeProblem({ state: 'refused', code: 1004 })).toMatchObject({ cause: 'background' });
    expect(outcomeProblem({ state: 'no-permission' })).toMatchObject({ cause: 'background' });
    expect(outcomeProblem({ state: 'no-provider' })).toMatchObject({ cause: 'services' });
    expect(outcomeProblem({ state: 'refused', code: 1001 })?.text).toContain('too many places');
    expect(outcomeProblem({ state: 'refused', code: 9 })).toMatchObject({ cause: 'other' });
    expect(outcomeProblem({ state: 'unknown' })?.text).toContain("didn't answer");
    expect(outcomeProblem({ state: 'ok', count: 2 })).toBeNull();
    expect(outcomeProblem({ state: 'off' })).toBeNull();
  });

  it('the problem report: state, code, count, when, restored; no coordinates', () => {
    const line = outcomeReport({ state: 'refused', code: 1000, count: 2, at, restored: true, message: 'Geofencing not available.' }, at);
    expect(line).toMatch(/^Android geofences: refused · code 1000 · 2 places · .* · restored \(Geofencing not available\.\)$/);
    expect(outcomeReport(null)).toBe('Android geofences: no answer recorded');
  });

  it('a stored record from another build is checked, not trusted', () => {
    expect(asOutcome({ state: 'ok', count: 2, at, restored: true })).toEqual({ state: 'ok', count: 2, at, restored: true, code: undefined, message: undefined });
    expect(asOutcome({ state: 'something new' })).toBeNull();
    expect(asOutcome('ok')).toBeNull();
    expect(asOutcome({ state: 'refused', code: 'x', count: NaN })).toMatchObject({ state: 'refused', code: undefined, count: undefined, restored: false });
  });
});
