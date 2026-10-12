import { describe, expect, it } from 'vitest';
import { judge, type NativeStatus } from '@/lib/reliability-rules';

const status = (o: Partial<NativeStatus> = {}): NativeStatus => ({
  manufacturer: 'google',
  brand: 'google',
  sdk: 34,
  exactAlarms: true,
  batteryUnrestricted: false,
  backgroundRestricted: false,
  autostart: null,
  ...o,
});

describe('which reminder settings need changing', () => {
  it('a Pixel with exact alarms needs nothing', () => {
    expect(judge(status(), { sdk: 34, maker: 'google', strict: false })).toEqual({ exactAlarms: 'ok', battery: 'ok', autostart: null, popups: null });
  });
  it('Android 14 without exact alarms: fix', () => {
    expect(judge(status({ exactAlarms: false }), { sdk: 34, maker: 'google', strict: false }).exactAlarms).toBe('fix');
  });
  it('before Android 12 there is no exact alarm setting', () => {
    expect(judge(status({ sdk: 30 }), { sdk: 30, maker: 'google', strict: false }).exactAlarms).toBeNull();
  });
  it('restricted battery is always wrong', () => {
    expect(judge(status({ backgroundRestricted: true, batteryUnrestricted: true }), { sdk: 34, maker: 'google', strict: false }).battery).toBe('fix');
  });
  it("Xiaomi: battery can't be read unless unrestricted; autostart read from MIUI", () => {
    const x = (o: Partial<NativeStatus>) => judge(status({ manufacturer: 'xiaomi', ...o }), { sdk: 34, maker: 'xiaomi', strict: true });
    expect(x({})).toEqual({ exactAlarms: 'ok', battery: 'check', autostart: 'check', popups: 'check' });
    expect(x({ autostart: false }).autostart).toBe('fix');
    expect(x({ autostart: true, batteryUnrestricted: true })).toMatchObject({ autostart: 'ok', battery: 'ok' });
  });
  it('Samsung: no autostart switch, battery to check', () => {
    expect(judge(status({ manufacturer: 'samsung' }), { sdk: 34, maker: 'samsung', strict: true })).toEqual({ exactAlarms: 'ok', battery: 'check', autostart: null, popups: null });
  });
  it('without the native module everything is "check", never a false "ok"', () => {
    expect(judge(null, { sdk: 34, maker: 'infinix', strict: true })).toEqual({ exactAlarms: 'check', battery: 'check', autostart: 'check', popups: null });
  });
});
