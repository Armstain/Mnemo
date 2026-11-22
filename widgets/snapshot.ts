import { readJson, writeJson } from '@/lib/storage';

import type { WidgetSnapshot } from './CaptureWidget';

// The widget is drawn even when the app isn't running (from
// task-handler.ts), so the app leaves it what to show here.

const KEY = 'mnemo-widget';

export async function readWidgetSnapshot(): Promise<WidgetSnapshot> {
  try {
    return ((await readJson(KEY)) as WidgetSnapshot | null) ?? {};
  } catch {
    return {};
  }
}

export async function writeWidgetSnapshot(snapshot: WidgetSnapshot): Promise<void> {
  try {
    await writeJson(KEY, snapshot);
  } catch {
    // The widget keeps what it had.
  }
}
