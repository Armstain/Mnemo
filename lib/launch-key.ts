import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

// "Start recording now" links (the widget's Record button, the Record
// shortcut) carry this install's own secret. A mnemo:// link from anywhere
// else (a website, another app) opens the Record screen but never turns
// the microphone on by itself.

const KEY = 'mnemo-launch-key';
let cached: string | null = null;
let loading: Promise<string> | null = null;

async function read(): Promise<string | null> {
  if (Platform.OS === 'web') return typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY);
  return AsyncStorage.getItem(KEY);
}

async function write(value: string): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, value);
    return;
  }
  await AsyncStorage.setItem(KEY, value);
}

/** This install's secret, made on first use. */
export function getLaunchKey(): Promise<string> {
  if (cached) return Promise.resolve(cached);
  if (!loading) {
    loading = (async () => {
      let key = await read().catch(() => null);
      if (!key) {
        key = Crypto.randomUUID().replace(/-/g, '');
        await write(key).catch(() => {});
      }
      cached = key;
      return key;
    })();
  }
  return loading;
}

/** The Record screen, set to start listening at once: only for our own buttons. */
export function recordNowHref(key: string): string {
  return `/dump?autostart=1&key=${key}`;
}

/** Whether a link asking to start recording came from one of our own buttons. */
export async function mayAutostart(key: string | undefined): Promise<boolean> {
  return !!key && key === (await getLaunchKey());
}
