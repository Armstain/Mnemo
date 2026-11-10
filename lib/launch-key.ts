import * as Crypto from 'expo-crypto';

import { storage } from '@/lib/storage';

// "Start recording now" links (the widget's Record button, the Record
// shortcut) carry this install's own secret. A mnemo:// link from anywhere
// else (a website, another app) opens the Record screen but never turns
// the microphone on by itself.

const KEY = 'mnemo-launch-key';
let cached: string | null = null;
let loading: Promise<string> | null = null;

/** This install's secret, made on first use. */
export function getLaunchKey(): Promise<string> {
  if (cached) return Promise.resolve(cached);
  if (!loading) {
    loading = (async () => {
      let key = await storage.get(KEY).catch(() => null);
      if (!key) {
        key = Crypto.randomUUID().replace(/-/g, '');
        await storage.set(KEY, key).catch(() => {});
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

export async function mayAutostart(key: string | undefined): Promise<boolean> {
  return !!key && key === (await getLaunchKey());
}
