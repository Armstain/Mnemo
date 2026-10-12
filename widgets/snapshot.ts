import AsyncStorage from '@react-native-async-storage/async-storage';

import type { WidgetSnapshot } from './CaptureWidget';

// The widget is drawn even when the app isn't running (from
// task-handler.ts), so the app leaves it what to show here.

const KEY = 'mnemo-widget';

export async function readWidgetSnapshot(): Promise<WidgetSnapshot> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as WidgetSnapshot) : {};
  } catch {
    return {};
  }
}

export async function writeWidgetSnapshot(snapshot: WidgetSnapshot): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(snapshot));
  } catch {
    // The widget keeps what it had.
  }
}
