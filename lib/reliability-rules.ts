// Which reminder settings need changing on which phone. Pure, so it's
// tested (tests/reliability.test.ts); lib/reliability.ts reads the phone.

export type CheckState = 'ok' | 'fix' | 'check';

/** What modules/mnemo-reliability reads on Android. */
export interface NativeStatus {
  manufacturer: string;
  brand: string;
  sdk: number;
  exactAlarms: boolean;
  batteryUnrestricted: boolean;
  backgroundRestricted: boolean;
  autostart: boolean | null;
}

/** Makers whose battery managers are known to hold back or drop reminders. */
export const STRICT: Record<string, string> = {
  xiaomi: 'Xiaomi',
  redmi: 'Redmi',
  poco: 'POCO',
  oppo: 'Oppo',
  realme: 'Realme',
  oneplus: 'OnePlus',
  vivo: 'Vivo',
  iqoo: 'iQOO',
  huawei: 'Huawei',
  honor: 'Honor',
  infinix: 'Infinix',
  tecno: 'Tecno',
  itel: 'itel',
  samsung: 'Samsung',
  asus: 'Asus',
};
/** Makers with their own autostart switch (modules/mnemo-reliability opens it). */
const AUTOSTART = new Set(['xiaomi', 'oppo', 'realme', 'oneplus', 'vivo', 'iqoo', 'huawei', 'honor', 'infinix', 'tecno', 'itel', 'asus']);
/** Makers that turn off pop-up and lock-screen notifications for new apps. */
const QUIET_POPUPS = new Set(['xiaomi', 'oppo', 'realme', 'vivo', 'iqoo', 'huawei', 'honor']);

/**
 * Each check's state. "check" means it matters here but can't be read (a
 * maker's own battery saver, or a build without the native module), so the
 * person looks once; the test reminder settles it.
 */
export function judge(
  s: NativeStatus | null,
  { sdk, maker, strict }: { sdk: number; maker: string; strict: boolean },
): { exactAlarms: CheckState | null; battery: CheckState; autostart: CheckState | null; popups: CheckState | null } {
  // Exact alarms only exist from Android 12 (API 31).
  const exactAlarms: CheckState | null = sdk < 31 ? null : s ? (s.exactAlarms ? 'ok' : 'fix') : 'check';
  // Restricted is always wrong and unrestricted always right; "optimized"
  // only matters on strict phones, where the maker's saver sits on top.
  const battery: CheckState = !s ? 'check' : s.backgroundRestricted ? 'fix' : s.batteryUnrestricted ? 'ok' : strict ? 'check' : 'ok';
  const autostart: CheckState | null = !AUTOSTART.has(maker) ? null : s?.autostart === true ? 'ok' : s?.autostart === false ? 'fix' : 'check';
  return { exactAlarms, battery, autostart, popups: QUIET_POPUPS.has(maker) ? 'check' : null };
}
